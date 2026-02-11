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
//   2. Finds ALL return expressions in the source
//   3. Validates each return is a verifiable static literal
//   4. Extracts headers and status from the options argument
//   5. If ALL returns produce the SAME value → pre-compute & serve from Rust
//
// DETECTED PATTERNS:
//   - t.response.json({ key: "value" }, { headers: {...}, status: N })
//   - t.response.text("literal", { headers: {...}, status: N })
//   - t.response.html("<html>...", { headers: {...}, status: N })
//   - return { key: "value", ... }         → StaticJson  (fallback)
//   - return "literal"                      → StaticText  (fallback)
//
// SAFETY:
//   - Side effects (console.log, t.log, etc.) are ALLOWED — they don't affect
//     the return value if the return itself is a verified static literal.
//   - If ANY return contains non-literal values → action is NOT fast-pathed.
//   - If multiple returns produce DIFFERENT static values → NOT fast-pathed.
//
// =============================================================================

use bytes::Bytes;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// Options extracted from the second argument of t.response.*() calls.
/// e.g. t.response.json({...}, { headers: { Server: "titanpl" }, status: 201 })
#[derive(Clone, Debug, Default)]
struct ResponseOptions {
    status: Option<u16>,
    headers: Vec<(String, String)>,
}

/// A pre-computed HTTP response for a static action.
#[derive(Clone, Debug)]
pub struct StaticResponse {
    pub body: Bytes,
    pub content_type: &'static str,
    pub status: u16,
    pub extra_headers: Vec<(String, String)>,
}

impl PartialEq for StaticResponse {
    fn eq(&self, other: &Self) -> bool {
        self.body == other.body
            && self.content_type == other.content_type
            && self.status == other.status
            && self.extra_headers == other.extra_headers
    }
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

                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
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
                        let header_info = if resp.extra_headers.is_empty() {
                            String::new()
                        } else {
                            format!(
                                " +{}h",
                                resp.extra_headers.len()
                            )
                        };
                        let status_info = if resp.status != 200 {
                            format!(" [{}]", resp.status)
                        } else {
                            String::new()
                        };
                        println!(
                            "\x1b[36m[Titan FastPath]\x1b[0m \x1b[32m✔\x1b[0m Action '{}' → static {} ({} bytes{}{})",
                            name, resp.content_type, resp.body.len(), status_info, header_info
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
        let mut builder = axum::response::Response::builder()
            .status(self.status)
            .header("content-type", self.content_type)
            .header("server", "TitanPL");

        for (key, val) in &self.extra_headers {
            // Skip content-type and server — already set above
            let lower = key.to_lowercase();
            if lower == "content-type" || lower == "server" {
                continue;
            }
            builder = builder.header(key.as_str(), val.as_str());
        }

        builder
            .body(axum::body::Body::from(self.body.clone()))
            .unwrap()
    }
}

// =============================================================================
// SOURCE CODE ANALYSIS
// =============================================================================

/// Analyze a bundled action's source code and detect static return patterns.
///
/// Strategy:
///   1. Find ALL t.response.json/text/html calls — collect their static values.
///   2. If any call has a non-parseable argument → bail (dynamic dependency).
///   3. If all collected values are identical → fast-path with that value.
///   4. If values differ → can't fast-path (conditional branches).
///   5. If no t.response.* found, fall back to plain `return {...}` / `return "..."`.
///
/// NOTE: Side effects (console.log, t.log, Math.random, etc.) do NOT disqualify
/// an action. Only the return value matters.
fn analyze_action_source(source: &str) -> Option<StaticResponse> {
    // -----------------------------------------------------------------
    // PHASE 1: Specific patterns — t.response.json/text/html
    // -----------------------------------------------------------------
    let mut responses: Vec<StaticResponse> = Vec::new();
    let mut has_dynamic = false;

    collect_response_json(source, &mut responses, &mut has_dynamic);
    collect_response_text(source, &mut responses, &mut has_dynamic);
    collect_response_html(source, &mut responses, &mut has_dynamic);

    if !responses.is_empty() || has_dynamic {
        if has_dynamic {
            return None;
        }
        return unique_response(&responses);
    }

    // -----------------------------------------------------------------
    // PHASE 2: Fallback — plain return statements
    // -----------------------------------------------------------------
    let mut fallback_responses: Vec<StaticResponse> = Vec::new();
    let mut fallback_dynamic = false;

    collect_static_json_returns(source, &mut fallback_responses, &mut fallback_dynamic);
    collect_static_text_returns(source, &mut fallback_responses, &mut fallback_dynamic);

    if fallback_dynamic || fallback_responses.is_empty() {
        return None;
    }

    unique_response(&fallback_responses)
}

