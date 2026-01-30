#![allow(unused)]
pub mod builtin;
pub mod external;

use crate::action_management::scan_actions;
use crate::utils::{blue, gray, green, red};
use bytes::Bytes;
use crossbeam::channel::Sender;
use dashmap::DashMap;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Once;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::broadcast;
use v8;

// ----------------------------------------------------------------------------
// GLOBALS
// ----------------------------------------------------------------------------

pub static SHARE_CONTEXT: OnceLock<ShareContextStore> = OnceLock::new();
pub static PROJECT_ROOT: OnceLock<PathBuf> = OnceLock::new();

pub struct ShareContextStore {
    pub kv: DashMap<String, serde_json::Value>,
    pub broadcast_tx: broadcast::Sender<(String, serde_json::Value)>,
}

impl ShareContextStore {
    pub fn get() -> &'static Self {
        SHARE_CONTEXT.get_or_init(|| {
            let (tx, _) = broadcast::channel(1000);
            Self {
                kv: DashMap::new(),
                broadcast_tx: tx,
            }
        })
    }
}

// Re-exports for easier access
pub fn load_project_extensions(root: PathBuf) {
    PROJECT_ROOT.get_or_init(|| root.clone());
    external::load_project_extensions(root);
}

// ----------------------------------------------------------------------------
// TITAN RUNTIME
// ----------------------------------------------------------------------------

pub enum TitanAsyncOp {
    Fetch {
        url: String,
        method: String,
        body: Option<String>,
        headers: Vec<(String, String)>,
    },
    DbQuery {
        conn: String,
        query: String,
    },
    FsRead {
        path: String,
    },
    Batch(Vec<TitanAsyncOp>),
}

pub struct WorkerAsyncResult {
    pub drift_id: u32,
    pub result: serde_json::Value,
    pub duration_ms: f64,
}

pub struct AsyncOpRequest {
    pub op: TitanAsyncOp,
    pub drift_id: u32,
    pub request_id: u32,
    pub op_type: String,
    pub respond_tx: tokio::sync::oneshot::Sender<WorkerAsyncResult>,
}

pub struct TitanRuntime {
    pub id: usize,
    pub isolate: v8::OwnedIsolate,
    pub context: v8::Global<v8::Context>,
    pub actions: HashMap<String, v8::Global<v8::Function>>,
    pub worker_tx: crossbeam::channel::Sender<crate::runtime::WorkerCommand>,
    
    // Async State
    pub async_rx: crossbeam::channel::Receiver<WorkerAsyncResult>,
    pub async_tx: crossbeam::channel::Sender<WorkerAsyncResult>,
    pub pending_drifts: HashMap<u32, v8::Global<v8::PromiseResolver>>,
    pub pending_requests: HashMap<u32, tokio::sync::oneshot::Sender<crate::runtime::WorkerResult>>,
    pub drift_counter: u32,
    pub request_counter: u32,
    
    pub tokio_handle: tokio::runtime::Handle,
    pub global_async_tx: tokio::sync::mpsc::Sender<AsyncOpRequest>,
    pub request_timings: HashMap<u32, Vec<(String, f64)>>,
    pub drift_to_request: HashMap<u32, u32>,
    pub completed_drifts: HashMap<u32, serde_json::Value>,
    pub active_requests: HashMap<u32, RequestData>,
    pub request_start_counters: HashMap<u32, u32>,
}

#[derive(Clone)]
pub struct RequestData {
    pub action_name: String,
    pub body: Option<Bytes>,
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub params: Vec<(String, String)>,
    pub query: Vec<(String, String)>,
}

unsafe impl Send for TitanRuntime {}
unsafe impl Sync for TitanRuntime {}

impl TitanRuntime {
    pub fn bind_to_isolate(&mut self) {
        let ptr = self as *mut TitanRuntime as *mut std::ffi::c_void;
        self.isolate.set_data(0, ptr);
    }
}

static V8_INIT: Once = Once::new();

