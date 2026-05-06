use v8;
use v8::{ValueSerializerHelper, ValueDeserializerHelper};
use std::sync::OnceLock;
use serde_json::Value;
use crate::extensions::{v8_str, v8_to_string, throw, TitanRuntime, TitanAsyncOp};
use crate::utils::{blue, gray, red, parse_expires_in};
use super::db::DB_POOL;
use tokio_postgres::types::{Type, ToSql, IsNull};
use bytes::BytesMut;
use std::error::Error;

#[derive(Debug)]
struct PostgresParam(serde_json::Value);

impl ToSql for PostgresParam {
    fn to_sql(&self, ty: &Type, out: &mut BytesMut) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        // Handle explicit type markers from t.types
        if let serde_json::Value::Object(map) = &self.0 {
            if let Some(serde_json::Value::String(t_type)) = map.get("_titanType") {
                let value = map.get("value").unwrap_or(&serde_json::Value::Null);

                return match t_type.as_str() {
                    "uuid" => {
                        if let Some(s) = value.as_str() {
                            if let Ok(u) = uuid::Uuid::parse_str(s) {
                                return u.to_sql(ty, out);
                            }
                        }
                        Ok(IsNull::Yes)
                    }
                    "timestamp" | "timestamptz" => {
                        if let Some(s) = value.as_str() {
                            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                                return dt.with_timezone(&chrono::Utc).to_sql(ty, out);
                            }
                            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
                                return dt.to_sql(ty, out);
                            }
                            if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
                                return d.and_hms_opt(0, 0, 0).unwrap().to_sql(ty, out);
                            }
                        }
                        Ok(IsNull::Yes)
                    }
                    "int" => {
                        let val = value.as_i64().unwrap_or(0);
                        if ty == &Type::INT8 {
                            val.to_sql(ty, out)
                        } else {
                            (val as i32).to_sql(ty, out)
                        }
                    }
                    "bigint" => {
                        if let Some(s) = value.as_str() {
                            if let Ok(i) = s.parse::<i64>() {
                                return i.to_sql(ty, out);
                            }
                        }
                        value.as_i64().unwrap_or(0).to_sql(ty, out)
                    }
                    "float" => value.as_f64().unwrap_or(0.0).to_sql(ty, out),
                    "boolean" => value.as_bool().unwrap_or(false).to_sql(ty, out),
                    "json" => value.to_sql(ty, out),
                    _ => {
                        if let Some(s) = value.as_str() {
                            s.to_sql(ty, out)
                        } else {
                            value.to_sql(ty, out)
                        }
                    }
                };
            }
        }

        // Default heuristic-based conversion
        match &self.0 {
            serde_json::Value::Null => Ok(IsNull::Yes),
            serde_json::Value::Bool(b) => b.to_sql(ty, out),
            serde_json::Value::Number(n) => {
                if ty == &Type::INT8 || ty == &Type::NUMERIC {
                    n.as_i64().unwrap_or(0).to_sql(ty, out)
                } else if ty == &Type::INT4 {
                    (n.as_i64().unwrap_or(0) as i32).to_sql(ty, out)
                } else if ty == &Type::FLOAT8 {
                    n.as_f64().unwrap_or(0.0).to_sql(ty, out)
                } else if ty == &Type::FLOAT4 {
                    (n.as_f64().unwrap_or(0.0) as f32).to_sql(ty, out)
                } else {
                    n.as_f64().unwrap_or(0.0).to_sql(ty, out)
                }
            }
            serde_json::Value::String(s) => {
                if ty == &Type::UUID {
                    if let Ok(u) = uuid::Uuid::parse_str(s) {
                        return u.to_sql(ty, out);
                    }
                }
                if ty == &Type::TIMESTAMP || ty == &Type::TIMESTAMPTZ {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                        return dt.with_timezone(&chrono::Utc).to_sql(ty, out);
                    }
                    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
                        return dt.to_sql(ty, out);
                    }
                    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
                        return d.and_hms_opt(0, 0, 0).unwrap().to_sql(ty, out);
                    }
                }
                s.to_sql(ty, out)
            }
            _ => self.0.to_sql(ty, out),
        }
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }

    fn to_sql_checked(&self, ty: &Type, out: &mut BytesMut) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        self.to_sql(ty, out)
    }
}

