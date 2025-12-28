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
use std::time::Instant;











/// Route configuration (loaded from routes.json)
#[derive(Debug, Deserialize)]
struct RouteVal {
    r#type: String,
    value: Value,
}

#[derive(Clone)]
struct AppState {
    routes: Arc<HashMap<String, RouteVal>>,
    dynamic_routes: Arc<Vec<DynamicRoute>>,
    project_root: PathBuf,
}


#[derive(Debug, Deserialize)]
struct DynamicRoute {
    method: String,
    pattern: String,
    action: String,
}


fn blue(s: &str) -> String {
    format!("\x1b[34m{}\x1b[0m", s)
}
fn white(s: &str) -> String {
    format!("\x1b[39m{}\x1b[0m", s)
}
fn yellow(s: &str) -> String {
    format!("\x1b[33m{}\x1b[0m", s)
}
fn green(s: &str) -> String {
    format!("\x1b[32m{}\x1b[0m", s)
}
fn gray(s: &str) -> String {
    format!("\x1b[90m{}\x1b[0m", s)
}
fn red(s: &str) -> String {
    format!("\x1b[31m{}\x1b[0m", s)
}

// A helper to Format Boa Errors
fn format_js_error(err: boa_engine::JsError, action: &str) -> String {
    format!(
        "Action: {}\n{}",
        action,
        err.to_string()
    )
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

/// Here add all the runtime t base things
/// Injects a synchronous `t.fetch(url, opts?)` function into the Boa `Context`.
///
/// Implementation details:
///  - Converts JS opts → `serde_json::Value` (owned) using `to_json`.
///  - Executes reqwest blocking client inside `tokio::task::block_in_place` to avoid blocking async runtime.
///  - Returns `{ ok: bool, status?: number, body?: string, error?: string }`.
fn inject_t_runtime(ctx: &mut Context, action_name: &str) {

    // =========================================================
    // t.log(...)  — unsafe by design (Boa requirement)
    // =========================================================
    let action = action_name.to_string();

    let t_log_native = unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let mut parts = Vec::new();

            for arg in args {
                parts.push(arg.display().to_string());
            }

            println!(
                "{} {}",
                blue("[Titan]"),
                white(&format!("log({}): {}", action, parts.join(" ")))
            );

            Ok(JsValue::undefined())
        })
    };

    // =========================================================
    // t.fetch(...) — no capture, safe fn pointer
    // =========================================================
    let t_fetch_native = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        let url = args
            .get(0)
            .and_then(|v| v.to_string(ctx).ok())
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_default();

        let opts_js = args.get(1).cloned().unwrap_or(JsValue::undefined());
        let opts_json: Value = opts_js
            .to_json(ctx)
            .unwrap_or(Value::Object(serde_json::Map::new()));

        let method = opts_json
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("GET")
            .to_string();

        let body_opt = opts_json.get("body").map(|v| v.to_string());

        let mut header_pairs = Vec::new();
        if let Some(Value::Object(map)) = opts_json.get("headers") {
            for (k, v) in map {
                header_pairs.push((k.clone(), v.to_string()));
            }
        }

        let out_json = task::block_in_place(move || {
            let client = Client::new();
            let mut req = client.request(
                method.parse().unwrap_or(reqwest::Method::GET),
                &url,
            );

            if !header_pairs.is_empty() {
                let mut headers = HeaderMap::new();
                for (k, v) in header_pairs {
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
                Ok(resp) => serde_json::json!({
                    "ok": true,
                    "status": resp.status().as_u16(),
                    "body": resp.text().unwrap_or_default()
                }),
                Err(e) => serde_json::json!({
                    "ok": false,
                    "error": e.to_string()
                }),
            }
        });

        Ok(JsValue::from_json(&out_json, ctx).unwrap_or(JsValue::undefined()))
    });

    // =========================================================
    // Build global `t`
    // =========================================================
    let realm = ctx.realm().clone();

    let t_obj = ObjectInitializer::new(ctx)
        .property(
            js_string!("log"),
            t_log_native.to_js_function(&realm),
            Attribute::all(),
        )
        .property(
            js_string!("fetch"),
            t_fetch_native.to_js_function(&realm),
            Attribute::all(),
        )    
        .build();

    ctx.global_object()
        .set(js_string!("t"), JsValue::from(t_obj), false, ctx)
        .expect("set global t");
}


// Dynamic Matcher (Core Logic)

