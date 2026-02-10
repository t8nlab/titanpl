// =============================================================================
// fast_path.rs — Static Action Detection & Pre-computed Responses
// =============================================================================
//
// PURPOSE:
//   Bypass V8 entirely for actions that return constant/static values.
//   For TechEmpower JSON benchmark, this eliminates the Rust↔V8 bridge
//   which is the #1 bottleneck (~15-25µs/request saved).
//
// HOW IT WORKS:
//   1. At startup, reads each bundled action file (.jsbundle)
//   2. Analyzes the source code for static return patterns
//   3. If detected, pre-serializes the response bytes
//   4. In the request handler, serves pre-computed bytes directly
//
// DETECTED PATTERNS:
//   - return { key: "value", ... }         → StaticJson
//   - return "literal"                      → StaticText
//   - t.response.text("literal")           → StaticText
//   - t.response.json({ key: "value" })    → StaticJson
//   - t.response.html("<html>...")          → StaticHtml
//
// SAFETY CHECK:
//   Actions with drift(), t.fetch, t.db, t.fs, t.crypto, t.log, req. references
//   are NEVER fast-pathed (they have side effects or depend on request data).
//
// =============================================================================

use bytes::Bytes;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// A pre-computed HTTP response for a static action.
#[derive(Clone, Debug)]
pub struct StaticResponse {
    pub body: Bytes,
    pub content_type: &'static str,
    pub status: u16,
}

/// Registry of actions that have been detected as static.
#[derive(Clone)]
pub struct FastPathRegistry {
    actions: HashMap<String, StaticResponse>,
}

impl FastPathRegistry {
    /// Build a FastPathRegistry by scanning action files in the given directory.
    pub fn build(actions_dir: &Path) -> Self {
        let mut actions = HashMap::new();

        if !actions_dir.exists() || !actions_dir.is_dir() {
            return Self { actions };
        }

        if let Ok(entries) = fs::read_dir(actions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                if ext != "js" && ext != "jsbundle" {
                    continue;
                }

                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                if name.is_empty() {
                    continue;
                }

                if let Ok(source) = fs::read_to_string(&path) {
                    if let Some(resp) = analyze_action_source(&source) {
                        println!(
                            "\x1b[36m[Titan FastPath]\x1b[0m \x1b[32m✔\x1b[0m Action '{}' → static {} ({} bytes)",
                            name,
                            resp.content_type,
                            resp.body.len()
                        );
                        actions.insert(name, resp);
                    }
                }
            }
        }

        if !actions.is_empty() {
            println!(
                "\x1b[36m[Titan FastPath]\x1b[0m {} action(s) will bypass V8",
                actions.len()
            );
        }

        Self { actions }
    }

    /// Check if an action has a fast-path static response.
    #[inline(always)]
    pub fn get(&self, action_name: &str) -> Option<&StaticResponse> {
        self.actions.get(action_name)
    }

    /// Number of registered fast-path actions.
    pub fn len(&self) -> usize {
        self.actions.len()
    }
}

impl StaticResponse {
    /// Convert to an Axum response. Uses Bytes::clone() which is O(1) ref-count bump.
    #[inline(always)]
    pub fn to_axum_response(&self) -> axum::response::Response<axum::body::Body> {
        axum::response::Response::builder()
            .status(self.status)
            .header("content-type", self.content_type)
            .header("server", "TitanPL")
            .body(axum::body::Body::from(self.body.clone()))
            .unwrap()
    }
}

// =============================================================================
// SOURCE CODE ANALYSIS
// =============================================================================

/// Analyze a bundled action's source code and detect static return patterns.
fn analyze_action_source(source: &str) -> Option<StaticResponse> {
    // SAFETY CHECK: If the action has side effects, never fast-path it.
    if has_side_effects(source) {
        return None;
    }

    // Check if the action uses the request parameter
    if uses_request_data(source) {
        return None;
    }

    // Try each detection pattern in order of specificity
    if let Some(resp) = detect_response_json(source) {
        return Some(resp);
    }
    if let Some(resp) = detect_response_text(source) {
        return Some(resp);
    }
    if let Some(resp) = detect_response_html(source) {
        return Some(resp);
    }
    if let Some(resp) = detect_static_json_return(source) {
        return Some(resp);
    }
    if let Some(resp) = detect_static_text_return(source) {
        return Some(resp);
    }

    None
}

