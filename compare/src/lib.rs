//! Compare library - core functionality for diff review and classification.
//!
//! This crate provides:
//! - Git diff parsing and hunk extraction (`diff`)
//! - Review state management and persistence (`review`)
//! - Trust pattern matching and taxonomy (`trust`)
//! - Claude-based hunk classification (`classify`)
//! - Git source abstraction (`sources`)
//!
//! Feature flags:
//! - `cli`: Command-line interface

// Core modules (always compiled, no Tauri dependencies)
pub mod classify;
pub mod diff;
pub mod error;
pub mod review;
pub mod sources;
pub mod trust;

// CLI module (feature-gated)
#[cfg(feature = "cli")]
pub mod cli;

// Re-export commonly used types
pub use sources::traits::Comparison;
