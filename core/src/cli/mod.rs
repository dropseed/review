use crate::review::state::HunkStatus;
use crate::review::storage;
use crate::service::targets::{self, ReviewTarget};
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

mod comments;
mod common;
mod findings;
mod guide;
mod review_state;
mod skill;
mod staging;
mod url;

#[derive(Debug, Parser)]
#[command(name = "review")]
#[command(author, version, about = "Review diffs more efficiently", long_about = None)]
pub struct Cli {
    /// Override the data directory (default: ~/.review/, env: REVIEW_HOME)
    #[arg(long, global = true)]
    pub home: Option<String>,

    #[command(subcommand)]
    pub command: Option<Commands>,

    /// Path to open (file or directory, defaults to current directory)
    pub path: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Start a review: resolve a comparison, create review state, and open the app
    Start {
        /// Repository path (defaults to current directory)
        #[arg(short, long)]
        repo: Option<String>,

        /// Comparison spec: "base..head"; a branch/tag (compared against the
        /// default branch); a bare commit (SHA, HEAD, HEAD~n — reviewed on its
        /// own); or "<rev>^!" (also a single commit).
        /// Auto-detects from branches if not specified.
        spec: Option<String>,

        /// The old side of the diff (defaults to default branch)
        #[arg(long)]
        old: Option<String>,

        /// The new side of the diff (defaults to current branch)
        #[arg(long)]
        new: Option<String>,

        /// Review just this one commit (its diff against its parent)
        #[arg(long, value_name = "REV", conflicts_with_all = ["spec", "old", "new"])]
        commit: Option<String>,

        /// Review only uncommitted changes (staged, unstaged, and untracked) on
        /// the current branch — i.e. everything since the last commit.
        #[arg(long, conflicts_with_all = ["spec", "old", "new", "commit"])]
        working: bool,

        /// Review only staged changes (the git index — what would be committed).
        #[arg(long, conflicts_with_all = ["spec", "old", "new", "commit", "working"])]
        staged: bool,

        /// Review a stash entry's changes (defaults to the most recent, stash@{0}).
        #[arg(
            long,
            value_name = "N",
            num_args = 0..=1,
            default_missing_value = "0",
            conflicts_with_all = ["spec", "old", "new", "commit", "working", "staged"]
        )]
        stash: Option<u32>,

        /// Review a unified-diff patch applied on top of HEAD ("-" reads stdin).
        #[arg(
            long,
            value_name = "FILE",
            conflicts_with_all = ["spec", "old", "new", "commit", "working", "staged", "stash"]
        )]
        patch: Option<String>,
    },

    /// List uncommitted working-tree changes as individual hunks
    Changes(staging::ChangesArgs),

    /// Stage hunks (or whole files) to the git index
    Stage(staging::StageArgs),

    /// Unstage hunks (or whole files) from the git index
    Unstage(staging::StageArgs),

    /// List a comparison's hunks with their review status
    Hunks(review_state::HunksArgs),

    /// Mark hunks as approved
    Approve(review_state::MarkArgs),

    /// Mark hunks as rejected
    Reject(review_state::MarkArgs),

    /// Mark hunks as saved for later
    Save(review_state::MarkArgs),

    /// Clear the review status of hunks
    Unmark(review_state::MarkArgs),

    /// Set or clear the risk level on hunks
    Risk(review_state::RiskArgs),

    /// Show review progress for a comparison
    Status(review_state::StatusArgs),

    /// List saved reviews
    List(review_state::ListArgs),

    /// Delete a saved review
    Delete(review_state::DeleteArgs),

    /// Change the base ref of a saved review
    ChangeBase(review_state::ChangeBaseArgs),

    /// Inspect or edit the trust list
    Trust(review_state::TrustArgs),

    /// Read or edit review notes
    Note(review_state::NoteArgs),

    /// List line-level comments on a comparison
    Comments(comments::CommentsArgs),

    /// Add, edit, resolve, or delete a line-level comment
    Comment(comments::CommentArgs),

    /// Submit a review run, or list findings (an AI review pass's record)
    Findings(findings::FindingsArgs),

    /// Show, resolve, or reopen an individual finding
    Finding(findings::FindingArgs),

    /// List recorded review runs
    Runs(findings::RunsArgs),

    /// Show, author, or clear the review guide (an agent-authored hunk grouping)
    Guide(guide::GuideArgs),

    /// Print a `review://` deep link for a file or hunk
    Url(url::UrlArgs),

    /// Install the review-guide skill for Claude Code and Codex
    Skill(skill::SkillArgs),
}

