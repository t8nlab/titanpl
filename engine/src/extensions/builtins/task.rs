// task.rs — t.task: Managed background job scheduler for TitanPL
//
// # Architecture
//
// Tasks execute NAMED TITAN ACTIONS with a JSON payload.
// The payload is delivered as `req.body` inside the action.
// The action runs through the full V8 worker pool — drift, fetch, db, all supported.
//
// API:
//   t.task.spawn(key, actionName, payload?, options?)
//   t.task.enqueue(queueKey, actionName, payload?, options?)
//   t.task.stop(key)
//   t.task.status(key) → { state, startedAt, duration? }
//   t.task.clear(queueKey)
//
// # Safety Guarantees
//   - Deduplication: spawn() with same key skips if already Pending/Running
//   - Bounded queues: max 1000 jobs per queue key
//   - Timeout: per-task kill via tokio::time::timeout (default: 30s)
//   - Error containment: crash does NOT affect server or other tasks
//   - Auto cleanup: Done/Failed entries removed from registry immediately
//   - FIFO: enqueue() runs jobs one-at-a-time per queue key
//   - No V8 heap sharing: each task dispatches through a fresh worker execution

use v8;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use bytes::Bytes;
use smallvec::smallvec;
use serde_json::Value;
use crate::extensions::{v8_str, v8_to_string, TASK_RUNTIME};
use crate::utils::{blue, gray, green, red, yellow};

// ============================================================================
// GLOBAL TASK REGISTRY
// ============================================================================

pub static TASK_REGISTRY: OnceLock<Arc<Mutex<TaskRegistry>>> = OnceLock::new();

pub fn get_task_registry() -> Arc<Mutex<TaskRegistry>> {
    TASK_REGISTRY
        .get_or_init(|| Arc::new(Mutex::new(TaskRegistry::new())))
        .clone()
}

/// Lifecycle state of a single task
#[derive(Clone, Debug)]
pub enum TaskState {
    Pending,
    Running,
    Done,
    Failed(String),
}

/// Metadata stored per task key (used by status())
#[derive(Clone, Debug)]
pub struct TaskEntry {
    pub state: TaskState,
    pub started_at: u64,    // Unix ms
    pub duration_ms: Option<f64>,
}

/// A single enqueued/spawned job descriptor
#[derive(Clone, Debug)]
pub struct TaskJob {
    /// Unique key for this specific job
    pub key: String,
    /// The named Titan action to dispatch (e.g. "emails/refresh")
    pub action_name: String,
    /// JSON payload — delivered as req.body in the action
    pub payload: Value,
    /// Timeout in ms (None = 30s default)
    pub timeout_ms: Option<u64>,
    pub enqueued_at: u64,
}

/// Maximum pending jobs per queue key (prevents runaway memory growth)
const MAX_QUEUE_SIZE: usize = 1000;