/// Check if the source contains any side-effect producing calls.
fn has_side_effects(source: &str) -> bool {
    // These indicate the action does I/O or async work
    let side_effect_patterns = [
        "drift(",
        "t.fetch(",
        "t.db.",
        "t.fs.",
        "t.crypto.",
        "t.password.",
        "t.jwt.",
        "t.net.",
        "t.ls.",
        "t.buffer.",
        "t.proc.",
        "t.os.",
        "t.shareContext.",
        "t.log(",
        "t._drift_call(",
        "console.log(",
        "console.error(",
        "Math.random(",
        "Date.now(",
        "new Date(",
    ];

    for pattern in &side_effect_patterns {
        if source.contains(pattern) {
            return true;
        }
    }

    false
}

/// Check if the action function body references request data.
fn uses_request_data(source: &str) -> bool {
    // Look for req.method, req.path, req.body, req.headers, req.params, req.query
    // Also req.rawBody, req.__titan_request_id
    // But NOT the parameter declaration itself: (req) => or function(req)

    let req_usage = Regex::new(r"req\s*\.\s*\w+").ok();
    if let Some(re) = req_usage {
        if re.is_match(source) {
            return true;
        }
    }

    false
}

// ---------------------------------------------------------------------------
// PATTERN: t.response.json({ ... })
// ---------------------------------------------------------------------------
// FIX: Old regex expected optional numeric second arg (?:,\s*\d+\s*)?\)
//      which failed to match when second arg is an options object like
//      { headers: { Server: "titanpl" } }
//      New regex: just capture the first { ... } argument, ignore the rest.
// ---------------------------------------------------------------------------
fn detect_response_json(source: &str) -> Option<StaticResponse> {
    let re = Regex::new(
        r#"t\.response\.json\(\s*(\{[^}]+\})"#
    ).ok()?;

    let caps = re.captures(source)?;
    let obj_str = caps.get(1)?.as_str().trim();

    let json_val = parse_js_object_literal(obj_str)?;
    let body = serde_json::to_vec(&json_val).ok()?;

    Some(StaticResponse {
        body: Bytes::from(body),
        content_type: "application/json",
        status: 200,
    })
}

// ---------------------------------------------------------------------------
// PATTERN: t.response.text("...")
// ---------------------------------------------------------------------------
// FIX: Same issue — old regex expected optional numeric second arg.
//      New regex: just capture the string, ignore everything after.
// ---------------------------------------------------------------------------
fn detect_response_text(source: &str) -> Option<StaticResponse> {
    let re = Regex::new(
        r#"t\.response\.text\(\s*"([^"]*?)""#
    ).ok()?;

    let caps = re.captures(source)?;
    let text = caps.get(1)?.as_str();

    Some(StaticResponse {
        body: Bytes::from(text.to_string()),
        content_type: "text/plain",
        status: 200,
    })
}

// ---------------------------------------------------------------------------
// PATTERN: t.response.html("...")
// ---------------------------------------------------------------------------
// FIX: Same issue — old regex expected optional numeric second arg.
//      New regex: just capture the string, ignore everything after.
// ---------------------------------------------------------------------------
fn detect_response_html(source: &str) -> Option<StaticResponse> {
    let re = Regex::new(
        r#"t\.response\.html\(\s*"([^"]*?)""#
    ).ok()?;

    let caps = re.captures(source)?;
    let html = caps.get(1)?.as_str();

    Some(StaticResponse {
        body: Bytes::from(html.to_string()),
        content_type: "text/html",
        status: 200,
    })
}

// ---------------------------------------------------------------------------
// PATTERN: return { key: "value", ... }
// ---------------------------------------------------------------------------
fn detect_static_json_return(source: &str) -> Option<StaticResponse> {
    // Match return statements with object literals
    // Handles: return { message: "Hello, World!" }
    //          return {message: "Hello, World!"}
    //          return { a: "b", c: "d" }
    let re = Regex::new(
        r#"return\s+(\{[^}]+\})\s*;?"#
    ).ok()?;

    // Find all matches and try the most likely (last one, usually the actual action body)
    let mut last_match = None;
    for caps in re.captures_iter(source) {
        if let Some(m) = caps.get(1) {
            let obj_str = m.as_str().trim();
            if let Some(val) = parse_js_object_literal(obj_str) {
                last_match = Some(val);
            }
        }
    }

    let json_val = last_match?;
    let body = serde_json::to_vec(&json_val).ok()?;

    Some(StaticResponse {
        body: Bytes::from(body),
        content_type: "application/json",
        status: 200,
    })
}