/// Walk up from `start` to find a directory containing `.git/`.
fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if current.join(".git").exists() {
            return Some(current.to_path_buf());
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return None,
        }
    }
}

/// Get the repository path from an explicit `--repo` flag, or walk up from cwd.
pub(crate) fn get_repo_path(repo: &Option<String>) -> Result<String, String> {
    if let Some(ref repo) = repo {
        return Ok(repo.clone());
    }

    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    find_repo_root(&cwd)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Not a git repository. Use --repo to specify a repository path.".to_owned())
}

/// Resolve a potentially relative path to an absolute one.
fn resolve_absolute(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    Ok(cwd.join(path))
}

/// Resolve the path given to `review [path]`. Returns `(repo_or_path, Option<relative_file_path>)`.
/// When the target is a file inside a git repo, the relative path from the repo root is returned.
/// When no git repo is found, returns `(target_path, None)`.
fn resolve_open_path(path: Option<String>) -> Result<(String, Option<String>), String> {
    let target = match path {
        Some(p) => {
            let abs = resolve_absolute(Path::new(&p))?;
            abs.canonicalize().unwrap_or(abs)
        }
        None => std::env::current_dir().map_err(|e| e.to_string())?,
    };

    // If it's a file, start searching from the parent directory
    let search_start = if target.is_file() {
        target.parent().unwrap_or(&target).to_path_buf()
    } else {
        target.clone()
    };

    // Try to find a git repo root
    match find_repo_root(&search_start) {
        Some(repo_root) => {
            // If the target is a file (or at least different from the repo root),
            // compute the relative path from the repo root.
            let focused_file = if target.is_file() {
                target
                    .strip_prefix(&repo_root)
                    .ok()
                    .map(|rel| rel.to_string_lossy().to_string())
            } else {
                None
            };
            Ok((repo_root.to_string_lossy().to_string(), focused_file))
        }
        None => Ok((target.to_string_lossy().to_string(), None)),
    }
}

/// Run the CLI: dispatch to the appropriate subcommand.
pub fn run(cli: Cli) -> Result<(), String> {
    let has_home_override = cli.home.is_some();

    // Set REVIEW_HOME early so all storage calls use the override
    if let Some(home) = &cli.home {
        let absolute = resolve_absolute(Path::new(home))?;
        std::env::set_var("REVIEW_HOME", &absolute);
    }

    match cli.command {
        Some(Commands::Start {
            repo,
            spec,
            old,
            new,
            commit,
            working,
            staged,
            stash,
            patch,
        }) => run_start(
            repo,
            StartTarget::from_args(spec, old, new, commit, working, staged, stash, patch),
            has_home_override,
        ),
        Some(Commands::Changes(args)) => staging::run_changes(args),
        Some(Commands::Stage(args)) => staging::run_stage(args, false),
        Some(Commands::Unstage(args)) => staging::run_stage(args, true),
        Some(Commands::Hunks(args)) => review_state::run_hunks(args),
        Some(Commands::Approve(args)) => review_state::run_mark(args, HunkStatus::Approved),
        Some(Commands::Reject(args)) => review_state::run_mark(args, HunkStatus::Rejected),
        Some(Commands::Save(args)) => review_state::run_mark(args, HunkStatus::SavedForLater),
        Some(Commands::Unmark(args)) => review_state::run_unmark(args),
        Some(Commands::Risk(args)) => review_state::run_risk(args),
        Some(Commands::Status(args)) => review_state::run_status(args),
        Some(Commands::List(args)) => review_state::run_list(args),
        Some(Commands::Delete(args)) => review_state::run_delete(args),
        Some(Commands::ChangeBase(args)) => review_state::run_change_base(args),
        Some(Commands::Trust(args)) => review_state::run_trust(args),
        Some(Commands::Note(args)) => review_state::run_note(args),
        Some(Commands::Comments(args)) => comments::run_comments(args),
        Some(Commands::Comment(args)) => match args.action {
            comments::CommentAction::Add(a) => comments::run_add(args.target, a),
            comments::CommentAction::Edit(a) => comments::run_edit(args.target, a),
            comments::CommentAction::Resolve(a) => comments::run_resolve(args.target, a),
            comments::CommentAction::Unresolve(a) => comments::run_unresolve(args.target, a),
            comments::CommentAction::Delete(a) => comments::run_delete(args.target, a),
        },
        Some(Commands::Findings(args)) => match args.action {
            Some(findings::FindingsAction::Submit(a)) => findings::run_submit(a),
            None => findings::run_list(args),
        },
        Some(Commands::Finding(args)) => match args.action {
            findings::FindingAction::Show(a) => findings::run_show(args.target, a),
            findings::FindingAction::Resolve(a) => findings::run_resolve(args.target, a),
            findings::FindingAction::Reopen(a) => findings::run_reopen(args.target, a),
        },
        Some(Commands::Runs(args)) => findings::run_runs(args),
        Some(Commands::Guide(args)) => match args.action {
            guide::GuideAction::Show(a) => guide::run_show(a),
            guide::GuideAction::Add(a) => guide::run_add(a),
            guide::GuideAction::Clear(a) => guide::run_clear(a),
        },
        Some(Commands::Url(args)) => url::run_url(args),
        Some(Commands::Skill(args)) => skill::run_skill(args),
        None => run_open(cli.path, has_home_override),
    }
}

