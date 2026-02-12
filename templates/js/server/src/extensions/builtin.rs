use v8;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use serde_json::Value;
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Validation};
use bcrypt::{hash, verify, DEFAULT_COST};
use postgres::{Client as PgClient, NoTls};
use std::sync::{Mutex, OnceLock};
use std::collections::{HashMap, BTreeMap};

use crate::utils::{blue, gray, red, parse_expires_in};
use super::{TitanRuntime, v8_str, v8_to_string, throw, ShareContextStore};

const TITAN_CORE_JS: &str = include_str!("titan_core.js");

// Database connection pool
static DB_POOL: Mutex<Option<HashMap<String, PgClient>>> = Mutex::new(None);
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .use_rustls_tls()
            .tcp_nodelay(true)
            .user_agent("TitanPL/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}


pub fn inject_builtin_extensions(scope: &mut v8::HandleScope, global: v8::Local<v8::Object>, t_obj: v8::Local<v8::Object>) {
    // 1. Native API Bindings
    
    // defineAction (Native side)
    let def_fn = v8::Function::new(scope, native_define_action).unwrap();
    let def_key = v8_str(scope, "defineAction");
    global.set(scope, def_key.into(), def_fn.into());

    
    // t.read
    let read_fn = v8::Function::new(scope, native_read).unwrap();
    let read_key = v8_str(scope, "read");
    t_obj.set(scope, read_key.into(), read_fn.into());

    // t.decodeUtf8
    let dec_fn = v8::Function::new(scope, native_decode_utf8).unwrap();
    let dec_key = v8_str(scope, "decodeUtf8");
    t_obj.set(scope, dec_key.into(), dec_fn.into());

    // t.log
    let log_fn = v8::Function::new(scope, native_log).unwrap();
    let log_key = v8_str(scope, "log");
    t_obj.set(scope, log_key.into(), log_fn.into());
    
    // t.fetch (Metadata version for drift)
    let fetch_fn = v8::Function::new(scope, native_fetch_meta).unwrap();
    let fetch_key = v8_str(scope, "fetch");
    t_obj.set(scope, fetch_key.into(), fetch_fn.into());

    // t._drift_call
    let drift_fn = v8::Function::new(scope, native_drift_call).unwrap();
    let drift_key = v8_str(scope, "_drift_call");
    t_obj.set(scope, drift_key.into(), drift_fn.into());

    // t._finish_request
    let finish_fn = v8::Function::new(scope, native_finish_request).unwrap();
    let finish_key = v8_str(scope, "_finish_request");
    t_obj.set(scope, finish_key.into(), finish_fn.into());

    // t.loadEnv
    let env_fn = v8::Function::new(scope, native_load_env).unwrap();
    let env_key = v8_str(scope, "loadEnv");
    t_obj.set(scope, env_key.into(), env_fn.into());

    // auth, jwt, password, db, core ... (setup native objects BEFORE JS injection)
    setup_native_utils(scope, t_obj);

    // 2. JS Side Injection (Embedded)
    let tc = &mut v8::TryCatch::new(scope);
    let source = v8_str(tc, TITAN_CORE_JS);
    if let Some(script) = v8::Script::compile(tc, source, None) {
        if script.run(tc).is_none() {
             let msg = tc.message().map(|m| m.get(tc).to_rust_string_lossy(tc)).unwrap_or("Unknown".to_string());
             println!("{} {} {}", blue("[Titan]"), red("Core JS Init Failed:"), msg);
        }
    } else {
        println!("{} {}", blue("[Titan]"), red("Core JS Compilation Failed"));
    }
}

fn setup_native_utils(scope: &mut v8::HandleScope, t_obj: v8::Local<v8::Object>) {
    // t.jwt
    let jwt_obj = v8::Object::new(scope);
    let sign_fn = v8::Function::new(scope, native_jwt_sign).unwrap();
    let verify_fn = v8::Function::new(scope, native_jwt_verify).unwrap();
    
    let sign_key = v8_str(scope, "sign");
    jwt_obj.set(scope, sign_key.into(), sign_fn.into());
    let verify_key = v8_str(scope, "verify");
    jwt_obj.set(scope, verify_key.into(), verify_fn.into());
    
    let jwt_key = v8_str(scope, "jwt");
    t_obj.set(scope, jwt_key.into(), jwt_obj.into());

    // t.password
    let pw_obj = v8::Object::new(scope);
    let hash_fn = v8::Function::new(scope, native_password_hash).unwrap();
    let pw_verify_fn = v8::Function::new(scope, native_password_verify).unwrap();
    
    let hash_key = v8_str(scope, "hash");
    pw_obj.set(scope, hash_key.into(), hash_fn.into());
    let pw_v_key = v8_str(scope, "verify");
    pw_obj.set(scope, pw_v_key.into(), pw_verify_fn.into());
    
    let pw_key = v8_str(scope, "password");
    t_obj.set(scope, pw_key.into(), pw_obj.into());

    // t.shareContext (Native primitives)
    let sc_obj = v8::Object::new(scope);
    let n_get = v8::Function::new(scope, share_context_get).unwrap();
    let n_set = v8::Function::new(scope, share_context_set).unwrap();
    let n_del = v8::Function::new(scope, share_context_delete).unwrap();
    let n_keys = v8::Function::new(scope, share_context_keys).unwrap();
    let n_pub = v8::Function::new(scope, share_context_broadcast).unwrap();

    let get_key = v8_str(scope, "get");
    sc_obj.set(scope, get_key.into(), n_get.into());
    let set_key = v8_str(scope, "set");
    sc_obj.set(scope, set_key.into(), n_set.into());
    let del_key = v8_str(scope, "delete");
    sc_obj.set(scope, del_key.into(), n_del.into());
    let keys_key = v8_str(scope, "keys");
    sc_obj.set(scope, keys_key.into(), n_keys.into());
    let pub_key = v8_str(scope, "broadcast");
    sc_obj.set(scope, pub_key.into(), n_pub.into());
    
    let sc_key = v8_str(scope, "shareContext");
    let sc_val = sc_obj.into();
    t_obj.set(scope, sc_key.into(), sc_val);

    // t.db (Database operations)
    let db_obj = v8::Object::new(scope);
    let db_connect_fn = v8::Function::new(scope, native_db_connect).unwrap();
    let connect_key = v8_str(scope, "connect");
    db_obj.set(scope, connect_key.into(), db_connect_fn.into());
    
    let db_key = v8_str(scope, "db");
    t_obj.set(scope, db_key.into(), db_obj.into());

    // t.core (System operations)
    let core_obj = v8::Object::new(scope);
    let fs_obj = v8::Object::new(scope);
    let fs_read_fn = v8::Function::new(scope, native_read).unwrap();
    let read_key = v8_str(scope, "read");
    fs_obj.set(scope, read_key.into(), fs_read_fn.into());

    let fs_read_sync_fn = v8::Function::new(scope, native_read_sync).unwrap();
    let read_sync_key = v8_str(scope, "readFile");
    fs_obj.set(scope, read_sync_key.into(), fs_read_sync_fn.into());
    
    // Also Expose as t.readSync
    let t_read_sync_fn = v8::Function::new(scope, native_read_sync).unwrap();
    let t_read_sync_key = v8_str(scope, "readSync");
    t_obj.set(scope, t_read_sync_key.into(), t_read_sync_fn.into());
    
    let fs_key = v8_str(scope, "fs");
    core_obj.set(scope, fs_key.into(), fs_obj.into());
    

}

fn native_read_sync(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let path_val = args.get(0);
    if !path_val.is_string() {
        throw(scope, "readSync/readFile: path is required");
        return;
    }
    let path_str = v8_to_string(scope, path_val);

    let root = super::PROJECT_ROOT.get().cloned().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let joined = root.join(&path_str);
    
    if let Ok(target) = joined.canonicalize() {
        if target.starts_with(&root.canonicalize().unwrap_or(root.clone())) {
            match std::fs::read_to_string(&target) {
                Ok(content) => {
                    let v8_content = v8_str(scope, &content);
                    retval.set(v8_content.into());
                },
                Err(e) => {
                     retval.set(v8::null(scope).into());
                }
            }
        } else {
             retval.set(v8::null(scope).into());
        }
    } else {
        retval.set(v8::null(scope).into());
    }
}

fn native_read(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let path_val = args.get(0);
    if !path_val.is_string() {
        throw(scope, "t.read(path): path is required");
        return;
    }
    let path_str = v8_to_string(scope, path_val);

    let obj = v8::Object::new(scope);
    let op_key = v8_str(scope, "__titanAsync");
    let op_val = v8::Boolean::new(scope, true);
    obj.set(scope, op_key.into(), op_val.into());
    
    let type_key = v8_str(scope, "type");
    let type_val = v8_str(scope, "fs_read");
    obj.set(scope, type_key.into(), type_val.into());
    
    let data_obj = v8::Object::new(scope);
    let path_k = v8_str(scope, "path");
    let path_v = v8_str(scope, &path_str);
    data_obj.set(scope, path_k.into(), path_v.into());
    
    let data_key = v8_str(scope, "data");
    obj.set(scope, data_key.into(), data_obj.into());
    
    retval.set(obj.into());
}

fn native_decode_utf8(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let val = args.get(0);
    if let Ok(u8arr) = v8::Local::<v8::Uint8Array>::try_from(val) {
        let buf = u8arr.buffer(scope).unwrap();
        let store = v8::ArrayBuffer::get_backing_store(&buf);
        let offset = usize::from(u8arr.byte_offset());
        let length = usize::from(u8arr.byte_length());
        let slice = &store[offset..offset+length];
        
        let bytes: Vec<u8> = slice.iter().map(|b| b.get()).collect();
        let s = String::from_utf8_lossy(&bytes);
        retval.set(v8_str(scope, &s).into());
    } else if let Ok(ab) = v8::Local::<v8::ArrayBuffer>::try_from(val) {
        let store = v8::ArrayBuffer::get_backing_store(&ab);
        let bytes: Vec<u8> = store.iter().map(|b| b.get()).collect();
        let s = String::from_utf8_lossy(&bytes);
        retval.set(v8_str(scope, &s).into());
    } else {
        retval.set(v8::null(scope).into());
    }
}

fn share_context_get(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let key = v8_to_string(scope, args.get(0));
    let store = ShareContextStore::get();
    if let Some(val) = store.kv.get(&key) {
        let json_str = val.to_string();
        let v8_str = v8::String::new(scope, &json_str).unwrap();
        if let Some(v8_val) = v8::json::parse(scope, v8_str) {
            retval.set(v8_val);
            return;
        }
    }
    retval.set(v8::null(scope).into());
}

fn share_context_set(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let key = v8_to_string(scope, args.get(0));
    let val_v8 = args.get(1);
    
    if let Some(json_v8) = v8::json::stringify(scope, val_v8) {
        let json_str = json_v8.to_rust_string_lossy(scope);
        if let Ok(val) = serde_json::from_str(&json_str) {
            ShareContextStore::get().kv.insert(key, val);
        }
    }
}

fn share_context_delete(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let key = v8_to_string(scope, args.get(0));
    ShareContextStore::get().kv.remove(&key);
}

fn share_context_keys(scope: &mut v8::HandleScope, _args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let store = ShareContextStore::get();
    let keys: Vec<v8::Local<v8::Value>> = store.kv.iter().map(|kv| v8_str(scope, kv.key()).into()).collect();
    let arr = v8::Array::new_with_elements(scope, &keys);
    retval.set(arr.into());
}

fn share_context_broadcast(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let event = v8_to_string(scope, args.get(0));
    let payload_v8 = args.get(1);
    
    if let Some(json_v8) = v8::json::stringify(scope, payload_v8) {
        let json_str = json_v8.to_rust_string_lossy(scope);
        if let Ok(payload) = serde_json::from_str(&json_str) {
            let _ = ShareContextStore::get().broadcast_tx.send((event, payload));
        }
    }
}



fn native_log(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
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
    
    let titan_str = blue("[Titan]");
    let log_msg = gray(&format!("\x1b[90mlog({})\x1b[0m\x1b[97m: {}\x1b[0m", action_name, parts.join(" ")));
    println!(
        "{} {}",
        titan_str,
        log_msg
    );
}



fn native_jwt_sign(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let payload_val = args.get(0);
    let json_str = v8::json::stringify(scope, payload_val).unwrap().to_rust_string_lossy(scope);
    let mut payload: serde_json::Map<String, Value> = serde_json::from_str(&json_str).unwrap_or_default();
    let secret = v8_to_string(scope, args.get(1));
    
    let opts_val = args.get(2);
    if opts_val.is_object() {
        let opts_obj = opts_val.to_object(scope).unwrap();
        let exp_key = v8_str(scope, "expiresIn");
        if let Some(val) = opts_obj.get(scope, exp_key.into()) {
             let seconds = if val.is_number() {
                 Some(val.to_number(scope).unwrap().value() as u64)
             } else if val.is_string() {
                 parse_expires_in(&v8_to_string(scope, val))
             } else { None };
             if let Some(sec) = seconds {
                let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                payload.insert("exp".to_string(), Value::Number(serde_json::Number::from(now + sec)));
             }
        }
    }

    let token = encode(&Header::default(), &Value::Object(payload), &EncodingKey::from_secret(secret.as_bytes()));
    match token {
        Ok(t) => {
            let res = v8_str(scope, &t);
            retval.set(res.into());
        },
        Err(e) => throw(scope, &e.to_string()),
    }
}

fn native_jwt_verify(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let token = v8_to_string(scope, args.get(0));
    let secret = v8_to_string(scope, args.get(1));
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let data = decode::<Value>(&token, &DecodingKey::from_secret(secret.as_bytes()), &validation);
    match data {
        Ok(d) => {
             let json_str = serde_json::to_string(&d.claims).unwrap();
             let v8_json_str = v8_str(scope, &json_str);
             if let Some(val) = v8::json::parse(scope, v8_json_str) {
                 retval.set(val);
             }
        },
        Err(e) => throw(scope, &format!("Invalid or expired JWT: {}", e)),
    }
}

fn native_password_hash(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let pw = v8_to_string(scope, args.get(0));
    match hash(pw, DEFAULT_COST) {
        Ok(h) => {
            let res = v8_str(scope, &h);
            retval.set(res.into());
        },
        Err(e) => throw(scope, &e.to_string()),
    }
}

fn native_password_verify(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let pw = v8_to_string(scope, args.get(0));
    let hash_str = v8_to_string(scope, args.get(1));
    let ok = verify(pw, &hash_str).unwrap_or(false);
    retval.set(v8::Boolean::new(scope, ok).into());
}

fn native_load_env(scope: &mut v8::HandleScope, _args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
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

fn native_define_action(_scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    retval.set(args.get(0));
}

fn native_db_connect(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let conn_string = v8_to_string(scope, args.get(0));
    
    if conn_string.is_empty() {
        throw(scope, "t.db.connect(): connection string is required");
        return;
    }

    match PgClient::connect(&conn_string, NoTls) {
        Ok(mut client) => {
            let mut pool = DB_POOL.lock().unwrap();
            let map = pool.get_or_insert_with(HashMap::new);
            map.insert(conn_string.clone(), client);
        },
        Err(e) => {
            throw(scope, &format!("Database connection failed: {}", e));
            return;
        }
    }
    
    let db_conn_obj = v8::Object::new(scope);
    
    let conn_key = v8_str(scope, "__conn_string");
    let conn_val = v8_str(scope, &conn_string);
    db_conn_obj.set(scope, conn_key.into(), conn_val.into());
    
    let query_fn = v8::Function::new(scope, native_db_query).unwrap();
    let query_key = v8_str(scope, "query");
    db_conn_obj.set(scope, query_key.into(), query_fn.into());
    
    retval.set(db_conn_obj.into());
}

fn native_db_query(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let this = args.this();
    let this_obj = this.to_object(scope).unwrap();
    
    let conn_key = v8_str(scope, "__conn_string");
    let conn_val = this_obj.get(scope, conn_key.into()).unwrap();
    let conn_string = v8_to_string(scope, conn_val);
    
    let query = v8_to_string(scope, args.get(0));
    
    if query.is_empty() {
        throw(scope, "db.query(): SQL query is required");
        return;
    }

    let obj = v8::Object::new(scope);
    let op_key = v8_str(scope, "__titanAsync");
    let op_val = v8::Boolean::new(scope, true);
    obj.set(scope, op_key.into(), op_val.into());
    
    let type_key = v8_str(scope, "type");
    let type_val = v8_str(scope, "db_query");
    obj.set(scope, type_key.into(), type_val.into());
    
    let data_obj = v8::Object::new(scope);
    let conn_k = v8_str(scope, "conn");
    let conn_v = v8_str(scope, &conn_string);
    data_obj.set(scope, conn_k.into(), conn_v.into());
    
    let q_k = v8_str(scope, "query");
    let q_v = v8_str(scope, &query);
    data_obj.set(scope, q_k.into(), q_v.into());
    
    let data_key = v8_str(scope, "data");
    obj.set(scope, data_key.into(), data_obj.into());
    
    retval.set(obj.into());
}

fn native_fetch_meta(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
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

fn parse_async_op(scope: &mut v8::HandleScope, op_val: v8::Local<v8::Value>) -> Option<super::TitanAsyncOp> {
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
            Some(super::TitanAsyncOp::Fetch { url, method, body, headers })
        },
        "db_query" => {
            let conn_key = v8_str(scope, "conn");
            let conn_obj = data_obj.get(scope, conn_key.into())?;
            let conn = v8_to_string(scope, conn_obj);
            let query_key = v8_str(scope, "query");
            let query_obj = data_obj.get(scope, query_key.into())?;
            let query = v8_to_string(scope, query_obj);
            Some(super::TitanAsyncOp::DbQuery { conn, query })
        },
        "fs_read" => {
            let path_key = v8_str(scope, "path");
            let path_obj = data_obj.get(scope, path_key.into())?;
            let path = v8_to_string(scope, path_obj);
            Some(super::TitanAsyncOp::FsRead { path })
        },
        _ => None
    }
}

fn native_drift_call(scope: &mut v8::HandleScope, mut args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut super::TitanRuntime;
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
        (super::TitanAsyncOp::Batch(ops), "batch".to_string())
    } else {
        match parse_async_op(scope, arg0) {
            Some(op) => {
                let t = match &op {
                    super::TitanAsyncOp::Fetch { .. } => "fetch",
                    super::TitanAsyncOp::DbQuery { .. } => "db_query",
                    super::TitanAsyncOp::FsRead { .. } => "fs_read",
                    _ => "unknown"
                };
                (op, t.to_string())
            },
            None => {
                throw(scope, "drift() requires an async operation or array of operations");
                return;
            }
        }
    };

    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut super::TitanRuntime;
    let runtime = unsafe { &mut *runtime_ptr };
    
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

    let (tx, rx) = tokio::sync::oneshot::channel::<super::WorkerAsyncResult>();
    
    let req = super::AsyncOpRequest {
        op: async_op,
        drift_id,
        request_id: req_id,
        op_type,
        respond_tx: tx,
    };
    
    if let Err(e) = runtime.global_async_tx.try_send(req) {
         println!("[Titan] Drift Call Failed to queue: {}", e);
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

// =============================================================================
// OPTIMIZED: native_finish_request — Direct V8 field extraction
// =============================================================================
//
// Before: v8_to_json(scope, result_val) → calls v8::json::stringify on the
//         ENTIRE response object, then serde_json::from_str to parse it back.
//         For _isResponse objects, this is wasteful because:
//         - body is already a JSON string (serialized in JS via JSON.stringify)
//         - status is a simple number
//         - headers is a flat object with ~2-3 keys
//         Round-tripping all of this through stringify+parse costs ~2-3µs.
//
// After:  For _isResponse objects (the hot path), extract each field directly
//         from V8 locals. Only falls back to v8_to_json for non-response objects.
//         This eliminates the stringify+parse round-trip for the most common case.
//
fn native_finish_request(scope: &mut v8::HandleScope, mut args: v8::FunctionCallbackArguments, _retval: v8::ReturnValue) {
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
            // Each field extraction is a simple V8 property lookup + type check.
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

            // redirect (optional string)
            let redirect_key = v8_str(scope, "redirect");
            if let Some(r) = obj.get(scope, redirect_key.into()) {
                if r.is_string() {
                    let url = r.to_string(scope).unwrap().to_rust_string_lossy(scope);
                    map.insert("redirect".into(), Value::String(url));
                }
            }

            Value::Object(map)
        } else {
            // Non-response object — use generic conversion (with v8::json::stringify)
            super::v8_to_json(scope, result_val)
        }
    } else {
        super::v8_to_json(scope, result_val)
    };

    let runtime_ptr = unsafe { args.get_isolate() }.get_data(0) as *mut super::TitanRuntime;
    let runtime = unsafe { &mut *runtime_ptr };
    
    let timings = runtime.request_timings.remove(&request_id).unwrap_or_default();
    
    // Cleanup drift mapping for this request
    runtime.drift_to_request.retain(|drift_id, v| {
        if *v == request_id {
            runtime.completed_drifts.remove(drift_id);
            false
        } else {
            true
        }
    });

    if let Some(tx) = runtime.pending_requests.remove(&request_id) {
        let _ = tx.send(crate::runtime::WorkerResult { json, timings });
    }
}

