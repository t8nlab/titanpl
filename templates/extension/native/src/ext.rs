use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::Mutex;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use std::fs::File;
use std::io::{self, Read};

// A registry type mapping function name to a function pointer
pub type NativeFn = fn(HashMap<String, Value>) -> Result<Value, String>;

// Use OnceLock to hold the global registry safely in Rust
use std::sync::OnceLock;
static REGISTRY: OnceLock<Mutex<HashMap<String, NativeFn>>> = OnceLock::new();

fn get_registry() -> &'static Mutex<HashMap<String, NativeFn>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register(name: &str, func: NativeFn) {
    if let Ok(mut reg) = get_registry().lock() {
        reg.insert(name.to_string(), func);
    }
}

#[derive(Serialize, Deserialize)]
struct InvokePayload {
    #[serde(rename = "fn")]
    fn_name: String,
    data: Option<HashMap<String, Value>>,
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/**
 * Smart Reader: Automatically detects if path is a local file or a URL
 * and returns a Box<dyn Read> that can be used directly for streaming.
 */
pub fn get_reader(path: &str) -> Result<Box<dyn Read>, String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        let resp = ureq::get(path)
            .call()
            .map_err(|e| format!("network error: {}", e))?;
        
        if resp.status() != 200 {
            return Err(format!("failed to fetch cloud resource (HTTP {})", resp.status()));
        }

        Ok(Box::new(resp.into_reader()))
    } else {
        let file = File::open(path).map_err(|e| format!("failed to open file: {}", e))?;
        Ok(Box::new(file))
    }
}

pub fn get_string(m: &HashMap<String, Value>, key: &str) -> Result<String, String> {
    match m.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(format!("invalid type for {}", key)),
        None => Err(format!("missing {}", key)),
    }
}

pub fn get_bool(m: &HashMap<String, Value>, key: &str, def: bool) -> bool {
    match m.get(key) {
        Some(Value::Bool(b)) => *b,
        _ => def,
    }
}

pub fn get_int(m: &HashMap<String, Value>, key: &str) -> Result<i64, String> {
    match m.get(key) {
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Ok(i)
            } else if let Some(f) = n.as_f64() {
                Ok(f as i64)
            } else {
                Err(format!("invalid number format for {}", key))
            }
        }
        Some(_) => Err(format!("invalid type for {}", key)),
        None => Err(format!("missing {}", key)),
    }
}

// Expose C FFI entry points
#[no_mangle]
pub extern "C" fn titan_invoke(input: *const c_char) -> *mut c_char {
    // Make sure the registered functions are initialized
    super::ensure_registered();

    if input.is_null() {
        let res = Response {
            ok: false,
            value: None,
            error: Some("null input".to_string()),
        };
        return to_c_string(&res);
    }

    let c_str = unsafe { CStr::from_ptr(input) };
    let str_slice = match c_str.to_str() {
        Ok(s) => s,
        Err(e) => {
            let res = Response {
                ok: false,
                value: None,
                error: Some(format!("invalid utf-8 string: {}", e)),
            };
            return to_c_string(&res);
        }
    };

    let payload: Value = match serde_json::from_str(str_slice) {
        Ok(p) => p,
        Err(e) => {
            let res = Response {
                ok: false,
                value: None,
                error: Some(format!("invalid JSON payload: {}", e)),
            };
            return to_c_string(&res);
        }
    };

    let fn_name = match payload.get("fn").and_then(|v| v.as_str()) {
        Some(name) => name,
        None => {
            let res = Response {
                ok: false,
                value: None,
                error: Some("invalid or missing fn".to_string()),
            };
            return to_c_string(&res);
        }
    };

    let data = payload.get("data")
        .and_then(|v| v.as_object())
        .map(|o| {
            o.iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<HashMap<String, Value>>()
        })
        .unwrap_or_default();

    let reg = match get_registry().lock() {
        Ok(r) => r,
        Err(_) => {
            let res = Response {
                ok: false,
                value: None,
                error: Some("failed to lock registry".to_string()),
            };
            return to_c_string(&res);
        }
    };

    let func = match reg.get(fn_name) {
        Some(f) => f,
        None => {
            let res = Response {
                ok: false,
                value: None,
                error: Some(format!("function '{}' not found", fn_name)),
            };
            return to_c_string(&res);
        }
    };

    match func(data) {
        Ok(val) => {
            let res = Response {
                ok: true,
                value: Some(val),
                error: None,
            };
            to_c_string(&res)
        }
        Err(e) => {
            let res = Response {
                ok: false,
                value: None,
                error: Some(e),
            };
            to_c_string(&res)
        }
    }
}

#[no_mangle]
pub extern "C" fn titan_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe {
            let _ = CString::from_raw(ptr);
        }
    }
}

fn to_c_string<T: Serialize>(val: &T) -> *mut c_char {
    let json_str = serde_json::to_string(val).unwrap_or_else(|_| r#"{"ok":false,"error":"serialization failure"}"#.to_string());
    let c_str = CString::new(json_str).unwrap();
    c_str.into_raw()
}