fn warn_home_override(has_home_override: bool) {
    if has_home_override {
        eprintln!(
            "Note: --home only takes effect on a fresh launch. If Review is already running, quit it first."
        );
    }
}

/// `review [path]` — open a path in the app without creating a review.
fn run_open(path: Option<String>, has_home_override: bool) -> Result<(), String> {
    let (repo_path, focused_file) = resolve_open_path(path)?;
    open_app(&repo_path, None, focused_file.as_deref())?;
    warn_home_override(has_home_override);
    Ok(())
}

/// `review start [spec]` — resolve a comparison, persist review state, open the app.
/// What to review, selected by the mutually-exclusive `review start` flags. New
/// target kinds (e.g. `--patch`, `--pr`) become a variant here rather than
/// another argument threaded through `run_start`.
enum StartTarget {
    /// Default: current branch vs default branch, honoring `--old`/`--new`.
    Compare {
        old: Option<String>,
        new: Option<String>,
    },
    /// A comparison spec (`a..b`, a bare ref, `<rev>^!`, `snapshot:<ref>`).
    Spec(String),
    /// Just one commit (`--commit <rev>`).
    Commit(String),
    /// Uncommitted changes only (`--working`).
    Working,
    /// Staged changes only (`--staged`).
    Staged,
    /// A stash entry (`--stash [<n>]`).
    Stash(u32),
    /// A unified-diff patch from a file or stdin (`--patch <file|->`).
    Patch(String),
}

impl StartTarget {
    /// Pick the target from the parsed flags. clap's `conflicts_with` guarantees
    /// at most one selector is set; the order here is just a defensive tiebreak.
    #[allow(clippy::too_many_arguments)]
    fn from_args(
        spec: Option<String>,
        old: Option<String>,
        new: Option<String>,
        commit: Option<String>,
        working: bool,
        staged: bool,
        stash: Option<u32>,
        patch: Option<String>,
    ) -> Self {
        if working {
            StartTarget::Working
        } else if staged {
            StartTarget::Staged
        } else if let Some(n) = stash {
            StartTarget::Stash(n)
        } else if let Some(src) = patch {
            StartTarget::Patch(src)
        } else if let Some(rev) = commit {
            StartTarget::Commit(rev)
        } else if let Some(spec) = spec {
            StartTarget::Spec(spec)
        } else {
            StartTarget::Compare { old, new }
        }
    }

    fn resolve(self, repo_path: &Path) -> Result<Comparison, String> {
        match self {
            StartTarget::Working => resolve_working_comparison(repo_path),
            StartTarget::Staged => resolve_staged_comparison(repo_path),
            StartTarget::Stash(n) => resolve_stash_comparison(repo_path, n),
            StartTarget::Patch(src) => resolve_patch_comparison(repo_path, &src),
            StartTarget::Commit(rev) => resolve_commit_comparison(repo_path, &rev),
            StartTarget::Spec(spec) => parse_comparison_spec(repo_path, &spec),
            StartTarget::Compare { old, new } => resolve_comparison(repo_path, old, new),
        }
    }
}

