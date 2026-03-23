use std::path::PathBuf;
use std::io::{BufReader, BufRead, stdin};
use serde_json::{json, Value};
use libloading::Library;

pub async fn run_native_host(lib_path: &str) {
    let path = PathBuf::from(lib_path);
    if !path.exists() {
        eprintln!("Error: library {:?} not found", path);
        std::process::exit(1);
    }

    let lib = unsafe { Library::new(&path).expect("Failed to load native library") };

    let mut reader = BufReader::new(stdin());
    
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.is_empty() { break; }

        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                println!("{}", json!({"error": "Invalid JSON"}));
                continue;
            }
        };

        let function_name = request["function"].as_str().unwrap_or("");
        let params = request["params"].as_array();

        // This is a simplified version. The actual @titanpl/sdk/native_export
        // would handle the symbol mapping and type conversion.
        // For now, we mock a few common types.
        
        let result = unsafe {
             if let Ok(symbol) = lib.get::<extern "C" fn(f64, f64) -> f64>(function_name.as_bytes()) {
                 let a = params.and_then(|p| p.get(0)).and_then(|v| v.as_f64()).unwrap_or(0.0);
                 let b = params.and_then(|p| p.get(1)).and_then(|v| v.as_f64()).unwrap_or(0.0);
                 json!(symbol(a, b))
             } else {
                 json!({"error": format!("Function '{}' not found or unexpected signature", function_name)})
             }
        };

        println!("{}", serde_json::to_string(&result).unwrap());
    }
}
