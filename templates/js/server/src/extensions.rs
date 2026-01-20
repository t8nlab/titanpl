#![allow(unused)]
use v8;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use std::sync::Once;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use serde_json::Value;
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Validation};
use bcrypt::{hash, verify, DEFAULT_COST};

use crate::utils::{blue, gray, green, parse_expires_in};
use libloading::{Library};
use walkdir::WalkDir;
use std::sync::Mutex;
use std::collections::HashMap;
use std::fs;

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

#[derive(Clone, Debug, PartialEq)]
pub enum ParamType {
    String,
    F64,
    Bool,
    Json,
    Buffer,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ReturnType {
    String,
    F64,
    Bool,
    Json,
    Buffer,
    Void,
}

#[derive(Clone, Debug)]
pub struct Signature {
    pub params: Vec<ParamType>,
    pub ret: ReturnType,
}

struct NativeFnEntry {
    symbol_ptr: usize,
    sig: Signature,
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

fn parse_type(s: &str) -> ParamType {
    match s {
        "string" => ParamType::String,
        "f64" => ParamType::F64,
        "bool" => ParamType::Bool,
        "json" => ParamType::Json,
        "buffer" => ParamType::Buffer,
        _ => ParamType::Json,
    }
}

fn parse_return(s: &str) -> ReturnType {
    match s {
        "string" => ReturnType::String,
        "f64" => ReturnType::F64,
        "bool" => ReturnType::Bool,
        "json" => ReturnType::Json,
        "buffer" => ReturnType::Buffer,
        "void" => ReturnType::Void,
        _ => ReturnType::Void,
    }
}

pub fn load_project_extensions(root: PathBuf) {
    let mut modules = Vec::new();
    let mut libs = Vec::new();
    let mut all_natives = Vec::new();

    let mut node_modules = root.join("node_modules");
    if !node_modules.exists() {
        if let Some(parent) = root.parent() {
            let parent_modules = parent.join("node_modules");
            if parent_modules.exists() {
                node_modules = parent_modules;
            }
        }
    }
    
    if node_modules.exists() {
        for entry in WalkDir::new(&node_modules).follow_links(true).min_depth(1).max_depth(4) {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            if entry.file_type().is_file() && entry.file_name() == "titan.json" {
                let dir = entry.path().parent().unwrap();
                let config_content = match fs::read_to_string(entry.path()) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let config: TitanConfig = match serde_json::from_str(&config_content) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let mut mod_natives_map = HashMap::new();
                
                if let Some(native_conf) = config.native {
                     let lib_path = dir.join(&native_conf.path);
                     unsafe {
                         match Library::new(&lib_path) {
                             Ok(lib) => {
                                 for (fn_name, fn_conf) in native_conf.functions {
                                     let params = fn_conf
                                        .parameters
                                        .iter()
                                        .map(|p| parse_type(&p.to_lowercase()))
                                        .collect::<Vec<_>>();

                                    let ret = parse_return(&fn_conf.result.to_lowercase());

                                    let sig = Signature { params, ret };
                                     
                                     if let Ok(symbol) = lib.get::<*const ()>(fn_conf.symbol.as_bytes()) {
                                          let idx = all_natives.len();
                                          all_natives.push(NativeFnEntry {
                                              symbol_ptr: *symbol as usize,
                                              sig
                                          });
                                          mod_natives_map.insert(fn_name, idx);
                                     }
                                 }
                                 libs.push(lib);
                             },
                             Err(e) => println!("Failed to load extension library {}: {}", lib_path.display(), e),
                         }
                     }
                }

                let js_path = dir.join(&config.main);
                let js_content = fs::read_to_string(js_path).unwrap_or_default();

                modules.push(ModuleDef {
                    name: config.name.clone(),
                    js: js_content,
                    native_indices: mod_natives_map,
                });
                
                println!("{} {} {}", blue("[Titan]"), green("Extension loaded:"), config.name);
            }
        }
    }

    *REGISTRY.lock().unwrap() = Some(Registry { _libs: libs, modules, natives: all_natives });
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

fn native_read(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
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
        Ok(t) => t,
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
        },
        Err(e) => {
            throw(scope, &format!("t.read failed: {}", e));
        }
    }
}

fn native_log(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut _retval: v8::ReturnValue) {
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
        gray(&format!("\x1b[90mlog({})\x1b[0m\x1b[97m: {}\x1b[0m", action_name, parts.join(" ")))
    );
}

