use crate::review::state::HunkStatus;
use crate::review::storage;
use crate::service::targets::{self, BaseReason, ResolvedReview};
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

mod comments;
mod common;
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

        /// Review spec: a ref (a branch — vs the default branch; a tag or bare
        /// commit — reviewed on its own); "base..ref" to pin the base;
        /// "<rev>^!" (a single commit); or "snapshot:<rev>". Defaults to the
        /// current branch.
        spec: Option<String>,

        /// Pin the base ref to diff against (defaults to the derived base)
        #[arg(long)]
        old: Option<String>,

        /// The ref to review (defaults to the current branch)
        #[arg(long)]
        new: Option<String>,

        /// Review just this one commit (its diff against its parent)
        #[arg(long, value_name = "REV", conflicts_with_all = ["spec", "old", "new"])]
        commit: Option<String>,

        /// Review the current branch (sugar; the base is derived by the ladder).
        #[arg(long, conflicts_with_all = ["spec", "old", "new", "commit"])]
        working: bool,

        /// Review a stash entry's changes (defaults to the most recent, stash@{0}).
        #[arg(
            long,
            value_name = "N",
            num_args = 0..=1,
            default_missing_value = "0",
            conflicts_with_all = ["spec", "old", "new", "commit", "working"]
        )]
        stash: Option<u32>,

        /// Review a unified-diff patch applied on top of HEAD ("-" reads stdin).
        #[arg(
            long,
            value_name = "FILE",
            conflicts_with_all = ["spec", "old", "new", "commit", "working", "stash"]
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

    /// Show review progress for a comparison
    Status(review_state::StatusArgs),

    /// List saved reviews
    List(review_state::ListArgs),

    /// Delete a saved review
    Delete(review_state::DeleteArgs),

    /// Pin (or clear) a review's base override — a derived setting, not identity
    ChangeBase(review_state::ChangeBaseArgs),

    /// Inspect or edit the trust list
    Trust(review_state::TrustArgs),

    /// Read or edit review notes
    Note(review_state::NoteArgs),

    /// List line-level comments on a comparison
    Comments(comments::CommentsArgs),

    /// Add, edit, resolve, or delete a line-level comment
    Comment(comments::CommentArgs),

    /// Show, author, or clear the review guide (an agent-authored hunk grouping)
    Guide(guide::GuideArgs),

    /// Print a `review://` deep link for a file or hunk
    Url(url::UrlArgs),

    /// Install the review-guide skill for Claude Code and Codex
    Skill(skill::SkillArgs),

    /// Set (or show/clear) the default comparison so commands don't need `-s`
    Use(UseArgs),
}

/// `review use [spec]` — the repo's stored default comparison. With a spec,
/// set it; with `--clear`, remove it; with neither, show it. Every data
/// command falls back to this when `--spec`/`$REVIEW_SPEC` are absent.
#[derive(Debug, clap::Args)]
pub struct UseArgs {
    /// Repository path (defaults to the current directory)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// Comparison spec to make the default (omit to show the current default)
    pub spec: Option<String>,
    /// Clear the stored default comparison
    #[arg(long, conflicts_with = "spec")]
    pub clear: bool,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// Get the repository path from an explicit `--repo` flag, or walk up from cwd.
pub(crate) fn get_repo_path(repo: &Option<String>) -> Result<String, String> {
    if let Some(ref repo) = repo {
        return Ok(repo.clone());
    }

    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    crate::service::util::find_repo_root(&cwd)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Not a git repository. Use --repo to specify a repository path.".to_owned())
}

/// `review use` — get, set, or clear the repo's default comparison.
fn run_use(args: UseArgs) -> Result<(), String> {
    use serde_json::json;
    let repo = PathBuf::from(get_repo_path(&args.repo)?);

    if args.clear {
        let had = storage::clear_default_spec(&repo).map_err(|e| e.to_string())?;
        if args.json {
            common::print_json(&json!({ "cleared": had, "default": null }));
        } else if had {
            println!("Cleared the default comparison.");
        } else {
            println!("No default comparison was set.");
        }
        return Ok(());
    }

    match args.spec {
        Some(spec) => {
            // Validate that the spec parses before storing it, so `review use`
            // can't leave every later command pointed at an unparseable ref.
            let (ref_name, _base) = parse_review_spec(&spec)?;
            storage::write_default_spec(&repo, &spec).map_err(|e| e.to_string())?;
            if args.json {
                common::print_json(&json!({ "default": spec, "ref": ref_name }));
            } else {
                println!("Default comparison set to {spec} (ref {ref_name}).");
                println!("Commands now target it without `-s`; `review use --clear` to undo.");
            }
        }
        None => {
            let current = storage::read_default_spec(&repo);
            if args.json {
                common::print_json(&json!({ "default": current }));
            } else {
                match current {
                    Some(spec) => println!("Default comparison: {spec}"),
                    None => println!("No default comparison set (using auto-detection)."),
                }
            }
        }
    }
    Ok(())
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
        Some(p) => resolve_absolute(Path::new(&p))?,
        None => std::env::current_dir().map_err(|e| e.to_string())?,
    };