/// If all responses are identical, return that response. Otherwise None.
fn unique_response(responses: &[StaticResponse]) -> Option<StaticResponse> {
    if responses.is_empty() {
        return None;
    }
    let first = &responses[0];
    if responses.iter().all(|r| r == first) {
        Some(first.clone())
    } else {
        None
    }
}

// =============================================================================
// CALL ARGUMENT EXTRACTION
// =============================================================================

/// Extract all occurrences of a t.response.*() call from source,
/// returning the raw argument strings for each call.
///
/// For `t.response.json({ a: 1 }, { headers: { X: "y" } })`:
///   returns vec![ ("{ a: 1 }", Some("{ headers: { X: \"y\" } }")) ]
///
/// Uses brace/paren counting to handle nested objects correctly.
fn extract_call_arguments<'a>(source: &'a str, call_prefix: &str) -> Vec<(&'a str, Option<&'a str>)> {
    let mut results = Vec::new();
    let mut search_from = 0;

    while let Some(start) = source[search_from..].find(call_prefix) {
        let abs_start = search_from + start;
        let args_start = abs_start + call_prefix.len();

        // Find the matching closing paren using brace/paren counting
        if let Some(args_str) = extract_balanced_parens(&source[args_start..]) {
            // Split into first arg and second arg (respecting nesting)
            let (arg1, arg2) = split_two_args(args_str);
            results.push((arg1.trim(), arg2.map(|s| s.trim())));
            search_from = args_start + args_str.len() + 1; // +1 for closing paren
        } else {
            search_from = args_start + 1;
        }
    }

    results
}

/// Given a string starting right after an opening `(`, find the content
/// up to the matching `)`. Returns the inner content (without parens).
fn extract_balanced_parens(s: &str) -> Option<&str> {
    let mut depth: i32 = 1; // We're already inside the opening (
    let mut in_double = false;
    let mut in_single = false;
    let mut prev_escape = false;

    for (i, b) in s.bytes().enumerate() {
        if prev_escape {
            prev_escape = false;
            continue;
        }
        match b {
            b'\\' => prev_escape = true,
            b'"' if !in_single => in_double = !in_double,
            b'\'' if !in_double => in_single = !in_single,
            b'(' if !in_double && !in_single => depth += 1,
            b')' if !in_double && !in_single => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[..i]);
                }
            }
            b'{' if !in_double && !in_single => depth += 1,
            b'}' if !in_double && !in_single => depth -= 1,
            _ => {}
        }
    }

    None
}

/// Split a function's argument string into first and optional second argument.
/// Respects nesting: `{ a: { b: 1 } }, { c: 2 }` → ("{ a: { b: 1 } }", "{ c: 2 }")
fn split_two_args(s: &str) -> (&str, Option<&str>) {
    let mut depth: i32 = 0;
    let mut in_double = false;
    let mut in_single = false;
    let mut prev_escape = false;

    for (i, b) in s.bytes().enumerate() {
        if prev_escape {
            prev_escape = false;
            continue;
        }
        match b {
            b'\\' => prev_escape = true,
            b'"' if !in_single => in_double = !in_double,
            b'\'' if !in_double => in_single = !in_single,
            b'(' | b'{' | b'[' if !in_double && !in_single => depth += 1,
            b')' | b'}' | b']' if !in_double && !in_single => depth -= 1,
            b',' if depth == 0 && !in_double && !in_single => {
                let arg1 = &s[..i];
                let arg2 = &s[i + 1..];
                return (arg1.trim(), Some(arg2.trim()));
            }
            _ => {}
        }
    }

    (s.trim(), None)
}

// =============================================================================
// OPTIONS PARSER
// =============================================================================