pub const TITAN_CORE_JS: &str = include_str!("../titan_core.js");

pub static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .use_rustls_tls()
            .tcp_nodelay(true)
            .user_agent("TitanPL/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

// --- V8 Serialization Built-ins ---

struct TitanSerializerDelegate;
impl v8::ValueSerializerImpl for TitanSerializerDelegate {
    fn throw_data_clone_error<'s>(&self, scope: &mut v8::HandleScope<'s>, message: v8::Local<'s, v8::String>) {
        let error = v8::Exception::error(scope, message);
        scope.throw_exception(error);
    }
}

struct TitanDeserializerDelegate;
impl v8::ValueDeserializerImpl for TitanDeserializerDelegate {}

pub fn native_serialize(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let value = args.get(0);
    let context = scope.get_current_context();
    let mut serializer = v8::ValueSerializer::new(scope, Box::new(TitanSerializerDelegate));
    serializer.write_header();
    
    if let Some(true) = serializer.write_value(context, value) {
        let bytes = serializer.release();
        let len = bytes.len();
        let bs = v8::ArrayBuffer::new_backing_store_from_boxed_slice(bytes.into_boxed_slice()).make_shared();
        let ab = v8::ArrayBuffer::with_backing_store(scope, &bs);
        if let Some(view) = v8::Uint8Array::new(scope, ab, 0, len) {
            retval.set(view.into());
        }
    }
}

pub fn native_deserialize(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let arg = args.get(0);
    if !arg.is_uint8_array() {
        throw(scope, "deserialize expects Uint8Array");
        return;
    }
    let view = v8::Local::<v8::Uint8Array>::try_from(arg).unwrap();
    let len = view.byte_length();
    let mut data = vec![0u8; len];
    view.copy_contents(&mut data);

    let context = scope.get_current_context();
    let deserializer = v8::ValueDeserializer::new(scope, Box::new(TitanDeserializerDelegate), &data);
    if let Some(true) = deserializer.read_header(context) {
        if let Some(val) = deserializer.read_value(context) {
            retval.set(val);
        }
    }
}

pub fn native_log(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let context = scope.get_current_context();
    let global = context.global(scope);
    let action_key = v8_str(scope, "__titan_action");
    let action_name = if let Some(action_val) = global.get(scope, action_key.into()) {
        if action_val.is_string() {
            v8_to_string(scope, action_val)
        } else {
            "init".to_string()
        }
    } else {
        "init".to_string()
    };

    let mut parts = Vec::new();
    for i in 0..args.length() {
        let val = args.get(i);
        let mut appended = false;
        
        if val.is_object() && !val.is_function() {
             if let Some(json) = v8::json::stringify(scope, val) {
                 parts.push(json.to_rust_string_lossy(scope));
                 appended = true;
             }
        }
        
        if !appended {
            parts.push(v8_to_string(scope, val));
        }
    }
    
    let titan_str = blue("[Gravity]");
    let log_msg = gray(&format!("\x1b[90mlog({})\x1b[0m\x1b[97m: {}\x1b[0m", action_name, parts.join(" ")));
    println!(
        "{} {}",
        titan_str,
        log_msg
    );
}

pub fn native_load_env(scope: &mut v8::HandleScope, _args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    use serde_json::json;

    let mut map = serde_json::Map::new();

    for (key, value) in std::env::vars() {
        map.insert(key, json!(value));
    }

    let json_str = serde_json::to_string(&map).unwrap();
    let v8_str = v8::String::new(scope, &json_str).unwrap();

    if let Some(obj) = v8::json::parse(scope, v8_str) {
        retval.set(obj);
    } else {
        retval.set(v8::null(scope).into());
    }
}

