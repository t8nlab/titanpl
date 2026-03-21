use v8;
use crate::extensions::{v8_to_string, WS_CHANNELS};

pub fn native_ws_send(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let id = v8_to_string(scope, args.get(0));
    let msg = v8_to_string(scope, args.get(1));
    
    if let Some(channels) = WS_CHANNELS.get() {
        if let Some(tx) = channels.get(&id) {
            let _ = tx.send(axum::extract::ws::Message::Text(msg.into()));
        }
    }
}

pub fn native_ws_broadcast(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
    let msg = v8_to_string(scope, args.get(0));
    
    if let Some(channels) = WS_CHANNELS.get() {
        for tx in channels.iter() {
            let _ = tx.send(axum::extract::ws::Message::Text(msg.clone().into()));
        }
    }
}