fn run_start(
    repo: Option<String>,
    target: StartTarget,
    has_home_override: bool,
) -> Result<(), String> {
    let repo_path = get_repo_path(&repo)?;
    let path = PathBuf::from(&repo_path);
    let comparison = target.resolve(&path)?;
    storage::ensure_review_exists(&path, &comparison, None).map_err(|e| e.to_string())?;
    open_app(&repo_path, Some(&comparison.key), None)?;
    warn_home_override(has_home_override);
    Ok(())
}

/// Resolve a comparison from optional `--old`/`--new` overrides, falling back
/// to the repo's default and current branches for whichever side is `None`.
pub(crate) fn resolve_comparison(
    repo_path: &Path,
    old: Option<String>,
    new: Option<String>,
) -> Result<Comparison, String> {
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    Ok(resolve_comparison_with(&source, old, new))
}

/// Resolve a comparison from optional `--old`/`--new` overrides against an
/// already-built source, defaulting each missing side to the repo's default /
/// current branch. Reused by `parse_comparison_spec` to avoid rebuilding a
/// `LocalGitSource` on the common single-ref path.
fn resolve_comparison_with(
    source: &LocalGitSource,
    old: Option<String>,
    new: Option<String>,
) -> Comparison {
    let base = old.unwrap_or_else(|| {
        source
            .get_default_branch()
            .unwrap_or_else(|_| "main".to_owned())
    });
    let head = new.unwrap_or_else(|| {
        source
            .get_current_branch()
            .unwrap_or_else(|_| "HEAD".to_owned())
    });
    Comparison::new(base, head)
}

/// Parse a comparison spec into a `Comparison`. Forms:
/// - `a..b` — explicit base/head range (an empty side means `HEAD`, like git).
/// - `<rev>^!` — review just that one commit (git-native syntax).
/// - `snapshot:<ref>` — the full tree at a ref, diffed against the empty tree.
/// - a bare **branch or tag** — compared against the default branch.
/// - a bare **commit** (SHA, `HEAD`, `HEAD~n`) — reviewed on its own.
pub(crate) fn parse_comparison_spec(repo_path: &Path, spec: &str) -> Result<Comparison, String> {
    // Explicit range — no git resolution needed. An empty side means HEAD,
    // matching git's `a..` / `..b` shorthand.
    if let Some((base, head)) = spec.split_once("..") {
        let base = if base.is_empty() { "HEAD" } else { base };
        let head = if head.is_empty() { "HEAD" } else { head };
        return Ok(Comparison::new(base.to_owned(), head.to_owned()));
    }
    // Everything else resolves against the repo; build the source once and reuse it.
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    // "snapshot:<ref>" — full tree state at a ref, diffed against the empty tree
    // (every file shows as added). Empty-string base is the empty-tree convention.
    if let Some(rev) = spec.strip_prefix("snapshot:") {
        if rev.is_empty() {
            return Err("Specify a ref after 'snapshot:' (e.g. snapshot:HEAD)".to_owned());
        }
        return targets::snapshot_comparison(&source, rev).map_err(|e| e.to_string());
    }
    if let Some(rev) = spec.strip_suffix("^!") {
        if rev.is_empty() {
            return Err("Specify a commit before '^!' (e.g. abc123^!)".to_owned());
        }
        return targets::commit_comparison(&source, rev).map_err(|e| e.to_string());
    }
    // Single ref. A branch/tag name reviews that branch's work against the
    // default branch; a bare commit reviews just that commit.
    if !source.is_named_ref(spec) && source.resolve_ref(spec).is_some() {
        targets::commit_comparison(&source, spec).map_err(|e| e.to_string())
    } else {
        Ok(resolve_comparison_with(
            &source,
            None,
            Some(spec.to_owned()),
        ))
    }
}

// The working/staged/stash/commit/snapshot leaf resolvers live in
// `crate::service::targets` so the desktop app and HTTP server share them; these
// thin CLI wrappers just adapt the error type to `String`.

/// Resolve `<rev>` into a comparison covering just that commit (`parent..rev`).
pub(crate) fn resolve_commit_comparison(repo_path: &Path, rev: &str) -> Result<Comparison, String> {
    targets::resolve_target(
        repo_path,
        &ReviewTarget::Commit {
            rev: rev.to_owned(),
        },
    )
    .map_err(|e| e.to_string())
}

/// Resolve a "working tree" comparison: only the uncommitted changes (staged,
/// unstaged, and untracked) on the current branch.
pub(crate) fn resolve_working_comparison(repo_path: &Path) -> Result<Comparison, String> {
    targets::resolve_target(repo_path, &ReviewTarget::Working).map_err(|e| e.to_string())
}

