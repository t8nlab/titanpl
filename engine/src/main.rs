use anyhow::Result;
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{State, FromRequestParts, Request as AxumRequest, ws::{WebSocketUpgrade, WebSocket, Message}},
    http::{StatusCode, HeaderValue},
    response::{IntoResponse, Json},
    routing::any,
};
use dashmap::DashMap;
use tokio::sync::mpsc;
use futures_util::{StreamExt, SinkExt};
use serde_json::Value;
use smallvec::SmallVec;
use std::time::Instant;
use std::{collections::HashMap, fs, path::PathBuf, sync::Arc};
use tokio::net::TcpListener;

mod action_management;
mod fast_path;

use gravity::{RuntimeManager, WsMessage};
use gravity::extensions;
use gravity::utils::{blue, gray, green, red, white, yellow};
use gravity::native_host;
use action_management::{RouteVal, DynamicRoute, match_dynamic_route, scan_actions};
use fast_path::{FastPathRegistry, PrecomputedRoute};

/// Global allocator: mimalloc for ~5-15% better allocation throughput.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[derive(Clone)]
struct AppState {
    routes: Arc<HashMap<String, RouteVal>>,
    dynamic_routes: Arc<Vec<DynamicRoute>>,
    runtime: Arc<RuntimeManager>,
    /// Pre-computed responses for static actions (bypass V8)
    fast_paths: Arc<FastPathRegistry>,
    /// Pre-serialized responses for reply routes (no re-serialization per request)
    precomputed: Arc<HashMap<String, PrecomputedRoute>>,
    /// When true: disable per-request logging and timings injection
    production_mode: bool,
    /// Active WebSocket channels (Gravity compatible)
    ws_sockets: Arc<DashMap<String, mpsc::UnboundedSender<WsMessage>>>,
}

async fn root_route(state: State<AppState>, req: AxumRequest) -> impl IntoResponse {
    handler(state, req).await
}

async fn dynamic_route(state: State<AppState>, req: AxumRequest) -> impl IntoResponse {
    handler(state, req).await
}