fn native_fetch(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
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
                        headers_vec.push((
                            v8_to_string(scope, key),
                            v8_to_string(scope, val),
                        ));
                    }
                }
            }
        }
    }

    let client = Client::builder().use_rustls_tls().tcp_nodelay(true).build().unwrap_or(Client::new());
    
    let mut req = client.request(method.parse().unwrap_or(reqwest::Method::GET), &url);
    
    for (k, v) in headers_vec {
        if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v)) {
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
        }, 
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

fn native_jwt_sign(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    // payload, secret, options
    let payload_val = args.get(0);
    // Parse payload to serde_json::Map
    let json_str = v8::json::stringify(scope, payload_val).unwrap().to_rust_string_lossy(scope);
    let mut payload: serde_json::Map<String, Value> = serde_json::from_str(&json_str).unwrap_or_default();

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
                let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                payload.insert("exp".to_string(), Value::Number(serde_json::Number::from(now + sec)));
             }
        }
    }

    let token = encode(
        &Header::default(),
        &Value::Object(payload),
        &EncodingKey::from_secret(secret.as_bytes()),
    );

    match token {
        Ok(t) => retval.set(v8_str(scope, &t).into()),
        Err(e) => throw(scope, &e.to_string()),
    }
}

fn native_jwt_verify(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
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
        },
        Err(e) => throw(scope, &format!("Invalid or expired JWT: {}", e)),
    }
}

fn native_password_hash(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let pw = v8_to_string(scope, args.get(0));
    match hash(pw, DEFAULT_COST) {
        Ok(h) => retval.set(v8_str(scope, &h).into()),
        Err(e) => throw(scope, &e.to_string()),
    }
}

fn native_password_verify(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let pw = v8_to_string(scope, args.get(0));
    let hash_str = v8_to_string(scope, args.get(1));
    
    let ok = verify(pw, &hash_str).unwrap_or(false);
    retval.set(v8::Boolean::new(scope, ok).into());
}

fn native_define_action(_scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    retval.set(args.get(0));
}

// ----------------------------------------------------------------------------
// NATIVE CALLBACKS (EXTENSIONS)
// ----------------------------------------------------------------------------

fn arg_from_v8(scope: &mut v8::HandleScope, val: v8::Local<v8::Value>, ty: &ParamType) -> serde_json::Value {
    match ty {
        ParamType::String => serde_json::Value::String(val.to_rust_string_lossy(scope)),
        ParamType::F64 => serde_json::json!(val.to_number(scope).map(|n| n.value()).unwrap_or(0.0)),
        ParamType::Bool => serde_json::json!(val.boolean_value(scope)),
        ParamType::Json => {
            if let Some(str_val) = v8::json::stringify(scope, val) {
                let s = str_val.to_rust_string_lossy(scope);
                serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        },
        ParamType::Buffer => {
            if let Ok(u8arr) = v8::Local::<v8::Uint8Array>::try_from(val) {
                let buf = u8arr.buffer(scope).unwrap();
                let store = v8::ArrayBuffer::get_backing_store(&buf);
                let offset = usize::from(u8arr.byte_offset());
                let length = usize::from(u8arr.byte_length());
                // Safety: underlying buffer is valid in v8 scope
                let slice = &store[offset..offset+length];
                let vec_u8: Vec<u64> = slice.iter().map(|b| b.get() as u64).collect();
                serde_json::Value::Array(vec_u8.into_iter().map(serde_json::Value::from).collect())
            } else {
                serde_json::Value::Array(vec![])
            }
        }
    }
}

fn js_from_value<'a>(
    scope: &mut v8::HandleScope<'a>,
    ret_type: &ReturnType,
    val: serde_json::Value,
) -> v8::Local<'a, v8::Value> {
    match ret_type {
        ReturnType::String => {
            let s = match val.as_str() {
                Some(x) => x,
                None => "",
            };
            v8::String::new(scope, s).unwrap().into()
        },
        ReturnType::F64 => v8::Number::new(scope, val.as_f64().unwrap_or(0.0)).into(),
        ReturnType::Bool => v8::Boolean::new(scope, val.as_bool().unwrap_or(false)).into(),
        ReturnType::Json => {
            let s = val.to_string();
            let v8_s = v8::String::new(scope, &s).unwrap();
            v8::json::parse(scope, v8_s).unwrap_or_else(|| v8::null(scope).into())
        },
        ReturnType::Buffer => {
            if let Some(arr) = val.as_array() {
                let bytes = arr
                    .iter()
                    .filter_map(|v| v.as_u64().map(|n| n as u8))
                    .collect::<Vec<u8>>();

                let ab = v8::ArrayBuffer::new(scope, bytes.len());
                // Copy logic would ideally use copy_contents if available or create from store.
                // Fallback to empty for strict safety if complex copy is missing
                v8::undefined(scope).into() 
            } else {
                 let ab = v8::ArrayBuffer::new(scope, 0);
                 v8::Uint8Array::new(scope, ab, 0, 0).unwrap().into()
            }
        }
        ReturnType::Void => v8::undefined(scope).into(),
    }
}

