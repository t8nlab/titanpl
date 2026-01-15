#![allow(unused)]
use bcrypt::{DEFAULT_COST, hash, verify};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use reqwest::{
    blocking::Client,
    Method,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Once;
use std::time::{SystemTime, UNIX_EPOCH};
use v8;

use crate::utils::{blue, gray, green, parse_expires_in};
use libloading::Library;
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use walkdir::WalkDir;


// ----------------------------------------------------------------------------
// RUST ACTION API
// ----------------------------------------------------------------------------

pub struct T {
    pub jwt: Jwt,
    pub password: Password,
}

#[allow(non_upper_case_globals)]
pub static t: T = T {
    jwt: Jwt,
    password: Password,
};

pub struct Jwt;
impl Jwt {
    pub fn sign(&self, payload: Value, secret: &str, options: Option<Value>) -> anyhow::Result<String> {
        let mut final_payload = match payload {
            Value::Object(map) => map,
            _ => serde_json::Map::new(), // Should probably error or handle string payload like JS
        };

        if let Some(opts) = options {
             if let Some(exp_val) = opts.get("expiresIn") {
                // Handle both number (seconds) and string ("1h")
                let seconds = if let Some(n) = exp_val.as_u64() {
                    Some(n)
                } else if let Some(s) = exp_val.as_str() {
                    parse_expires_in(s)
                } else {
                    None
                };

                if let Some(sec) = seconds {
                     let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                    final_payload.insert("exp".to_string(), Value::Number(serde_json::Number::from(now + sec)));
                }
             }
        }

        let token = encode(
            &Header::default(),
            &Value::Object(final_payload),
            &EncodingKey::from_secret(secret.as_bytes()),
        )?;
        Ok(token)
    }

    pub fn verify(&self, token: &str, secret: &str) -> anyhow::Result<Value> {
        let mut validation = Validation::default();
        validation.validate_exp = true; 

        let data = decode::<Value>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )?;
        Ok(data.claims)
    }
}

pub struct Password;
impl Password {
    pub fn hash(&self, password: &str) -> anyhow::Result<String> {
        let h = hash(password, DEFAULT_COST)?;
        Ok(h)
    }

    pub fn verify(&self, password: &str, hash_str: &str) -> bool {
        verify(password, hash_str).unwrap_or(false)
    }
}

impl T {
    pub fn log(&self, msg: impl std::fmt::Display) {
        println!(
            "{} {}",
            blue("[Titan]"),
            gray(&format!("\x1b[90mlog(rust)\x1b[0m\x1b[97m: {}\x1b[0m", msg))
        );
    }

    pub fn read(&self, path: &str) -> anyhow::Result<String> {
        let root = std::env::current_dir()?;
        let target = root.join(path);
        let target = target.canonicalize()?;
        Ok(fs::read_to_string(target)?)
    }

    pub async fn fetch(&self, url: &str, options: Option<FetchOptions>) -> anyhow::Result<FetchResponse> {
        let client = reqwest::Client::new();
        let opts = options.unwrap_or_default();
        
        let mut req = client.request(opts.method.parse().unwrap_or(Method::GET), url);

        if let Some(headers) = opts.headers {
            let mut map = HeaderMap::new();
            for (k, v) in headers {
                if let (Ok(name), Ok(val)) = (
                    HeaderName::from_bytes(k.as_bytes()),
                    HeaderValue::from_str(&v),
                ) {
                    map.insert(name, val);
                }
            }
            req = req.headers(map);
        }

        if let Some(body) = opts.body {
            req = req.body(body);
        }

        let res = req.send().await?;
        let status = res.status().as_u16();
        let text = res.text().await?;

        Ok(FetchResponse {
            status,
            body: text,
            ok: status >= 200 && status < 300
        })
    }
}

#[derive(Default)]
pub struct FetchOptions {
    pub method: String,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub body: Option<String>,
}