fn match_dynamic_route(
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

    // ---------------------------
    // BASIC REQUEST INFO
    // ---------------------------
    let method = req.method().as_str().to_uppercase();
    let path = req.uri().path().to_string();
    let key = format!("{}:{}", method, path);

    // ---------------------------
    // TIMER + LOG META
    // ---------------------------
    let start = Instant::now();
    let mut route_label = String::from("not_found");
    let mut route_kind = "none"; // exact | dynamic | reply

    // ---------------------------
    // QUERY PARSING
    // ---------------------------
    let query: HashMap<String, String> = req
        .uri()
        .query()
        .map(|q| {
            q.split('&')
                .filter_map(|pair| {
                    let mut it = pair.splitn(2, '=');
                    Some((
                        it.next()?.to_string(),
                        it.next().unwrap_or("").to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    // ---------------------------
    // BODY
    // ---------------------------
    let body_bytes = match to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                "Failed to read request body",
            )
                .into_response()
        }
    };

    let body_str = String::from_utf8_lossy(&body_bytes).to_string();
    let body_json: Value = if body_str.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&body_str).unwrap_or(Value::String(body_str))
    };

    // ---------------------------
    // ROUTE RESOLUTION
    // ---------------------------
    let mut params: HashMap<String, String> = HashMap::new();
    let mut action_name: Option<String> = None;

    // Exact route
    if let Some(route) = state.routes.get(&key) {
        route_kind = "exact";

        if route.r#type == "action" {
            let name = route.value.as_str().unwrap_or("unknown").to_string();
            route_label = name.clone();
            action_name = Some(name);
        } else if route.r#type == "json" {
            let elapsed = start.elapsed();
            println!(
                "{} {} {} {}",
                blue("[Titan]"),
                white(&format!("{} {}", method, path)),
                white("→ json"),
                gray(&format!("in {:.2?}", elapsed))
            );
            return Json(route.value.clone()).into_response();
        } else if let Some(s) = route.value.as_str() {
            let elapsed = start.elapsed();
            println!(
                "{} {} {} {}",
                blue("[Titan]"),
                white(&format!("{} {}", method, path)),
                white("→ reply"),
                gray(&format!("in {:.2?}", elapsed))
            );
            return s.to_string().into_response();
        }
    }

    // Dynamic route
    if action_name.is_none() {
        if let Some((action, p)) =
            match_dynamic_route(&method, &path, state.dynamic_routes.as_slice())
        {
            route_kind = "dynamic";
            route_label = action.clone();
            action_name = Some(action);
            params = p;
        }
    }

    let action_name = match action_name {
        Some(a) => a,
        None => {
            let elapsed = start.elapsed();
            println!(
                "{} {} {} {}",
                blue("[Titan]"),
                white(&format!("{} {}", method, path)),
                white("→ 404"),
                gray(&format!("in {:.2?}", elapsed))
            );
            return (StatusCode::NOT_FOUND, "Not Found").into_response();
        }
    };

    // ---------------------------
    // LOAD ACTION
    // ---------------------------
    let resolved = resolve_actions_dir();
    let actions_dir = resolved
        .exists()
        .then(|| resolved)
        .or_else(|| find_actions_dir(&state.project_root))
        .unwrap();

    let action_path = actions_dir.join(format!("{}.jsbundle", action_name));
    let js_code = fs::read_to_string(&action_path).unwrap();

    // ---------------------------
    // ENV
    // ---------------------------
    let env_json = std::env::vars()
        .map(|(k, v)| (k, Value::String(v)))
        .collect::<serde_json::Map<_, _>>();

    // ---------------------------
    // JS EXECUTION
    // ---------------------------
    let injected = format!(
        r#"
        globalThis.process = {{ env: {} }};
        const __titan_req = {{
            body: {},
            method: "{}",
            path: "{}",
            params: {},
            query: {}
        }};
        {};
        globalThis["{}"](__titan_req);
        "#,
        Value::Object(env_json).to_string(),
        body_json.to_string(),
        method,
        path,
        serde_json::to_string(&params).unwrap(),
        serde_json::to_string(&query).unwrap(),
        js_code,
        action_name
    );

    let mut ctx = Context::default();
    inject_t_runtime(&mut ctx, &action_name);
    let result = match ctx.eval(Source::from_bytes(&injected)) {
        Ok(v) => v,
        Err(err) => {
            let elapsed = start.elapsed();
    
            let details = format_js_error(err, &route_label);
    
            println!(
                "{} {} {} {}",
                blue("[Titan]"),
                red(&format!("{} {}", method, path)),
                red("→ error"),
                gray(&format!("in {:.2?}", elapsed))
            );
    
            println!("{}", red(&details));
    
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Action execution failed",
                    "action": route_label,
                    "details": details
                })),
            )
                .into_response();
        }
    };
    
    let result_json: Value = if result.is_undefined() {
        Value::Null
    } else {
        match result.to_json(&mut ctx) {
            Ok(v) => v,
            Err(err) => {
                let elapsed = start.elapsed();
                println!(
                    "{} {} {} {}",
                    blue("[Titan]"),
                    red(&format!("{} {}", method, path)),
                    red("→ serialization error"),
                    gray(&format!("in {:.2?}", elapsed))
                );
    
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "Failed to serialize action result",
                        "details": err.to_string()
                    })),
                )
                    .into_response();
            }
        }
    };
    
    

    // ---------------------------
    // FINAL LOG
    // ---------------------------
    let elapsed = start.elapsed();
    match route_kind {
        "dynamic" => println!(
            "{} {} {} {} {} {}",
            blue("[Titan]"),
            green(&format!("{} {}", method, path)),
            white("→"),
            green(&route_label),
            white("(dynamic)"),
            gray(&format!("in {:.2?}", elapsed))
        ),
        "exact" => println!(
            "{} {} {} {} {}",
            blue("[Titan]"),
            white(&format!("{} {}", method, path)),
            white("→"),
            yellow(&route_label),
            gray(&format!("in {:.2?}", elapsed))
        ),
        _ => {}
    }

    Json(result_json).into_response()
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
    let map: HashMap<String, RouteVal> =
    serde_json::from_value(routes_json).unwrap_or_default();

    let dynamic_routes: Vec<DynamicRoute> =
    serde_json::from_value(json["__dynamic_routes"].clone())
        .unwrap_or_default();

    // Project root — heuristics: try current_dir()
    let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let state = AppState {
        routes: Arc::new(map),
        dynamic_routes: Arc::new(dynamic_routes),
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