pub fn native_define_action(_scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    retval.set(args.get(0));
}

pub fn native_fetch_meta(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let url = v8_to_string(scope, args.get(0));
    let opts = args.get(1);
    
    let obj = v8::Object::new(scope);
    let op_key = v8_str(scope, "__titanAsync");
    let op_val = v8::Boolean::new(scope, true);
    obj.set(scope, op_key.into(), op_val.into());
    
    let type_key = v8_str(scope, "type");
    let type_val = v8_str(scope, "fetch");
    obj.set(scope, type_key.into(), type_val.into());
    
    let data_obj = v8::Object::new(scope);
    let url_key = v8_str(scope, "url");
    let url_val = v8_str(scope, &url);
    data_obj.set(scope, url_key.into(), url_val.into());
    
    let opts_key = v8_str(scope, "opts");
    data_obj.set(scope, opts_key.into(), opts);
    
    let data_key = v8_str(scope, "data");
    obj.set(scope, data_key.into(), data_obj.into());
    
    retval.set(obj.into());
}

pub fn parse_async_op(scope: &mut v8::HandleScope, op_val: v8::Local<v8::Value>) -> Option<TitanAsyncOp> {
    if !op_val.is_object() { return None; }
    let op_obj = op_val.to_object(scope).unwrap();
    
    let type_key = v8_str(scope, "type");
    let type_obj = op_obj.get(scope, type_key.into())?;
    let op_type = v8_to_string(scope, type_obj);

    let data_key = v8_str(scope, "data");
    let data_val = op_obj.get(scope, data_key.into())?;
    if !data_val.is_object() { return None; }
    let data_obj = data_val.to_object(scope).unwrap();
    
    match op_type.as_str() {
        "fetch" => {
            let url_key = v8_str(scope, "url");
            let url_obj = data_obj.get(scope, url_key.into())?;
            let url = v8_to_string(scope, url_obj);
            
            let mut method = "GET".to_string();
            let mut body = None;
            let mut headers = Vec::new();
            
            let opts_key = v8_str(scope, "opts");
            if let Some(opts_val) = data_obj.get(scope, opts_key.into()) {
                if opts_val.is_object() {
                    let opts_obj = opts_val.to_object(scope).unwrap();
                    let m_key = v8_str(scope, "method");
                    if let Some(m_val) = opts_obj.get(scope, m_key.into()) {
                        if m_val.is_string() { method = v8_to_string(scope, m_val); }
                    }
                    let b_key = v8_str(scope, "body");
                    if let Some(b_val) = opts_obj.get(scope, b_key.into()) {
                        if b_val.is_string() { 
                            body = Some(v8_to_string(scope, b_val)); 
                        } else if b_val.is_object() {
                            body = Some(v8::json::stringify(scope, b_val).unwrap().to_rust_string_lossy(scope));
                        }
                    }
                    let h_key = v8_str(scope, "headers");
                    if let Some(h_val) = opts_obj.get(scope, h_key.into()) {
                        if h_val.is_object() {
                            let h_obj = h_val.to_object(scope).unwrap();
                            if let Some(keys) = h_obj.get_own_property_names(scope, Default::default()) {
                                for i in 0..keys.length() {
                                    let key = keys.get_index(scope, i).unwrap();
                                    let val = h_obj.get(scope, key).unwrap();
                                    headers.push((v8_to_string(scope, key), v8_to_string(scope, val)));
                                }
                            }
                        }
                    }
                }
            }
            Some(TitanAsyncOp::Fetch { url, method, body, headers })
        },

        "db_query" => {
            let conn_key = v8_str(scope, "conn");
            let conn_val = data_obj.get(scope, conn_key.into())?;
            let conn = v8_to_string(scope, conn_val);

            let query_key = v8_str(scope, "query");
            let query_val = data_obj.get(scope, query_key.into())?;
            let query = v8_to_string(scope, query_val);

            let params_key = v8_str(scope, "params");
            let mut params = Vec::new();

            if let Some(p_val) = data_obj.get(scope, params_key.into()) {
                if p_val.is_array() {
                    let arr = v8::Local::<v8::Array>::try_from(p_val).unwrap();
                    for i in 0..arr.length() {
                        if let Some(v) = arr.get_index(scope, i) {
                            params.push(crate::extensions::v8_to_json(scope, v));
                        }
                    }
                }
            }

            let mut pool_timeout = None;
            let mut query_timeout = None;

            let opts_key = v8_str(scope, "options");
            if let Some(opts_val) = data_obj.get(scope, opts_key.into()) {
                if opts_val.is_object() {
                    let opts_obj = opts_val.to_object(scope).unwrap();
                    let pt_key = v8_str(scope, "pool_timeout");
                    if let Some(v) = opts_obj.get(scope, pt_key.into()) {
                        if v.is_number() {
                            if let Some(n) = v.number_value(scope) { pool_timeout = Some(n as u64); }
                        }
                    }
                    let qt_key = v8_str(scope, "timeout");
                    if let Some(v) = opts_obj.get(scope, qt_key.into()) {
                        if v.is_number() {
                            if let Some(n) = v.number_value(scope) { query_timeout = Some(n as u64); }
                        }
                    }
                }
            }

            Some(TitanAsyncOp::DbQuery { 
                conn, 
                query, 
                params,
                pool_timeout,
                query_timeout
            })
        }

        "fs_read" => {
            let path_key = v8_str(scope, "path");
            let path_obj = data_obj.get(scope, path_key.into())?;
            let path = v8_to_string(scope, path_obj);
            Some(TitanAsyncOp::FsRead { path })
        },
        "native_call" => {
            let ext_key = v8_str(scope, "extension");
            let ext_val = data_obj.get(scope, ext_key.into())?;
            let extension = v8_to_string(scope, ext_val);

            let fn_key = v8_str(scope, "function");
            let fn_val = data_obj.get(scope, fn_key.into())?;
            let function = v8_to_string(scope, fn_val);

            let params_key = v8_str(scope, "params");
            let mut params = Vec::new();
            if let Some(p_val) = data_obj.get(scope, params_key.into()) {
                if p_val.is_array() {
                    let arr = v8::Local::<v8::Array>::try_from(p_val).unwrap();
                    for i in 0..arr.length() {
                        if let Some(v) = arr.get_index(scope, i) {
                            params.push(crate::extensions::v8_to_json(scope, v));
                        }
                    }
                }
            }
            Some(TitanAsyncOp::NativeCall { extension, function, params })
        },
        _ => None
    }
}

