use v8;
use crate::extensions::{v8_str, v8_to_string, throw, PROJECT_ROOT};

pub fn native_read_sync(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let path_val = args.get(0);
    if !path_val.is_string() {
        throw(scope, "readSync/readFile: path is required");
        return;
    }
    let path_str = v8_to_string(scope, path_val);

    let root = PROJECT_ROOT.get().cloned().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let joined = root.join(&path_str);
    
    if let Ok(target) = joined.canonicalize() {
        if target.starts_with(&root.canonicalize().unwrap_or(root.clone())) {
            match std::fs::read(&target) {
                Ok(bytes) => {
                    let content = String::from_utf8_lossy(&bytes);
                    let v8_content = v8_str(scope, &content);
                    retval.set(v8_content.into());
                },
                Err(_) => {
                     retval.set(v8::null(scope).into());
                }
            }
        } else {
             retval.set(v8::null(scope).into());
        }
    } else {
        retval.set(v8::null(scope).into());
    }
}

pub fn native_read(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let path_val = args.get(0);
    if !path_val.is_string() {
        throw(scope, "t.read(path): path is required");
        return;
    }
    let path_str = v8_to_string(scope, path_val);

    let obj = v8::Object::new(scope);
    let op_key = v8_str(scope, "__titanAsync");
    let op_val = v8::Boolean::new(scope, true);
    obj.set(scope, op_key.into(), op_val.into());
    
    let type_key = v8_str(scope, "type");
    let type_val = v8_str(scope, "fs_read");
    obj.set(scope, type_key.into(), type_val.into());
    
    let data_obj = v8::Object::new(scope);
    let path_k = v8_str(scope, "path");
    let path_v = v8_str(scope, &path_str);
    data_obj.set(scope, path_k.into(), path_v.into());
    
    let data_key = v8_str(scope, "data");
    obj.set(scope, data_key.into(), data_obj.into());
    
    retval.set(obj.into());
}

pub fn native_decode_utf8(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let val = args.get(0);
    if let Ok(u8arr) = v8::Local::<v8::Uint8Array>::try_from(val) {
        let buf = u8arr.buffer(scope).unwrap();
        let store = v8::ArrayBuffer::get_backing_store(&buf);
        let offset = usize::from(u8arr.byte_offset());
        let length = usize::from(u8arr.byte_length());
        let slice = &store[offset..offset+length];
        
        let bytes: Vec<u8> = slice.iter().map(|b| b.get()).collect();
        let s = String::from_utf8_lossy(&bytes);
        retval.set(v8_str(scope, &s).into());
    } else if let Ok(ab) = v8::Local::<v8::ArrayBuffer>::try_from(val) {
        let store = v8::ArrayBuffer::get_backing_store(&ab);
        let bytes: Vec<u8> = store.iter().map(|b| b.get()).collect();
        let s = String::from_utf8_lossy(&bytes);
        retval.set(v8_str(scope, &s).into());
    } else {
        retval.set(v8::null(scope).into());
    }
}
