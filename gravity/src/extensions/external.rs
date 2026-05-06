//! External extension loading (JS, Wasm, Native).
//!
//! Follows the TitanPL Extension System specification.

use v8;
use std::path::{PathBuf, Path};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::{Mutex, Arc};
use walkdir::WalkDir;
use serde_json::Value;
use crate::utils::{blue, green, red, yellow, bold};
use super::{TitanRuntime, v8_str, throw};

pub static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);

pub struct Registry {
    pub extensions: HashMap<String, ExtensionDef>,
    pub allow_wasm: bool,
    pub allow_native: HashSet<String>,
}

#[derive(Clone)]
pub struct ExtensionDef {
    pub name: String,
    pub ext_type: String, // "js", "wasm", "native"
    pub entry_js: String,
    pub wasm_path: Option<PathBuf>,
    pub native_path: Option<PathBuf>,
}

#[derive(serde::Deserialize)]
struct TitanJson {
    name: String,
    #[serde(default = "default_type")]
    r#type: String,
    #[serde(alias = "main")]
    entry: String,
    #[serde(default)]
    wasm: serde_json::Value,
    #[serde(default)]
    native: serde_json::Value,
}

fn default_type() -> String { "js".to_string() }

#[derive(serde::Deserialize, Default)]
struct ExtensionsConfig {
    #[serde(default, rename = "allowWasm")]
    allow_wasm: bool,
    #[serde(default, rename = "allowNative")]
    allow_native: Vec<String>,
}

#[derive(serde::Deserialize, Default)]
struct TanfigJson {
    #[serde(default)]
    extensions: ExtensionsConfig,
}

pub fn load_project_extensions(mut root: PathBuf) {
    let mut extensions = HashMap::new();
    
    // Heuristic: if we are in 'dist', the actual project root is parent
    if root.ends_with("dist") {
        let parent = root.parent().unwrap().to_path_buf();
        if parent.join("tanfig.json").exists() {
            root = parent;
        }
    }

    // 1. Read tanfig.json for permissions
    let tanfig_path = root.join("tanfig.json");
    let tanfig: TanfigJson = if tanfig_path.exists() {
        let content = fs::read_to_string(tanfig_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        TanfigJson::default()
    };

    let allow_wasm = tanfig.extensions.allow_wasm;
    let allow_native: HashSet<String> = tanfig.extensions.allow_native.into_iter().collect();

    // 2. Scan node_modules and .ext for extensions
    let scan_dirs = [root.join("node_modules"), root.join(".ext")];
    
    for scan_path in scan_dirs {
        if !scan_path.exists() { continue; }
        for entry in WalkDir::new(&scan_path).follow_links(true).min_depth(1).max_depth(4) {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            if entry.file_type().is_file() && entry.file_name() == "titan.json" {
                let dir = entry.path().parent().unwrap();
                let config_content = fs::read_to_string(entry.path()).unwrap_or_default();
                let config: TitanJson = match serde_json::from_str(&config_content) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                // Heuristic detection of WASM/Native
                let has_wasm = !config.wasm.is_null();
                let has_native = !config.native.is_null();
                let is_wasm = config.r#type == "wasm" || has_wasm;
                let is_native = config.r#type == "native" || has_native;

                // Permission check
                if is_wasm && !allow_wasm {
                    println!("{} {} Extension '{}' contains WASM but allowWasm is false", blue("[Gravity]"), red("BLOCKED:"), config.name);
                    continue;
                }

                if is_native && !allow_native.contains(&config.name) {
                    println!("{} {} Extension '{}' contains native code but not in allowNative list", blue("[Gravity]"), red("HARD ERROR:"), config.name);
                    println!("{} {} Gravity requires explicit listing of ALL native extensions at startup.", blue("[Gravity]"), yellow("Policy:"));
                    std::process::exit(1);
                }

                let js_path = dir.join(&config.entry);
                let entry_js = fs::read_to_string(js_path).unwrap_or_default();

                let wasm_path = if has_wasm {
                    config.wasm.as_str().map(|p| dir.join(p))
                } else { None };
                
                let native_path = if has_native {
                    let mut path = None;
                    if let Some(native_map) = config.native.as_object() {
                        let platform = if cfg!(target_os = "windows") { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
                        path = native_map.get(platform).and_then(|v| v.as_str()).map(|p| dir.join(p));
                        
                        if path.is_none() {
                            // Fallback to "path" key (Core extension format)
                            path = native_map.get("path").and_then(|v| v.as_str()).map(|p| dir.join(p));
                        }
                    }
                    path
                } else { None };

                let final_type = if is_native {
                    "native"
                } else if is_wasm {
                    "wasm"
                } else {
                    "js"
                };

                extensions.insert(config.name.clone(), ExtensionDef {
                    name: config.name.clone(),
                    ext_type: final_type.to_string(),
                    entry_js,
                    wasm_path,
                    native_path,
                });

                println!("{} {} {} [{}]", blue("[Gravity]"), green("Loaded:"), config.name, final_type.to_uppercase());
            }
        }
    }

    *REGISTRY.lock().unwrap() = Some(Registry { extensions, allow_wasm, allow_native });
}

pub fn inject_external_extensions(scope: &mut v8::HandleScope, _global: v8::Local<v8::Object>, t_obj: v8::Local<v8::Object>) {
    let registry = if let Ok(guard) = REGISTRY.lock() {
        guard.as_ref().map(|r| r.extensions.clone()).unwrap_or_default()
    } else { return; };

    // Inject __native helper for t.__native.call/call_meta
    let native_helper = v8::Object::new(scope);
    
    let call_fn = v8::Function::new(scope, native_extension_call).unwrap();
    let call_key = v8_str(scope, "call");
    native_helper.set(scope, call_key.into(), call_fn.into());
    
    let call_meta_fn = v8::Function::new(scope, native_extension_call_meta).unwrap();
    let call_meta_key = v8_str(scope, "call_meta");
    native_helper.set(scope, call_meta_key.into(), call_meta_fn.into());
    
    let native_key = v8_str(scope, "__native");
    t_obj.set(scope, native_key.into(), native_helper.into());

    for (name, ext) in registry {
        if ext.ext_type == "native" {
            // PROXY: Synchronous by default, with .drift() for asynchronous offloading if desired.
            // This gives developers free will: no auto-drift, but drift() still works.
            let proxy_script = format!(
                "t['{}'] = new Proxy({{}}, {{ 
                    _cache: new Map(),
                    get: function(target, prop) {{ 
                        if (typeof prop !== 'string') return target[prop];
                        if (this._cache.has(prop)) return this._cache.get(prop);
                        const fn = (...args) => t.__native.call('{0}', prop, args); 
                        fn.drift = (...args) => t.__native.call_meta('{0}', prop, args); 
                        this._cache.set(prop, fn);
                        return fn; 
                    }} 
                }});",
                name
            );
            let ps_v8 = v8_str(scope, &proxy_script);
            let tc = &mut v8::TryCatch::new(scope);
            if let Some(script) = v8::Script::compile(tc, ps_v8, None) {
                script.run(tc);
            }
        }

        // Execute the extension's entry JS
        let wrapped_js = format!("(function(t) {{ {} }})(t)", ext.entry_js);
        let wrapped_js_str = v8_str(scope, &wrapped_js);
        let tc = &mut v8::TryCatch::new(scope);
        if let Some(script) = v8::Script::compile(tc, wrapped_js_str, None) {
             script.run(tc);
        }
    }
}