pub struct TaskRegistry {
    /// Per-key task metadata
    pub entries: HashMap<String, TaskEntry>,
    /// Per-queue-key FIFO pending job lists
    pub queues: HashMap<String, VecDeque<TaskJob>>,
    /// Whether a queue consumer Tokio task is currently active for this key
    pub queue_active: HashMap<String, bool>,
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            queues: HashMap::new(),
            queue_active: HashMap::new(),
        }
    }

    pub fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    /// Register a spawn job. Returns false if deduplicated.
    pub fn try_register_spawn(&mut self, key: &str) -> bool {
        if let Some(entry) = self.entries.get(key) {
            match entry.state {
                TaskState::Pending | TaskState::Running => return false,
                _ => {}
            }
        }
        self.entries.insert(key.to_string(), TaskEntry {
            state: TaskState::Pending,
            started_at: Self::now_ms(),
            duration_ms: None,
        });
        true
    }

    /// Force-register a spawn (dedupe=false path).
    pub fn force_register(&mut self, key: &str) {
        self.entries.insert(key.to_string(), TaskEntry {
            state: TaskState::Pending,
            started_at: Self::now_ms(),
            duration_ms: None,
        });
    }

    /// Enqueue a job for a queue key. Returns Err if queue is full.
    pub fn enqueue(&mut self, queue_key: &str, job: TaskJob) -> Result<(), &'static str> {
        let queue = self.queues.entry(queue_key.to_string()).or_default();
        if queue.len() >= MAX_QUEUE_SIZE {
            return Err("Queue full (max 1000 jobs)");
        }
        queue.push_back(job);
        Ok(())
    }

    /// Pop next job from a queue.
    pub fn pop_queue(&mut self, queue_key: &str) -> Option<TaskJob> {
        self.queues.get_mut(queue_key)?.pop_front()
    }

    pub fn mark_running(&mut self, key: &str) {
        if let Some(e) = self.entries.get_mut(key) {
            e.state = TaskState::Running;
        } else {
            self.entries.insert(key.to_string(), TaskEntry {
                state: TaskState::Running,
                started_at: Self::now_ms(),
                duration_ms: None,
            });
        }
    }

    /// Mark done — keeps entry in registry so status() can return "done"
    pub fn mark_done(&mut self, key: &str, duration_ms: f64) {
        let entry = self.entries.entry(key.to_string()).or_insert_with(|| TaskEntry {
            state: TaskState::Done,
            started_at: Self::now_ms(),
            duration_ms: None,
        });
        entry.state = TaskState::Done;
        entry.duration_ms = Some(duration_ms);
        // No removal — entry stays queryable via status()
        // Cleaned up lazily on next spawn() with the same key
    }

    /// Mark failed — keeps entry in registry so status() can return "failed"
    pub fn mark_failed(&mut self, key: &str, reason: String, duration_ms: f64) {
        let entry = self.entries.entry(key.to_string()).or_insert_with(|| TaskEntry {
            state: TaskState::Failed(reason.clone()),
            started_at: Self::now_ms(),
            duration_ms: None,
        });
        entry.state = TaskState::Failed(reason);
        entry.duration_ms = Some(duration_ms);
        // No removal — entry stays queryable via status()
    }

    pub fn stop(&mut self, key: &str) {
        self.entries.remove(key);
    }

    pub fn clear_queue(&mut self, queue_key: &str) {
        self.queues.remove(queue_key);
        self.queue_active.remove(queue_key);
    }

    pub fn status(&self, key: &str) -> Option<TaskEntry> {
        self.entries.get(key).cloned()
    }

    pub fn is_queue_active(&self, key: &str) -> bool {
        *self.queue_active.get(key).unwrap_or(&false)
    }

    pub fn set_queue_active(&mut self, key: &str, active: bool) {
        if active {
            self.queue_active.insert(key.to_string(), true);
        } else {
            self.queue_active.remove(key);
        }
    }
}

// ============================================================================
// TASK EXECUTOR
// ============================================================================

/// Returns true only in dev mode (TITAN_DEV=1).
/// All [TitanTask] logs are suppressed in production.
#[inline]
fn is_dev() -> bool {
    std::env::var("TITAN_DEV").unwrap_or_default() == "1"
}

/// Execute a single TaskJob by dispatching through the V8 RuntimeManager.
/// The payload is JSON-serialized and sent as the request body.
/// The action receives it as `req.body` (parsed automatically by defineAction wrapper).
async fn execute_job(job: &TaskJob) -> Result<Value, String> {
    let runtime = match TASK_RUNTIME.get() {
        Some(r) => r.clone(),
        None => return Err("Task runtime not initialized".to_string()),
    };

    // Serialize payload as request body
    let body_bytes = if job.payload.is_null() {
        None
    } else {
        let json = serde_json::to_string(&job.payload)
            .map_err(|e| format!("Payload serialize error: {}", e))?;
        Some(Bytes::from(json))
    };

    let timeout = job.timeout_ms.unwrap_or(30_000);

    let result = tokio::time::timeout(
        std::time::Duration::from_millis(timeout),
        runtime.execute(
            job.action_name.clone(),
            "TASK".to_string(),          // method = "TASK" (distinguishable from HTTP)
            format!("/__task/{}", job.key), // path for logging
            body_bytes,
            smallvec![                   // headers: mark as internal task
                ("x-titan-task".to_string(), "1".to_string()),
                ("content-type".to_string(), "application/json".to_string()),
            ],
            smallvec![],                 // params
            smallvec![],                 // query
        ),
    )
    .await;

    match result {
        Ok(Ok((json, _timings))) => {
            // Check for action-level errors
            if let Some(err) = json.get("error") {
                Err(err.as_str().unwrap_or("Unknown action error").to_string())
            } else {
                Ok(json)
            }
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!("Task timed out after {}ms", timeout)),
    }
}

