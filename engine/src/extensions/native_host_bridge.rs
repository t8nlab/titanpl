use std::process::{Child, Command, Stdio, ChildStdin, ChildStdout};
use std::io::{Write, Read, BufReader, BufRead};
use std::sync::{Mutex, Arc};
use std::collections::HashMap;
use serde_json::{json, Value};
use std::path::PathBuf;
use crate::utils::{blue, red, yellow};

pub static HOSTS: Mutex<Option<HashMap<String, Arc<NativeHost>>>> = Mutex::new(None);

pub struct NativeHost {
    pub name: String,
    pub path: PathBuf,
    pub stdin: Mutex<ChildStdin>,
    pub stdout: Mutex<ChildStdout>,
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

        println!("{} {} for '{}' at {:?}", blue("[TitanPL]"), yellow("Spawned NativeHost"), name, path);

        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");

        Self { 
            name, 
            path, 
            stdin: Mutex::new(stdin), 
            stdout: Mutex::new(stdout) 
        }
    }

    pub fn call(&self, function: &str, params: Vec<Value>) -> Value {
        let request = json!({
            "function": function,
            "params": params
        });

        let req_str = serde_json::to_string(&request).unwrap() + "\n";
        
        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(req_str.as_bytes()).unwrap();
            stdin.flush().unwrap();
        }

        let mut stdout = self.stdout.lock().unwrap();
        let mut reader = BufReader::new(&mut *stdout);
        let mut response = String::new();
        if reader.read_line(&mut response).is_ok() {
            serde_json::from_str(&response).unwrap_or(json!({"error": "Invalid response from NativeHost"}))
        } else {
            json!({"error": "Failed to read from NativeHost"})
        }
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
    drop(hosts_guard); // Release lock before calling (since call is blocking for now)

    // In a real implementation, this should be an async call to a non-blocking bridge
    host_clone.call(&function, params)
}
