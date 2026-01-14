use v8::JsError;

// A helper to Format v8 Errors
pub fn format_js_error(err: JsError, action: &str) -> String {
    format!(
        "Action: {}\n{}",
        action,
        err.to_string()
    )
}
