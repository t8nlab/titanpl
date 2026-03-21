use v8;
use std::sync::OnceLock;
use deadpool_postgres::{Manager, Pool};
use tokio_postgres::{NoTls, Config};
use crate::extensions::{v8_str, v8_to_string, throw};

// Database connection pool
pub static DB_POOL: OnceLock<Pool> = OnceLock::new();

pub fn native_db_connect(scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, mut retval: v8::ReturnValue) {
    let conn_string = v8_to_string(scope, args.get(0));

    if conn_string.is_empty() {
        throw(scope, "t.db.connect(): connection string required");
        return;
    }

    let mut max_size = 16;

    if args.length() > 1 && args.get(1).is_object() {
        let opts = args.get(1).to_object(scope).unwrap();
        let max_key = v8_str(scope, "max");
        if let Some(v) = opts.get(scope, max_key.into()) {
            if let Some(n) = v.number_value(scope) {
                max_size = n as usize;
            }
        }
    }

    if DB_POOL.get().is_none() {
        let cfg: Config = match conn_string.parse() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("t.db.connect(): Invalid connection string: {}", e);
                let message = v8::String::new(scope, &msg).unwrap_or_else(|| v8::String::new(scope, "Error").unwrap());
                let exception = v8::Exception::error(scope, message);
                scope.throw_exception(exception);
                return;
            }
        };
        let mgr = Manager::new(cfg, NoTls);
    
        let pool = match Pool::builder(mgr)
            .max_size(max_size)
            .build() {
                Ok(p) => p,
                Err(e) => {
                    throw(scope, &format!("t.db.connect(): Failed to build connection pool: {}", e));
                    return;
                }
            };
    
        DB_POOL.set(pool).ok();
    }

    let db_conn_obj = v8::Object::new(scope);

    let query_fn = v8::Function::new(scope, native_db_query).unwrap();
    let query_key = v8_str(scope, "query");
    db_conn_obj.set(scope, query_key.into(), query_fn.into());

    retval.set(db_conn_obj.into());
}

pub fn native_db_query(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut retval: v8::ReturnValue,
) {
    let sql = v8_to_string(scope, args.get(0));

    // Collect params
    let mut params = Vec::new();
    if args.length() > 1 && args.get(1).is_array() {
        let arr = v8::Local::<v8::Array>::try_from(args.get(1)).unwrap();
        for i in 0..arr.length() {
            if let Some(v) = arr.get_index(scope, i) {
                params.push(v8_to_string(scope, v));
            }
        }
    }

    // Main async wrapper object
    let obj = v8::Object::new(scope);

    let async_key = v8_str(scope, "__titanAsync");
    let async_val = v8::Boolean::new(scope, true);
    obj.set(scope, async_key.into(), async_val.into());

    let type_key = v8_str(scope, "type");
    let type_val = v8_str(scope, "db_query");
    obj.set(scope, type_key.into(), type_val.into());

    // Data object
    let data_obj = v8::Object::new(scope);

    let conn_key = v8_str(scope, "conn");
    let conn_val = v8_str(scope, "default");
    data_obj.set(scope, conn_key.into(), conn_val.into());

    let query_key = v8_str(scope, "query");
    let query_val = v8_str(scope, &sql);
    data_obj.set(scope, query_key.into(), query_val.into());

    // Params array
    let params_arr = v8::Array::new(scope, params.len() as i32);

    for (i, p) in params.iter().enumerate() {
        let param_val = v8_str(scope, p);
        params_arr.set_index(scope, i as u32, param_val.into());
    }

    let params_key = v8_str(scope, "params");
    data_obj.set(scope, params_key.into(), params_arr.into());

    let data_key = v8_str(scope, "data");
    obj.set(scope, data_key.into(), data_obj.into());

    retval.set(obj.into());
}