/// Main request handler — optimized with early fast-path bailout.
async fn handler(State(state): State<AppState>, req: AxumRequest) -> impl IntoResponse {
    let method = req.method().as_str().to_uppercase();
    let path = req.uri().path().to_string();
    let strict_key = format!("{}:{}", method, path);

    let start = Instant::now();
    let log_enabled = !state.production_mode;

    if let Some(route) = state
        .routes
        .get(&strict_key)
        .or_else(|| state.routes.get(&path))
        .or_else(|| state.routes.get(&format!("WS:{}", path)))
    {
        match route.r#type.as_str() {

            // Precomputed reply routes
            "json" | "text" => {
                if let Some(precomputed) = state.precomputed.get(&strict_key) {
                    if state.production_mode {
                        return precomputed.to_axum_response();
                    }

                    let mut response = precomputed.to_axum_response();
                    let elapsed = start.elapsed();

                    response.headers_mut().insert(
                        "Server-Timing",
                        format!("reply;dur={:.2}", elapsed.as_secs_f64() * 1000.0)
                            .parse()
                            .unwrap(),
                    );

                    if log_enabled {
                        println!(
                            "{} {} {} {}",
                            blue("[Titan]"),
                            green(&format!("{} {}", method, path)),
                            white("→ reply"),
                            gray(&format!("in {:.2?}", elapsed))
                        );
                    }

                    return response;
                }

                if route.r#type == "json" {
                    return Json(route.value.clone()).into_response();
                }

                if let Some(s) = route.value.as_str() {
                    return s.to_string().into_response();
                }
            }

            // WebSocket routes
            "websocket" => {
                let (mut parts, _body) = req.into_parts();
                let action_name = route.value.as_str().unwrap_or("").to_string();
                let socket_id = uuid::Uuid::new_v4().to_string();
                let state_clone = state.clone();

                if log_enabled {
                    println!(
                        "{} {} {} {}",
                        blue("[Titan]"),
                        yellow(&format!("WS {}", path)),
                        white("→ upgrade"),
                        gray(&format!("(id: {})", socket_id))
                    );
                }

                return match WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
                    Ok(ws_upgrade) => ws_upgrade.on_upgrade(move |socket| {
                        handle_websocket(socket, socket_id, action_name, state_clone)
                    }).into_response(),
                    Err(rejection) => rejection.into_response(),
                };
            }

            // Action routes (Fast path check)
            "action" => {
                let action_name = route.value.as_str().unwrap_or("");

                if let Some(static_resp) = state.fast_paths.get(action_name) {
                    if state.production_mode {
                        return static_resp.to_axum_response();
                    }

                    let mut response = static_resp.to_axum_response();
                    let elapsed = start.elapsed();

                    response.headers_mut().insert(
                        "Server-Timing",
                        format!("fastpath;dur={:.2}", elapsed.as_secs_f64() * 1000.0)
                            .parse()
                            .unwrap(),
                    );

                    if log_enabled {
                        println!(
                            "{} {} {} {}",
                            blue("[Titan]"),
                            green(&format!("{} {}", method, path)),
                            white("→ fastpath"),
                            gray(&format!("in {:.2?}", elapsed))
                        );
                    }

                    return response;
                }
            }

            _ => {
                if let Some(s) = route.value.as_str() {
                    if state.production_mode {
                        return s.to_string().into_response();
                    }
                    let elapsed = start.elapsed();
                    if log_enabled {
                        println!(
                            "{} {} {} {}",
                            blue("[Titan]"),
                            green(&format!("{} {}", method, path)),
                            white("→ reply"),
                            gray(&format!("in {:.2?}", elapsed))
                        );
                    }
                    return s.to_string().into_response();
                }
            }
        }
    }

    let start = Instant::now();
    let log_enabled = !state.production_mode;

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

    let (mut parts, body) = req.into_parts();
    let headers_map: HashMap<String, String> = parts
        .headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let body_bytes = match to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response(),
    };

    let mut params: HashMap<String, String> = HashMap::new();
    let mut action_name: Option<String> = None;
    let mut route_kind = "none";
    let mut route_label = String::from("not_found");

    let route = state
        .routes
        .get(&strict_key)
        .or_else(|| state.routes.get(&path));
    if let Some(route) = route {
        route_kind = "exact";
        if route.r#type == "action" {
            let name = route.value.as_str().unwrap_or("unknown").to_string();
            route_label = name.clone();
            action_name = Some(name);
        }
    }

    if action_name.is_none() {
        if let Some((action, p)) =
            match_dynamic_route(&method, &path, state.dynamic_routes.as_slice())
        {
            route_kind = "dynamic";
            route_label = action.clone();
            action_name = Some(action);
            params = p;
        } else {
            if let Some((action, p)) =
                match_dynamic_route("WS", &path, state.dynamic_routes.as_slice())
            {
                route_kind = "websocket_dynamic";
                route_label = action.clone();
                action_name = Some(action);
                params = p;
            }
        }
    }

    if route_kind == "websocket_dynamic" {
        let socket_id = uuid::Uuid::new_v4().to_string();
        let state_clone = state.clone();
        let action_name = action_name.unwrap();

        return match WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
            Ok(ws_upgrade) => ws_upgrade.on_upgrade(move |socket| {
                handle_websocket(socket, socket_id, action_name, state_clone)
            }).into_response(),
            Err(rejection) => rejection.into_response(),
        };
    }

    let action_name = match action_name {
        Some(a) => a,
        None => {
            if log_enabled {
                println!(
                    "{} {} {} {}",
                    blue("[Titan]"),
                    white(&format!("{} {}", method, path)),
                    white("→ 404"),
                    gray(&format!("in {:.2?}", start.elapsed()))
                );
            }
            return (StatusCode::NOT_FOUND, "Not Found").into_response();
        }
    };

    if let Some(static_resp) = state.fast_paths.get(&action_name) {
        if log_enabled {
            println!(
                "{} {} {} {}",
                blue("[Titan FastPath]"),
                white(&format!("{} {}", method, path)),
                green("→ static"),
                gray(&format!("in {:.2?}", start.elapsed()))
            );
        }
        return static_resp.to_axum_response();
    }

    let headers_vec: SmallVec<[(String, String); 8]> = headers_map.into_iter().collect();
    let params_vec: SmallVec<[(String, String); 4]> = params.into_iter().collect();
    let query_vec: SmallVec<[(String, String); 4]> = query_map.into_iter().collect();

    let body_arg = if !body_bytes.is_empty() {
        Some(body_bytes)
    } else {
        None
    };

    let (result_json, timings) = state
        .runtime
        .execute(
            action_name.clone(),
            method.clone(),
            path.clone(),
            body_arg,
            headers_vec,
            params_vec,
            query_vec,
        )
        .await
        .unwrap_or_else(|e| (serde_json::json!({"error": e}), vec![]));

    if let Some(err) = result_json.get("error") {
        if log_enabled {
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
        }
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(result_json)).into_response();
    }

    let mut response = if let Some(is_resp) = result_json.get("_isResponse") {
        if is_resp.as_bool().unwrap_or(false) {
            let status_u16 = result_json.get("status").and_then(|v| v.as_u64()).unwrap_or(200) as u16;
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
                    if !(300..400).contains(&final_status_u16) { final_status_u16 = 302; }
                    builder = builder.status(StatusCode::from_u16(final_status_u16).unwrap_or(StatusCode::FOUND)).header("Location", url);
                    is_redirect = true;
                }
            }

            let body_text = if is_redirect { "".to_string() } else {
                match result_json.get("body") {
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                    None => "".to_string(),
                }
            };
            builder.body(Body::from(body_text)).unwrap()
        } else {
            Json(result_json).into_response()
        }
    } else {
        Json(result_json).into_response()
    };

    if !state.production_mode && !timings.is_empty() {
        let server_timing = timings.iter().enumerate().map(|(i, (name, duration))| format!("{}_{};dur={:.2}", name, i, duration)).collect::<Vec<_>>().join(", ");
        response.headers_mut().insert("Server-Timing", server_timing.parse().unwrap_or_else(|_| HeaderValue::from_static("")));
    }

    if log_enabled {
        let total_elapsed = start.elapsed();
        let total_elapsed_ms = total_elapsed.as_secs_f64() * 1000.0;
        let total_drift_ms: f64 = timings.iter().filter(|(n, _)| n == "drift" || n == "drift_error").map(|(_, d)| d).sum();
        let compute_ms = (total_elapsed_ms - total_drift_ms).max(0.0);

        let prefix = if !timings.is_empty() { format!("{} {}", blue("[Titan"), blue("Drift]")) } else { blue("[Titan]").to_string() };
        let timing_info = if !timings.is_empty() { gray(&format!("(active: {:.2}ms, drift: {:.2}ms) in {:.2?}", compute_ms, total_drift_ms, total_elapsed)) } else { gray(&format!("in {:.2?}", total_elapsed)) };

        match route_kind {
            "dynamic" => println!("{} {} {} {} {} {}", prefix, green(&format!("{} {}", method, path)), white("→"), green(&route_label), white("(dynamic)"), timing_info),
            "exact" => println!("{} {} {} {} {}", prefix, white(&format!("{} {}", method, path)), white("→"), yellow(&route_label), timing_info),
            _ => {}
        }
    }

    response
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "native-host" {
        native_host::run_native_host(&args[2]).await;
        return Ok(());
    }

    if args.len() < 3 || args[1] != "run" {
        eprintln!("Usage: titan-runtime run <dist_dir>");
        std::process::exit(1);
    }
    let dist_dir = PathBuf::from(&args[2]);
    if !dist_dir.exists() {
        eprintln!("Error: dist directory {:?} not found", dist_dir);
        std::process::exit(1);
    }

    let production_mode = std::env::var("TITAN_DEV").unwrap_or_default() != "1";
    let routes_path = dist_dir.join("routes.json");
    let raw = fs::read_to_string(&routes_path).unwrap_or_else(|_| "{}".to_string());
    let json: Value = serde_json::from_str(&raw).unwrap_or_default();

    let port = std::env::var("PORT").ok().and_then(|p| p.parse::<u64>().ok()).or_else(|| json["__config"]["port"].as_u64()).unwrap_or(3000);
    let thread_count = json["__config"]["threads"].as_u64();
    let routes_json = json["routes"].clone();
    let map: HashMap<String, RouteVal> = serde_json::from_value(routes_json).unwrap_or_default();
    let dynamic_routes: Vec<DynamicRoute> = serde_json::from_value(json["__dynamic_routes"].clone()).unwrap_or_default();

    let project_root = dist_dir.clone();
    extensions::load_project_extensions(project_root.clone());

    let mut precomputed = HashMap::new();
    for (key, route) in &map {
        match route.r#type.as_str() {
            "json" => { precomputed.insert(key.clone(), PrecomputedRoute::from_json(&route.value)); }
            "text" => { if let Some(s) = route.value.as_str() { precomputed.insert(key.clone(), PrecomputedRoute::from_text(s)); } }
            _ => {}
        }
    }

    let actions_dir = dist_dir.join("actions");
    let fast_paths = FastPathRegistry::build(&actions_dir);

    let threads = match thread_count {
        Some(t) if t > 0 => t as usize,
        _ => num_cpus::get() * 2,
    };

    let stack_mb = json["__config"]["stack_mb"].as_u64().unwrap_or(8);
    let stack_size = (stack_mb as usize) * 1024 * 1024;

    let runtime_manager = Arc::new(RuntimeManager::new(project_root.clone(), threads, stack_size));

    // Load Actions into workers
    let action_files = scan_actions(&project_root);
    for (name, path) in action_files {
        if let Ok(code) = fs::read_to_string(&path) {
            runtime_manager.load_action(name, code);
        }
    }

    let state = AppState {
        routes: Arc::new(map),
        dynamic_routes: Arc::new(dynamic_routes),
        runtime: runtime_manager,
        fast_paths: Arc::new(fast_paths),
        precomputed: Arc::new(precomputed),
        production_mode,
        ws_sockets: Arc::new(DashMap::new()),
    };

    extensions::WS_CHANNELS.get_or_init(|| state.ws_sockets.clone());
    extensions::TASK_RUNTIME.get_or_init(|| state.runtime.clone());

    let app = Router::new()
        .route("/", any(root_route))
        .fallback(any(dynamic_route))
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    println!("\x1b[38;5;39mTitan server running at:\x1b[0m http://localhost:{}  \x1b[90m(Threads: {}, Stack: {}MB{})\x1b[0m", port, threads, stack_mb, if production_mode { "" } else { ", Dev Mode" });

    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_websocket(socket: WebSocket, id: String, action: String, state: AppState) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    state.ws_sockets.insert(id.clone(), tx);

    let _ = state.runtime.execute(action.clone(), "WS".to_string(), "/ws".to_string(), None, smallvec::smallvec![("socketId".to_string(), id.clone()), ("event".to_string(), "open".to_string())], smallvec::smallvec![], smallvec::smallvec![]).await;

    let (mut sender, mut receiver) = socket.split();
    let id_clone = id.clone();
    let state_clone = state.clone();
    let action_clone = action.clone();

    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let axum_msg = match msg {
                WsMessage::Text(t) => Message::Text(t.into()),
                WsMessage::Binary(b) => Message::Binary(b.into()),
                WsMessage::Ping(p) => Message::Ping(p.into()),
                WsMessage::Pong(p) => Message::Pong(p.into()),
                WsMessage::Close(_) => Message::Close(None),
            };
            if sender.send(axum_msg).await.is_err() { break; }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(t) => {
                    let _ = state_clone.runtime.execute(action_clone.clone(), "WS".to_string(), "/ws".to_string(), Some(bytes::Bytes::from(t.as_str().to_string())), smallvec::smallvec![("socketId".to_string(), id_clone.clone()), ("event".to_string(), "message".to_string())], smallvec::smallvec![], smallvec::smallvec![]).await;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! { _ = (&mut send_task) => recv_task.abort(), _ = (&mut recv_task) => send_task.abort(), };
    state.ws_sockets.remove(&id);
    let _ = state.runtime.execute(action, "WS".to_string(), "/ws".to_string(), None, smallvec::smallvec![("socketId".to_string(), id), ("event".to_string(), "close".to_string())], smallvec::smallvec![], smallvec::smallvec![]).await;
}
