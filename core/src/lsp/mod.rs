//! LSP client for language server integration.
//!
//! Provides a JSON-RPC 2.0 client over stdio for communicating with
//! language servers (e.g. `ty server` for Python). Used to resolve
//! symbol definitions in external dependencies (e.g. `.venv/site-packages/`).

pub mod client;
pub mod jsonrpc;
pub mod registry;
pub mod transport;
