use v8;
use std::path::PathBuf;
use std::collections::HashMap;
use std::fs;
use std::sync::{Mutex, Arc};
use walkdir::WalkDir;
use libloading::Library;
use crate::utils::{blue, green, red};
use super::{TitanRuntime, v8_str, throw};
use serde_json::Value;

pub static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);

#[allow(dead_code)]
pub struct Registry {
    pub _libs: Vec<Library>, 
    pub modules: Vec<ModuleDef>,
    pub natives: Vec<NativeFnEntry>,
}

#[derive(Clone)]
pub struct ModuleDef {
    pub name: String,
    pub js: String,
    pub native_indices: HashMap<String, usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ParamType {
    String, F64, Bool, Json, Buffer,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ReturnType {
    String, F64, Bool, Json, Buffer, Void,
}

#[derive(Clone, Debug)]
pub struct Signature {
    pub params: Vec<ParamType>,
    pub ret: ReturnType,
}

pub struct NativeFnEntry {
    pub symbol_ptr: usize,
    pub sig: Signature,
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
            if parent_modules.exists() { node_modules = parent_modules; }
        }
    }
    
    // Generic scanner helper
    let scan_dir = |path: PathBuf, modules: &mut Vec<ModuleDef>, libs: &mut Vec<Library>, all_natives: &mut Vec<NativeFnEntry>| {
        if !path.exists() { return; }
        for entry in WalkDir::new(&path).follow_links(true).min_depth(1).max_depth(4) {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            if entry.file_type().is_file() && entry.file_name() == "titan.json" {
                let dir = entry.path().parent().unwrap();
                let config_content = fs::read_to_string(entry.path()).unwrap_or_default();
                let config: TitanConfig = match serde_json::from_str(&config_content) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let mut mod_natives_map = HashMap::new();
                if let Some(native_conf) = config.native {
                     let lib_path = dir.join(&native_conf.path);
                     unsafe {
                         // Try loading library
                         let lib_load = Library::new(&lib_path);
                         // If failed, try resolving relative to current dir or LD_LIBRARY_PATH implicit
                         // But usually absolute path from `dir` works.
                         match lib_load {
                            Ok(lib) => {
                                 for (fn_name, fn_conf) in native_conf.functions {
                                     let params = fn_conf.parameters.iter().map(|p| parse_type(&p.to_lowercase())).collect();
                                     let ret = parse_return(&fn_conf.result.to_lowercase());
                                     if let Ok(symbol) = lib.get::<*const ()>(fn_conf.symbol.as_bytes()) {
                                          let idx = all_natives.len();
                                          all_natives.push(NativeFnEntry { symbol_ptr: *symbol as usize, sig: Signature { params, ret } });
                                          mod_natives_map.insert(fn_name, idx);
                                     } else {
                                          println!("{} {} {} -> {}", blue("[Titan]"), red("Symbol not found:"), fn_conf.symbol, config.name);
                                     }
                                 }
                                 libs.push(lib);
                            },
                            Err(e) => {
                                println!("{} {} {} -> {:?}", blue("[Titan]"), red("Failed to load native lib:"), config.name, e);
                            }
                         }
                     }
                }
                let js_path = dir.join(&config.main);
                modules.push(ModuleDef { name: config.name.clone(), js: fs::read_to_string(js_path).unwrap_or_default(), native_indices: mod_natives_map });
                println!("{} {} {}", blue("[Titan]"), green("Extension loaded:"), config.name);
            }
        }
    };

    // Scan node_modules
    if node_modules.exists() {
        scan_dir(node_modules, &mut modules, &mut libs, &mut all_natives);
    }

    // Scan .ext (Production / Docker)
    let ext_dir = root.join(".ext");
    if ext_dir.exists() {
        scan_dir(ext_dir, &mut modules, &mut libs, &mut all_natives);
    }
    
    *REGISTRY.lock().unwrap() = Some(Registry { _libs: libs, modules, natives: all_natives });
}