pub struct FetchResponse {
    pub status: u16,
    pub body: String,
    pub ok: bool,
}

// ----------------------------------------------------------------------------
// GLOBAL REGISTRY
// ----------------------------------------------------------------------------

static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
#[allow(dead_code)]
struct Registry {
    _libs: Vec<Library>,
    modules: Vec<ModuleDef>,
    natives: Vec<NativeFnEntry>, // Flattened list of all native functions
}

#[derive(Clone)]
struct ModuleDef {
    name: String,
    js: String,
    native_indices: HashMap<String, usize>, // Function Name -> Index in REGISTRY.natives
}

struct NativeFnEntry {
    ptr: usize,
    sig: Signature,
}

#[derive(Clone, Copy)]
enum Signature {
    F64TwoArgsRetF64,
    Unknown,
}

#[derive(serde::Deserialize)]
struct TitanConfig {
    name: String,
    main: String,
    native: Option<TitanNativeConfig>,
}
#[derive(serde::Deserialize)]
struct TitanNativeConfig {
    path: String,
    functions: HashMap<String, TitanNativeFunc>,
}
#[derive(serde::Deserialize)]
struct TitanNativeFunc {
    symbol: String,
    #[serde(default)]
    parameters: Vec<String>,
    #[serde(default)]
    result: String,
}

pub fn load_project_extensions(root: PathBuf) {
    let mut modules = Vec::new();
    let mut libs = Vec::new();
    let mut all_natives = Vec::new();

    // =====================================================
    // 1. Resolve all extension search directories
    // =====================================================

    let mut search_dirs = Vec::new();

    let ext_dir = root.join(".ext"); // Production
    let nm_root = root.join("node_modules"); // Dev
    let nm_parent = root.parent().map(|p| p.join("node_modules")); // Monorepo

    // 1) Production
    if ext_dir.exists() {
        search_dirs.push(ext_dir);
    }

    // 2) Dev: project node_modules
    if nm_root.exists() {
        search_dirs.push(nm_root.clone());
    }

    // 3) Dev monorepo: parent/node_modules
    if let Some(nmp) = &nm_parent {
        if nmp.exists() {
            search_dirs.push(nmp.clone());
        }
    }

    // 4) Never return empty — add root/node_modules even if missing
    if search_dirs.is_empty() {
        search_dirs.push(nm_root);
    }

    // Normalize and dedupe
    search_dirs.sort();
    search_dirs.dedup();

    // println!("{} Scanning extension directories:", blue("[Titan]"));
    for d in &search_dirs {
        
        //  let label = if d.to_string_lossy().contains(".ext") {
        //      crate::utils::green("(Production)")
        //  } else {
        //       crate::utils::yellow("(Development)")
        //  };
        //  println!("   • {} {}", d.display(), label);
        
    }

    // =====================================================
    // 2. Walk and locate titan.json inside search paths
    // =====================================================
    for dir in &search_dirs {
        if !dir.exists() {
            println!("   {} Skipping non-existent directory: {}", crate::utils::yellow("⚠"), dir.display());
            continue;
        }

        for entry in WalkDir::new(&dir)
            .min_depth(1)
            .max_depth(5) // Increased depth
            .follow_links(true)
        {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            // Only accept titan.json files
            if entry.file_type().is_file() && entry.file_name() == "titan.json" {
                let path = entry.path();
                // Load config file
                let config_content = match fs::read_to_string(path) {
                   Ok(c) => c,
                   Err(e) => {
                       println!("{} Failed to read {}: {}", crate::utils::red("[Titan]"), path.display(), e);
                       continue;
                   }
               };
   
               let config: TitanConfig = match serde_json::from_str(&config_content) {
                   Ok(c) => c,
                   Err(e) => {
                        println!("{} Failed to parse {}: {}", crate::utils::red("[Titan]"), path.display(), e);
                        continue;
                   }
               };
   
               let pkg_dir = path.parent().unwrap();
               let mut mod_natives_map = HashMap::new();
   
               // =====================================================
               // 3. Load native extension (optional)
               // =====================================================
               if let Some(native_conf) = config.native {
                   let lib_path = pkg_dir.join(&native_conf.path);
   
                   unsafe {
                       match Library::new(&lib_path) {
                           Ok(lib) => {
                               for (fn_name, fn_conf) in native_conf.functions {
                                   let sig = if fn_conf.parameters == ["f64", "f64"]
                                       && fn_conf.result == "f64"
                                   {
                                       Signature::F64TwoArgsRetF64
                                   } else {
                                       Signature::Unknown
                                   };
   
                                   if let Ok(symbol) = lib.get::<*const ()>(fn_conf.symbol.as_bytes())
                                   {
                                       let idx = all_natives.len();
                                       all_natives.push(NativeFnEntry {
                                           ptr: *symbol as usize,
                                           sig,
                                       });
                                       mod_natives_map.insert(fn_name, idx);
                                   }
                               }
                               libs.push(lib);
                           }
                           Err(e) => println!(
                               "{} Failed to load native library {} ({})",
                               blue("[Titan]"),
                               lib_path.display(),
                                e
                           ),
                       }
                   }
               }
   
               // =====================================================
               // 4. Load JS module file
               // =====================================================
               let js_path = pkg_dir.join(&config.main);
               let js_content = match fs::read_to_string(&js_path) {
                    Ok(c) => c,
                    Err(e) => {
                         println!("{} Failed to read JS main {} for extension {}: {}", 
                            crate::utils::red("[Titan]"), 
                            js_path.display(), 
                            config.name, 
                            e
                        );
                        continue;
                    }
                };
   
               modules.push(ModuleDef {
                   name: config.name.clone(),
                   js: js_content,
                   native_indices: mod_natives_map,
               });
   
                let source_label = if dir.to_string_lossy().contains(".ext") {
                     "Production"
                } else {
                     "Development"
                };

                println!(
                    "{} {} {} ({})",
                    blue("[Titan]"),
                    green("Extension loaded:"),
                    config.name,
                    source_label
                );
            }
        }
    }

    // =====================================================
    // 5. Store registry globally
    // =====================================================
    if modules.is_empty() {
         // println!("{} {}", blue("[Titan]"), crate::utils::yellow("No extensions loaded."));
    }

    *REGISTRY.lock().unwrap() = Some(Registry {
        _libs: libs,
        modules,
        natives: all_natives,
    });
}

