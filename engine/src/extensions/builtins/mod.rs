pub mod fs;
pub mod jwt;
pub mod password;
pub mod db;
pub mod ws;
pub mod share_context;
pub mod system;

use v8;
use crate::extensions::{v8_str, blue, red};

pub fn inject_builtin_extensions(scope: &mut v8::HandleScope, global: v8::Local<v8::Object>, t_obj: v8::Local<v8::Object>) {
    // 1. Native API Bindings
    
    // defineAction (Native side)
    let def_fn = v8::Function::new(scope, system::native_define_action).unwrap();
    let def_key = v8_str(scope, "defineAction");
    global.set(scope, def_key.into(), def_fn.into());

    // t.read
    let read_fn = v8::Function::new(scope, fs::native_read).unwrap();
    let read_key = v8_str(scope, "read");
    t_obj.set(scope, read_key.into(), read_fn.into());

    // t.decodeUtf8
    let dec_fn = v8::Function::new(scope, fs::native_decode_utf8).unwrap();
    let dec_key = v8_str(scope, "decodeUtf8");
    t_obj.set(scope, dec_key.into(), dec_fn.into());

    // t.log
    let log_fn = v8::Function::new(scope, system::native_log).unwrap();
    let log_key = v8_str(scope, "log");
    t_obj.set(scope, log_key.into(), log_fn.into());
    
    // t.fetch (Metadata version for drift)
    let fetch_fn = v8::Function::new(scope, system::native_fetch_meta).unwrap();
    let fetch_key = v8_str(scope, "fetch");
    t_obj.set(scope, fetch_key.into(), fetch_fn.into());

    // t._drift_call
    let drift_fn = v8::Function::new(scope, system::native_drift_call).unwrap();
    let drift_key = v8_str(scope, "_drift_call");
    t_obj.set(scope, drift_key.into(), drift_fn.into());

    // t._finish_request
    let finish_fn = v8::Function::new(scope, system::native_finish_request).unwrap();
    let finish_key = v8_str(scope, "_finish_request");
    t_obj.set(scope, finish_key.into(), finish_fn.into());

    // t.loadEnv
    let env_fn = v8::Function::new(scope, system::native_load_env).unwrap();
    let env_key = v8_str(scope, "loadEnv");
    t_obj.set(scope, env_key.into(), env_fn.into());

    // setup native objects
    setup_native_utils(scope, t_obj);

    // 2. JS Side Injection (Embedded)
    let tc = &mut v8::TryCatch::new(scope);
    let source = v8_str(tc, system::TITAN_CORE_JS);
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
    let sign_fn = v8::Function::new(scope, jwt::native_jwt_sign).unwrap();
    let verify_fn = v8::Function::new(scope, jwt::native_jwt_verify).unwrap();
    
    let sign_key = v8_str(scope, "sign");
    jwt_obj.set(scope, sign_key.into(), sign_fn.into());
    let verify_key = v8_str(scope, "verify");
    jwt_obj.set(scope, verify_key.into(), verify_fn.into());
    
    let jwt_key = v8_str(scope, "jwt");
    t_obj.set(scope, jwt_key.into(), jwt_obj.into());

    // t.password
    let pw_obj = v8::Object::new(scope);
    let hash_fn = v8::Function::new(scope, password::native_password_hash).unwrap();
    let pw_verify_fn = v8::Function::new(scope, password::native_password_verify).unwrap();
    
    let hash_key = v8_str(scope, "hash");
    pw_obj.set(scope, hash_key.into(), hash_fn.into());
    let pw_v_key = v8_str(scope, "verify");
    pw_obj.set(scope, pw_v_key.into(), pw_verify_fn.into());
    
    let pw_key = v8_str(scope, "password");
    t_obj.set(scope, pw_key.into(), pw_obj.into());

    // t.shareContext (Native primitives)
    let sc_obj = v8::Object::new(scope);
    let n_get = v8::Function::new(scope, share_context::share_context_get).unwrap();
    let n_set = v8::Function::new(scope, share_context::share_context_set).unwrap();
    let n_del = v8::Function::new(scope, share_context::share_context_delete).unwrap();
    let n_keys = v8::Function::new(scope, share_context::share_context_keys).unwrap();
    let n_pub = v8::Function::new(scope, share_context::share_context_broadcast).unwrap();

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
    t_obj.set(scope, sc_key.into(), sc_obj.into());

    // t.db (Database operations)
    let db_obj = v8::Object::new(scope);
    let db_connect_fn = v8::Function::new(scope, db::native_db_connect).unwrap();
    let connect_key = v8_str(scope, "connect");
    db_obj.set(scope, connect_key.into(), db_connect_fn.into());
    
    let db_key = v8_str(scope, "db");
    t_obj.set(scope, db_key.into(), db_obj.into());

    // t.core (System operations)
    let core_obj = v8::Object::new(scope);
    let fs_obj = v8::Object::new(scope);
    let fs_read_fn = v8::Function::new(scope, fs::native_read).unwrap();
    let read_key = v8_str(scope, "read");
    fs_obj.set(scope, read_key.into(), fs_read_fn.into());

    let fs_read_sync_fn = v8::Function::new(scope, fs::native_read_sync).unwrap();
    let read_sync_key = v8_str(scope, "readFile");
    fs_obj.set(scope, read_sync_key.into(), fs_read_sync_fn.into());
    
    // Also Expose as t.readSync
    let t_read_sync_fn = v8::Function::new(scope, fs::native_read_sync).unwrap();
    let t_read_sync_key = v8_str(scope, "readSync");
    t_obj.set(scope, t_read_sync_key.into(), t_read_sync_fn.into());
    
    let fs_key = v8_str(scope, "fs");
    core_obj.set(scope, fs_key.into(), fs_obj.into());
    
    // t.ws
    let ws_obj = v8::Object::new(scope);
    let ws_send_fn = v8::Function::new(scope, ws::native_ws_send).unwrap();
    let ws_broadcast_fn = v8::Function::new(scope, ws::native_ws_broadcast).unwrap();
    
    let send_key = v8_str(scope, "send");
    ws_obj.set(scope, send_key.into(), ws_send_fn.into());
    let broadcast_key = v8_str(scope, "broadcast");
    ws_obj.set(scope, broadcast_key.into(), ws_broadcast_fn.into());
    
    let ws_key = v8_str(scope, "ws");
    t_obj.set(scope, ws_key.into(), ws_obj.into());
}
