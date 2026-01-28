use std::thread;
use crossbeam::channel::{bounded, Sender};
use tokio::sync::oneshot;
use bytes::Bytes;
use smallvec::SmallVec;
use crate::extensions::{self, TitanRuntime, WorkerAsyncResult};
use std::sync::{Arc, Mutex};

// ----------------------------------------------------------------------------
// TITANVM: HIGH-PERFORMANCE WORKER POOL (SCHEDULER V2)
// ----------------------------------------------------------------------------

pub enum WorkerCommand {
    Request(RequestTask),
    Resume {
        isolate_id: usize,
        drift_id: u32,
        result: WorkerAsyncResult,
    },
}

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

pub struct RuntimeManager {
    // Normal Priority (New Requests)
    request_tx: Sender<WorkerCommand>,
    // High Priority (Drift Resumes)
    _resume_tx: Sender<WorkerCommand>,
    
    _workers: Vec<thread::JoinHandle<()>>,
}

impl RuntimeManager {
    pub fn new(project_root: std::path::PathBuf, num_threads: usize) -> Self {
        // We Use 4x Isolates vs Threads to ensure Drift concurrency can exceed Thread count
        let num_isolates = std::cmp::max(num_threads * 4, 16); 
        
        // Priority Queues
        let (req_tx, req_rx) = bounded::<WorkerCommand>(10000);
        let (res_tx, res_rx) = bounded::<WorkerCommand>(10000);

        let tokio_handle = tokio::runtime::Handle::current();
        let (async_tx, mut async_rx) = tokio::sync::mpsc::channel::<extensions::AsyncOpRequest>(10000);
        
        // Global Async Executor (Tokio)
        tokio_handle.spawn(async move {
            println!("\x1b[38;5;39m[Titan]\x1b[0m Tokio Async Executor Online");
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

        // Registry of Isolates
        // Since V8 Isolates are NOT thread-safe, we must use a Mutex or 1-thread-at-a-time lock.
        // We use a Vec of Mutexes. The threads will 'pick' an isolate and lock it while working.
        let mut isolates = Vec::new();
        for i in 0..num_isolates {
            let rt = extensions::init_runtime_worker(
                i,
                project_root.clone(),
                res_tx.clone(), // Resumes go back to the high-priority queue
                tokio_handle.clone(),
                async_tx.clone(),
            );
            isolates.push(Arc::new(Mutex::new(rt)));
        }
        
        // Isolate State Registry
        let free_isolates = bounded::<usize>(num_isolates);
        for i in 0..num_isolates {
            // Set Isolate ID data for the native bridge to use
            let mut rt = isolates[i].lock().unwrap();
            let ptr = &mut *rt as *mut extensions::TitanRuntime as *mut std::ffi::c_void;
            rt.isolate.set_data(0, ptr);
            free_isolates.0.send(i).unwrap();
        }

        let isolates = Arc::new(isolates);
        let free_isolates_rx = free_isolates.1;
        let free_isolates_tx = free_isolates.0;

        let mut workers = Vec::new();
        for i in 0..num_threads {
            let req_rx_c = req_rx.clone();
            let res_rx_c = res_rx.clone();
            let isolates_c = isolates.clone();
            let free_isolates_tx_c = free_isolates_tx.clone();
            let free_isolates_rx_c = free_isolates_rx.clone();

            let handle = thread::Builder::new()
                .name(format!("titan-worker-{}", i))
                .spawn(move || {
                    loop {
                        // 1. Check for HIGHEST PRIORITY: Resumes
                        // Resumes are pinned to specific isolates, but ANY thread can pick them up.
                        if let Ok(cmd) = res_rx_c.try_recv() {
                             handle_resume(cmd, &isolates_c);
                             continue;
                        }

                        // 2. Regular Requests
                        // If no resumes, pick a new request IF an isolate is free.
                        crossbeam::select! {
                            recv(res_rx_c) -> cmd => {
                                if let Ok(cmd) = cmd {
                                    handle_resume(cmd, &isolates_c);
                                }
                            }
                            recv(req_rx_c) -> cmd => {
                                if let Ok(cmd) = cmd {
                                    // We need an isolate to handle a new request
                                    if let Ok(iso_id) = free_isolates_rx_c.recv() {
                                        handle_new_request(cmd, iso_id, &isolates_c, &free_isolates_tx_c);
                                    }
                                } else {
                                    break; // Channel closed
                                }
                            }
                        }
                    }
                })
                .expect("Failed to spawn worker thread");
            workers.push(handle);
        }

        Self {
            request_tx: req_tx,
            _resume_tx: res_tx,
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
        self.request_tx.send(WorkerCommand::Request(task)).map_err(|e| e.to_string())?;
        match rx.await {
            Ok(res) => Ok((res.json, res.timings)),
            Err(_) => Err("Worker channel closed".to_string()),
        }
    }
}

fn handle_new_request(
    cmd: WorkerCommand, 
    iso_id: usize, 
    isolates: &[Arc<Mutex<TitanRuntime>>],
    free_tx: &Sender<usize>
) {
    if let WorkerCommand::Request(task) = cmd {
        let mut rt = isolates[iso_id].lock().unwrap();
        rt.request_counter += 1;
        let request_id = rt.request_counter;
        rt.pending_requests.insert(request_id, task.response_tx);

        // Store request data for potential replay
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
            &mut rt,
            request_id,
            &task.action_name,
            task.body,
            &task.method,
            &task.path,
            &task.headers,
            &task.params,
            &task.query
        );
        
        // After execution, check if finished or suspended.
        // If finished, pending_requests will not have the key (removed by t._finish_request).
        // If suspended, it will still have the key.
        
        if !rt.pending_requests.contains_key(&request_id) {
             rt.active_requests.remove(&request_id);
             rt.request_start_counters.remove(&request_id);
        }
        
        // ALWAYS free the isolate for other work
        free_tx.send(iso_id).unwrap();
    }
}

fn handle_resume(
    cmd: WorkerCommand, 
    isolates: &[Arc<Mutex<TitanRuntime>>]
) {
    if let WorkerCommand::Resume { isolate_id, drift_id, result } = cmd {
        let mut rt = isolates[isolate_id].lock().unwrap();
        
        // 1. Identify which request this drift belongs to
        let req_id = rt.drift_to_request.get(&drift_id).copied().unwrap_or(0);
        
        // 2. Perform Timing
        let timing_type = if result.result.get("error").is_some() { "drift_error" } else { "drift" };
        rt.request_timings.entry(req_id).or_default().push((timing_type.to_string(), result.duration_ms));

        // 3. Store Result for Replay
        rt.completed_drifts.insert(drift_id, result.result);

        // 4. Reset drift counter for the replay? 
        // No, we need to match the drift_id.
        // But if we replay, the action calls drift() again. 
        // It will increment drift_counter again.
        // So we must RESET `drift_counter` to the start value for this request?
        // Or we use a deterministic counter based on call order.
        // `TitanRuntime.drift_counter` is global monotonic if we don't reset.
        // IF we use global monotonic, the 2nd run will generate NEW IDs.
        // So we must use a PER-REQUEST counter (or logic to match).
        
        // REPLAY STRATEGY:
        // We rely on `drift_id` being stable.
        // If `rt.drift_counter` is global, it is NOT stable across replays.
        // We need to SAVE `drift_counter` state? Or use a Request-Local counter.
        // Since we are single-threaded per isolate, we can just reset `drift_counter` if we treat the runtime as fresh for the request?
        // But `TitanRuntime` handles multiple requests sequentially.
        
        // Use `rt.request_drift_counter` map?
        // Let's assume for now we need to reset the counter for *this* request re-run.
        // But `drift_counter` is currently U32 on Runtime.
        // We need to fix that.
        
        // 5. Trigger Replay (If we have the data)
        // Check if we have active request data
        if let Some(req_data) = rt.active_requests.get(&req_id).cloned() {
            // Reset counter for deterministic ID generation? 
            // This is tricky if we interleaved multiple requests on same runtime (we don't, we free isolate after request).
            // So for a single request on an isolate, we can reset a local counter.
            // Let's add `rt.last_start_drift_id`?
            // Actually, if we just use `rt.drift_counter` and don't reset, the Replay will generate `drift_id + 1`.
            // But we stored result at `drift_id`.
            // So `drift()` needs to look up `drift_id` or `drift_id + 1`?
            // NO. The Replay MUST generate the SAME ID.
            // So `drift_counter` MUST be reset to what it was at start of request.
            
            let start_counter = rt.request_start_counters.get(&req_id).copied().unwrap_or(0);
            rt.drift_counter = start_counter; 

            extensions::execute_action_optimized(
                &mut rt,
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

        // 6. Check if finished
        if req_id != 0 && !rt.pending_requests.contains_key(&req_id) {
            // Clean up request data
            rt.active_requests.remove(&req_id);
            rt.request_start_counters.remove(&req_id);
        }
    }
}