static V8_INIT: Once = Once::new();

pub fn init_v8() {
    V8_INIT.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

fn v8_str<'s>(scope: &mut v8::HandleScope<'s>, s: &str) -> v8::Local<'s, v8::String> {
    v8::String::new(scope, s).unwrap()
}

fn v8_to_string(scope: &mut v8::HandleScope, value: v8::Local<v8::Value>) -> String {
    value.to_string(scope).unwrap().to_rust_string_lossy(scope)
}

fn throw(scope: &mut v8::HandleScope, msg: &str) {
    let message = v8_str(scope, msg);
    let exception = v8::Exception::error(scope, message);
    scope.throw_exception(exception);
}

// ----------------------------------------------------------------------------
// NATIVE CALLBACKS
// ----------------------------------------------------------------------------

fn native_read(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let path_val = args.get(0);
    // 1. Read argument
    if !path_val.is_string() {
        throw(scope, "t.read(path): path is required");
        return;
    }
    let path_str = v8_to_string(scope, path_val);

    // 2. Check if absolute
    if std::path::Path::new(&path_str).is_absolute() {
        throw(scope, "t.read expects a relative path like 'db/file.sql'");
        return;
    }

    let context = scope.get_current_context();
    let global = context.global(scope);
    let root_key = v8_str(scope, "__titan_root");
    let root_val = global.get(scope, root_key.into()).unwrap();

    let root_str = if root_val.is_string() {
        v8_to_string(scope, root_val)
    } else {
        throw(scope, "Internal Error: __titan_root not set");
        return;
    };

    let root_path = PathBuf::from(root_str);
    let root_path = root_path.canonicalize().unwrap_or(root_path);
    let joined = root_path.join(&path_str);

    // 3. Canonicalize (resolves ../)
    let target = match joined.canonicalize() {
        Ok(target) => target,
        Err(_) => {
            throw(scope, &format!("t.read: file not found: {}", path_str));
            return;
        }
    };

    // 4. Enforce root boundary
    if !target.starts_with(&root_path) {
        throw(scope, "t.read: path escapes allowed root");
        return;
    }

    // 5. Read file
    match std::fs::read_to_string(&target) {
        Ok(content) => {
            retval.set(v8_str(scope, &content).into());
        }
        Err(e) => {
            throw(scope, &format!("t.read failed: {}", e));
        }
    }
}

