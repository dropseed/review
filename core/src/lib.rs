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
pub mod review;
pub mod sources;
pub mod symbols;
pub mod trust;

// Service layer — shared business logic for Tauri and Axum
pub mod service;

// LSP client (feature-gated)
#[cfg(feature = "lsp")]
pub mod lsp;

// CLI module (feature-gated)
#[cfg(feature = "cli")]
pub mod cli;

// HTTP server (feature-gated)
#[cfg(feature = "server")]
pub mod server;

// Re-export commonly used types
pub use sources::traits::Comparison;