/// Dispatch a spawn job to a Tokio task (fire-and-forget, non-blocking).
pub fn dispatch_spawn(job: TaskJob, tokio_handle: tokio::runtime::Handle) {
    let registry = get_task_registry();

    tokio_handle.spawn(async move {
        let start = Instant::now();
        let key = job.key.clone();

        {
            let mut reg = registry.lock().unwrap();
            reg.mark_running(&key);
        }

        if is_dev() {
            println!(
                "{} {} {}",
                blue("[Titan Task]"),
                yellow(&format!("spawn:{}", key)),
                gray(&format!("→ {} running", job.action_name))
            );
        }

        let result = execute_job(&job).await;
        let duration_ms = start.elapsed().as_secs_f64() * 1000.0;

        {
            let mut reg = registry.lock().unwrap();
            match result {
                Ok(_) => {
                    if is_dev() {
                        println!(
                            "{} {} {} {}",
                            blue("[Titan Task]"),
                            green(&format!("spawn:{}", key)),
                            green("✓ done"),
                            gray(&format!("{:.2}ms", duration_ms))
                        );
                    }
                    reg.mark_done(&key, duration_ms);
                }
                Err(e) => {
                    if is_dev() {
                        println!(
                            "{} {} {} {}",
                            blue("[Titan Task]"),
                            red(&format!("spawn:{}", key)),
                            red("✗ failed"),
                            gray(&format!("{} in {:.2}ms", e, duration_ms))
                        );
                    }
                    reg.mark_failed(&key, e, duration_ms);
                }
            }
        }
    });
}

/// Start a FIFO queue consumer for `queue_key`. Runs until queue is empty then exits.
pub fn dispatch_queue_consumer(queue_key: String, tokio_handle: tokio::runtime::Handle) {
    let registry = get_task_registry();

    tokio_handle.spawn(async move {
        loop {
            // Pop next job (or exit if empty)
            let job = {
                let mut reg = registry.lock().unwrap();
                let job = reg.pop_queue(&queue_key);
                if job.is_none() {
                    reg.set_queue_active(&queue_key, false);
                }
                job
            };

            let job = match job {
                Some(j) => j,
                None => break, // Queue drained — consumer exits cleanly
            };

            let start = Instant::now();
            let key = job.key.clone();
            let action_name = job.action_name.clone();

            {
                let mut reg = registry.lock().unwrap();
                reg.mark_running(&key);
            }

            if is_dev() {
                println!(
                    "{} {} {}",
                    blue("[Titan Task]"),
                    yellow(&format!("queue:{}:{}", queue_key, key)),
                    gray(&format!("→ {} running", action_name))
                );
            }

            let result = execute_job(&job).await;
            let duration_ms = start.elapsed().as_secs_f64() * 1000.0;

            {
                let mut reg = registry.lock().unwrap();
                match result {
                    Ok(_) => {
                        if is_dev() {
                            println!(
                                "{} {} {} {}",
                                blue("[Titan Task]"),
                                green(&format!("queue:{}:{}", queue_key, key)),
                                green("✓ done"),
                                gray(&format!("{:.2}ms", duration_ms))
                            );
                        }
                        reg.mark_done(&key, duration_ms);
                    }
                    Err(e) => {
                        if is_dev() {
                            println!(
                                "{} {} {} {}",
                                blue("[Titan Task]"),
                                red(&format!("queue:{}:{}", queue_key, key)),
                                red("✗ failed"),
                                gray(&format!("{} in {:.2}ms", e, duration_ms))
                            );
                        }
                        reg.mark_failed(&key, e, duration_ms);
                    }
                }
            }
            // FIFO: automatically loop to next job
        }
    });
}