/// Resolve a "staged" comparison: only the changes in the git index.
pub(crate) fn resolve_staged_comparison(repo_path: &Path) -> Result<Comparison, String> {
    targets::resolve_target(repo_path, &ReviewTarget::Staged).map_err(|e| e.to_string())
}

/// Resolve a "stash" comparison: a stash entry's changes vs its parent.
pub(crate) fn resolve_stash_comparison(repo_path: &Path, index: u32) -> Result<Comparison, String> {
    targets::resolve_target(repo_path, &ReviewTarget::Stash { index }).map_err(|e| e.to_string())
}

/// Resolve a "patch" comparison: apply a unified diff on top of HEAD in a
/// throwaway index and review the result as `HEAD..<patched-tree>`. `patch_src`
/// is a file path, or "-" to read the patch from stdin. CLI-only — the desktop
/// targets don't include patch.
pub(crate) fn resolve_patch_comparison(
    repo_path: &Path,
    patch_src: &str,
) -> Result<Comparison, String> {
    let patch = read_patch_input(patch_src)?;
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    let base = source.resolve_ref_or_empty_tree("HEAD");
    let tree = source
        .write_patched_tree(patch.as_bytes())
        .map_err(|e| format!("Patch does not apply on HEAD: {e}"))?;
    Ok(Comparison::new(base, tree))
}

/// Read a patch from a file path, or from stdin when `src` is "-".
fn read_patch_input(src: &str) -> Result<String, String> {
    if src == "-" {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| format!("Could not read patch from stdin: {e}"))?;
        Ok(buf)
    } else {
        std::fs::read_to_string(src).map_err(|e| format!("Could not read patch '{src}': {e}"))
    }
}

/// Path to the signal file used to communicate a repo path to the running app.
/// On macOS, `open -a` silently drops `--args` when the app is already running.
/// The CLI writes the requested repo path here, and the app reads it on reactivation.
fn open_request_path() -> PathBuf {
    let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    PathBuf::from(tmp).join("review-open-request")
}

