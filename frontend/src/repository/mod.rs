pub mod convert;
pub mod hash;
pub mod idb;
pub mod model;
pub mod sequence;
pub mod test_hook;
pub mod validate;

pub use idb::ClientRepository;
pub use model::*;

pub const DB_NAME: &str = "srep-client";
pub const DB_VERSION: u32 = 2;
pub const REPOSITORY_SCHEMA_VERSION: u32 = 1;
pub const PACK_SCHEMA_VERSION: u32 = 1;
pub const OUTBOX_PAYLOAD_SCHEMA_VERSION: u32 = 1;
pub const DIAGNOSTIC_FORMAT_VERSION: u32 = 1;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
