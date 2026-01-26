pub mod claude;
pub mod prompt;

pub use claude::{check_claude_available, classify_hunks_batched, ClassifyError, ClassifyResponse};
pub use prompt::HunkInput;
