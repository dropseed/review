use serde::Serialize;
use thiserror::Error;

/// Unified error type for the Review application.
///
/// This enum provides structured error information that can be
/// serialized to JSON for the frontend to handle appropriately.
#[derive(Error, Debug, Serialize)]
#[serde(tag = "type", content = "details")]
pub enum AppError {
    #[error("Git error: {message}")]
    Git { message: String, operation: String },

    #[error("Storage error: {message}")]
    Storage { message: String },

    #[error("Classification error: {message}")]
    Classification { message: String },

    #[error("Not found: {resource}")]
    NotFound { resource: String },

    #[error("Path traversal: {path}")]
    PathTraversal { path: String },

    #[error("IO error: {message}")]
    Io { message: String },

    #[error("Parse error: {message}")]
    Parse { message: String },
}

impl AppError {
    /// Create a Git error with operation context
    pub fn git(message: impl Into<String>, operation: impl Into<String>) -> Self {
        Self::Git {
            message: message.into(),
            operation: operation.into(),
        }
    }

    /// Create a Storage error
    pub fn storage(message: impl Into<String>) -> Self {
        Self::Storage {
            message: message.into(),
        }
    }

    /// Create a Classification error
    pub fn classification(message: impl Into<String>) -> Self {
        Self::Classification {
            message: message.into(),
        }
    }

    /// Create a Not Found error
    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::NotFound {
            resource: resource.into(),
        }
    }

    /// Create a Path Traversal error
    pub fn path_traversal(path: impl Into<String>) -> Self {
        Self::PathTraversal { path: path.into() }
    }

    /// Create an IO error
    pub fn io(message: impl Into<String>) -> Self {
        Self::Io {
            message: message.into(),
        }
    }

    /// Create a Parse error
    pub fn parse(message: impl Into<String>) -> Self {
        Self::Parse {
            message: message.into(),
        }
    }

    /// Check if this error is recoverable (user can retry or take action)
    pub fn is_recoverable(&self) -> bool {
        match self {
            // Git operations can often be retried
            // Storage issues may be transient
            // Classification can be retried
            // IO issues may be transient
            Self::Git { .. }
            | Self::Storage { .. }
            | Self::Classification { .. }
            | Self::Io { .. } => true,
            // Resource genuinely doesn't exist
            // Security issue, not recoverable
            // Parse errors won't change on retry
            Self::NotFound { .. } | Self::PathTraversal { .. } | Self::Parse { .. } => false,
        }
    }
}

// Convert from LocalGitError
impl From<crate::sources::local_git::LocalGitError> for AppError {
    fn from(err: crate::sources::local_git::LocalGitError) -> Self {
        use crate::sources::local_git::LocalGitError;
        match err {
            LocalGitError::Git(msg) => AppError::git(msg, "git"),
            LocalGitError::Io(e) => AppError::io(e.to_string()),
            LocalGitError::NotARepo => AppError::not_found("git repository"),
        }
    }
}

// Convert from StorageError
impl From<crate::review::storage::StorageError> for AppError {
    fn from(err: crate::review::storage::StorageError) -> Self {
        use crate::review::storage::StorageError;
        match err {
            StorageError::Io(e) => AppError::storage(format!("IO: {e}")),
            StorageError::Json(e) => AppError::storage(format!("JSON: {e}")),
            StorageError::VersionConflict { expected, found } => AppError::storage(format!(
                "Version conflict: expected version {expected}, found {found}. Another process modified the file."
            )),
        }
    }
}

// Convert from ClassifyError
impl From<crate::classify::ClassifyError> for AppError {
    fn from(err: crate::classify::ClassifyError) -> Self {
        use crate::classify::ClassifyError;
        match err {
            ClassifyError::ClaudeNotFound => AppError::classification(
                "Claude CLI not found. Install from https://claude.ai/code",
            ),
            ClassifyError::CommandFailed(msg) => {
                AppError::classification(format!("Command failed: {msg}"))
            }
            ClassifyError::ParseError(msg) => {
                AppError::classification(format!("Parse error: {msg}"))
            }
            ClassifyError::EmptyResponse => AppError::classification("Empty response from Claude"),
            ClassifyError::Io(e) => AppError::io(e.to_string()),
        }
    }
}

// Convert from std::io::Error
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::io(err.to_string())
    }
}

// Convert to String for Tauri command errors (backward compatibility)
impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_serialization() {
        let err = AppError::git("branch not found", "checkout");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"type\":\"Git\""));
        assert!(json.contains("\"message\":\"branch not found\""));
        assert!(json.contains("\"operation\":\"checkout\""));
    }

    #[test]
    fn test_is_recoverable() {
        assert!(AppError::git("failed", "fetch").is_recoverable());
        assert!(AppError::storage("disk full").is_recoverable());
        assert!(AppError::classification("timeout").is_recoverable());
        assert!(!AppError::not_found("file.txt").is_recoverable());
        assert!(!AppError::path_traversal("../../../etc/passwd").is_recoverable());
    }

    #[test]
    fn test_helper_constructors() {
        let err = AppError::git("msg", "op");
        match err {
            AppError::Git { message, operation } => {
                assert_eq!(message, "msg");
                assert_eq!(operation, "op");
            }
            _ => panic!("Wrong variant"),
        }

        let err = AppError::not_found("resource");
        match err {
            AppError::NotFound { resource } => {
                assert_eq!(resource, "resource");
            }
            _ => panic!("Wrong variant"),
        }
    }
}
