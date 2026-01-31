pub mod claude;
pub mod prompt;
pub mod static_classify;

#[cfg(feature = "cli")]
pub(crate) use claude::classify_single_hunk;
pub use claude::{check_claude_available, classify_hunks_batched, ClassifyError, ClassifyResponse};
pub use prompt::HunkInput;
pub use static_classify::classify_hunks_static;