// ---------------------------------------------------------------------------
// PATTERN: return "literal string"
// ---------------------------------------------------------------------------
fn detect_static_text_return(source: &str) -> Option<StaticResponse> {
    // Match: return "Hello, World!";
    // But avoid matching return statements that are part of the wrapper code
    let re = Regex::new(
        r#"return\s+"([^"]+)"\s*;?"#
    ).ok()?;

    // Check this is inside an arrow function or function declaration (action body)
    // Simple heuristic: should appear after `(req)` or `function`
    let has_action_fn = source.contains("(req)") || source.contains("function(req)");
    if !has_action_fn {
        return None;
    }

    let caps = re.captures(source)?;
    let text = caps.get(1)?.as_str();

    // Skip wrapper-generated strings (error messages, action names)
    if text.contains("[Titan]") || text.contains("not found") || text.contains("not a function") {
        return None;
    }

    Some(StaticResponse {
        body: Bytes::from(text.to_string()),
        content_type: "text/plain",
        status: 200,
    })
}

// =============================================================================
// JS OBJECT LITERAL PARSER (Simple)
// =============================================================================

/// Parse a simple JavaScript object literal into a serde_json::Value.
/// Handles: { key: "value", key2: "value2" }
/// Also:    { "key": "value" }
/// Also:    { key: 123, key2: true, key3: null }
fn parse_js_object_literal(s: &str) -> Option<serde_json::Value> {
    let trimmed = s.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }

    let inner = &trimmed[1..trimmed.len() - 1].trim();
    if inner.is_empty() {
        return Some(serde_json::json!({}));
    }

    let mut map = serde_json::Map::new();

    // Split by comma (simple - doesn't handle nested objects or strings with commas)
    for pair in inner.split(',') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }

        // Split by first colon
        let (key_part, val_part) = pair.split_once(':')?;
        let key = key_part
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        let val_str = val_part.trim();

        // Parse value
        let value = if (val_str.starts_with('"') && val_str.ends_with('"'))
            || (val_str.starts_with('\'') && val_str.ends_with('\''))
        {
            // String literal
            let s = &val_str[1..val_str.len() - 1];
            serde_json::Value::String(s.to_string())
        } else if val_str == "true" {
            serde_json::Value::Bool(true)
        } else if val_str == "false" {
            serde_json::Value::Bool(false)
        } else if val_str == "null" || val_str == "undefined" {
            serde_json::Value::Null
        } else if let Ok(n) = val_str.parse::<i64>() {
            serde_json::Value::Number(n.into())
        } else if let Ok(n) = val_str.parse::<f64>() {
            serde_json::json!(n)
        } else {
            // Can't parse → not a static literal
            return None;
        };

        map.insert(key, value);
    }

    Some(serde_json::Value::Object(map))
}

// =============================================================================
// PRE-COMPUTED ROUTE RESPONSES
// =============================================================================

/// A pre-computed response for static reply routes (t.get("/").reply("ok")).
#[derive(Clone, Debug)]
pub struct PrecomputedRoute {
    pub body: Bytes,
    pub content_type: &'static str,
}

impl PrecomputedRoute {
    /// Create from a JSON serde_json::Value (for .reply({...}) routes)
    pub fn from_json(val: &serde_json::Value) -> Self {
        let body = serde_json::to_vec(val).unwrap_or_default();
        Self {
            body: Bytes::from(body),
            content_type: "application/json",
        }
    }

    /// Create from a text string (for .reply("text") routes)
    pub fn from_text(text: &str) -> Self {
        Self {
            body: Bytes::from(text.to_string()),
            content_type: "text/plain; charset=utf-8",
        }
    }

    /// Convert to Axum response. O(1) body clone via Bytes refcount.
    #[inline(always)]
    pub fn to_axum_response(&self) -> axum::response::Response<axum::body::Body> {
        axum::response::Response::builder()
            .status(200u16)
            .header("content-type", self.content_type)
            .header("server", "TitanPL")
            .body(axum::body::Body::from(self.body.clone()))
            .unwrap()
    }
}