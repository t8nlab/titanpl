use v8;
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Validation};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::extensions::{v8_str, v8_to_string, throw};
use crate::utils::parse_expires_in;

pub fn native_jwt_sign(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let payload_val = args.get(0);
    let json_str = v8::json::stringify(scope, payload_val)
        .map(|s| s.to_rust_string_lossy(scope))
        .unwrap_or_else(|| "{}".to_string());
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

pub fn native_jwt_verify(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let token = v8_to_string(scope, args.get(0));
    let secret = v8_to_string(scope, args.get(1));
    let mut validation = Validation::default();
    validation.validate_exp = false;
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