pub async fn run_single_op(op: super::TitanAsyncOp) -> serde_json::Value {
    match op {
        super::TitanAsyncOp::Fetch { url, method, body, headers } => {
            let client = get_http_client();
            let mut req = client.request(method.parse().unwrap_or(reqwest::Method::GET), &url);
            if let Some(b) = body { req = req.body(b); }
            for (k, v) in headers {
                if let (Ok(name), Ok(val)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), reqwest::header::HeaderValue::from_str(&v)) {
                    req = req.header(name, val);
                }
            }
            match req.send().await {
                Ok(res) => {
                    let status = res.status().as_u16();
                    let text = res.text().await.unwrap_or_default();
                    serde_json::json!({ "status": status, "body": text, "ok": true })
                },
                Err(e) => serde_json::json!({ "error": e.to_string(), "ok": false })
            }
        },
        super::TitanAsyncOp::FsRead { path } => {
            let root = super::PROJECT_ROOT.get().cloned().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            let joined = root.join(&path);
            
            if let Ok(target) = joined.canonicalize() {
                if target.starts_with(&root.canonicalize().unwrap_or(root)) {
                    match std::fs::read_to_string(&target) {
                        Ok(content) => serde_json::json!(content),
                        Err(e) => serde_json::json!({ "error": format!("File read failed: {}", e) })
                    }
                } else {
                    serde_json::json!({ "error": "Path escapes project root" })
                }
            } else {
                serde_json::json!({ "error": format!("File not found: {}", path) })
            }
        },
        super::TitanAsyncOp::DbQuery { conn, query } => {
            tokio::task::spawn_blocking(move || {
                let mut pool = DB_POOL.lock().unwrap();
                if let Some(map) = pool.as_mut() {
                    if let Some(client) = map.get_mut(&conn) {
                        return match client.query(&query, &[]) {
                            Ok(rows) => {
                                let mut result = Vec::new();
                                for row in rows {
                                    let mut obj = serde_json::Map::new();
                                    for (i, column) in row.columns().iter().enumerate() {
                                        let col_name = column.name();
                                        let col_value: serde_json::Value = if let Ok(val) = row.try_get::<_, Option<String>>(i) {
                                            serde_json::json!(val)
                                        } else if let Ok(val) = row.try_get::<_, Option<i32>>(i) {
                                            serde_json::json!(val)
                                        } else if let Ok(val) = row.try_get::<_, Option<i64>>(i) {
                                            serde_json::json!(val)
                                        } else if let Ok(val) = row.try_get::<_, Option<f64>>(i) {
                                            serde_json::json!(val)
                                        } else if let Ok(val) = row.try_get::<_, Option<bool>>(i) {
                                            serde_json::json!(val)
                                        } else {
                                            serde_json::Value::Null
                                        };
                                        obj.insert(col_name.to_string(), col_value);
                                    }
                                    result.push(serde_json::Value::Object(obj));
                                }
                                serde_json::Value::Array(result)
                            },
                            Err(e) => serde_json::json!({ "error": e.to_string() })
                        };
                    }
                }
                serde_json::json!({ "error": "Database connection not found" })
            }).await.unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() }))
        },
        _ => serde_json::json!({ "error": "Invalid operation" })
    }
}

pub async fn run_async_operation(op: super::TitanAsyncOp) -> serde_json::Value {
    match op {
        super::TitanAsyncOp::Batch(ops) => {
            let mut set = tokio::task::JoinSet::new();
            for (i, op) in ops.into_iter().enumerate() {
                set.spawn(async move {
                    (i, run_single_op(op).await)
                });
            }
            let mut results_map = std::collections::BTreeMap::new();
            while let Some(res) = set.join_next().await {
                if let Ok((i, val)) = res {
                    results_map.insert(i, val);
                }
            }
            serde_json::Value::Array(results_map.into_values().collect())
        },
        _ => run_single_op(op).await
    }
}