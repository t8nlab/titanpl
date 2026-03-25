use std::path::PathBuf;
use std::io::{BufReader, BufRead, stdin, Write};
use serde_json::{json, Value};
use libloading::Library;

pub async fn run_native_host(lib_path: &str) {
    let path = PathBuf::from(lib_path);
    if !path.exists() {
        eprintln!("[NativeHost] Error: library {:?} not found", path);
        std::process::exit(1);
    }

    let canonical_path = std::fs::canonicalize(&path).unwrap_or(path);
    let lib = unsafe { Library::new(&canonical_path).expect("Failed to load native library") };

    let mut reader = BufReader::new(stdin());

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.is_empty() { break; }

        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                println!("{}", json!({"error": "Invalid JSON request"}));
                std::io::stdout().flush().unwrap();
                continue;
            }
        };

        let function_name = request["function"].as_str().unwrap_or("");
        let params = request["params"].as_array();

        let result = unsafe {
            // Priority 1: Titan ABI — receives full JSON request, returns JSON
            if let Ok(symbol) = lib.get::<extern "C" fn(*const std::os::raw::c_char) -> *const std::os::raw::c_char>(b"titan_export") {
                let req_str = serde_json::to_string(&request).unwrap_or_default();
                let c_req   = std::ffi::CString::new(req_str).unwrap();
                let c_res   = symbol(c_req.as_ptr());

                if c_res.is_null() {
                    json!({"error": "Native titan_export returned NULL"})
                } else {
                    let s = std::ffi::CStr::from_ptr(c_res).to_string_lossy();
                    serde_json::from_str(&s).unwrap_or_else(|_| json!({"error": "DLL returned invalid JSON"}))
                }
            }
            // Priority 2: Direct C export — string in, string out
            else if let Ok(symbol) = lib.get::<extern "C" fn(*const std::os::raw::c_char) -> *const std::os::raw::c_char>(function_name.as_bytes()) {
                let params_str = params
                    .map(|p| serde_json::to_string(p).unwrap_or_else(|_| "[]".to_string()))
                    .unwrap_or_else(|| "[]".to_string());
                let c_params = std::ffi::CString::new(params_str).unwrap();
                let c_res    = symbol(c_params.as_ptr());

                if c_res.is_null() {
                    json!({"error": "DLL returned null pointer"})
                } else {
                    let s = std::ffi::CStr::from_ptr(c_res).to_string_lossy();
                    serde_json::from_str(&s).unwrap_or_else(|_| json!(s.to_string()))
                }
            }
            // Priority 3: Legacy f64 ABI
            else if let Ok(symbol) = lib.get::<extern "C" fn(f64, f64) -> f64>(function_name.as_bytes()) {
                let a = params.and_then(|p| p.get(0)).and_then(|v| v.as_f64()).unwrap_or(0.0);
                let b = params.and_then(|p| p.get(1)).and_then(|v| v.as_f64()).unwrap_or(0.0);
                json!(symbol(a, b))
            }
            else {
                json!({"error": format!("Function '{}' not found in extension", function_name)})
            }
        };

        let final_resp = serde_json::to_string(&result)
            .unwrap_or_else(|e| json!({"error": format!("Serialization failed: {}", e)}).to_string());
        println!("{}", final_resp);
        std::io::stdout().flush().unwrap();
    }
}
