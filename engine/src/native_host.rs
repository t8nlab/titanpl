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

    let lib = unsafe {
        match Library::new(&canonical_path) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[NativeHost] FATAL: Failed to load {:?}: {}", canonical_path, e);
                std::process::exit(1);
            }
        }
    };

    let mut reader = BufReader::new(stdin());

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.is_empty() { break; }

        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                println!("{}", json!({"error": "Invalid JSON"}));
                let _ = std::io::stdout().flush();
                continue;
            }
        };

        let function_name = request["function"].as_str().unwrap_or("");
        let params        = request["params"].as_array();

        let result = unsafe {
            // Priority 1: titan_export JSON ABI (preferred — handles all functions)
            if let Ok(sym) = lib.get::<extern "C" fn(*const std::os::raw::c_char) -> *const std::os::raw::c_char>(b"titan_export") {
                let req_str = serde_json::to_string(&request).unwrap_or_default();
                let c_req   = std::ffi::CString::new(req_str).unwrap();
                let c_res   = sym(c_req.as_ptr());
                if c_res.is_null() {
                    json!({"error": "titan_export returned NULL"})
                } else {
                    let s = std::ffi::CStr::from_ptr(c_res).to_string_lossy();
                    serde_json::from_str(&s)
                        .unwrap_or_else(|_| json!({"error": "DLL returned invalid JSON", "raw": s.to_string()}))
                }
            }
            // Priority 2: Direct C export — multiple separate strings/f64s inferred at runtime
            else if let Ok(sym) = lib.get::<*mut std::ffi::c_void>(function_name.as_bytes()) {
                let mut c_args_ptrs = Vec::new();
                let mut c_args_nums = Vec::new();
                let mut arg_types = Vec::new(); // true = f64, false = string

                let mut c_strings = Vec::new();

                if let Some(arr) = params {
                    for p in arr {
                        if p.is_number() {
                            arg_types.push(true);
                            c_args_nums.push(p.as_f64().unwrap_or(0.0));
                            // push dummy to keep indexes aligned
                            c_strings.push(std::ffi::CString::new("").unwrap());
                        } else {
                            arg_types.push(false);
                            c_args_nums.push(0.0);
                            let s = match p {
                                Value::String(vs) => vs.clone(),
                                _ => p.to_string(),
                            };
                            c_strings.push(std::ffi::CString::new(s).unwrap_or_default());
                        }
                    }
                }

                for c_str in &c_strings {
                    c_args_ptrs.push(c_str.as_ptr());
                }

                let ptr = *sym;

                // Combinatorial matching for up to 3 arguments
                let arg_comb = |i: usize| -> bool { *arg_types.get(i).unwrap_or(&false) };

                // Get argument as correct type (helper)
                // We use raw macros/transmutes
                let c_res: *const std::os::raw::c_char = match arg_types.len() {
                    0 => {
                        let f: extern "C" fn() -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                        f()
                    }
                    1 => {
                        if arg_comb(0) {
                            let f: extern "C" fn(f64) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                            f(c_args_nums[0])
                        } else {
                            let f: extern "C" fn(*const std::os::raw::c_char) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                            f(c_args_ptrs[0])
                        }
                    }
                    2 => {
                        match (arg_comb(0), arg_comb(1)) {
                            (false, false) => {
                                let f: extern "C" fn(*const std::os::raw::c_char, *const std::os::raw::c_char) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                                f(c_args_ptrs[0], c_args_ptrs[1])
                            }
                            (false, true) => {
                                let f: extern "C" fn(*const std::os::raw::c_char, f64) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                                f(c_args_ptrs[0], c_args_nums[1])
                            }
                            (true, false) => {
                                let f: extern "C" fn(f64, *const std::os::raw::c_char) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                                f(c_args_nums[0], c_args_ptrs[1])
                            }
                            (true, true) => {
                                let f: extern "C" fn(f64, f64) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                                f(c_args_nums[0], c_args_nums[1])
                            }
                        }
                    }
                    3 => {
                        match (arg_comb(0), arg_comb(1), arg_comb(2)) {
                            (false, false, false) => {
                                let f: extern "C" fn(*const std::os::raw::c_char, *const std::os::raw::c_char, *const std::os::raw::c_char) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                                f(c_args_ptrs[0], c_args_ptrs[1], c_args_ptrs[2])
                            }
                            // Simplified for likely uses – 3 params are rare in core native extensions, fallback to all-strings if unsupported combo to prevent massive boilerplate
                            _ => {
                                let f: extern "C" fn(*const std::os::raw::c_char, *const std::os::raw::c_char, *const std::os::raw::c_char) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                                f(c_args_ptrs[0], c_args_ptrs[1], c_args_ptrs[2])
                            }
                        }
                    }
                    _ => {
                        let f: extern "C" fn(*const std::os::raw::c_char, *const std::os::raw::c_char, *const std::os::raw::c_char, *const std::os::raw::c_char) -> *const std::os::raw::c_char = std::mem::transmute(ptr);
                        f(c_args_ptrs[0], c_args_ptrs[1], c_args_ptrs[2], c_args_ptrs[3])
                    }
                };

                #[cfg(windows)]
                let is_bad = {
                    unsafe extern "system" {
                        fn IsBadReadPtr(lp: *const std::os::raw::c_void, ucb: usize) -> i32;
                    }
                    IsBadReadPtr(c_res as *const _, 1) != 0
                };
                #[cfg(not(windows))]
                let is_bad = false;

                if c_res.is_null() || is_bad {
                    json!({"error": "Native returned NULL or void pointer"})
                } else {
                    let s = std::ffi::CStr::from_ptr(c_res).to_string_lossy();
                    serde_json::from_str(&s).unwrap_or_else(|_| Value::String(s.to_string()))
                }
            } else {
                json!({"error": format!("Function '{}' not found in DLL", function_name)})
            }
        };

        let out = serde_json::to_string(&result)
            .unwrap_or_else(|_| json!({"error": "serialization failed"}).to_string());
        println!("{}", out);
        let _ = std::io::stdout().flush();
    }
}