fn native_log(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut _retval: v8::ReturnValue,
) {
    let context = scope.get_current_context();
    let global = context.global(scope);
    let action_key = v8_str(scope, "__titan_action");
    let action_val = global.get(scope, action_key.into()).unwrap();
    let action_name = v8_to_string(scope, action_val);

    let mut parts = Vec::new();
    for i in 0..args.length() {
        let val = args.get(i);
        let mut appended = false;

        // Try to JSON stringify objects so they are readable in logs
        if val.is_object() && !val.is_function() {
            if let Some(json) = v8::json::stringify(scope, val) {
                parts.push(json.to_rust_string_lossy(scope));
                appended = true;
            }
        }

        if !appended {
            parts.push(v8_to_string(scope, val));
        }
    }

    println!(
        "{} {}",
        blue("[Titan]"),
        gray(&format!(
            "\x1b[90mlog({})\x1b[0m\x1b[97m: {}\x1b[0m",
            action_name,
            parts.join(" ")
        ))
    );
}

fn native_fetch(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let url = v8_to_string(scope, args.get(0));

    // Check for options (method, headers, body)
    let mut method = "GET".to_string();
    let mut body_str = None;
    let mut headers_vec = Vec::new();

    let opts_val = args.get(1);
    if opts_val.is_object() {
        let opts_obj = opts_val.to_object(scope).unwrap();

        // method
        let m_key = v8_str(scope, "method");
        if let Some(m_val) = opts_obj.get(scope, m_key.into()) {
            if m_val.is_string() {
                method = v8_to_string(scope, m_val);
            }
        }

        // body
        let b_key = v8_str(scope, "body");
        if let Some(b_val) = opts_obj.get(scope, b_key.into()) {
            if b_val.is_string() {
                body_str = Some(v8_to_string(scope, b_val));
            } else if b_val.is_object() {
                let json_obj = v8::json::stringify(scope, b_val).unwrap();
                body_str = Some(json_obj.to_rust_string_lossy(scope));
            }
        }

        // headers
        let h_key = v8_str(scope, "headers");
        if let Some(h_val) = opts_obj.get(scope, h_key.into()) {
            if h_val.is_object() {
                let h_obj = h_val.to_object(scope).unwrap();
                if let Some(keys) = h_obj.get_own_property_names(scope, Default::default()) {
                    for i in 0..keys.length() {
                        let key = keys.get_index(scope, i).unwrap();
                        let val = h_obj.get(scope, key).unwrap();
                        headers_vec.push((v8_to_string(scope, key), v8_to_string(scope, val)));
                    }
                }
            }
        }
    }

    let client = Client::builder()
        .use_rustls_tls()
        .tcp_nodelay(true)
        .build()
        .unwrap_or(Client::new());

    let mut req = client.request(method.parse().unwrap_or(reqwest::Method::GET), &url);

    for (k, v) in headers_vec {
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(&v),
        ) {
            let mut map = HeaderMap::new();
            map.insert(name, val);
            req = req.headers(map);
        }
    }

    if let Some(b) = body_str {
        req = req.body(b);
    }

    let res = req.send();

    let obj = v8::Object::new(scope);
    match res {
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().unwrap_or_default();

            let status_key = v8_str(scope, "status");
            let status_val = v8::Number::new(scope, status as f64);
            obj.set(scope, status_key.into(), status_val.into());

            let body_key = v8_str(scope, "body");
            let body_val = v8_str(scope, &text);
            obj.set(scope, body_key.into(), body_val.into());

            let ok_key = v8_str(scope, "ok");
            let ok_val = v8::Boolean::new(scope, true);
            obj.set(scope, ok_key.into(), ok_val.into());
        }
        Err(e) => {
            let ok_key = v8_str(scope, "ok");
            let ok_val = v8::Boolean::new(scope, false);
            obj.set(scope, ok_key.into(), ok_val.into());

            let err_key = v8_str(scope, "error");
            let err_val = v8_str(scope, &e.to_string());
            obj.set(scope, err_key.into(), err_val.into());
        }
    }
    retval.set(obj.into());
}

