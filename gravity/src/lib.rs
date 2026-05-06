pub mod extensions;
pub mod runtime;
pub mod utils;
pub mod native_host;

pub use runtime::{RuntimeManager, WorkerCommand, RequestTask, WorkerResult};
pub use extensions::{TitanRuntime, WorkerAsyncResult, RequestData};
pub use native_host::run_native_host;

#[derive(Clone, Debug)]
pub enum WsMessage {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close(Option<String>),
}
