//! `review url` — print a `review://` deep link that opens the desktop app
//! at a specific repo, comparison, file, and (optionally) hunk.
//!
//! Agents (and humans) call this to produce a clickable URL they can paste
//! into chat, PR descriptions, or markdown notes.

use std::path::PathBuf;

use clap::Args;

use crate::review::central::compute_repo_id;

use super::common::{parse_hunk_target, resolve_review_arg, HunkTarget};
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct UrlArgs {
    /// Repository path (defaults to the current directory)
    #[arg(short, long)]
    pub repo: Option<String>,

    /// Review spec (a ref, or "base..ref" to pin the base); defaults to the
    /// current branch. Pass `--no-comparison` to produce a browse-mode URL
    /// instead.
    #[arg(short, long)]
    pub spec: Option<String>,

    /// Generate a browse-mode URL (no comparison). Useful for linking to a
    /// file without a specific diff context.
    #[arg(long, conflicts_with = "spec")]
    pub no_comparison: bool,

    /// Positional `<file>` or `<file>:<hash>` target. May also be supplied
    /// via `--file` / `--hunk`.
    pub target: Option<String>,

    /// File path relative to the repo root.
    #[arg(long, conflicts_with = "target")]
    pub file: Option<String>,

    /// Hunk content hash (the `<hash>` half of a `file:hash` hunk ID).
    #[arg(long, conflicts_with = "target")]
    pub hunk: Option<String>,
}

pub fn run_url(args: UrlArgs) -> Result<(), String> {
    let repo_path = get_repo_path(&args.repo)?;
    let repo = PathBuf::from(&repo_path);
    let repo_id = compute_repo_id(&repo).map_err(|e| e.to_string())?;

    let (file, hunk) = match (args.target, args.file, args.hunk) {
        (Some(target), None, None) => match parse_hunk_target(&target) {
            HunkTarget::Hunk { file, hash } => (Some(file), Some(hash)),
            HunkTarget::File { path } => (Some(path), None),
        },
        (None, file, hunk) => (file, hunk),
        _ => unreachable!("clap conflicts_with prevents this combination"),
    };

    let review_ref = if args.no_comparison {
        None
    } else {
        Some(resolve_review_arg(&repo, args.spec.as_deref())?.ref_name)
    };

    println!(
        "{}",
        build_review_url(
            &repo_id,
            review_ref.as_deref(),
            file.as_deref(),
            hunk.as_deref()
        )
    );
    Ok(())
}

/// Construct `review://open?repo=...&ref=...&file=...&hunk=...` with the
/// given parts. The `ref` value is the review ref (identity). All parameters
/// are URL-encoded; missing parts are omitted.
pub fn build_review_url(
    repo_id: &str,
    review_ref: Option<&str>,
    file: Option<&str>,
    hunk: Option<&str>,
) -> String {
    let mut url = format!("review://open?repo={}", urlencoding::encode(repo_id));
    if let Some(review_ref) = review_ref {
        url.push_str(&format!("&ref={}", urlencoding::encode(review_ref)));
    }
    if let Some(file) = file {
        url.push_str(&format!("&file={}", urlencoding::encode(file)));
    }
    if let Some(hunk) = hunk {
        url.push_str(&format!("&hunk={}", urlencoding::encode(hunk)));
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_includes_all_present_params() {
        let url = build_review_url(
            "abc123",
            Some("main..feature"),
            Some("src/main.rs"),
            Some("deadbeef"),
        );
        assert_eq!(
            url,
            "review://open?repo=abc123&ref=main..feature&file=src%2Fmain.rs&hunk=deadbeef"
        );
    }

    #[test]
    fn url_omits_missing_params() {
        let url = build_review_url("abc123", None, None, None);
        assert_eq!(url, "review://open?repo=abc123");
    }

    #[test]
    fn url_encodes_branch_with_slash() {
        let url = build_review_url("abc", Some("main..feature/x"), None, None);
        assert!(url.contains("feature%2Fx"));
    }
}