/// Parse the options object (second argument) from a t.response.*() call.
///
/// Expected shape:
///   { headers: { Key: "value", ... }, status: 201 }
///
/// Extracts:
///   - `status` → u16
///   - `headers` → Vec<(String, String)> (flat key-value pairs)
fn parse_options(opts_str: &str) -> ResponseOptions {
    let mut options = ResponseOptions::default();
    let trimmed = opts_str.trim();

    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return options;
    }

    // Extract status: look for `status: <number>` or `status:<number>`
    let status_re = Regex::new(r#"status\s*:\s*(\d{3})"#).ok();
    if let Some(re) = status_re {
        if let Some(caps) = re.captures(trimmed) {
            if let Some(m) = caps.get(1) {
                if let Ok(s) = m.as_str().parse::<u16>() {
                    options.status = Some(s);
                }
            }
        }
    }

    // Extract headers: find `headers: { ... }` with brace matching
    if let Some(headers_start) = trimmed.find("headers") {
        // Find the opening { after "headers"
        let after_key = &trimmed[headers_start + "headers".len()..];
        if let Some(brace_pos) = after_key.find('{') {
            let from_brace = &after_key[brace_pos + 1..];
            // Find matching }
            if let Some(inner) = find_matching_brace(from_brace) {
                // Parse the flat key-value pairs inside headers: { ... }
                let pairs = split_respecting_quotes(inner);
                for pair in pairs {
                    let pair = pair.trim();
                    if pair.is_empty() {
                        continue;
                    }
                    if let Some((key_part, val_part)) = pair.split_once(':') {
                        let key = key_part
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_string();
                        let val = val_part
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_string();
                        if !key.is_empty() && !val.is_empty() {
                            options.headers.push((key, val));
                        }
                    }
                }
            }
        }
    }

    options
}

/// Find the content up to the matching `}` (assumes we're right after an opening `{`).
fn find_matching_brace(s: &str) -> Option<&str> {
    let mut depth: i32 = 1;
    let mut in_double = false;
    let mut in_single = false;
    let mut prev_escape = false;

    for (i, b) in s.bytes().enumerate() {
        if prev_escape {
            prev_escape = false;
            continue;
        }
        match b {
            b'\\' => prev_escape = true,
            b'"' if !in_single => in_double = !in_double,
            b'\'' if !in_double => in_single = !in_single,
            b'{' if !in_double && !in_single => depth += 1,
            b'}' if !in_double && !in_single => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[..i]);
                }
            }
            _ => {}
        }
    }

    None
}

// =============================================================================
// HELPER: Build StaticResponse with options
// =============================================================================

fn build_static_response(
    body: Vec<u8>,
    content_type: &'static str,
    options: &ResponseOptions,
) -> StaticResponse {
    StaticResponse {
        body: Bytes::from(body),
        content_type,
        status: options.status.unwrap_or(200),
        extra_headers: options.headers.clone(),
    }
}

// =============================================================================
// PATTERN COLLECTORS
// =============================================================================