/// Launch the Review desktop app for the given repo, optionally with a comparison and/or focused file.
fn open_app(
    repo_path: &str,
    comparison_key: Option<&str>,
    focused_file: Option<&str>,
) -> Result<(), String> {
    // Write a signal file with a timestamp, repo path, optional comparison key, and optional focused file.
    // Always write all 4 lines, using empty strings for missing optional values.
    // This is the reliable channel for the already-running case where
    // `open -a` activates the app but drops `--args`.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let signal_content = format!(
        "{now}\n{repo_path}\n{}\n{}",
        comparison_key.unwrap_or(""),
        focused_file.unwrap_or("")
    );
    let _ = std::fs::write(open_request_path(), signal_content);

    #[cfg(target_os = "macos")]
    {
        // Try to launch the app at the given path via `open -a`.
        // --args works for fresh launches; the signal file handles the rest.
        let try_open = |app_path: &Path| -> Option<()> {
            if !app_path.exists() {
                return None;
            }
            // Clean environment so the app doesn't inherit unwanted
            // variables from the caller (e.g. CLAUDECODE inside Claude Code).
            let mut cmd = Command::new("open");
            cmd.env_clear()
                .env("HOME", std::env::var("HOME").unwrap_or_default())
                .env("USER", std::env::var("USER").unwrap_or_default())
                .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");

            // Forward REVIEW_HOME so the app uses the same data directory
            if let Ok(review_home) = std::env::var("REVIEW_HOME") {
                cmd.env("REVIEW_HOME", review_home);
            }

            cmd.arg("-a").arg(app_path).arg("--args").arg(repo_path);

            // Only pass comparison key as an arg if present
            if let Some(key) = comparison_key {
                cmd.arg(key);
            }

            // Only pass focused file as an arg if present
            if let Some(file) = focused_file {
                cmd.arg(file);
            }

            let result = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();

            match result {
                Ok(status) if status.success() => Some(()),
                Ok(_) => {
                    eprintln!("open -a failed for {}", app_path.display());
                    None
                }
                Err(e) => {
                    eprintln!("Failed to run open -a {}: {}", app_path.display(), e);
                    None
                }
            }
        };

        // Common locations for the app bundle
        let home_apps = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Applications/Review.app"))
            .unwrap_or_default();
        let app_locations = [PathBuf::from("/Applications/Review.app"), home_apps];

        for app_path in &app_locations {
            if try_open(app_path).is_some() {
                println!("Opened Review app for {repo_path}");
                return Ok(());
            }
        }

        // Fallback: Try the development binary location
        let dev_app = std::env::current_exe().ok().and_then(|p| {
            p.parent()?
                .parent()
                .map(|p| p.join("bundle/macos/Review.app"))
        });
        if let Some(ref app_path) = dev_app {
            if try_open(app_path).is_some() {
                println!("Opened Review app for {repo_path}");
                return Ok(());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Try to find review in PATH or common locations
        let binary_names = ["review", "Review"];
        for name in &binary_names {
            if let Ok(status) = Command::new(name).arg(repo_path).status() {
                if status.success() {
                    println!("Opened Review for {}", repo_path);
                    return Ok(());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Try to find Review.exe
        if let Ok(status) = Command::new("Review.exe").arg(repo_path).status() {
            if status.success() {
                println!("Opened Review for {}", repo_path);
                return Ok(());
            }
        }
    }

    Err("Could not open Review app. Make sure it is installed and in your PATH.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as Cmd;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Cmd::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            // Isolate from the developer's global/system git config (e.g. forced
            // signed tags) so the tests are deterministic.
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    /// Temp repo with `first` (root) and `second` commits; returns (dir, first_sha, second_sha).
    fn two_commit_repo() -> (tempfile::TempDir, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "first"]);
        let first = git(p, &["rev-parse", "HEAD"]);
        std::fs::write(p.join("a.txt"), "one\ntwo\n").unwrap();
        git(p, &["commit", "-aqm", "second"]);
        let second = git(p, &["rev-parse", "HEAD"]);
        (dir, first, second)
    }

    #[test]
    fn commit_comparison_is_parent_to_commit() {
        let (dir, first, second) = two_commit_repo();
        let c = resolve_commit_comparison(dir.path(), &second).unwrap();
        assert_eq!(c.base, first);
        assert_eq!(c.head, second);
        assert_eq!(c.key, format!("{first}..{second}"));
    }

    #[test]
    fn root_commit_compares_against_empty_tree() {
        let (dir, first, _second) = two_commit_repo();
        let c = resolve_commit_comparison(dir.path(), &first).unwrap();
        assert_eq!(c.base, LocalGitSource::EMPTY_TREE);
        assert_eq!(c.head, first);
    }

    #[test]
    fn caret_bang_spec_resolves_to_commit() {
        let (dir, first, second) = two_commit_repo();
        let via_spec = parse_comparison_spec(dir.path(), &format!("{second}^!")).unwrap();
        let direct = resolve_commit_comparison(dir.path(), &second).unwrap();
        assert_eq!(via_spec.key, direct.key);
        assert_eq!(via_spec.base, first);
        assert_eq!(via_spec.head, second);
    }

    #[test]
    fn unknown_commit_errors() {
        let (dir, _first, _second) = two_commit_repo();
        assert!(resolve_commit_comparison(dir.path(), "deadbeef").is_err());
    }

    #[test]
    fn bare_commit_sha_reviews_that_commit() {
        let (dir, first, second) = two_commit_repo();
        let c = parse_comparison_spec(dir.path(), &second).unwrap();
        assert_eq!(c.base, first);
        assert_eq!(c.head, second);
    }

    #[test]
    fn bare_head_reviews_that_commit() {
        let (dir, first, second) = two_commit_repo();
        let c = parse_comparison_spec(dir.path(), "HEAD").unwrap();
        assert_eq!(c.base, first);
        assert_eq!(c.head, second);
    }

    #[test]
    fn bare_branch_compares_against_default() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        git(p, &["branch", "feature"]);
        let c = parse_comparison_spec(p, "feature").unwrap();
        // Branch name is kept verbatim as the head (not resolved to a SHA),
        // i.e. it took the default..branch path, not the single-commit path.
        assert_eq!(c.head, "feature");
        assert_ne!(c.base, c.head);
    }

    #[test]
    fn bare_tag_compares_against_default() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        git(p, &["tag", "v1.0.0"]);
        let c = parse_comparison_spec(p, "v1.0.0").unwrap();
        // Tag is a named ref → compared against the default branch, not reviewed alone.
        assert_eq!(c.head, "v1.0.0");
    }

    #[test]
    fn working_comparison_is_head_to_current_branch() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        let branch = git(p, &["rev-parse", "--abbrev-ref", "HEAD"]);
        let c = resolve_working_comparison(p).unwrap();
        assert_eq!(c.base, "HEAD");
        assert_eq!(c.head, branch);
    }

    #[test]
    fn working_diff_shows_only_uncommitted_changes() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        // "two" is already committed; "three" is a new uncommitted edit.
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        let c = resolve_working_comparison(p).unwrap();
        let source = LocalGitSource::new(p.to_path_buf()).unwrap();
        let diff = source.get_diff(&c, None).unwrap();
        assert!(
            diff.contains("+three"),
            "should show the uncommitted line:\n{diff}"
        );
        assert!(
            !diff.contains("+two"),
            "should not include committed history:\n{diff}"
        );
    }

    #[test]
    fn staged_diff_shows_only_staged_changes() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        // Stage "three", then leave a further unstaged edit that must NOT appear.
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(p, &["add", "a.txt"]);
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\nfour-unstaged\n").unwrap();
        let c = resolve_staged_comparison(p).unwrap();
        let source = LocalGitSource::new(p.to_path_buf()).unwrap();
        let diff = source.get_diff(&c, None).unwrap();
        assert!(
            diff.contains("+three"),
            "staged change should appear:\n{diff}"
        );
        assert!(
            !diff.contains("four-unstaged"),
            "unstaged change must not appear:\n{diff}"
        );
    }

    #[test]
    fn stash_diff_shows_stashed_changes() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        std::fs::write(p.join("a.txt"), "one\ntwo\nstashed\n").unwrap();
        git(p, &["stash"]);
        let c = resolve_stash_comparison(p, 0).unwrap();
        let source = LocalGitSource::new(p.to_path_buf()).unwrap();
        let diff = source.get_diff(&c, None).unwrap();
        assert!(
            diff.contains("+stashed"),
            "stashed change should appear:\n{diff}"
        );
    }

    #[test]
    fn missing_stash_errors() {
        let (dir, _first, _second) = two_commit_repo();
        assert!(resolve_stash_comparison(dir.path(), 0).is_err());
    }

    #[test]
    fn patch_comparison_applies_patch_on_head() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        // Generate a real patch via git (add a line), then revert the worktree.
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        let patch = git(p, &["diff"]);
        git(p, &["checkout", "--", "a.txt"]);
        let patch_file = p.join("change.patch");
        std::fs::write(&patch_file, format!("{patch}\n")).unwrap();

        let c = resolve_patch_comparison(p, patch_file.to_str().unwrap()).unwrap();
        let source = LocalGitSource::new(p.to_path_buf()).unwrap();
        let diff = source.get_diff(&c, None).unwrap();
        assert!(
            diff.contains("+three"),
            "patched result should show the added line:\n{diff}"
        );
    }

    #[test]
    fn patch_that_does_not_apply_errors() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        let patch_file = p.join("bad.patch");
        std::fs::write(
            &patch_file,
            "diff --git a/zzz.txt b/zzz.txt\n--- a/zzz.txt\n+++ b/zzz.txt\n@@ -1 +1 @@\n-nope\n+changed\n",
        )
        .unwrap();
        assert!(resolve_patch_comparison(p, patch_file.to_str().unwrap()).is_err());
    }

    #[test]
    fn dotdot_empty_side_means_head() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        assert_eq!(parse_comparison_spec(p, "main..").unwrap().head, "HEAD");
        assert_eq!(parse_comparison_spec(p, "..main").unwrap().base, "HEAD");
    }

    #[test]
    fn empty_caret_bang_and_snapshot_error() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        assert!(parse_comparison_spec(p, "^!").is_err());
        assert!(parse_comparison_spec(p, "snapshot:").is_err());
    }

    #[test]
    fn snapshot_spec_diffs_against_empty_tree() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, second) = two_commit_repo();
        let p = dir.path();
        let c = parse_comparison_spec(p, "snapshot:HEAD").unwrap();
        assert_eq!(c.base, "");
        assert_eq!(c.head, second);
        let source = LocalGitSource::new(p.to_path_buf()).unwrap();
        let diff = source.get_diff(&c, None).unwrap();
        // The whole file appears as added.
        assert!(
            diff.contains("new file"),
            "snapshot should add files:\n{diff}"
        );
        assert!(
            diff.contains("+one"),
            "full content shown as added:\n{diff}"
        );
    }
}