macro_rules! dispatch_ret {
    ($ptr:expr, $ret:expr, ($($arg_ty:ty),*), ($($arg:expr),*)) => {
        match $ret {
            ReturnType::String => { 
                let f: extern "C" fn($($arg_ty),*) -> *mut std::os::raw::c_char; 
                f = std::mem::transmute($ptr); 
                let ptr = f($($arg),*);
                if ptr.is_null() {
                    serde_json::Value::String(String::new())
                } else {
                    let s = unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned() };
                    // We leak the pointer here because we don't have a shared allocator/free function. 
                    // This prevents the double-free/heap corruption crash.
                    serde_json::Value::String(s)
                }
            },
            ReturnType::F64 => { let f: extern "C" fn($($arg_ty),*) -> f64; f = std::mem::transmute($ptr); serde_json::json!(f($($arg),*)) },
            ReturnType::Bool => { let f: extern "C" fn($($arg_ty),*) -> bool; f = std::mem::transmute($ptr); serde_json::json!(f($($arg),*)) },
            ReturnType::Json => { 
                let f: extern "C" fn($($arg_ty),*) -> *mut std::os::raw::c_char; 
                f = std::mem::transmute($ptr); 
                let ptr = f($($arg),*);
                if ptr.is_null() {
                    serde_json::Value::Null
                } else {
                    let s = unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned() };
                    serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)
                }
             },
            ReturnType::Buffer => { let f: extern "C" fn($($arg_ty),*) -> Vec<u8>; f = std::mem::transmute($ptr); 
                let v = f($($arg),*); 
                serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect()) 
            },
            ReturnType::Void => { let f: extern "C" fn($($arg_ty),*); f = std::mem::transmute($ptr); f($($arg),*); serde_json::Value::Null },
        }
    }
}

