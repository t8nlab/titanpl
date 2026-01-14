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

mod utils;

mod action_management;
mod extensions;

use action_management::{
    DynamicRoute, RouteVal, find_actions_dir, match_dynamic_route, resolve_actions_dir,
};
use extensions::{init_v8, inject_extensions};
use utils::{blue, gray, green, red, white, yellow};

#[derive(Clone)]
struct AppState {
    routes: Arc<HashMap<String, RouteVal>>,
    dynamic_routes: Arc<Vec<DynamicRoute>>,
    project_root: PathBuf,
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
                    Some((it.next()?.to_string(), it.next().unwrap_or("").to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    // ---------------------------
    // HEADERS & BODY
    // ---------------------------
    let (parts, body) = req.into_parts();

    let headers = parts
        .headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect::<HashMap<String, String>>();

    let body_bytes = match to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response(),
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

    let mut action_path = actions_dir.join(format!("{}.jsbundle", action_name));
    if !action_path.exists() {
        let js_path = actions_dir.join(format!("{}.js", action_name));
        if js_path.exists() {
            action_path = js_path;
        }
    }

    let js_code =
        match fs::read_to_string(&action_path) {
            Ok(c) => c,
            Err(_) => return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": "Action bundle not found", "action": action_name}),
                ),
            )
                .into_response(),
        };

    // ---------------------------
    // EXECUTE IN V8
    // ---------------------------
    let env_json = std::env::vars()
        .map(|(k, v)| (k, Value::String(v)))
        .collect::<serde_json::Map<_, _>>();

    let injected = format!(
        r#"
        globalThis.process = {{ env: {} }};
        const __titan_req = {{
            body: {},
            method: "{}",
            path: "{}",
            headers: {},
            params: {},
            query: {}
        }};
        (function() {{
            {}
        }})(); // Run the bundle
        // Call the action
        if (typeof globalThis["{}"] === 'function') {{
            globalThis["{}"](__titan_req);
        }} else {{
            throw new Error("Action function '{}' not found in bundle");
        }}
        "#,
        Value::Object(env_json).to_string(),
        body_json.to_string(),
        method,
        path,
        serde_json::to_string(&headers).unwrap(),
        serde_json::to_string(&params).unwrap(),
        serde_json::to_string(&query).unwrap(),
        js_code,
        action_name,
        action_name,
        action_name
    );

    // Run V8 in a blocking task safely?
    // Axum handlers are async. V8 operations should be blocking.
    // We can use `task::spawn_blocking`.
    let root = state.project_root.clone();
    let action_name_for_v8 = action_name.clone();

    let result_json: Value = tokio::task::spawn_blocking(move || {
        let isolate = &mut v8::Isolate::new(v8::CreateParams::default());
        let handle_scope = &mut v8::HandleScope::new(isolate);
        let context = v8::Context::new(handle_scope, v8::ContextOptions::default());
        let scope = &mut v8::ContextScope::new(handle_scope, context);

        let global = context.global(scope);

        // Inject extensions (t.read, etc)
        inject_extensions(scope, global);

        // Set metadata globals
        let root_str = v8::String::new(scope, root.to_str().unwrap_or(".")).unwrap();
        let root_key = v8::String::new(scope, "__titan_root").unwrap();
        global.set(scope, root_key.into(), root_str.into());

        let action_str = v8::String::new(scope, &action_name_for_v8).unwrap();
        let action_key = v8::String::new(scope, "__titan_action").unwrap();
        global.set(scope, action_key.into(), action_str.into());

        let source = v8::String::new(scope, &injected).unwrap();

        let try_catch = &mut v8::TryCatch::new(scope);

        let script = match v8::Script::compile(try_catch, source, None) {
            Some(s) => s,
            None => {
                let err = try_catch.message().unwrap();
                let msg = err.get(try_catch).to_rust_string_lossy(try_catch);
                return serde_json::json!({ "error": msg, "phase": "compile" });
            }
        };

        let result = script.run(try_catch);

        match result {
            Some(val) => {
                // Convert v8 Value to Serde JSON
                // Minimal impl: stringify
                let json_obj = v8::json::stringify(try_catch, val).unwrap();
                let json_str = json_obj.to_rust_string_lossy(try_catch);
                serde_json::from_str(&json_str).unwrap_or(Value::Null)
            }
            None => {
                let err = try_catch.message().unwrap();
                let msg = err.get(try_catch).to_rust_string_lossy(try_catch);
                serde_json::json!({ "error": msg, "phase": "execution" })
            }
        }
    })
    .await
    .unwrap_or(serde_json::json!({"error": "V8 task failed"}));

    // ---------------------------
    // FINAL LOG
    // ---------------------------
    let elapsed = start.elapsed();

    // Check for errors in result
    if let Some(err) = result_json.get("error") {
        println!(
            "{} {} {} {}",
            blue("[Titan]"),
            red(&format!("{} {}", method, path)),
            red("→ error"),
            gray(&format!("in {:.2?}", elapsed))
        );
        println!("{}", red(err.as_str().unwrap_or("Unknown")));
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(result_json)).into_response();
    }

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
    init_v8(); // Init platform once

    // Load routes.json
    let raw = fs::read_to_string("./routes.json").unwrap_or_else(|_| "{}".to_string());
    let json: Value = serde_json::from_str(&raw).unwrap_or_default();

    let port = json["__config"]["port"].as_u64().unwrap_or(3000);
    let routes_json = json["routes"].clone();
    let map: HashMap<String, RouteVal> = serde_json::from_value(routes_json).unwrap_or_default();
    let dynamic_routes: Vec<DynamicRoute> =
        serde_json::from_value(json["__dynamic_routes"].clone()).unwrap_or_default();

    // Identify project root (where .ext or node_modules lives)
    let project_root = resolve_project_root();

    let state = AppState {
        routes: Arc::new(map),
        dynamic_routes: Arc::new(dynamic_routes),
        project_root: project_root.clone(),
    };

    // Load extensions
    extensions::load_project_extensions(project_root.clone());

    let app = Router::new()
        .route("/", any(root_route))
        .fallback(any(dynamic_route))
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

    println!("\n\x1b[38;5;208m████████╗██╗████████╗ █████╗ ███╗   ██╗");
    println!("╚══██╔══╝██║╚══██╔══╝██╔══██╗████╗  ██║");
    println!("   ██║   ██║   ██║   ███████║██╔██╗ ██║");
    println!("   ██║   ██║   ██║   ██╔══██║██║╚██╗██║");
    println!("   ██║   ██║   ██║   ██║  ██║██║ ╚████║");
    println!("   ╚═╝   ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝\x1b[0m\n");
    println!(
        "\x1b[38;5;39mTitan server running at:\x1b[0m http://localhost:{}",
        port
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
