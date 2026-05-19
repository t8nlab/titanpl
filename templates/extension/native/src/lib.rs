#![allow(dead_code, unused_imports)]

mod ext;

use std::collections::HashMap;
use serde_json::Value;
use std::sync::Once;

static INIT: Once = Once::new();

pub fn ensure_registered() {
    INIT.call_once(|| {
        ext::register("add_number", add);
    });
}

/**
 * 1. Define your function
 * It must accept HashMap<String, Value> and return Result<Value, String>
 */
fn add(input: HashMap<String, Value>) -> Result<Value, String> {
    // 2. Extract inputs using type helpers from ext
    // get_int, get_string, get_bool help handle JSON type conversions
    let n1 = ext::get_int(&input, "n1")?;
    let n2 = ext::get_int(&input, "n2")?;

    // 3. Perform your logic
    let sum = n1 + n2;

    // 4. Return the result (will be auto-serialized to JSON for JS)
    Ok(Value::from(sum))
}
