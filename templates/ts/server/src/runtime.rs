use bytes::Bytes;
use crossbeam::channel::{bounded, Sender};
use std::thread;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use smallvec::SmallVec;

use crate::extensions::{self, TitanRuntime, AsyncOpRequest, WorkerAsyncResult};

pub struct RuntimeManager {
    request_txs: Vec<Sender<WorkerCommand>>,
    round_robin_counter: AtomicUsize,
    _resume_txs: Vec<Sender<WorkerCommand>>, // Keep alive
    _workers: Vec<thread::JoinHandle<()>>,
}

pub enum WorkerCommand {
    Request(RequestTask),
    Resume {
        drift_id: u32,
        result: WorkerAsyncResult,
    },
}

#[allow(dead_code)]
pub struct RequestTask {
    pub action_name: String,
    pub body: Option<Bytes>,
    pub method: String,
    pub path: String,
    pub headers: SmallVec<[(String, String); 8]>,
    pub params: SmallVec<[(String, String); 4]>,
    pub query: SmallVec<[(String, String); 4]>,
    pub response_tx: oneshot::Sender<WorkerResult>,
}

pub struct WorkerResult {
    pub json: serde_json::Value,
    pub timings: Vec<(String, f64)>,
}

impl RuntimeManager {
    pub fn new(project_root: std::path::PathBuf, num_threads: usize, stack_size: usize) -> Self {
        let (async_tx, mut async_rx) = mpsc::channel::<AsyncOpRequest>(1000);
        
        let tokio_handle = tokio::runtime::Handle::current();

        // Spawn Tokio Async Handler
        tokio_handle.spawn(async move {
            while let Some(req) = async_rx.recv().await {
                let drift_id = req.drift_id;
                let respond_tx = req.respond_tx;
                tokio::spawn(async move {
                    let start = std::time::Instant::now();
                    let result = extensions::builtin::run_async_operation(req.op).await;
                    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
                    let _ = respond_tx.send(WorkerAsyncResult {
                        drift_id,
                        result,
                        duration_ms,
                    });
                });
            }
        });

        let mut worker_txs = Vec::new();
        let mut workers = Vec::new();

        // Pass 1: Create channels
        for _ in 0..num_threads {
            let (tx, rx) = bounded(100); 
            worker_txs.push((tx, rx));
        }

        let mut final_txs = Vec::new();
        for (tx, _) in &worker_txs {
            final_txs.push(tx.clone());
        }

        // Pass 2: Spawn Workers
        for (i, (tx, rx)) in worker_txs.into_iter().enumerate() {
            let my_tx = tx.clone(); // The worker needs a way to send commands to ITSELF (for resumes)
            let root = project_root.clone();
            let handle = tokio_handle.clone();
            let async_tx = async_tx.clone();
            
            let handle = thread::Builder::new()
                .name(format!("titan-worker-{}", i))
                .stack_size(stack_size)
                .spawn(move || {
                    // Start a thread with a pinned V8 isolate. 
                    // This thread will handle requests for this isolate exclusively.
                    let mut rt = extensions::init_runtime_worker(
                        i,
                        root,
                        my_tx, 
                        handle,
                        async_tx,
                        stack_size 
                    );
                    
                    // Bind the runtime instance to the V8 isolate data slot
                    // This is CRITICAL because native drift calls use this pointer.
                    rt.bind_to_isolate();

                    loop {
                        match rx.recv() {
                            Ok(cmd) => {
                                match cmd {
                                    WorkerCommand::Request(task) => {
                                         handle_new_request(task, &mut rt);
                                     },
                                    WorkerCommand::Resume { drift_id, result } => {
                                         handle_resume(drift_id, result, &mut rt);
                                     }
                                }
                            }
                            Err(_) => break, // Channel closed
                        }
                    }
                })
                .expect("Failed to spawn worker");

            workers.push(handle);
        }

        Self {
            request_txs: final_txs.clone(),
            round_robin_counter: AtomicUsize::new(0),
            _resume_txs: final_txs,
            _workers: workers,
        }
    
}

    pub async fn execute(
        &self, 
        action: String, 
        method: String, 
        path: String, 
        body: Option<Bytes>,
        headers: SmallVec<[(String, String); 8]>,
        params: SmallVec<[(String, String); 4]>,
        query: SmallVec<[(String, String); 4]>,
    ) -> Result<(serde_json::Value, Vec<(String, f64)>), String> {
        let (tx, rx) = oneshot::channel();
        let task = RequestTask {
            action_name: action,
            body,
            method,
            path,
            headers,
            params,
            query,
            response_tx: tx,
        };
        
        // Round Robin Distribution
        let idx = self.round_robin_counter.fetch_add(1, Ordering::Relaxed) % self.request_txs.len();
        self.request_txs[idx].send(WorkerCommand::Request(task)).map_err(|e| e.to_string())?;
        
        match rx.await {
            Ok(res) => Ok((res.json, res.timings)),
            Err(_) => Err("Worker channel closed".to_string()),
        }
    }
}

// ----------------------------------------------------------------------------
// HANDLERS (Simpler - No Mutex/Vec lookup)
// ----------------------------------------------------------------------------

fn handle_new_request(task: RequestTask, rt: &mut TitanRuntime) {
    rt.request_counter += 1;
    let request_id = rt.request_counter;
    rt.pending_requests.insert(request_id, task.response_tx);

    let req_data = extensions::RequestData {
        action_name: task.action_name.clone(),
        body: task.body.clone(),
        method: task.method.clone(),
        path: task.path.clone(),
        headers: task.headers.iter().map(|(k,v)| (k.clone(), v.clone())).collect(),
        params: task.params.iter().map(|(k,v)| (k.clone(), v.clone())).collect(),
        query: task.query.iter().map(|(k,v)| (k.clone(), v.clone())).collect(),
    };
    rt.active_requests.insert(request_id, req_data);
    let drift_count = rt.drift_counter;
    rt.request_start_counters.insert(request_id, drift_count);

    extensions::execute_action_optimized(
        rt,
        request_id,
        &task.action_name,
        task.body,
        &task.method,
        &task.path,
        &task.headers,
        &task.params,
        &task.query
    );
    
    // Cleanup if sync
    if !rt.pending_requests.contains_key(&request_id) {
         rt.active_requests.remove(&request_id);
         rt.request_start_counters.remove(&request_id);
    }
}

fn handle_resume(drift_id: u32, result: WorkerAsyncResult, rt: &mut TitanRuntime) {
    // 1. Identify which request this drift belongs to
    let req_id = rt.drift_to_request.get(&drift_id).copied().unwrap_or(0);
    
    // 2. Perform Timing
    let timing_type = if result.result.get("error").is_some() { "drift_error" } else { "drift" };
    rt.request_timings.entry(req_id).or_default().push((timing_type.to_string(), result.duration_ms));

    // 3. Store Result for Replay
    rt.completed_drifts.insert(drift_id, result.result);
    
    // 4. Trigger Replay
    if let Some(req_data) = rt.active_requests.get(&req_id).cloned() {
        let start_counter = rt.request_start_counters.get(&req_id).copied().unwrap_or(0);
        rt.drift_counter = start_counter; 

        extensions::execute_action_optimized(
            rt,
            req_id,
            &req_data.action_name,
            req_data.body,
            &req_data.method,
            &req_data.path,
            &req_data.headers,
            &req_data.params,
            &req_data.query
        );
    }

    // 5. Cleanup
    if req_id != 0 && !rt.pending_requests.contains_key(&req_id) {
        rt.active_requests.remove(&req_id);
        rt.request_start_counters.remove(&req_id);
    }
}
