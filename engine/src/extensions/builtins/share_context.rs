use v8;
use crate::extensions::{v8_str, v8_to_string, ShareContextStore};

pub fn share_context_get(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
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

pub fn share_context_set(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let key = v8_to_string(scope, args.get(0));
    let val_v8 = args.get(1);
    
    if let Some(json_v8) = v8::json::stringify(scope, val_v8) {
        let json_str = json_v8.to_rust_string_lossy(scope);
        if let Ok(val) = serde_json::from_str(&json_str) {
            ShareContextStore::get().kv.insert(key, val);
        }
    }
}

pub fn share_context_delete(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let key = v8_to_string(scope, args.get(0));
    ShareContextStore::get().kv.remove(&key);
}

pub fn share_context_keys(scope: &mut v8::HandleScope, _args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let store = ShareContextStore::get();
    let keys: Vec<v8::Local<v8::Value>> = store.kv.iter().map(|kv| v8_str(scope, kv.key()).into()).collect();
    let arr = v8::Array::new_with_elements(scope, &keys);
    retval.set(arr.into());
}

pub fn share_context_broadcast(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let event = v8_to_string(scope, args.get(0));
    let payload_v8 = args.get(1);
    
    if let Some(json_v8) = v8::json::stringify(scope, payload_v8) {
        let json_str = json_v8.to_rust_string_lossy(scope);
        if let Ok(payload) = serde_json::from_str(&json_str) {
            let _ = ShareContextStore::get().broadcast_tx.send((event, payload));
        }
    }
}