pub fn native_drift_call(scope: &mut v8::HandleScope, mut args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut TitanRuntime;
    let runtime = unsafe { &mut *runtime_ptr };

    let arg0 = args.get(0);
    
    let (async_op, op_type) = if arg0.is_array() {
        let arr = v8::Local::<v8::Array>::try_from(arg0).unwrap();
        let mut ops = Vec::new();
        for i in 0..arr.length() {
            let op_val = arr.get_index(scope, i).unwrap();
            if let Some(op) = parse_async_op(scope, op_val) {
                ops.push(op);
            }
        }
        (TitanAsyncOp::Batch(ops), "batch".to_string())
    } else {
        match parse_async_op(scope, arg0) {
            Some(op) => {
                let t = match &op {
                    TitanAsyncOp::Fetch { .. } => "fetch",
                    TitanAsyncOp::DbQuery { .. } => "db_query",
                    TitanAsyncOp::FsRead { .. } => "fs_read",
                    _ => "unknown"
                };
                (op, t.to_string())
            },
            None => {
                // If it's not a recognized async op, just return it immediately (sync/identity path)
                retval.set(arg0);
                return;
            }
        }
    };

    let req_id = {
        let context = scope.get_current_context();
        let global = context.global(scope);
        let req_key = v8_str(scope, "__titan_req");
        if let Some(req_obj_val) = global.get(scope, req_key.into()) {
            if req_obj_val.is_object() {
                let req_obj = req_obj_val.to_object(scope).unwrap();
                let id_key = v8_str(scope, "__titan_request_id");
                req_obj.get(scope, id_key.into()).unwrap().uint32_value(scope).unwrap_or(0)
            } else { 0 }
        } else { 0 }
    };

    runtime.drift_counter += 1;
    let drift_id = runtime.drift_counter;
    
    if req_id != 0 {
        runtime.drift_to_request.insert(drift_id, req_id);
    }

    // --- REPLAY CHECK ---
    if let Some(res) = runtime.completed_drifts.get(&drift_id) {
         let json_str = serde_json::to_string(res).unwrap_or_else(|_| "null".to_string());
         let v8_str = v8::String::new(scope, &json_str).unwrap();
         let mut try_catch = v8::TryCatch::new(scope);
         if let Some(val) = v8::json::parse(&mut try_catch, v8_str) {
             retval.set(val);
         } else {
             retval.set(v8::null(&mut try_catch).into());
         }
         return;
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<crate::extensions::WorkerAsyncResult>();
    
    let req = crate::extensions::AsyncOpRequest {
        op: async_op,
        drift_id,
        request_id: req_id,
        op_type: op_type.clone(),
        respond_tx: tx,
    };
    
    if let Err(_) = runtime.global_async_tx.try_send(req) {
         retval.set(v8::null(scope).into());
         return;
    }

    let tokio_handle = runtime.tokio_handle.clone();
    let worker_tx = runtime.worker_tx.clone();
    
    tokio_handle.spawn(async move {
        if let Ok(res) = rx.await {
            let _ = worker_tx.send(crate::runtime::WorkerCommand::Resume {
                drift_id,
                result: res,
            });
        }
    });

    throw(scope, "__SUSPEND__");
}

pub fn native_finish_request(scope: &mut v8::HandleScope, mut args: v8::FunctionCallbackArguments, _retval: v8::ReturnValue) {
    let request_id = args.get(0).uint32_value(scope).unwrap_or(0);
    let result_val = args.get(1);

    // --- OPTIMIZATION: Direct field extraction for _isResponse objects ---
    let json = if result_val.is_object() {
        let obj = result_val.to_object(scope).unwrap();
        let is_resp_key = v8_str(scope, "_isResponse");
        let is_response = obj
            .get(scope, is_resp_key.into())
            .map(|v| v.boolean_value(scope))
            .unwrap_or(false);

        if is_response {
            // Hot path: extract fields directly without full stringify+parse.
            let mut map = serde_json::Map::with_capacity(5);
            map.insert("_isResponse".into(), Value::Bool(true));

            // status (number → u64)
            let status_key = v8_str(scope, "status");
            if let Some(s) = obj.get(scope, status_key.into()) {
                if let Some(n) = s.number_value(scope) {
                    map.insert(
                        "status".into(),
                        Value::Number(serde_json::Number::from(n as u64)),
                    );
                }
            }

            // body (already a JSON string from JS — extract as-is, no re-serialization)
            let body_key = v8_str(scope, "body");
            if let Some(b) = obj.get(scope, body_key.into()) {
                if b.is_string() {
                    let body_str = b.to_string(scope).unwrap().to_rust_string_lossy(scope);
                    map.insert("body".into(), Value::String(body_str));
                } else if !b.is_null_or_undefined() {
                    // Non-string body (rare) — stringify it
                    let body_str = v8_to_string(scope, b);
                    map.insert("body".into(), Value::String(body_str));
                }
            }

            // headers (flat object with ~2-3 keys typically)
            let headers_key = v8_str(scope, "headers");
            if let Some(h) = obj.get(scope, headers_key.into()) {
                if h.is_object() {
                    let h_obj = h.to_object(scope).unwrap();
                    if let Some(keys) =
                        h_obj.get_own_property_names(scope, Default::default())
                    {
                        let mut h_map = serde_json::Map::with_capacity(keys.length() as usize);
                        for i in 0..keys.length() {
                            if let Some(key) = keys.get_index(scope, i) {
                                if let Some(val) = h_obj.get(scope, key) {
                                    let k_str =
                                        key.to_string(scope).unwrap().to_rust_string_lossy(scope);
                                    let v_str =
                                        val.to_string(scope).unwrap().to_rust_string_lossy(scope);
                                    h_map.insert(k_str, Value::String(v_str));
                                }
                            }
                        }
                        map.insert("headers".into(), Value::Object(h_map));
                    }
                }
            }
            serde_json::Value::Object(map)
        } else {
            crate::extensions::v8_to_json(scope, result_val)
        }
    } else {
        crate::extensions::v8_to_json(scope, result_val)
    };

    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut TitanRuntime;
    let runtime = unsafe { &mut *runtime_ptr };
    
    if let Some(tx) = runtime.pending_requests.remove(&request_id) {
        let timings = runtime.request_timings.remove(&request_id).unwrap_or_default();
        let _ = tx.send(crate::runtime::WorkerResult {
             json,
             timings
        });
    }
}

pub fn run_async_operation(
    op: TitanAsyncOp,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = serde_json::Value> + Send>> {
    Box::pin(async move {
        match op {

            // =========================
            // FETCH
            // =========================
            TitanAsyncOp::Fetch {
                url,
                method,
                body,
                headers,
            } => {
                let client = get_http_client();

                let method = reqwest::Method::from_bytes(method.as_bytes())
                    .unwrap_or(reqwest::Method::GET);

                let mut req = client.request(method, &url);

                for (k, v) in headers {
                    req = req.header(k, v);
                }

                if let Some(b) = body {
                    req = req.body(b);
                }

                match req.send().await {
                    Ok(resp) => {
                        let status = resp.status().as_u16();
                        let api_headers = resp.headers().clone();
                        let text = resp.text().await.unwrap_or_default();

                        let mut h_map = serde_json::Map::new();
                        for (k, v) in api_headers.iter() {
                            if let Ok(s) = v.to_str() {
                                h_map.insert(
                                    k.as_str().to_string(),
                                    serde_json::Value::String(s.to_string()),
                                );
                            }
                        }

                        serde_json::json!({
                            "_isResponse": true,
                            "status": status,
                            "body": text,
                            "headers": h_map
                        })
                    }
                    Err(e) => serde_json::json!({ "error": e.to_string() }),
                }
            }

            // =========================
            // DB QUERY
            // =========================
            TitanAsyncOp::DbQuery { 
                conn: _, 
                query, 
                params,
                pool_timeout,
                query_timeout
            } => {
                let pool = match DB_POOL.get() {
                    Some(p) => p,
                    None => {
                        return serde_json::json!({
                            "error": "DB pool not initialized"
                        });
                    }
                };
                let p_timeout = pool_timeout.unwrap_or(5000);
                let q_timeout = query_timeout.unwrap_or(10000);

                if std::env::var("TITAN_DEV").unwrap_or_default() == "1" {
                    println!("{} {} Operation started (Pool: {}ms, Query: {}ms)", crate::utils::blue("[Titan]"), crate::utils::yellow("DB:"), p_timeout, q_timeout);
                }

                match tokio::time::timeout(std::time::Duration::from_millis(p_timeout), pool.get()).await {
                    Ok(Ok(client)) => {
                        let stmt = match client.prepare(&query).await {
                            Ok(s) => s,
                            Err(e) => {
                                return serde_json::json!({
                                    "error": e.to_string()
                                });
                            }
                        };

                        let param_wrappers: Vec<PostgresParam> =
                            params.into_iter().map(PostgresParam).collect();

                        let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                            param_wrappers.iter()
                                .map(|p| p as &(dyn tokio_postgres::types::ToSql + Sync))
                                .collect();

                        match tokio::time::timeout(std::time::Duration::from_millis(q_timeout), client.query(&stmt, &param_refs)).await {
                            Ok(Ok(rows)) => {
                                let mut result = Vec::new();

                                for row in rows {
                                    let mut obj = serde_json::Map::new();

                                    for (i, col) in row.columns().iter().enumerate() {
                                        let val =
                                            if let Ok(v) = row.try_get::<_, String>(i) {
                                                serde_json::Value::String(v)
                                            } else if let Ok(v) = row.try_get::<_, i64>(i) {
                                                serde_json::Value::Number(v.into())
                                            } else if let Ok(v) = row.try_get::<_, i32>(i) {
                                                serde_json::Value::Number(v.into())
                                            } else if let Ok(v) = row.try_get::<_, f64>(i) {
                                                serde_json::Number::from_f64(v)
                                                    .map(serde_json::Value::Number)
                                                    .unwrap_or(serde_json::Value::Null)
                                            } else if let Ok(v) = row.try_get::<_, bool>(i) {
                                                serde_json::Value::Bool(v)
                                            } else if let Ok(v) = row.try_get::<_, uuid::Uuid>(i) {
                                                serde_json::Value::String(v.to_string())
                                            } else if let Ok(v) = row.try_get::<_, chrono::NaiveDateTime>(i) {
                                                serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string())
                                            } else if let Ok(v) = row.try_get::<_, chrono::DateTime<chrono::Utc>>(i) {
                                                serde_json::Value::String(v.to_rfc3339())
                                            } else if let Ok(v) = row.try_get::<_, serde_json::Value>(i) {
                                                v
                                            } else {
                                                serde_json::Value::Null
                                            };

                                        obj.insert(col.name().to_string(), val);
                                    }

                                    result.push(serde_json::Value::Object(obj));
                                }

                                serde_json::Value::Array(result)
                            }
                            Ok(Err(e)) => {
                                serde_json::json!({ "error": e.to_string() })
                            }
                            Err(_) => {
                                println!("{} {} Query TIMEOUT after {}ms", crate::utils::blue("[Titan]"), crate::utils::red("DB:"), q_timeout);
                                serde_json::json!({ "error": format!("Query timeout after {} milliseconds", q_timeout) })
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        serde_json::json!({ "error": e.to_string() })
                    }
                    Err(_) => {
                        println!("{} {} Pool checkout TIMEOUT after {}ms", crate::utils::blue("[Titan]"), crate::utils::red("DB:"), p_timeout);
                        serde_json::json!({ "error": format!("Database connection timeout after {} milliseconds", p_timeout) })
                    }
                }
            }

            // =========================
            // FS READ
            // =========================
            TitanAsyncOp::FsRead { path } => {

                let root = crate::extensions::PROJECT_ROOT
                    .get()
                    .cloned()
                    .unwrap_or(std::path::PathBuf::from("."));

                let target = root.join(&path);

                let safe = target
                    .canonicalize()
                    .map(|p| {
                        p.starts_with(
                            crate::extensions::PROJECT_ROOT.get()
                                .and_then(|r| r.canonicalize().ok())
                                .unwrap_or(root.clone())
                        )
                    })
                    .unwrap_or(false);

                if safe {
                    match tokio::fs::read_to_string(target).await {
                        Ok(c) => serde_json::json!({ "data": c }),
                        Err(e) => serde_json::json!({ "error": e.to_string() }),
                    }
                } else {
                    serde_json::json!({ "error": "Access denied" })
                }
            }

            TitanAsyncOp::NativeCall { extension, function, params } => {
                crate::extensions::native_host_bridge::handle_native_call(extension, function, params).await
            }

            // =========================
            // BATCH
            // =========================
            TitanAsyncOp::Batch(ops) => {

                let mut res = Vec::new();

                for op in ops {
                    res.push(run_async_operation(op).await);
                }

                serde_json::Value::Array(res)
            }
        }
    })
}
