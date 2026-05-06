use v8;
use bcrypt::{hash, verify, DEFAULT_COST};
use crate::extensions::{v8_str, v8_to_string, throw};

pub fn native_password_hash(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let pw = v8_to_string(scope, args.get(0));
    match hash(pw, DEFAULT_COST) {
        Ok(h) => {
            let res = v8_str(scope, &h);
            retval.set(res.into());
        },
        Err(e) => throw(scope, &e.to_string()),
    }
}

pub fn native_password_verify(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let pw = v8_to_string(scope, args.get(0));
    let hash_str = v8_to_string(scope, args.get(1));
    let ok = verify(pw, &hash_str).unwrap_or(false);
    retval.set(v8::Boolean::new(scope, ok).into());
}
