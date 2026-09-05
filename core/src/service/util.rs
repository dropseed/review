//! Pure utility functions shared across the service layer.

use anyhow::{bail, Context};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::path::{Path, PathBuf};

use super::FileContent;

/// Return `path` relative to `repo_root` as a string; fall back to the absolute
/// path when stripping fails (e.g. when the event path is outside the repo).
pub fn repo_relative_path(path: &Path, repo_root: &Path) -> String {
    path.strip_prefix(repo_root)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

/// Resolve an already-absolute path to an "open target": the repo it lives in
/// (or the path itself if it's not inside a git repo) plus, when the target
/// is a file inside a repo, its path relative to the repo root.
///
/// Returns `(repo_or_path, Option<relative_file_path>)`.
pub fn resolve_open_target(target: &Path) -> (String, Option<String>) {
    let target = crate::home::canonical_path(target);

    // If it's a file, start searching from the parent directory
    let search_start = if target.is_file() {
        target.parent().unwrap_or(&target).to_path_buf()
    } else {
        target.clone()
    };

    match crate::home::enclosing_working_tree(&search_start) {
        Some(repo_root) => {
            let focused_file = if target.is_file() {
                target
                    .strip_prefix(&repo_root)
                    .ok()
                    .map(|rel| rel.to_string_lossy().to_string())
            } else {
                None
            };
            (repo_root.to_string_lossy().to_string(), focused_file)
        }
        None => (target.to_string_lossy().to_string(), None),
    }
}

/// Return the MIME type for a known image extension, or None.
pub fn get_image_mime_type(extension: &str) -> Option<&'static str> {
    match extension.to_lowercase().as_str() {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"),
        "icns" => Some("image/icns"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// Check whether a file path refers to an image based on its extension.
pub fn is_image_file(file_path: &str) -> bool {
    let ext = file_path.rsplit('.').next().unwrap_or("");
    get_image_mime_type(ext).is_some()
}

/// Return a content type string ("text", "image", or "svg") for the given file path.
pub fn get_content_type(file_path: &str) -> String {
    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
    if ext == "svg" {
        "svg".to_owned()
    } else if is_image_file(file_path) {
        "image".to_owned()
    } else {
        "text".to_owned()
    }
}

/// Encode raw bytes as a `data:` URL with the given MIME type.
pub fn bytes_to_data_url(bytes: &[u8], mime_type: &str) -> String {
    let base64_data = BASE64.encode(bytes);
    format!("data:{mime_type};base64,{base64_data}")
}
pub fn strip_jsonc_comments(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escape_next = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if escape_next {
            result.push(c);
            escape_next = false;
            continue;
        }

        if c == '\\' && in_string {
            result.push(c);
            escape_next = true;
            continue;
        }

        if c == '"' {
            in_string = !in_string;
            result.push(c);
            continue;
        }

        if !in_string && c == '/' {
            if chars.peek() == Some(&'/') {
                // Line comment — skip to end of line
                for ch in chars.by_ref() {
                    if ch == '\n' {
                        result.push('\n');
                        break;
                    }
                }
                continue;
            }
            if chars.peek() == Some(&'*') {
                // Block comment — skip to */
                chars.next(); // consume *
                let mut prev = ' ';
                for ch in chars.by_ref() {
                    if prev == '*' && ch == '/' {
                        break;
                    }
                    prev = ch;
                }
                continue;
            }
        }

        result.push(c);
    }

    result
}

/// Reject a logical repo-relative file path that could escape the repository
/// (e.g. `../../etc/passwd` or an absolute path) once it's joined onto a
/// repo root.
pub fn reject_path_traversal(file_path: &str) -> anyhow::Result<()> {
    if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
        bail!("Path traversal detected: file path escapes repository");
    }
    Ok(())
}

/// Like `reject_path_traversal`, but allows absolute paths through
/// unchanged instead of rejecting them.
///
/// Used by the LSP commands, which legitimately navigate to absolute paths
/// outside the repo (e.g. "go to definition" landing in a vendored
/// dependency or the language's stdlib) rather than joining onto the repo
/// root. Relative paths are still checked for `..` escapes.
pub fn reject_relative_path_traversal(file_path: &str) -> anyhow::Result<()> {
    let is_absolute = file_path.starts_with('/') || file_path.starts_with('\\');
    if !is_absolute && file_path.contains("..") {
        bail!("Path traversal detected: file path escapes repository");
    }
    Ok(())
}

/// Validate that a path is within .git/review/ or ~/.spur/ for security.
pub fn validate_review_path(path: &str) -> anyhow::Result<PathBuf> {
    let path_buf = PathBuf::from(path);

    // Reject paths with ".." components to prevent traversal
    if path.contains("..") {
        bail!("Path traversal detected: path contains '..'");
    }

    let normalized = Path::new(&path.replace('\\', "/")).to_path_buf();

    // Allow writes to .git/review/ (legacy log path). Compared by path
    // component, not substring, so a directory merely named like `my.git`
    // can't be mistaken for the `.git` component itself.
    let components: Vec<_> = normalized.components().collect();
    let is_git_review = components
        .windows(2)
        .any(|w| w[0].as_os_str() == ".git" && w[1].as_os_str() == "review");
    if is_git_review {
        return Ok(path_buf);
    }

    // Allow writes to the central ~/.spur/ directory
    if let Ok(root) = crate::home::get_central_root() {
        let root = Path::new(&root.to_string_lossy().replace('\\', "/")).to_path_buf();
        if normalized.starts_with(&root) {
            return Ok(path_buf);
        }
    }

    bail!("Security error: writes are only allowed to .git/review/ or ~/.spur/ directory");
}

/// Convert raw file bytes into a FileContent struct, handling image/SVG/text detection.
pub fn bytes_to_file_content(bytes: Vec<u8>, file_path: &str) -> anyhow::Result<FileContent> {
    let content_type = get_content_type(file_path);
    let ext = file_path.rsplit('.').next().unwrap_or("");
    let mime_type = get_image_mime_type(ext);

    if content_type == "image" || content_type == "svg" {
        let image_data_url = mime_type.map(|mt| bytes_to_data_url(&bytes, mt));
        let content = if content_type == "svg" {
            String::from_utf8_lossy(&bytes).to_string()
        } else {
            String::new()
        };
        return Ok(FileContent {
            content,
            old_content: None,
            diff_patch: String::new(),
            hunks: vec![],
            content_type,
            image_data_url,
            old_image_data_url: None,
        });
    }

    let content = String::from_utf8(bytes)
        .with_context(|| format!("File is not valid UTF-8: {file_path}"))?;
    Ok(FileContent {
        content,
        old_content: None,
        diff_patch: String::new(),
        hunks: vec![],
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    })
}

/// Whether `path` is inside a git repository.
///
/// Asks git itself rather than looking for a `.git` directory, which is what
/// makes it right for worktrees, submodules, bare repos and repos whose git
/// directory lives elsewhere — all cases where the directory either isn't
/// there or isn't a directory.
pub fn is_git_repo(path: &Path) -> bool {
    std::process::Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Codex's home directory: `$CODEX_HOME` when set, else `~/.codex`.
///
/// Codex honours the override for everything it stores, so anything reading or
/// writing under its home has to resolve it the same way.
pub fn codex_home() -> Option<PathBuf> {
    match std::env::var_os("CODEX_HOME") {
        Some(dir) => Some(PathBuf::from(dir)),
        None => dirs::home_dir().map(|home| home.join(".codex")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_path_traversal_allows_ordinary_relative_paths() {
        assert!(reject_path_traversal("src/main.rs").is_ok());
        assert!(reject_path_traversal("file.txt").is_ok());
    }

    #[test]
    fn reject_path_traversal_rejects_escaping_paths() {
        assert!(reject_path_traversal("../etc/passwd").is_err());
        assert!(reject_path_traversal("src/../../etc/passwd").is_err());
        assert!(reject_path_traversal("/etc/passwd").is_err());
        assert!(reject_path_traversal("\\etc\\passwd").is_err());
    }

    #[test]
    fn reject_relative_path_traversal_allows_ordinary_and_absolute_paths() {
        assert!(reject_relative_path_traversal("src/main.rs").is_ok());
        assert!(reject_relative_path_traversal("file.txt").is_ok());
        assert!(reject_relative_path_traversal("/usr/lib/python3/os.py").is_ok());
    }

    #[test]
    fn reject_relative_path_traversal_rejects_relative_escapes() {
        assert!(reject_relative_path_traversal("../etc/passwd").is_err());
        assert!(reject_relative_path_traversal("src/../../etc/passwd").is_err());
    }

    #[test]
    fn resolve_open_target_finds_repo_root_and_relative_file() {
        let dir = tempfile::tempdir().unwrap();
        let repo_root = dir.path().join("myrepo");
        std::fs::create_dir_all(repo_root.join(".git")).unwrap();
        let nested_dir = repo_root.join("src").join("nested");
        std::fs::create_dir_all(&nested_dir).unwrap();
        let file_path = nested_dir.join("file.txt");
        std::fs::write(&file_path, "hello").unwrap();

        let (repo, focused_file) = resolve_open_target(&file_path);

        let expected_root = repo_root.canonicalize().unwrap();
        assert_eq!(PathBuf::from(&repo), expected_root);
        assert_eq!(focused_file.as_deref(), Some("src/nested/file.txt"));
    }

    #[test]
    fn resolve_open_target_outside_repo_returns_path_with_no_focused_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("standalone.txt");
        std::fs::write(&file_path, "hello").unwrap();

        let (resolved, focused_file) = resolve_open_target(&file_path);

        let expected = file_path.canonicalize().unwrap();
        assert_eq!(PathBuf::from(&resolved), expected);
        assert_eq!(focused_file, None);
    }

    #[test]
    fn strip_jsonc_comments_strips_line_comments() {
        let input = "{\n  \"a\": 1, // trailing comment\n  \"b\": 2\n}";
        let result = strip_jsonc_comments(input);
        assert_eq!(result, "{\n  \"a\": 1, \n  \"b\": 2\n}");
    }

    #[test]
    fn validate_review_path_allows_git_review_and_rejects_traversal() {
        assert!(validate_review_path("/repo/.git/review/log.json").is_ok());
        assert!(validate_review_path(".git/review/log.json").is_ok());
        assert!(validate_review_path("/repo/.git/review/../../etc/passwd").is_err());
    }

    #[test]
    fn validate_review_path_rejects_lookalike_git_review_component() {
        // `my.git` is a single path component, not a `.git` directory
        // followed by `spur` — the old substring check let this through.
        assert!(validate_review_path("/tmp/my.git/review/x").is_err());
    }

    #[test]
    fn validate_review_path_rejects_central_root_lookalike_sibling() {
        let _lock = crate::home::tests::ENV_LOCK.lock().unwrap();
        let (_guard, spur_home, _repo) = crate::home::tests::setup_test();

        let root = spur_home.path();
        assert!(validate_review_path(root.join("state.json").to_str().unwrap()).is_ok());

        // A sibling directory whose name merely has the root as a string
        // prefix (e.g. "<root>backup") must not be treated as inside it.
        let mut sibling = root.as_os_str().to_owned();
        sibling.push("backup/evil");
        assert!(validate_review_path(sibling.to_str().unwrap()).is_err());
    }

    #[test]
    fn strip_jsonc_comments_strips_block_comments() {
        let input = "{ /* comment */ \"a\": 1 /* multi\nline */ }";
        let result = strip_jsonc_comments(input);
        assert_eq!(result, "{  \"a\": 1  }");
    }

    #[test]
    fn strip_jsonc_comments_leaves_slashes_inside_strings_untouched() {
        let input = r#"{ "url": "https://example.com" }"#;
        let result = strip_jsonc_comments(input);
        assert_eq!(result, input);
    }

    #[test]
    fn strip_jsonc_comments_handles_escaped_quotes_inside_strings() {
        let input = r#"{ "a": "she said \"// not a comment\"" }"#;
        let result = strip_jsonc_comments(input);
        assert_eq!(result, input);
    }

    #[test]
    fn strip_jsonc_comments_handles_comment_followed_by_content_on_next_line() {
        let input = "{\n  // leading comment\n  \"a\": 1\n}";
        let result = strip_jsonc_comments(input);
        assert_eq!(result, "{\n  \n  \"a\": 1\n}");
    }

    #[test]
    fn strip_jsonc_comments_handles_unterminated_trailing_block_comment() {
        let input = "{ \"a\": 1 } /* trailing, never closed";
        let result = strip_jsonc_comments(input);
        assert_eq!(result, "{ \"a\": 1 } ");
    }
}
