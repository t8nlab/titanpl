// server/src/main.rs
use std::{collections::HashMap, env, fs, path::PathBuf, sync::Arc, path::Path};

use anyhow::Result;
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Json},
    routing::any,
    Router,
};

use boa_engine::{object::ObjectInitializer, Context, JsValue, Source};
use boa_engine::{js_string, native_function::NativeFunction, property::Attribute};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::blocking::Client;

use serde::Deserialize;
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::task;

/// Route configuration (loaded from routes.json)
#[derive(Debug, Deserialize)]
struct RouteVal {
    r#type: String,
    value: Value,
}

#[derive(Clone)]
struct AppState {
    routes: Arc<HashMap<String, RouteVal>>,
    project_root: PathBuf,
}

// -------------------------
// ACTION DIRECTORY RESOLUTION
// -------------------------

fn resolve_actions_dir() -> PathBuf {
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
///
/// Checks multiple likely paths to support both dev and production container layouts:
///  - <project_root>/server/actions
///  - <project_root>/actions
///  - <project_root>/../server/actions
///  - /app/actions
///  - ./actions
fn find_actions_dir(project_root: &PathBuf) -> Option<PathBuf> {
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

/// Injects a synchronous `t.fetch(url, opts?)` function into the Boa `Context`.
///
/// Implementation details:
///  - Converts JS opts → `serde_json::Value` (owned) using `to_json`.
///  - Executes reqwest blocking client inside `tokio::task::block_in_place` to avoid blocking async runtime.
///  - Returns `{ ok: bool, status?: number, body?: string, error?: string }`.
fn inject_t_fetch(ctx: &mut Context) {
    // Native function (Boa 0.20) using from_fn_ptr
    let t_fetch_native = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        // Extract URL (owned string)
        let url = args
            .get(0)
            .and_then(|v| v.to_string(ctx).ok())
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_default();

        // Extract opts -> convert to serde_json::Value (owned)
        let opts_js = args.get(1).cloned().unwrap_or(JsValue::undefined());
        let opts_json: Value = match opts_js.to_json(ctx) {
            Ok(v) => v,
            Err(_) => Value::Object(serde_json::Map::new()),
        };

        // Pull method, body, headers into owned Rust values
        let method = opts_json
            .get("method")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "GET".to_string());

        let body_opt = match opts_json.get("body") {
            Some(Value::String(s)) => Some(s.clone()),
            Some(other) => Some(other.to_string()),
            None => None,
        };

        // headers as Vec<(String,String)>
        let mut header_pairs: Vec<(String, String)> = Vec::new();
        if let Some(Value::Object(map)) = opts_json.get("headers") {
            for (k, v) in map.iter() {
                let v_str = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                header_pairs.push((k.clone(), v_str));
            }
        }

        // Perform the blocking HTTP request inside block_in_place to avoid runtime panic
        let out_json = task::block_in_place(move || {
            let client = Client::new();

            let method_parsed = method.parse().unwrap_or(reqwest::Method::GET);
            let mut req = client.request(method_parsed, &url);

            if !header_pairs.is_empty() {
                let mut headers = HeaderMap::new();
                for (k, v) in header_pairs.into_iter() {
                    if let (Ok(name), Ok(val)) =
                        (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v))
                    {
                        headers.insert(name, val);
                    }
                }
                req = req.headers(headers);
            }

            if let Some(body) = body_opt {
                req = req.body(body);
            }

            match req.send() {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let text = resp.text().unwrap_or_default();
                    serde_json::json!({
                        "ok": true,
                        "status": status,
                        "body": text
                    })
                }
                Err(e) => serde_json::json!({
                    "ok": false,
                    "error": e.to_string()
                }),
            }
        });

        // Convert serde_json::Value -> JsValue
        Ok(JsValue::from_json(&out_json, ctx).unwrap_or(JsValue::undefined()))
    });

    // Convert native function to JS function object (requires Realm)
    let realm = ctx.realm();
    let t_fetch_js_fn = t_fetch_native.to_js_function(realm);

    // Build `t` object with `.fetch`
    let t_obj = ObjectInitializer::new(ctx)
        .property(js_string!("fetch"), t_fetch_js_fn, Attribute::all())
        .build();

    ctx.global_object()
        .set(js_string!("t"), JsValue::from(t_obj), false, ctx)
        .expect("set global t");
}

// Root/dynamic handlers -----------------------------------------------------

async fn root_route(state: State<AppState>, req: Request<Body>) -> impl IntoResponse {
    dynamic_handler_inner(state, req).await
}