fn native_jwt_sign(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    // payload, secret, options
    let payload_val = args.get(0);
    // Parse payload to serde_json::Map
    let json_str = v8::json::stringify(scope, payload_val)
        .unwrap()
        .to_rust_string_lossy(scope);
    let mut payload: serde_json::Map<String, Value> =
        serde_json::from_str(&json_str).unwrap_or_default();

    let secret = v8_to_string(scope, args.get(1));

    let opts_val = args.get(2);
    if opts_val.is_object() {
        let opts_obj = opts_val.to_object(scope).unwrap();
        let exp_key = v8_str(scope, "expiresIn");

        if let Some(val) = opts_obj.get(scope, exp_key.into()) {
            let seconds = if val.is_number() {
                Some(val.to_number(scope).unwrap().value() as u64)
            } else if val.is_string() {
                parse_expires_in(&v8_to_string(scope, val))
            } else {
                None
            };

            if let Some(sec) = seconds {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                payload.insert(
                    "exp".to_string(),
                    Value::Number(serde_json::Number::from(now + sec)),
                );
            }
        }
    }

    let token = encode(
        &Header::default(),
        &Value::Object(payload),
        &EncodingKey::from_secret(secret.as_bytes()),
    );

    match token {
        Ok(tok) => retval.set(v8_str(scope, &tok).into()),
        Err(e) => throw(scope, &e.to_string()),
    }
}

fn native_jwt_verify(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let token = v8_to_string(scope, args.get(0));
    let secret = v8_to_string(scope, args.get(1));

    let mut validation = Validation::default();
    validation.validate_exp = true;

    let data = decode::<Value>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    );

    match data {
        Ok(d) => {
            // Convert claim back to V8 object via JSON
            let json_str = serde_json::to_string(&d.claims).unwrap();
            let v8_json_str = v8_str(scope, &json_str);
            if let Some(val) = v8::json::parse(scope, v8_json_str) {
                retval.set(val);
            }
        }
        Err(e) => throw(scope, &format!("Invalid or expired JWT: {}", e)),
    }
}

fn native_password_hash(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let pw = v8_to_string(scope, args.get(0));
    match hash(pw, DEFAULT_COST) {
        Ok(h) => retval.set(v8_str(scope, &h).into()),
        Err(e) => throw(scope, &e.to_string()),
    }
}

fn native_password_verify(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let pw = v8_to_string(scope, args.get(0));
    let hash_str = v8_to_string(scope, args.get(1));

    let ok = verify(pw, &hash_str).unwrap_or(false);
    retval.set(v8::Boolean::new(scope, ok).into());
}

fn native_define_action(
    _scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    retval.set(args.get(0));
}