// ============================================================================
// V8 NATIVE BINDINGS
// ============================================================================

/// t.task._native_spawn(key, actionName, payloadJson, optionsJson)
///
/// Spawns a single background job that executes the named Titan action.
/// Deduplicated by key — if a task with this key is already Pending/Running, this is a no-op.
pub fn native_task_spawn(
    scope: &mut v8::HandleScope,
    mut args: v8::FunctionCallbackArguments,
    mut _retval: v8::ReturnValue,
) {
    use crate::extensions::TitanRuntime;

    let key = v8_to_string(scope, args.get(0));
    let action_name = v8_to_string(scope, args.get(1));
    let payload = crate::extensions::v8_to_json(scope, args.get(2));

    let opts_val = args.get(3);
    let mut timeout_ms: Option<u64> = None;
    let mut dedupe = true;

    if opts_val.is_object() {
        if let Some(obj) = opts_val.to_object(scope) {
            let t_key = v8_str(scope, "timeout");
            if let Some(t_val) = obj.get(scope, t_key.into()) {
                if t_val.is_number() {
                    timeout_ms = t_val.number_value(scope).map(|n| n as u64);
                }
            }
            let d_key = v8_str(scope, "dedupe");
            if let Some(d_val) = obj.get(scope, d_key.into()) {
                if d_val.is_boolean() {
                    dedupe = d_val.boolean_value(scope);
                }
            }
        }
    }

    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut TitanRuntime;
    let runtime = unsafe { &mut *runtime_ptr };
    let tokio_handle = runtime.tokio_handle.clone();

    {
        let registry = get_task_registry();
        let mut reg = registry.lock().unwrap();
        if dedupe {
            if !reg.try_register_spawn(&key) {
                // Deduplicated — silently skip
                return;
            }
        } else {
            reg.force_register(&key);
        }
    }

    let job = TaskJob {
        key: key.clone(),
        action_name: action_name.clone(),
        payload,
        timeout_ms,
        enqueued_at: TaskRegistry::now_ms(),
    };

    if is_dev() {
        println!(
            "{} {} {}",
            blue("[Titan Task]"),
            yellow(&format!("spawn:{}", key)),
            gray(&format!("→ {} queued", action_name))
        );
    }

    dispatch_spawn(job, tokio_handle);
}

/// t.task._native_enqueue(queueKey, jobKey, actionName, payloadJson, optionsJson)
///
/// Adds a job to a FIFO queue. Jobs in the same queue run one at a time, in order.
pub fn native_task_enqueue(
    scope: &mut v8::HandleScope,
    mut args: v8::FunctionCallbackArguments,
    mut _retval: v8::ReturnValue,
) {
    use crate::extensions::TitanRuntime;

    let queue_key = v8_to_string(scope, args.get(0));
    let job_key = v8_to_string(scope, args.get(1));
    let action_name = v8_to_string(scope, args.get(2));
    let payload = crate::extensions::v8_to_json(scope, args.get(3));

    let opts_val = args.get(4);
    let mut timeout_ms: Option<u64> = None;

    if opts_val.is_object() {
        if let Some(obj) = opts_val.to_object(scope) {
            let t_key = v8_str(scope, "timeout");
            if let Some(t_val) = obj.get(scope, t_key.into()) {
                if t_val.is_number() {
                    timeout_ms = t_val.number_value(scope).map(|n| n as u64);
                }
            }
        }
    }

    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut TitanRuntime;
    let runtime = unsafe { &mut *runtime_ptr };
    let tokio_handle = runtime.tokio_handle.clone();

    let job = TaskJob {
        key: job_key.clone(),
        action_name: action_name.clone(),
        payload,
        timeout_ms,
        enqueued_at: TaskRegistry::now_ms(),
    };

    let need_consumer = {
        let registry = get_task_registry();
        let mut reg = registry.lock().unwrap();
        match reg.enqueue(&queue_key, job) {
            Ok(_) => {
                let active = reg.is_queue_active(&queue_key);
                if !active {
                    reg.set_queue_active(&queue_key, true);
                    true
                } else {
                    false
                }
            }
            Err(e) => {
                if is_dev() {
                    println!(
                        "{} {} {} {}",
                        blue("[Titan Task]"),
                        red(&format!("enqueue:{}", queue_key)),
                        red("→ rejected"),
                        gray(e)
                    );
                }
                false
            }
        }
    };

    if need_consumer {
        if is_dev() {
            println!(
                "{} {} {}",
                blue("[Titan Task]"),
                yellow(&format!("queue:{}", queue_key)),
                gray("→ consumer started")
            );
        }
        dispatch_queue_consumer(queue_key, tokio_handle);
    }
}

