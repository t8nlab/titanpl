use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use serde::Deserialize;
use serde_json::Value;

/// Route configuration (loaded from routes.json)
#[derive(Debug, Deserialize, Clone)]
pub struct RouteVal {
    pub r#type: String,
    pub value: Value,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DynamicRoute {
    pub method: String,
    pub pattern: String,
    pub action: String,
}

// -------------------------
// ACTION DIRECTORY RESOLUTION
// -------------------------

pub fn resolve_actions_dir() -> PathBuf {
    // Respect explicit override first
    if let Ok(override_dir) = env::var("TITAN_ACTIONS_DIR") {
        return PathBuf::from(override_dir);
    }

    // Production container layout
    if Path::new("/app/actions").exists() {
        return PathBuf::from("/app/actions");
    }

    // Try to walk up from the executing binary to discover `<...>/server/actions`
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if let Some(target_dir) = parent.parent() {
                if let Some(server_dir) = target_dir.parent() {
                    let candidate = server_dir.join("actions");
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }
    }

    // Fall back to local ./actions
    PathBuf::from("./actions")
}

/// Try to find the directory that contains compiled action bundles.
pub fn find_actions_dir(project_root: &PathBuf) -> Option<PathBuf> {
    let candidates = [
        project_root.join("server").join("actions"),
        project_root.join("actions"),
        project_root.join("..").join("server").join("actions"),
        PathBuf::from("/app").join("actions"),
        PathBuf::from("actions"),
    ];

    for p in &candidates {
        if p.exists() && p.is_dir() {
            return Some(p.clone());
        }
    }

    None
}

// Dynamic Matcher (Core Logic)

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