    Ok(crate::service::util::resolve_open_target(&target))
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
            stash,
            patch,
        }) => run_start(
            repo,
            StartTarget::from_args(spec, old, new, commit, working, stash, patch),
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
        Some(Commands::Status(args)) => review_state::run_status(args),
        Some(Commands::List(args)) => review_state::run_list(args),
        Some(Commands::Delete(args)) => review_state::run_delete(args),
        Some(Commands::ChangeBase(args)) => review_state::run_change_base(args),
        Some(Commands::Trust(args)) => review_state::run_trust(args),
        Some(Commands::Note(args)) => review_state::run_note(args),
        Some(Commands::Comments(mut args)) => match args.action.take() {
            Some(comments::CommentsAction::Submit(a)) => {
                comments::run_submit_comments(args.target, a)
            }
            None => comments::run_comments(args),
        },
        Some(Commands::Comment(args)) => match args.action {
            comments::CommentAction::Add(a) => comments::run_add(args.target, a),
            comments::CommentAction::Edit(a) => comments::run_edit(args.target, a),
            comments::CommentAction::Resolve(a) => comments::run_resolve(args.target, a),
            comments::CommentAction::Unresolve(a) => comments::run_unresolve(args.target, a),
            comments::CommentAction::Delete(a) => comments::run_delete(args.target, a),
        },
        Some(Commands::Guide(args)) => match args.action {
            guide::GuideAction::Show(a) => guide::run_show(a),
            guide::GuideAction::Add(a) => guide::run_add(a),
            guide::GuideAction::Clear(a) => guide::run_clear(a),
        },
        Some(Commands::Url(args)) => url::run_url(args),
        Some(Commands::Skill(args)) => skill::run_skill(args),
        Some(Commands::Use(args)) => run_use(args),
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

/// `review [path]` — open a path in the app.
///
/// Opening a repo root (no specific file) lands on the current branch's review
/// — base derived by the ladder — so `review .` in a worktree or feature branch
/// shows that branch's review, matching `review start` and launching the app in
/// the repo. On the default branch the comparison is degenerate (base == head,
/// nothing to diff), so we fall back to browse mode, which still has the file
/// tree to show. A specific file also opens in browse mode, focused on that file.
fn run_open(path: Option<String>, has_home_override: bool) -> Result<(), String> {
    let (repo_path, focused_file) = resolve_open_path(path)?;

    let review = if focused_file.is_none() {
        default_open_review(&repo_path)
    } else {
        None
    };

    if let Some(review) = &review {
        // Persist the review so it shows up under its parent in the sidebar,
        // mirroring `review start`. Best-effort — a failure here shouldn't stop
        // the app from opening.
        let _ = storage::ensure_review_exists(
            Path::new(&repo_path),
            &review.ref_name,
            review.base_override.clone(),
            None,
        );
    }

    open_app(
        &repo_path,
        review.as_ref().map(|r| r.ref_name.as_str()),
        focused_file.as_deref(),
    )?;
    warn_home_override(has_home_override);
    Ok(())
}

/// The review `review [path]` opens a repo root to: the current branch, its
/// base derived by the resolution ladder. Returns `None` when `repo_path` isn't
/// a git repo or there's nothing to diff, so the caller falls back to browse
/// mode rather than opening an empty review. "Nothing to diff" means base ==
/// head (on the default branch), or the default branch couldn't be detected —
/// the ladder then yields a `"HEAD"` base, which is the current commit, so the
/// diff would be empty.
fn default_open_review(repo_path: &str) -> Option<ResolvedReview> {
    let path = Path::new(repo_path);
    let ref_name = auto_detect_ref(path).ok()?;
    let review = targets::resolve(path, &ref_name, None).ok()?;
    if review.comparison.base == review.comparison.head || review.comparison.base == "HEAD" {
        return None;
    }
    Some(review)
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
        stash: Option<u32>,
        patch: Option<String>,
    ) -> Self {
        if working {
            StartTarget::Working
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

    fn resolve(self, repo_path: &Path) -> Result<ResolvedReview, String> {
        match self {
            // `--working` is now pure sugar for "review the current branch": the
            // ladder derives its base (default branch, or the remote tip when
            // you're on the default branch itself).
            StartTarget::Working => {
                resolve_ref_review(repo_path, &auto_detect_ref(repo_path)?, None)
            }
            StartTarget::Stash(n) => resolve_ref_review(repo_path, &format!("stash@{{{n}}}"), None),
            StartTarget::Patch(src) => resolve_patch_review(repo_path, &src),
            // Pin the commit's SHA as the ref so the review is stable even as
            // HEAD/branches move; the ladder reviews it as `sha^..sha`.
            StartTarget::Commit(rev) => {
                let sha = resolve_ref_sha(repo_path, &rev)?;
                resolve_ref_review(repo_path, &sha, None)
            }
            StartTarget::Spec(spec) => {
                let (ref_name, base) = parse_review_spec(&spec)?;
                resolve_ref_review(repo_path, &ref_name, base)
            }
            StartTarget::Compare { old, new } => {
                let ref_name = match new {
                    Some(new) => new,
                    None => auto_detect_ref(repo_path)?,
                };
                resolve_ref_review(repo_path, &ref_name, old)
            }
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
    let review = target.resolve(&path)?;
    storage::ensure_review_exists(&path, &review.ref_name, review.base_override.clone(), None)
        .map_err(|e| e.to_string())?;
    open_app(&repo_path, Some(&review.ref_name), None)?;
    warn_home_override(has_home_override);
    Ok(())
}

/// The current branch — the ref a spec-less command reviews. Falls back to
/// `HEAD` (detached) when there's no current branch.
pub(crate) fn auto_detect_ref(repo_path: &Path) -> Result<String, String> {
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    Ok(source
        .get_current_branch()
        .unwrap_or_else(|_| "HEAD".to_owned()))
}

/// Resolve a `ref` (+ optional base override) into a [`ResolvedReview`] via the
/// shared base-resolution ladder.
pub(crate) fn resolve_ref_review(
    repo_path: &Path,
    ref_name: &str,
    base_override: Option<String>,
) -> Result<ResolvedReview, String> {
    targets::resolve(repo_path, ref_name, base_override.as_deref()).map_err(|e| e.to_string())
}

/// Resolve a revspec to a concrete SHA, erroring if it doesn't resolve.
fn resolve_ref_sha(repo_path: &Path, rev: &str) -> Result<String, String> {
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    source
        .resolve_ref(rev)
        .ok_or_else(|| format!("Could not resolve '{rev}'"))
}

/// Parse a review spec into a `(ref, base_override?)` pair. The base is a
/// derived setting, not identity, so most specs yield `None` and let the ladder
/// derive it. Forms:
/// - `<ref>` → `(ref, None)` — a branch (vs the default branch), a tag or SHA
///   (reviewed as a single commit), etc. — the ladder decides.
/// - `<base>..<ref>` → `(ref, Some(base))` — pin the base (empty side means
///   `HEAD`, like git's `a..` / `..b`).
/// - `<rev>^!` → `(rev, None)` — review that one commit (the ladder's
///   single-commit rule yields `rev^..rev`).
/// - `snapshot:<rev>` → `(rev, Some(""))` — the full tree at a rev, diffed
///   against the empty tree (empty-string base is the empty-tree convention).
pub(crate) fn parse_review_spec(spec: &str) -> Result<(String, Option<String>), String> {
    // Explicit range — an empty side means HEAD, matching git's `a..` / `..b`.
    if let Some((base, head)) = spec.split_once("..") {
        let base = if base.is_empty() { "HEAD" } else { base };
        let head = if head.is_empty() { "HEAD" } else { head };
        return Ok((head.to_owned(), Some(base.to_owned())));
    }
    if let Some(rev) = spec.strip_prefix("snapshot:") {
        if rev.is_empty() {
            return Err("Specify a ref after 'snapshot:' (e.g. snapshot:HEAD)".to_owned());
        }
        return Ok((rev.to_owned(), Some(String::new())));
    }
    if let Some(rev) = spec.strip_suffix("^!") {
        if rev.is_empty() {
            return Err("Specify a commit before '^!' (e.g. abc123^!)".to_owned());
        }
        return Ok((rev.to_owned(), None));
    }
    Ok((spec.to_owned(), None))
}

/// Resolve a "patch" review: apply a unified diff on top of HEAD in a throwaway
/// index and review the result as `HEAD..<patched-tree>`, keyed by the patched
/// tree's SHA. `patch_src` is a file path, or "-" to read the patch from stdin.
/// CLI-only — the ladder has no patch rule, so the comparison is built directly.
fn resolve_patch_review(repo_path: &Path, patch_src: &str) -> Result<ResolvedReview, String> {
    let patch = read_patch_input(patch_src)?;
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    let base = source.resolve_ref_or_empty_tree("HEAD");
    let tree = source
        .write_patched_tree(patch.as_bytes())
        .map_err(|e| format!("Patch does not apply on HEAD: {e}"))?;
    Ok(ResolvedReview {
        ref_name: tree.clone(),
        base_override: Some(base.clone()),
        comparison: Comparison::new(base, tree),
        // A patch pins an explicit base, so it reads as an override.
        base_reason: BaseReason::Override,
        ahead_count: None,
    })
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

/// Launch the Review desktop app for the given repo, optionally with a review ref and/or focused file.
fn open_app(
    repo_path: &str,
    review_ref: Option<&str>,
    focused_file: Option<&str>,
) -> Result<(), String> {
    // Write a signal file with a timestamp, repo path, optional review ref, and optional focused file.
    // Always write all 4 lines, using empty strings for missing optional values.
    // This is the reliable channel for the already-running case where
    // `open -a` activates the app but drops `--args`.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let signal_content = format!(
        "{now}\n{repo_path}\n{}\n{}",
        review_ref.unwrap_or(""),
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

            // Only pass the review ref as an arg if present
            if let Some(review_ref) = review_ref {
                cmd.arg(review_ref);
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

    /// Resolve a spec string the way a data command does: parse it to
    /// `(ref, base?)` and run the ladder. Panics on error (test-only).
    fn resolve_spec(dir: &Path, spec: &str) -> Comparison {
        let (ref_name, base) = parse_review_spec(spec).unwrap();
        targets::resolve(dir, &ref_name, base.as_deref())
            .unwrap()
            .comparison
    }

    /// Resolve a `review start` target to its comparison (test-only).
    fn start_comparison(dir: &Path, target: StartTarget) -> Comparison {
        target.resolve(dir).unwrap().comparison
    }

    #[test]
    fn parse_review_spec_sugar_table() {
        // Bare ref → no base (the ladder derives it).
        assert_eq!(
            parse_review_spec("feature").unwrap(),
            ("feature".into(), None)
        );
        // Explicit range → pinned base.
        assert_eq!(
            parse_review_spec("main..feature").unwrap(),
            ("feature".into(), Some("main".into()))
        );
        // Empty sides mean HEAD, like git.
        assert_eq!(
            parse_review_spec("main..").unwrap(),
            ("HEAD".into(), Some("main".into()))
        );
        assert_eq!(
            parse_review_spec("..feature").unwrap(),
            ("feature".into(), Some("HEAD".into()))
        );
        // `^!` → single-commit review (base derived by the ladder).
        assert_eq!(
            parse_review_spec("abc123^!").unwrap(),
            ("abc123".into(), None)
        );
        // snapshot → empty-tree base.
        assert_eq!(
            parse_review_spec("snapshot:HEAD").unwrap(),
            ("HEAD".into(), Some(String::new()))
        );
        // Degenerate forms error.
        assert!(parse_review_spec("^!").is_err());
        assert!(parse_review_spec("snapshot:").is_err());
    }

    #[test]
    fn commit_ref_is_parent_to_commit() {
        let (dir, first, second) = two_commit_repo();
        let c = start_comparison(dir.path(), StartTarget::Commit(second.clone()));
        assert_eq!(c.base, first);
        assert_eq!(c.head, second);
        assert_eq!(c.key, format!("{first}..{second}"));
    }

    #[test]
    fn root_commit_compares_against_empty_tree() {
        let (dir, first, _second) = two_commit_repo();
        let c = start_comparison(dir.path(), StartTarget::Commit(first.clone()));
        assert_eq!(c.base, LocalGitSource::EMPTY_TREE);
        assert_eq!(c.head, first);
    }

    #[test]
    fn caret_bang_spec_resolves_to_commit() {
        let (dir, first, second) = two_commit_repo();
        let via_spec = resolve_spec(dir.path(), &format!("{second}^!"));
        let direct = start_comparison(dir.path(), StartTarget::Commit(second.clone()));
        assert_eq!(via_spec.key, direct.key);
        assert_eq!(via_spec.base, first);
        assert_eq!(via_spec.head, second);
    }

    #[test]
    fn unknown_commit_errors() {
        let (dir, _first, _second) = two_commit_repo();
        assert!(StartTarget::Commit("deadbeef".to_owned())
            .resolve(dir.path())
            .is_err());
    }

    #[test]
    fn bare_commit_sha_reviews_that_commit() {
        let (dir, first, second) = two_commit_repo();
        let c = resolve_spec(dir.path(), &second);
        assert_eq!(c.base, first);
        assert_eq!(c.head, second);
    }

    #[test]
    fn bare_head_reviews_that_commit() {
        // HEAD is not a branch, so the ladder reviews it as a single commit:
        // parent..HEAD. The head stays the literal ref "HEAD".
        let (dir, first, _second) = two_commit_repo();
        let c = resolve_spec(dir.path(), "HEAD");
        assert_eq!(c.base, first);
        assert_eq!(c.head, "HEAD");
    }

    #[test]
    fn bare_branch_compares_against_default() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        git(p, &["branch", "feature"]);
        let c = resolve_spec(p, "feature");
        // Branch name is kept verbatim as the head (not resolved to a SHA),
        // i.e. it took the default..branch path, not the single-commit path.
        assert_eq!(c.head, "feature");
        assert_ne!(c.base, c.head);
    }

    #[test]
    fn bare_tag_reviews_that_commit() {
        let (dir, first, _second) = two_commit_repo();
        let p = dir.path();
        git(p, &["tag", "v1.0.0"]);
        let c = resolve_spec(p, "v1.0.0");
        // A tag is not a branch, so it falls through to the single-commit rule:
        // the tag's parent .. the tag (not vs the default branch).
        assert_eq!(c.head, "v1.0.0");
        assert_eq!(c.base, first);
    }

    #[test]
    fn open_on_default_branch_is_browse() {
        // On the default branch base == head, so there is nothing to diff and
        // `review .` falls back to browse mode (None).
        let (dir, _first, _second) = two_commit_repo();
        assert!(default_open_review(&dir.path().to_string_lossy()).is_none());
    }

    #[test]
    fn open_on_feature_branch_opens_default_to_branch_review() {
        // On a feature branch (as in a worktree), `review .` opens the
        // default..branch review rather than browse mode.
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        let default_branch = git(p, &["rev-parse", "--abbrev-ref", "HEAD"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        let review =
            default_open_review(&p.to_string_lossy()).expect("feature branch should open a review");
        assert_eq!(review.ref_name, "feature");
        let c = review.comparison;
        assert_eq!(c.base, default_branch);
        assert_eq!(c.head, "feature");
        assert_eq!(c.key, format!("{default_branch}..feature"));
    }

    #[test]
    fn open_non_git_path_is_browse() {
        // A path that isn't a git repo has no comparison — browse mode (None).
        let dir = tempfile::tempdir().unwrap();
        assert!(default_open_review(&dir.path().to_string_lossy()).is_none());
    }

    #[test]
    fn open_without_detectable_default_branch_is_browse() {
        // No origin and no main/master ref → default-branch detection falls
        // back to "HEAD" (the current commit), so there's nothing to diff and
        // the open lands on browse mode rather than an empty review.
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        git(p, &["branch", "-m", "trunk"]); // rename default away from main/master
        assert!(default_open_review(&p.to_string_lossy()).is_none());
    }

    #[test]
    fn working_reviews_the_current_branch() {
        // `--working` is sugar for the current branch. On the default branch the
        // ladder yields HEAD..branch (working-tree changes only).
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        let branch = git(p, &["rev-parse", "--abbrev-ref", "HEAD"]);
        let c = start_comparison(p, StartTarget::Working);
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
        let c = start_comparison(p, StartTarget::Working);
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
    fn stash_diff_shows_stashed_changes() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        std::fs::write(p.join("a.txt"), "one\ntwo\nstashed\n").unwrap();
        git(p, &["stash"]);
        let c = start_comparison(p, StartTarget::Stash(0));
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
        assert!(StartTarget::Stash(0).resolve(dir.path()).is_err());
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

        let c = start_comparison(
            p,
            StartTarget::Patch(patch_file.to_str().unwrap().to_owned()),
        );
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
        assert!(StartTarget::Patch(patch_file.to_str().unwrap().to_owned())
            .resolve(p)
            .is_err());
    }

    #[test]
    fn dotdot_empty_side_means_head() {
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        assert_eq!(resolve_spec(p, "main..").head, "HEAD");
        assert_eq!(resolve_spec(p, "..main").base, "HEAD");
    }

    #[test]
    fn snapshot_spec_diffs_against_empty_tree() {
        use crate::sources::traits::DiffSource;
        let (dir, _first, _second) = two_commit_repo();
        let p = dir.path();
        let c = resolve_spec(p, "snapshot:HEAD");
        assert_eq!(c.base, "");
        // The head stays the literal ref "HEAD"; the empty-tree base makes the
        // whole tree show as added.
        assert_eq!(c.head, "HEAD");
        let source = LocalGitSource::new(p.to_path_buf()).unwrap();
        let diff = source.get_diff(&c, None).unwrap();
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
