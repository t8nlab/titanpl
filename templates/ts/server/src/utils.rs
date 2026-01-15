pub fn blue(s: &str) -> String {
    format!("\x1b[38;5;39m{}\x1b[0m", s)
}
pub fn white(s: &str) -> String {
    format!("\x1b[39m{}\x1b[0m", s)
}
pub fn yellow(s: &str) -> String {
    format!("\x1b[33m{}\x1b[0m", s)
}
pub fn green(s: &str) -> String {
    format!("\x1b[32m{}\x1b[0m", s)
}
pub fn gray(s: &str) -> String {
    format!("\x1b[90m{}\x1b[0m", s)
}
pub fn red(s: &str) -> String {
    format!("\x1b[31m{}\x1b[0m", s)
}

pub fn parse_expires_in(value: &str) -> Option<u64> {
    let (num, unit) = value.split_at(value.len() - 1);
    let n: u64 = num.parse().ok()?;

    match unit {
        "s" => Some(n),
        "m" => Some(n * 60),
        "h" => Some(n * 60 * 60),
        "d" => Some(n * 60 * 60 * 24),
        _ => None,
    }
}


