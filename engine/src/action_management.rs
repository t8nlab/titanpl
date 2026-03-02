//! Action Management and Dynamic Routing
//!
//! Handles resolution of action directories, scanning for available actions,
//! and matching dynamic routes (e.g. `/users/:id`).

use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use serde::Deserialize;
use serde_json::Value;

/// Route configuration (loaded from routes.json)
#[derive(Debug, Deserialize, Clone)]
pub struct RouteVal {
    pub r#type: String,
    #[serde(alias = "target")]
    pub value: Value,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DynamicRoute {
    pub method: String,
    pub pattern: String,
    pub action: String,
}

/// Resolve the directory path where actions are stored.
pub fn resolve_actions_dir() -> PathBuf {
    // Respect explicit override first
    if let Ok(override_dir) = env::var("TITAN_ACTIONS_DIR") {
        return PathBuf::from(override_dir);
    }

    // Production container layout
    if Path::new("/app/actions").exists() {
        return PathBuf::from("/app/actions");
    }

    // Try to walk up from the executing binary to discover `<...>/server/src/actions`
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if let Some(target_dir) = parent.parent() {
                if let Some(server_dir) = target_dir.parent() {
                    let candidate = server_dir.join("src").join("actions");
                    if candidate.exists() {
                        return candidate;
                    }
                    let candidate2 = server_dir.join("actions");
                    if candidate2.exists() {
                        return candidate2;
                    }
                }
            }
        }
    }

    // Fall back to local ./src/actions
    PathBuf::from("./src/actions")
}

/// Try to find the directory that contains compiled action bundles.
pub fn find_actions_dir(dist_dir: &PathBuf) -> Option<PathBuf> {
    let p = dist_dir.join("actions");
    if p.exists() && p.is_dir() {
        return Some(p);
    }
    None
}

/// Match a dynamic route against the current request path.
pub fn match_dynamic_route(
    method: &str,
    path: &str,
    routes: &[DynamicRoute],
) -> Option<(String, HashMap<String, String>)> {
    let path_segments: Vec<&str> =
        path.trim_matches('/').split('/').collect();

    for route in routes {
        if route.method != method {
            continue;
        }

        let pattern_segments: Vec<&str> =
            route.pattern.trim_matches('/').split('/').collect();

        if pattern_segments.len() != path_segments.len() {
            continue;
        }

        let mut params = HashMap::new();
        let mut matched = true;

        for (pat, val) in pattern_segments.iter().zip(path_segments.iter()) {
            if pat.starts_with(':') {
                let inner = &pat[1..];

                let (name, ty) = inner
                    .split_once('<')
                    .map(|(n, t)| (n, t.trim_end_matches('>')))
                    .unwrap_or((inner, "string"));

                let valid = match ty {
                    "number" => val.parse::<i64>().is_ok(),
                    "string" => true,
                    _ => false,
                };

                if !valid {
                    matched = false;
                    break;
                }

                params.insert(name.to_string(), (*val).to_string());
            } else if pat != val {
                matched = false;
                break;
            }
        }

        if matched {
            return Some((route.action.clone(), params));
        }
    }

    None
}

/// Scan the resolved actions directory and return a map of action names to file paths.
pub fn scan_actions(root: &PathBuf) -> HashMap<String, PathBuf> {
    let mut map = HashMap::new();
    
    // Locate actions dir - Priority: project root relative paths
    let dir = match find_actions_dir(root) {
        Some(d) => d,
        None => {
            let ad = resolve_actions_dir();
            if ad.exists() { ad } else { return map; }
        }
    };

    // Scanning actions
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() { continue; }
            
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
            if ext != "js" && ext != "jsbundle" {
                continue;
            }
            
            let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if file_stem.is_empty() { continue; }
            
            // Found action
            map.insert(file_stem.to_string(), path);
        }
    }
    
    map
}