async fn dynamic_route(state: State<AppState>, req: Request<Body>) -> impl IntoResponse {
    dynamic_handler_inner(state, req).await
}

/// Main handler: looks up routes.json and executes action bundles using Boa.
async fn dynamic_handler_inner(
    State(state): State<AppState>,
    req: Request<Body>,
) -> impl IntoResponse {
    let method = req.method().as_str().to_uppercase();
    let path = req.uri().path();
    let key = format!("{}:{}", method, path);

    let body_bytes = match to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read body").into_response(),
    };
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    if let Some(route) = state.routes.get(&key) {
        match route.r#type.as_str() {
            "action" => {
                let action_name = route.value.as_str().unwrap_or("").trim();
                if action_name.is_empty() {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid action name").into_response();
                }

                // Resolve actions directory: prefer resolve_actions_dir(), fall back to heuristic find_actions_dir
                let resolved = resolve_actions_dir();
                let actions_dir = if resolved.exists() && resolved.is_dir() {
                    resolved
                } else {
                    match find_actions_dir(&state.project_root) {
                        Some(p) => p,
                        None => {
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                format!("Actions directory not found (checked multiple locations)"),
                            )
                                .into_response();
                        }
                    }
                };

                let action_path = actions_dir.join(format!("{}.jsbundle", action_name));

                if !action_path.exists() {
                    return (
                        StatusCode::NOT_FOUND,
                        format!("Action bundle not found: {:?}", action_path),
                    )
                        .into_response();
                }

                let js_code = match fs::read_to_string(&action_path) {
                    Ok(v) => v,
                    Err(e) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed reading action bundle: {}", e),
                        )
                            .into_response();
                    }
                };

                // Build env object
                let mut env_map = serde_json::Map::new();
                for (k, v) in std::env::vars() {
                    env_map.insert(k, Value::String(v));
                }
                let env_json = Value::Object(env_map);

                // Injected script: sets process.env and __titan_req and invokes action function.
                let injected = format!(
                    r#"
                    globalThis.process = {{ env: {} }};
                    const __titan_req = {};
                    {};
                    {}(__titan_req);
                    "#,
                    env_json.to_string(),
                    body_str,
                    js_code,
                    action_name
                );

                let mut ctx = Context::default();
                inject_t_fetch(&mut ctx);

                let result = match ctx.eval(Source::from_bytes(&injected)) {
                    Ok(v) => v,
                    Err(e) => return Json(json_error(e.to_string())).into_response(),
                };

                let result_json: Value = match result.to_json(&mut ctx) {
                    Ok(v) => v,
                    Err(e) => json_error(e.to_string()),
                };

                return Json(result_json).into_response();
            }

            "json" => return Json(route.value.clone()).into_response(),
            _ => {
                if let Some(s) = route.value.as_str() {
                    return s.to_string().into_response();
                }
                return route.value.to_string().into_response();
            }
        }
    }

    (StatusCode::NOT_FOUND, "Not Found").into_response()
}

fn json_error(msg: String) -> Value {
    serde_json::json!({ "error": msg })
}

// Entrypoint ---------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    // Load routes.json (expected at runtime root)
    let raw = fs::read_to_string("./routes.json").unwrap_or_else(|_| "{}".to_string());
    let json: Value = serde_json::from_str(&raw).unwrap_or_default();

    let port = json["__config"]["port"].as_u64().unwrap_or(3000);
    let routes_json = json["routes"].clone();
    let map: HashMap<String, RouteVal> = serde_json::from_value(routes_json).unwrap_or_default();

    // Project root — heuristics: try current_dir()
    let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let state = AppState {
        routes: Arc::new(map),
        project_root,
    };

    let app = Router::new()
        .route("/", any(root_route))
        .fallback(any(dynamic_route))
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

    // Banner (yellow-orange) and server info
    println!("\n\x1b[38;5;208m████████╗██╗████████╗ █████╗ ███╗   ██╗");
    println!("╚══██╔══╝██║╚══██╔══╝██╔══██╗████╗  ██║");
    println!("   ██║   ██║   ██║   ███████║██╔██╗ ██║");
    println!("   ██║   ██║   ██║   ██╔══██║██║╚██╗██║");
    println!("   ██║   ██║   ██║   ██║  ██║██║ ╚████║");
    println!("   ╚═╝   ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝\x1b[0m\n");
    println!("\x1b[38;5;39mTitan server running at:\x1b[0m http://localhost:{}", port);

    axum::serve(listener, app).await?;
    Ok(())
}