pub fn inject_external_extensions(scope: &mut v8::HandleScope, global: v8::Local<v8::Object>, t_obj: v8::Local<v8::Object>) {
    let invoke_fn = v8::Function::new(scope, native_invoke_extension).unwrap();
    let invoke_key = v8_str(scope, "__titan_invoke_native");
    global.set(scope, invoke_key.into(), invoke_fn.into());

    let modules = if let Ok(guard) = REGISTRY.lock() {
        guard.as_ref().map(|r| r.modules.clone()).unwrap_or_default()
    } else { vec![] };

    for module in modules {
         let mod_obj = v8::Object::new(scope);
         for (fn_name, &idx) in &module.native_indices {
              let code = format!("(function(...args) {{ return __titan_invoke_native({}, args); }})", idx);
              let code_str = v8_str(scope, &code);
              if let Some(script) = v8::Script::compile(scope, code_str, None) {
                  if let Some(val) = script.run(scope) {
                        let key = v8_str(scope, fn_name);
                        mod_obj.set(scope, key.into(), val);
                  }
              }
         }
         let mod_key = v8_str(scope, &module.name);
         t_obj.set(scope, mod_key.into(), mod_obj.into());
         
         let act_key = v8_str(scope, "__titan_action");
         let act_val = v8_str(scope, &module.name);
         global.set(scope, act_key.into(), act_val.into());
         
         let wrapped_js = format!("(function(t) {{ {} }})", module.js);
         let wrapped_js_str = v8_str(scope, &wrapped_js);
         let tc = &mut v8::TryCatch::new(scope);
         if let Some(script) = v8::Script::compile(tc, wrapped_js_str, None) {
             if let Some(func_val) = script.run(tc) {
                 if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                     let receiver = v8::undefined(&mut *tc).into();
                     let args = [t_obj.into()];
                     func.call(&mut *tc, receiver, &args);
                 }
             }
         }
    }
}

fn native_invoke_extension(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let fn_idx = args.get(0).to_integer(scope).unwrap().value() as usize;
    let js_args_val = args.get(1);
    let (ptr, sig) = if let Ok(guard) = REGISTRY.lock() {
        if let Some(entry) = guard.as_ref().and_then(|r| r.natives.get(fn_idx)) {
            (entry.symbol_ptr, entry.sig.clone())
        } else { return; }
    } else { return; };
    
    if ptr == 0 { throw(scope, "Native function not found"); return; }

    let js_args = if js_args_val.is_array() {
        v8::Local::<v8::Array>::try_from(js_args_val).unwrap()
    } else { v8::Array::new(scope, 0) };
    
    let argc = sig.params.len();
    unsafe {
         let mut vals = Vec::new();
         for (i, param) in sig.params.iter().enumerate() {
             let val = js_args.get_index(scope, i as u32).unwrap_or_else(|| v8::undefined(scope).into());
             vals.push(arg_from_v8(scope, val, param));
         }

         let res_val: serde_json::Value = match argc {
             0 => { dispatch_ret!(ptr, sig.ret, (), ()) },
             1 => {
                 let v0 = vals.remove(0);
                 match sig.params[0] {
                     ParamType::String => { 
                         let c = std::ffi::CString::new(v0.as_str().unwrap_or("")).unwrap();
                         dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char), (c.as_ptr())) 
                     },
                     ParamType::F64 => { dispatch_ret!(ptr, sig.ret, (f64), (v0.as_f64().unwrap_or(0.0))) },
                     ParamType::Bool => { dispatch_ret!(ptr, sig.ret, (bool), (v0.as_bool().unwrap_or(false))) },
                     ParamType::Json => { 
                         let c = std::ffi::CString::new(v0.to_string()).unwrap();
                         dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char), (c.as_ptr())) 
                     },
                     ParamType::Buffer => { 
                         let a0: Vec<u8> = v0.as_array().map(|a| a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect()).unwrap_or_default();
                         dispatch_ret!(ptr, sig.ret, (Vec<u8>), (a0)) 
                     },
                 }
             },
             2 => {
                 let v0 = vals.remove(0); let v1 = vals.remove(0);
                 match (sig.params[0].clone(), sig.params[1].clone()) {
                    (ParamType::String, ParamType::String) => {
                        let c0 = std::ffi::CString::new(v0.as_str().unwrap_or("")).unwrap();
                        let c1 = std::ffi::CString::new(v1.as_str().unwrap_or("")).unwrap();
                        dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char, *const std::os::raw::c_char), (c0.as_ptr(), c1.as_ptr()))
                    },
                    (ParamType::String, ParamType::F64) => {
                        let c0 = std::ffi::CString::new(v0.as_str().unwrap_or("")).unwrap();
                        dispatch_ret!(ptr, sig.ret, (*const std::os::raw::c_char, f64), (c0.as_ptr(), v1.as_f64().unwrap_or(0.0)))
                    },
                     _ => serde_json::Value::Null
                 }
             },
             _ => serde_json::Value::Null
         };
         retval.set(js_from_value(scope, &sig.ret, res_val));
    }
}

