use v8::{HandleScope, TryCatch};

pub fn format_v8_error(scope: &mut TryCatch<HandleScope>, action_name: &str) -> String {
    let message = match scope.message() {
        Some(m) => m,
        None => return format!("Unknown error in action '{}'", action_name),
    };

    // File info
    let resource_name = message
        .get_script_resource_name(scope)
        .map(|s| s.to_rust_string_lossy(scope))
        .unwrap_or_else(|| format!("app/actions/{}.ts", action_name));

    let line_number = message.get_line_number(scope).unwrap_or(0);
    let start_col = message.get_start_column();

    // The actual error message
    let exception = scope.exception().unwrap();
    let exception_string = exception.to_rust_string_lossy(scope);

    // Source line
    let source_line = message
        .get_source_line(scope)
        .map(|s| s.to_rust_string_lossy(scope))
        .unwrap_or_default();

    let mut out = String::new();
    out.push_str(&format!(
        "[JS] {}:{}:{} - {}\n",
        resource_name, line_number, start_col, exception_string
    ));

    if !source_line.is_empty() {
        out.push_str(&format!("[JS] {}    {}\n", line_number, source_line));

        let mut pointer = String::from("[JS] ");
        let padding = line_number.to_string().len() + 4;
        for _ in 0..padding {
            pointer.push(' ');
        }

        for _ in 0..start_col {
            pointer.push(' ');
        }
        pointer.push('^');
        out.push_str(&pointer);
    }

    out
}
