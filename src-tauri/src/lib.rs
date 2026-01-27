//! Compare Desktop - Tauri desktop application for diff review.
//!
//! This crate provides the desktop UI built on Tauri.
//! Core functionality is provided by the `compare` crate.

pub mod desktop;

// Re-export the run function for the desktop app
pub use desktop::run;