fn arg_from_v8(scope: &mut v8::HandleScope, val: v8::Local<v8::Value>, ty: &ParamType) -> serde_json::Value {
    match ty {
        ParamType::String => serde_json::Value::String(val.to_rust_string_lossy(scope)),
        ParamType::F64 => serde_json::json!(val.to_number(scope).map(|n| n.value()).unwrap_or(0.0)),
        ParamType::Bool => serde_json::json!(val.boolean_value(scope)),
        ParamType::Json => {
            v8::json::stringify(scope, val).map(|s| serde_json::from_str(&s.to_rust_string_lossy(scope)).unwrap_or(Value::Null)).unwrap_or(Value::Null)
        },
        ParamType::Buffer => {
            if let Ok(u8arr) = v8::Local::<v8::Uint8Array>::try_from(val) {
                let store = v8::ArrayBuffer::get_backing_store(&u8arr.buffer(scope).unwrap());
                let offset = usize::from(u8arr.byte_offset());
                let length = usize::from(u8arr.byte_length());
                let vec_u8: Vec<Value> = store[offset..offset+length].iter().map(|b| Value::from(b.get() as u64)).collect();
                Value::Array(vec_u8)
            } else { Value::Array(vec![]) }
        }
    }
}

fn js_from_value<'a>(scope: &mut v8::HandleScope<'a>, ret_type: &ReturnType, val: serde_json::Value) -> v8::Local<'a, v8::Value> {
    match ret_type {
        ReturnType::String => v8_str(scope, val.as_str().unwrap_or("")).into(),
        ReturnType::F64 => v8::Number::new(scope, val.as_f64().unwrap_or(0.0)).into(),
        ReturnType::Bool => v8::Boolean::new(scope, val.as_bool().unwrap_or(false)).into(),
        ReturnType::Json => {
            let s = v8_str(scope, &val.to_string());
            v8::json::parse(scope, s).unwrap_or_else(|| v8::null(scope).into())
        },
        ReturnType::Buffer => v8::undefined(scope).into(),
        ReturnType::Void => v8::undefined(scope).into(),
    }
}

macro_rules! dispatch_ret {
    ($ptr:expr, $ret:expr, ($($arg_ty:ty),*), ($($arg:expr),*)) => {
        match $ret {
            ReturnType::String => { 
                let f: extern "C" fn($($arg_ty),*) -> *mut std::os::raw::c_char = unsafe { std::mem::transmute($ptr) }; 
                let ptr = f($($arg),*);
                if ptr.is_null() { Value::String(String::new()) } else { Value::String(unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned() }) }
            },
            ReturnType::F64 => { let f: extern "C" fn($($arg_ty),*) -> f64 = unsafe { std::mem::transmute($ptr) }; serde_json::json!(f($($arg),*)) },
            ReturnType::Bool => { let f: extern "C" fn($($arg_ty),*) -> bool = unsafe { std::mem::transmute($ptr) }; serde_json::json!(f($($arg),*)) },
            ReturnType::Json => { 
                let f: extern "C" fn($($arg_ty),*) -> *mut std::os::raw::c_char = unsafe { std::mem::transmute($ptr) }; 
                let ptr = f($($arg),*);
                if ptr.is_null() { Value::Null } else { serde_json::from_str(&unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy() }).unwrap_or(Value::Null) }
             },
            ReturnType::Buffer => { 
                let f: extern "C" fn($($arg_ty),*) -> Vec<u8> = unsafe { std::mem::transmute($ptr) }; 
                Value::Array(f($($arg),*).into_iter().map(Value::from).collect()) 
            },
            ReturnType::Void => { let f: extern "C" fn($($arg_ty),*) = unsafe { std::mem::transmute($ptr) }; f($($arg),*); Value::Null },
        }
    }
}
pub(crate) use dispatch_ret;