// ----------------------------------------------------------------------------
// NATIVE CALLBACKS (EXTENSIONS)
// ----------------------------------------------------------------------------

// generic wrappers could go here if needed

fn native_invoke_extension(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let fn_idx = args.get(0).to_integer(scope).unwrap().value() as usize;

    // Get pointer from registry
    let mut ptr = 0;
    let mut sig = Signature::Unknown;

    if let Ok(guard) = REGISTRY.lock() {
        if let Some(registry) = &*guard {
            if let Some(entry) = registry.natives.get(fn_idx) {
                ptr = entry.ptr;
                sig = entry.sig;
            }
        }
    }

    if ptr == 0 {
        throw(scope, "Native function not found");
        return;
    }

    match sig {
        Signature::F64TwoArgsRetF64 => {
            let a = args
                .get(1)
                .to_number(scope)
                .unwrap_or(v8::Number::new(scope, 0.0))
                .value();
            let b = args
                .get(2)
                .to_number(scope)
                .unwrap_or(v8::Number::new(scope, 0.0))
                .value();

            unsafe {
                let func: extern "C" fn(f64, f64) -> f64 = std::mem::transmute(ptr);
                let res = func(a, b);
                retval.set(v8::Number::new(scope, res).into());
            }
        }
        _ => throw(scope, "Unsupported signature"),
    }
}

// ----------------------------------------------------------------------------
// INJECTOR
// ----------------------------------------------------------------------------