/// DEFAULT: Synchronous Native Call (No Replay/Suspension)
fn native_extension_call(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let ext_name = args.get(0).to_rust_string_lossy(scope);
    let fn_name = args.get(1).to_rust_string_lossy(scope);
    let fn_args_val = args.get(2);

    let mut params = Vec::new();
    if fn_args_val.is_array() {
        let arr = v8::Local::<v8::Array>::try_from(fn_args_val).unwrap();
        for i in 0..arr.length() {
            let val = arr.get_index(scope, i).unwrap();
            params.push(super::v8_to_json(scope, val));
        }
    }

    let result = crate::extensions::native_host_bridge::handle_native_call_sync(ext_name, fn_name, params);
    retval.set(super::json_to_v8(scope, &result));
}

/// METADATA: Returns an Op description for use with drift()
fn native_extension_call_meta(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let ext_name = args.get(0).to_rust_string_lossy(scope);
    let fn_name = args.get(1).to_rust_string_lossy(scope);
    let fn_args_val = args.get(2);

    let obj = v8::Object::new(scope);
    let async_key = v8_str(scope, "__titanAsync");
    let async_val = v8::Boolean::new(scope, true);
    obj.set(scope, async_key.into(), async_val.into());
    
    let type_key = v8_str(scope, "type");
    let type_val = v8_str(scope, "native_call");
    obj.set(scope, type_key.into(), type_val.into());
    
    let data_obj = v8::Object::new(scope);
    let ext_key = v8_str(scope, "extension");
    let ext_val = v8_str(scope, &ext_name);
    data_obj.set(scope, ext_key.into(), ext_val.into());

    let func_key = v8_str(scope, "function");
    let func_val = v8_str(scope, &fn_name);
    data_obj.set(scope, func_key.into(), func_val.into());

    let params_key = v8_str(scope, "params");
    data_obj.set(scope, params_key.into(), fn_args_val);
    
    let data_key = v8_str(scope, "data");
    obj.set(scope, data_key.into(), data_obj.into());
    retval.set(obj.into());
}
