use anyhow::Result;
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Json},
    routing::any,
};
use serde_json::Value;
use std::time::Instant;
use std::{collections::HashMap, fs, path::PathBuf, sync::Arc};
use tokio::net::TcpListener;
use smallvec::SmallVec;

mod utils;

mod action_management;
mod extensions;
mod runtime;

use action_management::{
    DynamicRoute, RouteVal, match_dynamic_route,
};
use runtime::RuntimeManager;
use utils::{blue, gray, green, red, white, yellow};

#[derive(Clone)]
struct AppState {
    routes: Arc<HashMap<String, RouteVal>>,
    dynamic_routes: Arc<Vec<DynamicRoute>>,
    runtime: Arc<RuntimeManager>,
}

// Root/dynamic handlers -----------------------------------------------------

async fn root_route(state: State<AppState>, req: Request<Body>) -> impl IntoResponse {
    dynamic_handler_inner(state, req).await
}

async fn dynamic_route(state: State<AppState>, req: Request<Body>) -> impl IntoResponse {
    dynamic_handler_inner(state, req).await
}

async fn dynamic_handler_inner(
    State(state): State<AppState>,
    req: Request<Body>,
) -> impl IntoResponse {
    // ---------------------------
    // BASIC REQUEST INFO
    // ---------------------------
    let method = req.method().as_str().to_uppercase();
    let path = req.uri().path().to_string();
    let strict_key = format!("{}:{}", method, path);
    // Also try simple path for generic routes
    // Check strict first, then simple path

    // ---------------------------
    // TIMER + LOG META
    // ---------------------------
    let start = Instant::now();
    let mut route_label = String::from("not_found");
    let mut route_kind = "none"; // exact | dynamic | reply

    // ---------------------------
    // QUERY PARSING
    // ---------------------------
    let query_pairs: Vec<(String, String)> = req
        .uri()
        .query()
        .map(|q| {
            q.split('&')
                .filter_map(|pair| {
                    let mut it = pair.splitn(2, '=');
                    Some((it.next()?.to_string(), it.next().unwrap_or("").to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    
    let query_map: HashMap<String, String> = query_pairs.into_iter().collect();

    // ---------------------------
    // HEADERS & BODY
    // ---------------------------
    let (parts, body) = req.into_parts();

    let headers_map: HashMap<String, String> = parts
        .headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let body_bytes = match to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response(),
    };

    // ---------------------------
    // ROUTE RESOLUTION
    // ---------------------------
    let mut params: HashMap<String, String> = HashMap::new();
    let mut action_name: Option<String> = None;

    // Exact route
    let route = state.routes.get(&strict_key).or_else(|| state.routes.get(&path));
    if let Some(route) = route {
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
    // EXECUTE IN V8 (WORKER POOL)
    // ---------------------------
    
    // OPTIMIZATION: Zero-Copy & Stack Allocation
    // 1. Headers/Params are collected into `SmallVec` (stack allocated if small).
    // 2. Body is passed as `Bytes` (ref-counted pointer), not copied.
    // 3. No JSON serialization happens here anymore. This saves ~60% CPU vs previous version.
    
    let headers_vec: SmallVec<[(String, String); 8]> = headers_map.into_iter().collect();
    let params_vec: SmallVec<[(String, String); 4]> = params.into_iter().collect();
    let query_vec: SmallVec<[(String, String); 4]> = query_map.into_iter().collect();
    
    // Pass raw bytes to worker if not empty
    let body_arg = if !body_bytes.is_empty() {
        Some(body_bytes)
    } else {
        None
    };

    // Dispatch to the optimized RuntimeManager
    // This sends a pointer-sized message through the ring buffer, triggering 
    // the V8 thread to wake up and process the request immediately.

    // Dispatch to the optimized RuntimeManager
    let (mut result_json, timings) = state
        .runtime
        .execute(
            action_name,
            method.clone(),
            path.clone(),
            body_arg,
            headers_vec,
            params_vec,
            query_vec
        )
        .await
        .unwrap_or_else(|e| (serde_json::json!({"error": e}), vec![]));

    // Construct Server-Timing header
    let server_timing = timings.iter().enumerate().map(|(i, (name, duration))| {
        format!("{}_{};dur={:.2}", name, i, duration)
    }).collect::<Vec<_>>().join(", ");

    // Inject timings into JSON if it's an object
    if let Some(obj) = result_json.as_object_mut() {
        obj.insert("_titanTimings".to_string(), serde_json::json!(timings));
    }

    // Prepare response
    let mut response = if let Some(err) = result_json.get("error") {
        let prefix = if !timings.is_empty() { 
            format!("{} {}", blue("[Titan"), blue("Drift]"))
        } else {
            blue("[Titan]").to_string()
        };

        println!(
            "{} {} {} {}",
            prefix,
            red(&format!("{} {}", method, path)), 
            red("→ error"),
            gray(&format!("in {:.2?}", start.elapsed()))
        );
         println!(
            "{} {} {} {}",
            prefix,
            red("Action Error:"),
            red(err.as_str().unwrap_or("Unknown")),
            gray(&format!("in {:.2?}", start.elapsed()))
        );
        (StatusCode::INTERNAL_SERVER_ERROR, Json(result_json.clone())).into_response()
    } else if let Some(is_resp) = result_json.get("_isResponse") {
        if is_resp.as_bool().unwrap_or(false) {
            let status_u16 = match result_json.get("status") {
                Some(Value::Number(n)) => {
                    if let Some(u) = n.as_u64() {
                        u as u16
                    } else if let Some(f) = n.as_f64() {
                        f as u16
                    } else {
                        200
                    }
                }
                _ => 200,
            };

            let status = StatusCode::from_u16(status_u16).unwrap_or(StatusCode::OK);
            let mut builder = axum::http::Response::builder().status(status);

            if let Some(hmap) = result_json.get("headers").and_then(|v| v.as_object()) {
                for (k, v) in hmap {
                    if let Some(vs) = v.as_str() {
                        builder = builder.header(k, vs);
                    }
                }
            }

            let mut is_redirect = false;
            
            if let Some(location) = result_json.get("redirect") {
                if let Some(url) = location.as_str() {
                    let mut final_status_u16 = status.as_u16();
                    // If it's a redirect call, ensure we use a 3xx status
                    if final_status_u16 < 300 || final_status_u16 > 399 {
                        final_status_u16 = 302; // Default to 302 Found
                    }
                    
                    builder = builder.status(StatusCode::from_u16(final_status_u16).unwrap_or(StatusCode::FOUND))
                                     .header("Location", url);
                    is_redirect = true;
                }
            }

            let body_text = if is_redirect {
                "".to_string()
            } else {
                match result_json.get("body") {
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                    None => "".to_string(),
                }
            };

            builder.body(Body::from(body_text)).unwrap()
        } else {
            Json(result_json.clone()).into_response()
        }
    } else {
        Json(result_json.clone()).into_response()
    };

    // Add Server-Timing Header
    if !server_timing.is_empty() {
        response.headers_mut().insert("Server-Timing", server_timing.parse().unwrap());
    }

    // ---------------------------
    // FINAL LOG (SUCCESS)
    // ---------------------------
    let total_elapsed = start.elapsed();
    let total_elapsed_ms = total_elapsed.as_secs_f64() * 1000.0;
    
    let total_drift_ms: f64 = timings.iter()
        .filter(|(n, _)| n == "drift" || n == "drift_error")
        .map(|(_, d)| d)
        .sum();
    
    let compute_ms = (total_elapsed_ms - total_drift_ms).max(0.0);

    let prefix = if !timings.is_empty() { 
        format!("{} {}", blue("[Titan"), blue("Drift]"))
    } else {
        blue("[Titan]").to_string()
    };

    let timing_info = if !timings.is_empty() {
        gray(&format!("(active: {:.2}ms, drift: {:.2}ms) in {:.2?}", compute_ms, total_drift_ms, total_elapsed))
    } else {
        gray(&format!("in {:.2?}", total_elapsed))
    };

    match route_kind {
        "dynamic" => println!(
            "{} {} {} {} {} {}",
            prefix,
            green(&format!("{} {}", method, path)),
            white("→"),
            green(&route_label),
            white("(dynamic)"),
            timing_info
        ),
        "exact" => println!(
            "{} {} {} {} {}",
            prefix,
            white(&format!("{} {}", method, path)),
            white("→"),
            yellow(&route_label),
            timing_info
        ),
        _ => {}
    }

    response
}


// Entrypoint ---------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    
    // Load routes.json
    let raw = fs::read_to_string("./routes.json").unwrap_or_else(|_| "{}".to_string());
    let json: Value = serde_json::from_str(&raw).unwrap_or_default();

    let port = json["__config"]["port"].as_u64().unwrap_or(3000);
    let thread_count = json["__config"]["threads"].as_u64();
    let routes_json = json["routes"].clone();
    let map: HashMap<String, RouteVal> = serde_json::from_value(routes_json).unwrap_or_default();
    let dynamic_routes: Vec<DynamicRoute> =
        serde_json::from_value(json["__dynamic_routes"].clone()).unwrap_or_default();

    // Identify project root (where .ext or node_modules lives)
    let project_root = resolve_project_root();

    // Load extensions (Load definitions globally)
    extensions::load_project_extensions(project_root.clone());
    
    // Initialize Runtime Manager (Worker Pool)
    let threads = match thread_count {
        Some(t) if t > 0 => t as usize,
        _ => num_cpus::get() * 4,   // default
    };

    
    let runtime_manager = Arc::new(RuntimeManager::new(project_root.clone(), threads));

    let state = AppState {
        routes: Arc::new(map),
        dynamic_routes: Arc::new(dynamic_routes),
        runtime: runtime_manager,
    };

    let app = Router::new()
        .route("/", any(root_route))
        .fallback(any(dynamic_route))
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

    
    println!(
        "\x1b[38;5;39mTitan server running at:\x1b[0m http://localhost:{}  \x1b[90m(Threads: {})\x1b[0m",
        port,
        threads
    );
    

    axum::serve(listener, app).await?;
    Ok(())
}

fn resolve_project_root() -> PathBuf {
    // 1. Check CWD (preferred for local dev/tooling)
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("node_modules").exists()
            || cwd.join("package.json").exists()
            || cwd.join(".ext").exists()
        {
            return cwd;
        }
    }

    // 2. Check executable persistence (Docker / Production)
    // Walk up from the executable to find .ext or node_modules
    if let Ok(exe) = std::env::current_exe() {
        let mut current = exe.parent();
        while let Some(dir) = current {
            if dir.join(".ext").exists() || dir.join("node_modules").exists() {
                return dir.to_path_buf();
            }
            current = dir.parent();
        }
    }

    // 3. Fallback to CWD
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}