fn native_invoke_extension(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let fn_idx = args.get(0).to_integer(scope).unwrap().value() as usize;
    let js_args_val = args.get(1);

    let (ptr, sig) = if let Ok(guard) = REGISTRY.lock() {
        if let Some(registry) = &*guard {
            if let Some(entry) = registry.natives.get(fn_idx) {
                (entry.symbol_ptr, entry.sig.clone())
            } else { return; }
        } else { return; }
    } else { return; };
    
    if ptr == 0 { throw(scope, "Native function not found"); return; }

    let js_args = if js_args_val.is_array() {
        v8::Local::<v8::Array>::try_from(js_args_val).unwrap()
    } else {
        v8::Array::new(scope, 0)
    };
    
    let argc = sig.params.len();
    
    unsafe {
         // Dispatch based on Argument Count
         // This implements the ABI Engine dispatcher.
         // currently supports: 0 args, 1 arg (all types), 2 args (String/String).
         
         let mut vals = Vec::new();
         for (i, param) in sig.params.iter().enumerate() {
             let val = js_args.get_index(scope, i as u32).unwrap_or_else(|| v8::undefined(scope).into());
             vals.push(arg_from_v8(scope, val, param));
         }

         let res_val: serde_json::Value = match argc {
             0 => {
                 dispatch_ret!(ptr, sig.ret, (), ())
             },
             1 => {
                 let v0 = vals.remove(0);
                 match sig.params[0] {
                     ParamType::String => { 
                         let s = v0.as_str().unwrap_or("").to_string(); 
                         let c = std::ffi::CString::new(s).unwrap();
                         dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char), (c.as_ptr())) 
                     },
                     ParamType::F64 => { let a0 = v0.as_f64().unwrap_or(0.0); dispatch_ret!(ptr, sig.ret, (f64), (a0)) },
                     ParamType::Bool => { let a0 = v0.as_bool().unwrap_or(false); dispatch_ret!(ptr, sig.ret, (bool), (a0)) },
                     ParamType::Json => { 
                         let s = v0.to_string(); 
                         let c = std::ffi::CString::new(s).unwrap();
                         dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char), (c.as_ptr())) 
                     },
                     ParamType::Buffer => { 
                         // Extract vec u8
                         let a0: Vec<u8> = if let Some(arr) = v0.as_array() {
                             arr.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect()
                         } else { vec![] };
                         dispatch_ret!(ptr, sig.ret, (Vec<u8>), (a0)) 
                     },
                 }
             },
             2 => {
                 let v0 = vals.remove(0);
                 let v1 = vals.remove(0);
                 match (sig.params[0].clone(), sig.params[1].clone()) { // Clone to satisfy borrow checker if needed
                    (ParamType::String, ParamType::String) => {
                        let s0 = v0.as_str().unwrap_or("").to_string();
                        let c0 = std::ffi::CString::new(s0).unwrap();
                        let s1 = v1.as_str().unwrap_or("").to_string();
                        let c1 = std::ffi::CString::new(s1).unwrap();
                        dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char, *const std::os::raw::c_char), (c0.as_ptr(), c1.as_ptr()))
                    },
                    (ParamType::String, ParamType::F64) => {
                        let s0 = v0.as_str().unwrap_or("").to_string();
                        let c0 = std::ffi::CString::new(s0).unwrap();
                        let a1 = v1.as_f64().unwrap_or(0.0);
                        dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char, f64), (c0.as_ptr(), a1))
                    },
                    // Add more combinations as needed. 
                     _ => { println!("Unsupported 2-arg signature"); serde_json::Value::Null }
                 }
             },
             _ => {
                 println!("Arg count {} not supported in this version", argc);
                 serde_json::Value::Null
             }
         };
         
         retval.set(js_from_value(scope, &sig.ret, res_val));
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
    global.create_data_property(scope, t_key.into(), t_obj.into()).unwrap();

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
         let mod_obj = v8::Object::new(scope);
         
         // Generate JS wrappers
         for (fn_name, &idx) in &module.native_indices {
              let code = format!("(function(...args) {{ return __titan_invoke_native({}, args); }})", idx);
              let source = v8_str(scope, &code);
              if let Some(script) = v8::Script::compile(scope, source, None) {
                  if let Some(val) = script.run(scope) {
                       let key = v8_str(scope, fn_name);
                       mod_obj.set(scope, key.into(), val);
                  }
              }
         }
         
         // Inject t.<module_name>
         let mod_key = v8_str(scope, &module.name);
         t_obj.set(scope, mod_key.into(), mod_obj.into());

         // Set context for logging
         let action_key = v8_str(scope, "__titan_action");
         let action_val = v8_str(scope, &module.name);
         global.set(scope, action_key.into(), action_val.into());
         
         // Execute JS
         // Wrap in IIFE passing 't' to ensure visibility
         let wrapped_js = format!("(function(t) {{ {} }})", module.js);
         let source = v8_str(scope, &wrapped_js);
         let tc = &mut v8::TryCatch::new(scope);
         
         if let Some(script) = v8::Script::compile(tc, source, None) {
             if let Some(func_val) = script.run(tc) {
                 // func_val is the function. Call it with [t_obj]
                 if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                     let receiver = v8::undefined(&mut *tc).into();
                     let args = [t_obj.into()];
                     // Pass tc (which is a scope) 
                     if func.call(&mut *tc, receiver, &args).is_none() {
                         println!("{} {}", crate::utils::blue("[Titan]"), crate::utils::red("Extension Execution Failed"));
                         if let Some(msg) = tc.message() {
                             let text = msg.get(&mut *tc).to_rust_string_lossy(&mut *tc);
                             println!("{} {}", crate::utils::red("Error details:"), text);
                         }
                     }
                 }
             } else {
                 let msg = tc.message().unwrap();
                 let text = msg.get(&mut *tc).to_rust_string_lossy(&mut *tc);
                 println!("{} {} {}", crate::utils::blue("[Titan]"), crate::utils::red("Extension JS Error:"), text);
             }
         } else {
             let msg = tc.message().unwrap();
             let text = msg.get(&mut *tc).to_rust_string_lossy(&mut *tc);
             println!("{} {} {}", crate::utils::blue("[Titan]"), crate::utils::red("Extension Compile Error:"), text);
         }
    }

    // t.db (Stub for now)
    let db_obj = v8::Object::new(scope);
    let db_key = v8_str(scope, "db");
    t_obj.set(scope, db_key.into(), db_obj.into());

    let t_key = v8_str(scope, "t");
    global.set(scope, t_key.into(), t_obj.into());
}