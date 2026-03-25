use std::process::{Child, Command, Stdio, ChildStdin, ChildStdout};
use std::io::{Write, BufReader, BufRead};
use std::sync::{Mutex, Arc};
use std::collections::HashMap;
use serde_json::{json, Value};
use std::path::PathBuf;
use crate::utils::{blue, yellow};

pub static HOSTS: Mutex<Option<HashMap<String, Arc<NativeHost>>>> = Mutex::new(None);

pub struct NativeHost {
    pub name: String,
    pub path: PathBuf,
    pub stdin: Mutex<ChildStdin>,
    pub reader: Mutex<BufReader<ChildStdout>>,
    pub child: Mutex<Child>,
}

impl NativeHost {
    pub fn new(name: String, path: PathBuf) -> Self {
        let mut child = Command::new(std::env::current_exe().expect("Failed to get current executable path"))
            .arg("native-host")
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("Failed to spawn NativeHost");

        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");

        Self { 
            name, 
            path, 
            stdin: Mutex::new(stdin),
            // Wrap stdout in a persistent BufReader ONCE
            reader: Mutex::new(BufReader::new(stdout)),
            child: Mutex::new(child)
        }
    }

    pub fn call(&self, function: &str, params: Vec<Value>) -> Value {
        // 1. Build and send request
        let request = json!({
            "function": function,
            "params": params
        });

        let req_str = format!("{}\n", serde_json::to_string(&request).unwrap());
        
        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(req_str.as_bytes()).unwrap();
            stdin.flush().unwrap();
        }

        // 2. Read one line from the persistent BufReader
        let mut response = String::new();
        let mut reader = self.reader.lock().unwrap();
        
        match reader.read_line(&mut response) {
            Ok(0) => {
                return json!({"error": "NativeHost closed connection (EOF)"});
            },
            Ok(_) => {},
            Err(e) => {
                return json!({"error": format!("Error reading from NativeHost: {}", e)});
            }
        }
        
        serde_json::from_str(response.trim())
            .unwrap_or_else(|_| json!({"error": format!("Invalid JSON from NativeHost: {}", response)}))
    }
}

pub async fn handle_native_call(extension: String, function: String, params: Vec<Value>) -> Value {
    // 1. Get registry to find the extension path
    let registry_guard = super::external::REGISTRY.lock().unwrap();
    let registry = registry_guard.as_ref().unwrap();
    let ext_def = match registry.extensions.get(&extension) {
        Some(d) => d,
        None => return json!({"error": format!("Extension '{}' not found", extension)}),
    };

    let native_path = match &ext_def.native_path {
        Some(p) => p,
        None => return json!({"error": format!("Extension '{}' is not a native extension", extension)}),
    };

    // 2. Get or spawn host
    let mut hosts_guard = HOSTS.lock().unwrap();
    if hosts_guard.is_none() {
        *hosts_guard = Some(HashMap::new());
    }
    let hosts = hosts_guard.as_mut().unwrap();

    let host = hosts.entry(extension.clone()).or_insert_with(|| {
        Arc::new(NativeHost::new(extension.clone(), native_path.clone()))
    });

    let host_clone = host.clone();
    drop(hosts_guard);

    host_clone.call(&function, params)
}