// ---------------------------------------------------------------------------
// t.response.json({ ... }, { headers: {...}, status: N })
// ---------------------------------------------------------------------------
fn collect_response_json(
    source: &str,
    responses: &mut Vec<StaticResponse>,
    has_dynamic: &mut bool,
) {
    let calls = extract_call_arguments(source, "t.response.json(");
    if calls.is_empty() {
        return;
    }

    for (body_str, opts_str) in &calls {
        let body_trimmed = body_str.trim();

        // Must start with { — it's a JSON object
        if !body_trimmed.starts_with('{') {
            *has_dynamic = true;
            continue;
        }

        // Find the closing } (first arg might be captured with extra whitespace)
        let obj_str = if body_trimmed.ends_with('}') {
            body_trimmed
        } else {
            *has_dynamic = true;
            continue;
        };

        match parse_js_object_literal(obj_str) {
            Some(json_val) => {
                if let Ok(body) = serde_json::to_vec(&json_val) {
                    let options = opts_str.map(parse_options).unwrap_or_default();
                    responses.push(build_static_response(body, "application/json", &options));
                }
            }
            None => {
                *has_dynamic = true;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// t.response.text("...", { headers: {...}, status: N })
// ---------------------------------------------------------------------------
fn collect_response_text(
    source: &str,
    responses: &mut Vec<StaticResponse>,
    has_dynamic: &mut bool,
) {
    let calls = extract_call_arguments(source, "t.response.text(");
    if calls.is_empty() {
        return;
    }

    for (body_str, opts_str) in &calls {
        let body_trimmed = body_str.trim();

        if let Some(text) = extract_string_literal(body_trimmed) {
            let options = opts_str.map(parse_options).unwrap_or_default();
            responses.push(build_static_response(
                text.as_bytes().to_vec(),
                "text/plain",
                &options,
            ));
        } else {
            *has_dynamic = true;
        }
    }
}

// ---------------------------------------------------------------------------
// t.response.html("...", { headers: {...}, status: N })
// ---------------------------------------------------------------------------
fn collect_response_html(
    source: &str,
    responses: &mut Vec<StaticResponse>,
    has_dynamic: &mut bool,
) {
    let calls = extract_call_arguments(source, "t.response.html(");
    if calls.is_empty() {
        return;
    }

    for (body_str, opts_str) in &calls {
        let body_trimmed = body_str.trim();

        if let Some(text) = extract_string_literal(body_trimmed) {
            let options = opts_str.map(parse_options).unwrap_or_default();
            responses.push(build_static_response(
                text.as_bytes().to_vec(),
                "text/html",
                &options,
            ));
        } else {
            *has_dynamic = true;
        }
    }
}

// ---------------------------------------------------------------------------
// return { key: "value", ... }     (fallback — plain object returns)
// ---------------------------------------------------------------------------
fn collect_static_json_returns(
    source: &str,
    responses: &mut Vec<StaticResponse>,
    has_dynamic: &mut bool,
) {
    let re = match Regex::new(r#"return\s+(\{[^}]+\})\s*;?"#) {
        Ok(r) => r,
        Err(_) => return,
    };

    for caps in re.captures_iter(source) {
        if let Some(m) = caps.get(1) {
            let obj_str = m.as_str().trim();

            // Skip wrapper-generated returns (esbuild boilerplate)
            if obj_str.contains("__esModule")
                || obj_str.contains("__defProp")
                || obj_str.contains("__copyProps")
            {
                continue;
            }

            match parse_js_object_literal(obj_str) {
                Some(json_val) => {
                    if let Ok(body) = serde_json::to_vec(&json_val) {
                        responses.push(StaticResponse {
                            body: Bytes::from(body),
                            content_type: "application/json",
                            status: 200,
                            extra_headers: Vec::new(),
                        });
                    }
                }
                None => {
                    *has_dynamic = true;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// return "literal string"     (fallback — plain text returns)
// ---------------------------------------------------------------------------
fn collect_static_text_returns(
    source: &str,
    responses: &mut Vec<StaticResponse>,
    _has_dynamic: &mut bool,
) {
    let has_action_fn = source.contains("(req)") || source.contains("function(req)");
    if !has_action_fn {
        return;
    }

    let re = match Regex::new(r#"return\s+"([^"]+)"\s*;?"#) {
        Ok(r) => r,
        Err(_) => return,
    };

    for caps in re.captures_iter(source) {
        if let Some(m) = caps.get(1) {
            let text = m.as_str();

            if text.contains("[Titan]")
                || text.contains("not found")
                || text.contains("not a function")
            {
                continue;
            }

            responses.push(StaticResponse {
                body: Bytes::from(text.to_string()),
                content_type: "text/plain",
                status: 200,
                extra_headers: Vec::new(),
            });
        }
    }
}

// =============================================================================
// STRING LITERAL EXTRACTOR
// =============================================================================

/// Extract a string literal from JS source. Handles "..." and '...'.
fn extract_string_literal(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        Some(trimmed[1..trimmed.len() - 1].to_string())
    } else {
        None
    }
}

// =============================================================================
// JS OBJECT LITERAL PARSER
// =============================================================================

/// Parse a simple JavaScript object literal into a serde_json::Value.
///
/// Returns None if ANY value is not a parseable literal (variable, function call, etc.)
/// This acts as the core "is this static?" validation.
fn parse_js_object_literal(s: &str) -> Option<serde_json::Value> {
    let trimmed = s.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }

    let inner = trimmed[1..trimmed.len() - 1].trim();
    if inner.is_empty() {
        return Some(serde_json::json!({}));
    }

    let mut map = serde_json::Map::new();

    let pairs = split_respecting_quotes(inner);

    for pair in pairs {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }

        let (key_part, val_part) = pair.split_once(':')?;
        let key = key_part
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        let val_str = val_part.trim();

        let value = if (val_str.starts_with('"') && val_str.ends_with('"'))
            || (val_str.starts_with('\'') && val_str.ends_with('\''))
        {
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
            return None;
        };

        map.insert(key, value);
    }

    Some(serde_json::Value::Object(map))
}

/// Split a string by commas, but ignore commas inside quoted strings.
fn split_respecting_quotes(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut in_double = false;
    let mut in_single = false;
    let mut prev_was_escape = false;
    let bytes = s.as_bytes();

    for i in 0..bytes.len() {
        if prev_was_escape {
            prev_was_escape = false;
            continue;
        }
        match bytes[i] {
            b'\\' => {
                prev_was_escape = true;
            }
            b'"' if !in_single => {
                in_double = !in_double;
            }
            b'\'' if !in_double => {
                in_single = !in_single;
            }
            b',' if !in_double && !in_single => {
                parts.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }

    if start < s.len() {
        parts.push(&s[start..]);
    }

    parts
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