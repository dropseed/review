//! Review library - core functionality for diff review and classification.
//!
//! This crate provides:
//! - Git diff parsing and hunk extraction (`diff`)
//! - Review state management and persistence (`review`)
//! - Trust pattern matching and taxonomy (`trust`)
//! - Claude-based hunk classification (`classify`)
//! - Git source abstraction (`sources`)
//! - File path filtering utilities (`filters`)
//!
//! Feature flags:
//! - `cli`: Command-line interface

// Core modules (always compiled, no Tauri dependencies)
pub mod ai;
pub mod classify;
pub mod diff;
pub mod filters;
pub mod process;
pub mod review;
pub mod sources;
pub mod symbols;
pub mod trust;
pub mod work;

// Service layer — shared business logic for Tauri and Axum
pub mod service;

// The local Tailscale node, as the settings panel's "serve this on my tailnet"
// switch needs to see it. Shells out to the `tailscale` CLI and nothing else,
// so it costs no dependencies and is compiled unconditionally.
pub mod tailnet;

// LSP client (feature-gated)
#[cfg(feature = "lsp")]
pub mod lsp;

// Embedded terminal sessions (feature-gated). `terminal-types` is the wire
// contract alone; `terminal` adds the PTY machinery. See `terminal::wire`.
#[cfg(feature = "terminal-types")]
pub mod terminal;

// Terminal session daemon — server half (`daemon`), client half
// (`daemon-client`), shared protocol under either.
#[cfg(any(feature = "daemon", feature = "daemon-client"))]
pub mod daemon;

// Shutdown signalling for the processes that serve until told to stop.
#[cfg(any(feature = "server", feature = "daemon"))]
pub(crate) mod signal;

// CLI module (feature-gated)
#[cfg(feature = "cli")]
pub mod cli;

// HTTP server (feature-gated)
#[cfg(feature = "server")]
pub mod server;

// Re-export commonly used types
pub use sources::traits::Comparison;