pub fn init_v8() {
    V8_INIT.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

pub fn init_runtime_worker(
    id: usize,
    root: PathBuf,
    worker_tx: crossbeam::channel::Sender<crate::runtime::WorkerCommand>,
    tokio_handle: tokio::runtime::Handle,
    global_async_tx: tokio::sync::mpsc::Sender<AsyncOpRequest>,
    stack_size: usize,
) -> TitanRuntime {
    init_v8();

    // Memory optimization strategy
    let params = v8::CreateParams::default();
    let mut isolate = v8::Isolate::new(params);
    
    let (global_context, actions_map) = {
        let handle_scope = &mut v8::HandleScope::new(&mut isolate);
        let context = v8::Context::new(handle_scope, v8::ContextOptions::default());
        let scope = &mut v8::ContextScope::new(handle_scope, context);
        let global = context.global(scope);

        // Inject Titan Runtime APIs
        inject_extensions(scope, global);

        // Root Metadata (Dynamic per app instance)
        let root_str = v8::String::new(scope, root.to_str().unwrap_or(".")).unwrap();
        let root_key = v8_str(scope, "__titan_root");
        global.set(scope, root_key.into(), root_str.into());

        // Load Actions (Cold start optimization target)
        let mut map = HashMap::new();
        let action_files = scan_actions(&root);
        for (name, path) in action_files {
            if let Ok(code) = fs::read_to_string(&path) {
                // Wrap action in an IIFE to capture its exports and register it globally
                let wrapped_source =
                    format!("(function() {{ {} }})(); globalThis[\"{}\"];", code, name);
                let source_str = v8_str(scope, &wrapped_source);
                let try_catch = &mut v8::TryCatch::new(scope);
                if let Some(script) = v8::Script::compile(try_catch, source_str, None) {
                    if let Some(val) = script.run(try_catch) {
                        if val.is_function() {
                            let func = v8::Local::<v8::Function>::try_from(val).unwrap();
                            map.insert(name.clone(), v8::Global::new(try_catch, func));
                        } else if id == 0 {
                            println!("[V8] Action '{}' did not evaluate to a function: {:?}", name, val.to_rust_string_lossy(try_catch));
                        }
                    } else if id == 0 {
                        let msg = try_catch
                            .message()
                            .map(|m| m.get(try_catch).to_rust_string_lossy(try_catch))
                            .unwrap_or("Unknown run error".to_string());
                        println!("[V8] Failed to run action '{}': {}", name, msg);
                    }
                } else if id == 0 {
                    let msg = try_catch
                        .message()
                        .map(|m| m.get(try_catch).to_rust_string_lossy(try_catch))
                        .unwrap_or("Unknown compile error".to_string());
                    println!("[V8] Failed to compile action '{}': {}", name, msg);
                }
            }
        }
        (v8::Global::new(scope, context), map)
    };

    let (async_tx, async_rx) = crossbeam::channel::unbounded();

    TitanRuntime {
        id,
        isolate,
        context: global_context,
        actions: actions_map,
        worker_tx,
        async_rx,
        async_tx,
        pending_drifts: HashMap::new(),
        pending_requests: HashMap::new(),
        drift_counter: 0,
        request_counter: 0,
        tokio_handle,
        global_async_tx,
        request_timings: HashMap::new(),
        drift_to_request: HashMap::new(),
        completed_drifts: HashMap::new(),
        active_requests: HashMap::new(),
        request_start_counters: HashMap::new(),
    }
}

pub fn inject_extensions(scope: &mut v8::HandleScope, global: v8::Local<v8::Object>) {
    // Ensuring globalThis
    let gt_key = v8_str(scope, "globalThis");
    global.set(scope, gt_key.into(), global.into());

    let t_obj = v8::Object::new(scope);
    let t_key = v8_str(scope, "t");
    global
        .create_data_property(scope, t_key.into(), t_obj.into())
        .unwrap();

    // Call individual injectors
    builtin::inject_builtin_extensions(scope, global, t_obj);
    external::inject_external_extensions(scope, global, t_obj);

    global.set(scope, t_key.into(), t_obj.into());
}

pub fn v8_to_json<'s>(
    scope: &mut v8::HandleScope<'s>,
    value: v8::Local<v8::Value>,
) -> serde_json::Value {
    if value.is_null_or_undefined() {
        return serde_json::Value::Null;
    }

    // Boolean
    if value.is_boolean() {
        return serde_json::Value::Bool(value.boolean_value(scope));
    }

    // Number
    if value.is_number() {
        let n = value.number_value(scope).unwrap_or(0.0);
        return serde_json::Value::Number(
            serde_json::Number::from_f64(n).unwrap_or_else(|| serde_json::Number::from(0)),
        );
    }

    // String
    if value.is_string() {
        let s = value.to_string(scope).unwrap().to_rust_string_lossy(scope);
        return serde_json::Value::String(s);
    }

    // Array
    if value.is_array() {
        let arr = v8::Local::<v8::Array>::try_from(value).unwrap();
        let mut list = Vec::with_capacity(arr.length() as usize);
        for i in 0..arr.length() {
            let element = arr
                .get_index(scope, i)
                .unwrap_or_else(|| v8::null(scope).into());
            list.push(v8_to_json(scope, element));
        }
        return serde_json::Value::Array(list);
    }

    // Object
    if value.is_object() {
        let obj = value.to_object(scope).unwrap();

        let props = obj
            .get_own_property_names(scope, v8::GetPropertyNamesArgs::default())
            .unwrap();

        let mut map = serde_json::Map::new();

        for i in 0..props.length() {
            let key_val = props
                .get_index(scope, i)
                .unwrap_or_else(|| v8::null(scope).into());

            let key = key_val
                .to_string(scope)
                .unwrap()
                .to_rust_string_lossy(scope);

            let val = obj
                .get(scope, key_val.into())
                .unwrap_or_else(|| v8::null(scope).into());

            map.insert(key, v8_to_json(scope, val));
        }

        return serde_json::Value::Object(map);
    }

    serde_json::Value::Null
}

