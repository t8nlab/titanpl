use axum::{response::{IntoResponse, Json}, http::Request, body::Body};
use serde_json::json;

pub async fn run(_req: Request<Body>) -> impl IntoResponse {
    // let _token = t.jwt.sign(json!({"id": 1}), "secret", Some(json!({"expiresIn": "1h"}))).unwrap_or_default();
    // let decoded = t.jwt.verify(&_token, "secret").unwrap_or_default();

    Json(json!({
        "message": "Hello from Rust Action! 🦀",
        "status": "blazing fast test",
        // "token": _token,
        // "decoded": decoded
    }))
}
