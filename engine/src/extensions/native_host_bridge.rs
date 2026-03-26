use std::process::{Command, Stdio, Child, ChildStdin, ChildStdout};
use std::io::{Write, BufReader, BufRead};
use std::sync::{Mutex, Arc};
use std::collections::HashMap;
use serde_json::{json, Value};
use std::path::PathBuf;

static HOSTS: Mutex<Option<HashMap<String, Arc<Mutex<NativeHostState>>>>> = Mutex::new(None);

struct NativeHostState {
    name: String,
    path: PathBuf,
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
}

fn spawn_child(path: &PathBuf) -> Option<(Child, ChildStdin, BufReader<ChildStdout>)> {
    let canonical = std::fs::canonicalize(path).unwrap_or(path.clone());
    let dll_dir   = canonical.parent().unwrap_or(&canonical).to_path_buf();

    // Strip Windows UNC prefix so it works as a CLI arg
    let path_str = {
        let s = path.to_string_lossy();
        if s.starts_with(r"\\?\") { s[4..].to_string() } else { s.to_string() }
    };

    let project_root_raw = super::PROJECT_ROOT.get()
        .cloned()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let project_root = {
        let s = project_root_raw.to_string_lossy();
        if s.starts_with(r"\\?\") {
            std::path::PathBuf::from(s[4..].to_string())
        } else {
            project_root_raw
        }
    };

    let exe = std::env::current_exe().ok()?;
    let mut cmd = Command::new(&exe);
    cmd.arg("native-host")
       .arg(&path_str)
       .current_dir(&project_root)
       .stdin(Stdio::piped())
       .stdout(Stdio::piped())
       .stderr(Stdio::inherit());

    // Let the DLL find its own dependencies
    if let Some(p) = std::env::var_os("PATH") {
        let mut paths = std::env::split_paths(&p).collect::<Vec<_>>();
        paths.insert(0, dll_dir);
        if let Ok(new_path) = std::env::join_paths(paths) {
            cmd.env("PATH", new_path);
        }
    }

    let mut child = cmd.spawn().ok()?;
    let stdin  = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    Some((child, stdin, BufReader::new(stdout)))
}

impl NativeHostState {
    fn new(name: String, path: PathBuf) -> Option<Self> {
        let (child, stdin, reader) = spawn_child(&path)?;
        Some(Self { name, path, child, stdin, reader })
    }

    /// Send one JSON request, read one JSON response line.
    /// Returns Err(()) if the pipe is dead (caller should respawn).
    fn call_once(&mut self, request: &Value) -> Result<Value, ()> {
        let req_str = format!("{}\n", serde_json::to_string(request).map_err(|_| ())?);
        self.stdin.write_all(req_str.as_bytes()).map_err(|_| ())?;
        self.stdin.flush().map_err(|_| ())?;

        let mut line = String::new();
        match self.reader.read_line(&mut line) {
            Ok(0) => Err(()), // EOF — child exited
            Ok(_) => serde_json::from_str(line.trim()).map_err(|_| ()),
            Err(_) => Err(()),
        }
    }

    /// Respawn the child process (called after a crash).
    fn respawn(&mut self) -> bool {
        let _ = self.child.kill();
        let _ = self.child.wait();
        match spawn_child(&self.path) {
            Some((child, stdin, reader)) => {
                self.child  = child;
                self.stdin  = stdin;
                self.reader = reader;
                true
            }
            None => false,
        }
    }
}

pub async fn handle_native_call(extension: String, function: String, params: Vec<Value>) -> Value {
    handle_native_call_sync(extension, function, params)
}

pub fn handle_native_call_sync(extension: String, function: String, params: Vec<Value>) -> Value {
    // Resolve DLL path from registry
    let native_path = {
        let guard = super::external::REGISTRY.lock().unwrap();
        let reg   = match guard.as_ref() {
            Some(r) => r,
            None    => return json!({ "error": "Registry not initialized" }),
        };
        let def = match reg.extensions.get(&extension) {
            Some(d) => d,
            None    => return json!({ "error": format!("Extension '{}' not found", extension) }),
        };
        match &def.native_path {
            Some(p) => p.clone(),
            None    => return json!({ "error": format!("'{}' is not a native extension", extension) }),
        }
    };

    // Get or spawn the host
    let mut hosts_guard = HOSTS.lock().unwrap();
    let hosts = hosts_guard.get_or_insert_with(HashMap::new);
    let state_arc = hosts
        .entry(extension.clone())
        .or_insert_with(|| {
            let state = NativeHostState::new(extension.clone(), native_path.clone())
                .expect("Failed to spawn NativeHost");
            Arc::new(Mutex::new(state))
        })
        .clone();
    drop(hosts_guard);

    let request = json!({ "function": function, "params": params });

    let mut state = state_arc.lock().unwrap();

    // Try the call; if it fails, respawn once and retry
    match state.call_once(&request) {
        Ok(val) => val,
        Err(()) => {
            if state.respawn() {
                match state.call_once(&request) {
                    Ok(val) => val,
                    Err(()) => json!({ "error": format!("NativeHost crashed on '{}'", function) }),
                }
            } else {
                json!({ "error": "Failed to respawn NativeHost" })
            }
        }
    }
}