pub fn inject_extensions(scope: &mut v8::HandleScope, global: v8::Local<v8::Object>) {
    // Ensure globalThis reference
    let gt_key = v8_str(scope, "globalThis");
    global.set(scope, gt_key.into(), global.into());

    let t_obj = v8::Object::new(scope);
    let t_key = v8_str(scope, "t");
    // Use create_data_property to guarantee definition
    global
        .create_data_property(scope, t_key.into(), t_obj.into())
        .unwrap();

    // defineAction (identity function for clean typing)
    let def_fn = v8::Function::new(scope, native_define_action).unwrap();
    let def_key = v8_str(scope, "defineAction");
    global.set(scope, def_key.into(), def_fn.into());

    // t.read
    let read_fn = v8::Function::new(scope, native_read).unwrap();
    let read_key = v8_str(scope, "read");
    t_obj.set(scope, read_key.into(), read_fn.into());

    // t.log
    let log_fn = v8::Function::new(scope, native_log).unwrap();
    let log_key = v8_str(scope, "log");
    t_obj.set(scope, log_key.into(), log_fn.into());

    // t.fetch
    let fetch_fn = v8::Function::new(scope, native_fetch).unwrap();
    let fetch_key = v8_str(scope, "fetch");
    t_obj.set(scope, fetch_key.into(), fetch_fn.into());

    // t.jwt
    let jwt_obj = v8::Object::new(scope);
    let sign_fn = v8::Function::new(scope, native_jwt_sign).unwrap();
    let verify_fn = v8::Function::new(scope, native_jwt_verify).unwrap();

    let sign_key = v8_str(scope, "sign");
    jwt_obj.set(scope, sign_key.into(), sign_fn.into());
    let verify_key = v8_str(scope, "verify");
    jwt_obj.set(scope, verify_key.into(), verify_fn.into());

    let jwt_key = v8_str(scope, "jwt");
    t_obj.set(scope, jwt_key.into(), jwt_obj.into());

    // t.password
    let pw_obj = v8::Object::new(scope);
    let hash_fn = v8::Function::new(scope, native_password_hash).unwrap();
    let pw_verify_fn = v8::Function::new(scope, native_password_verify).unwrap();

    let hash_key = v8_str(scope, "hash");
    pw_obj.set(scope, hash_key.into(), hash_fn.into());
    let pw_verify_key = v8_str(scope, "verify");
    pw_obj.set(scope, pw_verify_key.into(), pw_verify_fn.into());

    let pw_key = v8_str(scope, "password");
    t_obj.set(scope, pw_key.into(), pw_obj.into());

    // Inject __titan_invoke_native
    let invoke_fn = v8::Function::new(scope, native_invoke_extension).unwrap();
    let invoke_key = v8_str(scope, "__titan_invoke_native");
    global.set(scope, invoke_key.into(), invoke_fn.into());

    // Inject Loaded Extensions
    let modules = if let Ok(guard) = REGISTRY.lock() {
        if let Some(registry) = &*guard {
            registry.modules.clone()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    for module in modules {
        // 1. Prepare Native Wrappers
        let natives_obj = v8::Object::new(scope);
        for (fn_name, &idx) in &module.native_indices {
            let code = format!(
                "(function(a, b) {{ return __titan_invoke_native({}, a, b); }})",
                idx
            );
            let source = v8_str(scope, &code);
            // Compile wrappers
            if let Some(script) = v8::Script::compile(scope, source, None) {
                if let Some(val) = script.run(scope) {
                    let key = v8_str(scope, fn_name);
                    natives_obj.set(scope, key.into(), val);
                }
            }
        }

        // 2. Prepare JS Wrapper (CommonJS shim)
        // We pass 't' and 'native' (the object we just made) to the module.
        let wrapper_src = format!(
            r#"(function(t, native) {{
                var module = {{ exports: {{}} }};
                var exports = module.exports;
                {}
                return module.exports;
            }})"#,
            module.js
        );

        let source = v8_str(scope, &wrapper_src);
        let tc = &mut v8::TryCatch::new(scope);

        // 3. Compile and Run
        if let Some(script) = v8::Script::compile(tc, source, None) {
            if let Some(factory_val) = script.run(tc) {
                if let Ok(factory) = v8::Local::<v8::Function>::try_from(factory_val) {
                    let recv = v8::undefined(&mut *tc).into();
                    // Pass t_obj and natives_obj
                    let args = [t_obj.into(), natives_obj.into()];

                    if let Some(exports_val) = factory.call(&mut *tc, recv, &args) {
                        // 4. Assign exports to t.<extName>
                        let mod_key = v8_str(&mut *tc, &module.name);
                        t_obj.set(&mut *tc, mod_key.into(), exports_val);

                        // println!(
                        //     "{} {} {}",
                        //     crate::utils::blue("[Titan]"),
                        //     crate::utils::green("Injected extension:"),
                        //     module.name
                        // );
                    } else {
                        // Execution error
                        if let Some(msg) = tc.message() {
                            let text = msg.get(&mut *tc).to_rust_string_lossy(&mut *tc);
                            println!(
                                "{} {} {} -> {}",
                                crate::utils::blue("[Titan]"),
                                crate::utils::red("Error running extension"),
                                module.name,
                                text
                            );
                        }
                    }
                }
            } else {
                 // Runtime error during script run
                 if let Some(msg) = tc.message() {
                    let text = msg.get(&mut *tc).to_rust_string_lossy(&mut *tc);
                    println!(
                        "{} {} {} -> {}",
                        crate::utils::blue("[Titan]"),
                        crate::utils::red("Error evaluating extension wrapper"),
                        module.name,
                        text
                    );
                }
            }
        } else {
            // Compile error
            if let Some(msg) = tc.message() {
                let text = msg.get(&mut *tc).to_rust_string_lossy(&mut *tc);
                println!(
                    "{} {} {} -> {}",
                    crate::utils::blue("[Titan]"),
                    crate::utils::red("Syntax Error in extension"),
                    module.name,
                    text
                );
            }
        }
    }

    // t.db (Stub for now)
    let db_obj = v8::Object::new(scope);
    let db_key = v8_str(scope, "db");
    t_obj.set(scope, db_key.into(), db_obj.into());

    let t_key = v8_str(scope, "t");
    global.set(scope, t_key.into(), t_obj.into());
}