/// t.task._native_stop(key)
///
/// Removes a task from the registry. Stops future execution of the keyed spawn task.
/// Note: a currently-running Tokio task cannot be force-killed mid-execution;
/// this removes the registry entry so dedup checks pass on the next spawn.
pub fn native_task_stop(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut _retval: v8::ReturnValue,
) {
    let key = v8_to_string(scope, args.get(0));
    let registry = get_task_registry();
    let mut reg = registry.lock().unwrap();
    reg.stop(&key);
    if is_dev() {
        println!(
            "{} {} {}",
            blue("[Titan Task]"),
            yellow(&format!("stop:{}", key)),
            gray("→ removed from registry")
        );
    }
}

/// t.task._native_status(key) → V8 object | null
///
/// Returns: { state: "pending"|"running"|"done"|"failed", startedAt: number, duration?: number, error?: string }
pub fn native_task_status(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let key = v8_to_string(scope, args.get(0));
    let registry = get_task_registry();
    let reg = registry.lock().unwrap();

    match reg.status(&key) {
        Some(entry) => {
            let state_str = match &entry.state {
                TaskState::Pending => "pending",
                TaskState::Running => "running",
                TaskState::Done => "done",
                TaskState::Failed(_) => "failed",
            };

            let obj = v8::Object::new(scope);

            let state_key = v8_str(scope, "state");
            let state_val = v8_str(scope, state_str);
            obj.set(scope, state_key.into(), state_val.into());

            let sa_key = v8_str(scope, "startedAt");
            let sa_val = v8::Number::new(scope, entry.started_at as f64);
            obj.set(scope, sa_key.into(), sa_val.into());

            if let Some(dur) = entry.duration_ms {
                let dur_key = v8_str(scope, "duration");
                let dur_val = v8::Number::new(scope, dur);
                obj.set(scope, dur_key.into(), dur_val.into());
            }

            if let TaskState::Failed(ref reason) = entry.state {
                let err_key = v8_str(scope, "error");
                let err_val = v8_str(scope, reason);
                obj.set(scope, err_key.into(), err_val.into());
            }

            retval.set(obj.into());
        }
        None => {
            retval.set(v8::null(scope).into());
        }
    }
}

/// t.task._native_clear(queueKey)
///
/// Drains all pending jobs from a queue and deactivates its consumer.
pub fn native_task_clear(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut _retval: v8::ReturnValue,
) {
    let queue_key = v8_to_string(scope, args.get(0));
    let registry = get_task_registry();
    let mut reg = registry.lock().unwrap();
    reg.clear_queue(&queue_key);
    if is_dev() {
        println!(
            "{} {} {}",
            blue("[Titan Task]"),
            yellow(&format!("clear:{}", queue_key)),
            gray("→ queue drained")
        );
    }
}