// ----------------------------------------------------------------------------
// EXECUTION HELPERS
// ----------------------------------------------------------------------------

pub fn execute_action_optimized(
    runtime: &mut TitanRuntime,
    request_id: u32,
    action_name: &str,
    req_body: Option<bytes::Bytes>,
    req_method: &str,
    req_path: &str,
    headers: &[(String, String)],
    params: &[(String, String)],
    query: &[(String, String)],
) {
    // Execute action in V8
    let context_global = runtime.context.clone();
    let actions_map = runtime.actions.clone(); // Clone the map of globals (cheap)
    let isolate = &mut runtime.isolate;
    
    let handle_scope = &mut v8::HandleScope::new(isolate);
    let context = v8::Local::new(handle_scope, context_global);
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    let req_obj = v8::Object::new(scope);

    let req_id_key = v8_str(scope, "__titan_request_id");
    let req_id_val = v8::Integer::new(scope, request_id as i32);
    req_obj.set(scope, req_id_key.into(), req_id_val.into());

    let m_key = v8_str(scope, "method");
    let m_val = v8_str(scope, req_method);
    req_obj.set(scope, m_key.into(), m_val.into());

    let p_key = v8_str(scope, "path");
    let p_val = v8_str(scope, req_path);
    req_obj.set(scope, p_key.into(), p_val.into());

    let body_val: v8::Local<v8::Value> = if let Some(bytes) = req_body {
        let vec = bytes.to_vec();
        let store = v8::ArrayBuffer::new_backing_store_from_boxed_slice(vec.into_boxed_slice());
        let ab = v8::ArrayBuffer::with_backing_store(scope, &store.make_shared());
        ab.into()
    } else {
        v8::null(scope).into()
    };
    let rb_key = v8_str(scope, "rawBody");
    req_obj.set(scope, rb_key.into(), body_val);

    let h_obj = v8::Object::new(scope);
    for (k, v) in headers {
        let k_v8 = v8_str(scope, k);
        let v_v8 = v8_str(scope, v);
        h_obj.set(scope, k_v8.into(), v_v8.into());
    }
    let h_key = v8_str(scope, "headers");
    req_obj.set(scope, h_key.into(), h_obj.into());

    let p_obj = v8::Object::new(scope);
    for (k, v) in params {
        let k_v8 = v8_str(scope, k);
        let v_v8 = v8_str(scope, v);
        p_obj.set(scope, k_v8.into(), v_v8.into());
    }
    let params_key = v8_str(scope, "params");
    req_obj.set(scope, params_key.into(), p_obj.into());

    let q_obj = v8::Object::new(scope);
    for (k, v) in query {
        let k_v8 = v8_str(scope, k);
        let v_v8 = v8_str(scope, v);
        q_obj.set(scope, k_v8.into(), v_v8.into());
    }
    let q_key = v8_str(scope, "query");
    req_obj.set(scope, q_key.into(), q_obj.into());

    let global = context.global(scope);
    let req_tr_key = v8_str(scope, "__titan_req");
    global.set(scope, req_tr_key.into(), req_obj.into());

    if let Some(action_global) = actions_map.get(action_name) {
        let action_fn = v8::Local::new(scope, action_global);
        let tr_act_key = v8_str(scope, "__titan_action");
        let tr_act_val = v8_str(scope, action_name);
        global.set(scope, tr_act_key.into(), tr_act_val.into());
        let try_catch = &mut v8::TryCatch::new(scope);

        if let Some(_) = action_fn.call(try_catch, global.into(), &[req_obj.into()]) {
            return;
        }
        
        let msg = try_catch
            .message()
            .map(|m| m.get(try_catch).to_rust_string_lossy(try_catch))
            .unwrap_or("Unknown error".to_string());
        
        if msg.contains("SUSPEND") {
            return;
        }

        println!("[Isolate {}] Action Error: {}", runtime.id, msg);
        if let Some(tx) = runtime.pending_requests.remove(&request_id) {
             let _ = tx.send(crate::runtime::WorkerResult { 
                 json: serde_json::json!({"error": msg}),
                 timings: vec![]
             });
        }
    } else {
        if let Some(tx) = runtime.pending_requests.remove(&request_id) {
             let _ = tx.send(crate::runtime::WorkerResult { 
                 json: serde_json::json!({"error": format!("Action '{}' not found", action_name)}),
                 timings: vec![]
             });
        }
    }
}

pub fn v8_str<'s>(scope: &mut v8::HandleScope<'s>, s: &str) -> v8::Local<'s, v8::String> {
    v8::String::new(scope, s).unwrap()
}

pub fn v8_to_string(scope: &mut v8::HandleScope, value: v8::Local<v8::Value>) -> String {
    value.to_string(scope).unwrap().to_rust_string_lossy(scope)
}

pub fn throw(scope: &mut v8::HandleScope, msg: &str) {
    let message = v8_str(scope, msg);
    let exception = v8::Exception::error(scope, message);
    scope.throw_exception(exception);
}
