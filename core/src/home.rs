//! Centralized review state storage.
//!
//! Stores all review data in `~/.spur/` (or `$SPUR_HOME`) so that
//! reviews from every repository are accessible system-wide.
//!
//! Layout — split by durability so the disposable tier can be cleared without
//! risking durable state:
//! ```text
//! ~/.spur/
//!   index.json                        # repo_id -> { path, name, last_accessed }
//!   repos/                            # DURABLE — never delete to reclaim space
//!     <repo-id>/
//!       repo.json                     # { canonical_path, display_name }
//!       reviews/
//!         <comparison-key>.json       # ReviewState (carries schemaVersion)
//!   cache/                            # DISPOSABLE — safe to `rm -rf` anytime
//!     <repo-id>/
//!       hunk-cache/<comparison-key>.json
//!       symbol-cache/<comparison-key>.json
//!   worktrees/<repo-id>/              # Review-managed git worktrees
//!   settings.json                     # desktop UI preferences
//!   viewer_prs.json                   # DISPOSABLE — last GitHub PR snapshot
//! ```
//!
//! `repo-id` is a 16-hex hash of the git **common dir**, so a repository and
//! all of its worktrees share one id (see [`compute_repo_id`]).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CentralError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Could not determine home directory")]
    Home,
}

/// A single entry in the repo index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoIndexEntry {
    pub repo_id: String,
    pub path: String,
    pub name: String,
    pub last_accessed: String,
}

/// The full repo index stored at `~/.spur/index.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoIndex {
    pub repos: HashMap<String, RepoIndexEntry>,
}

/// Sanitize a string for use as a filename or directory name.
/// Replaces characters that are problematic in file paths: `/\:*?"<>|` → `_`.
pub fn sanitize_path_component(name: &str) -> String {
    name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}

/// The central storage root when nothing overrides it: `~/.spur/`.
///
/// Its own function because two questions need it — "where do I store things?"
/// and "am I the default instance?" ([`open_request_name`]) — and a second
/// spelling of `.review` is a second answer waiting to drift.
pub fn default_central_root() -> Result<PathBuf, CentralError> {
    let home = dirs::home_dir().ok_or(CentralError::Home)?;
    Ok(home.join(".spur"))
}

/// The home this app used when it was called Review.
///
/// Kept for exactly one purpose — moving it aside on first run. Nothing reads
/// from it, and nothing should: a second live root is a second answer to
/// "where is my state?".
const LEGACY_CENTRAL_DIR: &str = ".review";

/// The queue file's name before workspaces got their own noun.
const LEGACY_WORKSPACES_FILE: &str = "work.json";

/// Move a pre-rename `~/.review` into place as `~/.spur`.
///
/// **Call this once, from a binary's startup — never from library code.** It is
/// a filesystem move, and hanging it off [`get_central_root`] would make every
/// path lookup destructive: any test that resolves the default home with
/// `$SPUR_HOME` unset would migrate the developer's own live data out from
/// under a running app. That is not hypothetical — it is why this is a separate
/// function rather than a step inside the resolver.
///
/// Fires only when `~/.spur` does not exist and `~/.review` does, so a fresh
/// install and every run after the first both no-op. `rename` is atomic and
/// same-filesystem by construction (both sit in `$HOME`), so two Spur processes
/// racing at login end with one winning and the other failing harmlessly — its
/// precondition, "no `~/.spur`", no longer holds.
///
/// Honours `$SPUR_HOME`: an instance pointed somewhere else is not the default
/// home and has nothing to migrate.
///
/// A failure is logged, not fatal. Refusing to start over a directory the user
/// can move by hand would be the worse trade.
pub fn migrate_legacy_home() {
    // Only the default home adopts `~/.review`; an instance pointed elsewhere
    // is not the app the old one turned into.
    if std::env::var_os("SPUR_HOME").is_none() {
        if let (Ok(target), Some(legacy)) = (
            default_central_root(),
            dirs::home_dir().map(|h| h.join(LEGACY_CENTRAL_DIR)),
        ) {
            adopt_legacy_home(&legacy, &target, legacy_app_is_running());
        }
    }
    // Whatever home we ended up with, the queue file inside it may predate the
    // rename. Runs for a `$SPUR_HOME` dev instance too — that file was written
    // by the same builds.
    if let Ok(root) = get_central_root() {
        adopt_legacy_workspaces_file(&root);
    }
}

/// Is a pre-rename desktop app still running?
///
/// This, and not a live daemon, is what the migration must refuse to move
/// beneath. An app that is still up recreates the home the moment it writes,
/// and then holds a queue nobody else can see — two homes, both half right.
///
/// A live *daemon* is the opposite case and must not block: it owns PTYs, never
/// writes the queue, and its socket travels with the rename by inode, so the
/// new app finds it, sees a protocol-compatible build, and keeps every session
/// running (`attach_decision` → `AttachSkewed`). Blocking on it would mean
/// choosing between migrating and keeping the user's shells, and there is no
/// reason to make anyone choose.
///
/// Asked with `pgrep`, because the old app left no lock to check. The pattern
/// is case-sensitive on purpose: `MacOS/Review` is the app, `MacOS/review-daemon`
/// is not. A false positive only delays the migration to the next launch; a
/// false negative is the split above, so the loose end is the safe one.
fn legacy_app_is_running() -> bool {
    std::process::Command::new("pgrep")
        .arg("-f")
        .arg("Review.app/Contents/MacOS/Review")
        .output()
        .is_ok_and(|out| out.status.success() && !out.stdout.trim_ascii().is_empty())
}

/// Move a pre-rename `~/.review` into place as `~/.spur`.
///
/// Takes both paths rather than deriving them so the rule can be tested against
/// temporary directories — the one piece of this file that must never be
/// exercised against a real `$HOME`.
fn adopt_legacy_home(legacy: &Path, target: &Path, app_running: bool) {
    if target.exists() {
        return;
    }
    if !legacy.exists() {
        return;
    }
    // The one thing that must never happen: moving the directory out from under
    // a running Review.app, which then recreates it empty and writes a fresh
    // queue into the husk.
    if app_running {
        log::warn!(
            "{} is still in use by a running Review app — not migrating. \
             Quit Review and start Spur again to bring your queue and reviews \
             across; any terminals it left running will come with them.",
            legacy.display()
        );
        return;
    }
    match fs::rename(legacy, target) {
        Ok(()) => log::info!(
            "Moved {} to {} — the app is Spur now.",
            legacy.display(),
            target.display()
        ),
        Err(e) => log::warn!(
            "Could not move {} to {}: {e}. Spur is starting with empty state; \
             move that directory by hand to keep your queue and reviews.",
            legacy.display(),
            target.display()
        ),
    }
}

/// Rename a pre-rename `work.json` to `workspaces.json` inside a home.
///
/// Separate from the directory move because the two are independent: a home
/// that was already `~/.spur` still holds a `work.json`, and a freshly adopted
/// `~/.review` holds one too.
fn adopt_legacy_workspaces_file(root: &Path) {
    let current = root.join("workspaces.json");
    if current.exists() {
        return;
    }
    let legacy = root.join(LEGACY_WORKSPACES_FILE);
    if !legacy.exists() {
        return;
    }
    match fs::rename(&legacy, &current) {
        Ok(()) => log::info!("Renamed {} to {}.", legacy.display(), current.display()),
        Err(e) => log::warn!(
            "Could not rename {} to {}: {e}. Spur will start with an empty queue.",
            legacy.display(),
            current.display()
        ),
    }
}

/// Return the central storage root.
///
/// Uses `$SPUR_HOME` if set, otherwise `~/.spur/`. Pure: resolving a path never
/// touches the filesystem — see [`migrate_legacy_home`].
pub fn get_central_root() -> Result<PathBuf, CentralError> {
    if let Ok(spur_home) = std::env::var("SPUR_HOME") {
        return Ok(PathBuf::from(spur_home));
    }
    default_central_root()
}

/// The central storage root as the filesystem reports it — what a watcher must
/// compare its events against.
///
/// `notify`/FSEvents deliver *resolved* paths. On macOS `/tmp` is a symlink to
/// `/private/tmp`, so a `$SPUR_HOME=/tmp/spur-dev` — the documented dev
/// setup — has its `workspaces.json` arrive as `/private/tmp/spur-dev/workspaces.json`,
/// which matches neither the parent-equality nor the `strip_prefix` check in
/// `categorize_change`. The queue's own saves then read as working-tree edits:
/// no `work-changed` at all, and a spurious full diff refetch on every one.
///
/// Falls back to the unresolved path when the root doesn't exist yet, which
/// behaves exactly as before.
pub fn canonical_central_root() -> Result<PathBuf, CentralError> {
    Ok(canonical_path(&get_central_root()?))
}

/// The file name both sides of the signal use for the default review home.
const OPEN_REQUEST_NAME: &str = "spur-open-request";

/// The CLI→app "open this repo" signal file.
///
/// Scoped per review home: a `$SPUR_HOME` dev instance and the released app
/// must not be able to steer each other, so a custom home hashes into the file
/// name. The default home keeps the historical bare name — released binaries
/// on both sides of the file already agree on it.
pub fn open_request_path() -> PathBuf {
    let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    PathBuf::from(tmp).join(open_request_name())
}

/// What one side is asking the other to open.
///
/// The payload of the only IPC these two processes have, so it lives beside the
/// path rather than being spelled out at each end — the CLI wrote four lines and
/// the desktop five, agreeing only because the reader happened to treat a
/// missing line as absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenRequest {
    pub repo_path: String,
    pub ref_name: Option<String>,
    pub focused_file: Option<String>,
    pub focused_hunk_hash: Option<String>,
}

/// How long a request stays worth acting on.
///
/// The file is a doorbell, not a queue: it is written immediately before the
/// app is asked to come forward, so anything older than this is the leftover of
/// a run that crashed or never reached the app, and opening whatever it names
/// would yank the human off what they are doing now.
const OPEN_REQUEST_TTL: Duration = Duration::from_secs(30);

/// Write the signal file. Five lines — a timestamp and all four fields, empty
/// for the ones that are absent — because [`read_open_request`] locates a field
/// by its line.
///
/// The error is returned rather than swallowed: on macOS `open -a` drops
/// `--args` for an app that is already running, so this file *is* the channel in
/// the common case, and a caller that reported success over a failed write would
/// send someone looking for a repo the app never heard about.
pub fn write_open_request(request: &OpenRequest) -> io::Result<()> {
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let content = format!(
        "{now}\n{}\n{}\n{}\n{}",
        request.repo_path,
        request.ref_name.as_deref().unwrap_or(""),
        request.focused_file.as_deref().unwrap_or(""),
        request.focused_hunk_hash.as_deref().unwrap_or(""),
    );
    fs::write(open_request_path(), content)
}

/// Read and delete the signal file, if it holds a request worth acting on.
///
/// Deleting on read — before the staleness check, and whatever the outcome — is
/// what keeps one ring from being answered twice, and what stops a malformed or
/// expired file sitting in `$TMPDIR` being re-examined on every activation.
///
/// Tolerant of a short file: a build that wrote fewer lines than this one reads
/// is missing fields, not unreadable.
pub fn read_open_request() -> Option<OpenRequest> {
    let path = open_request_path();
    let content = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);

    let mut lines = content.lines();
    let timestamp: u64 = lines.next()?.parse().ok()?;
    let repo_path = lines.next()?.trim().to_owned();
    let mut next_optional = || {
        lines
            .next()
            .map(|line| line.trim().to_owned())
            .filter(|line| !line.is_empty())
    };
    let request = OpenRequest {
        repo_path,
        ref_name: next_optional(),
        focused_file: next_optional(),
        focused_hunk_hash: next_optional(),
    };

    let age = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(timestamp);
    if age > OPEN_REQUEST_TTL.as_secs() || request.repo_path.is_empty() {
        return None;
    }
    Some(request)
}

/// Which name this process writes and reads, keyed on the **resolved** review
/// home rather than on whether `SPUR_HOME` happens to be set.
///
/// That distinction is the whole of it, and getting it wrong broke `review .`
/// outright: the app pins `SPUR_HOME=~/.spur` on the daemon it spawns and
/// every PTY inherits it, so a shell *inside* the app has the variable set to
/// the default home. Keyed on "is it set", that shell wrote a hashed name while
/// Spur.app — launched from Finder with no environment at all — went on
/// reading the bare one. Two processes pointed at one directory, passing on
/// different channels.
///
/// Both halves of the comparison run through [`canonical_path`] for the reason
/// [`canonical_central_root`] documents: `$SPUR_HOME=/tmp/spur-dev` is the
/// documented dev setup, and on macOS that is the same directory as
/// `/private/tmp/spur-dev`. Spelling a home two ways must not hand its two
/// processes two channels either — which also means the hashed name is derived
/// from the resolved path, so a dev instance's name moves once, on the build
/// that fixes this.
///
/// The default home keeping the unhashed name is a **compatibility
/// concession**, not a claim that it is special: hashing it too would be the
/// cleaner rule, but it would break every installed CLI/app pair for as long as
/// one half is upgraded and the other isn't — and that is the pair almost
/// everybody has. There is nothing to say for the bare name beyond "released
/// binaries already agree on it", which is enough.
fn open_request_name() -> String {
    let Ok(root) = get_central_root() else {
        // No home to resolve is not a reason to invent a private channel; the
        // bare name is what every other process without one is using.
        return OPEN_REQUEST_NAME.to_owned();
    };
    let root = canonical_path(&root);
    if default_central_root().is_ok_and(|default| canonical_path(&default) == root) {
        return OPEN_REQUEST_NAME.to_owned();
    }
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("{OPEN_REQUEST_NAME}-{}", &digest[..8])
}

/// Resolve the canonical path, falling back to the original if canonicalization fails.
fn canonical_path(repo_path: &Path) -> PathBuf {
    repo_path
        .canonicalize()
        .unwrap_or_else(|_| repo_path.to_path_buf())
}

/// Return `(git_dir, common_dir)` for `repo_path`. For a regular repo both are
/// `<repo>/.git`. For a linked worktree, `git_dir` is the per-worktree dir
/// (`<main>/.git/worktrees/<name>`) and `common_dir` is the shared root
/// (`<main>/.git`) — the part every worktree of a repo agrees on. If anything
/// can't be resolved we fall back to `<repo>/.git`.
///
/// This is the single source of truth for git-dir resolution; consumers that
/// need worktree-aware identity or fingerprints (`compute_repo_id`,
/// `service::activity_cache`) build on it.
pub(crate) fn resolve_git_dirs(repo_path: &Path) -> (PathBuf, PathBuf) {
    let git_path = repo_path.join(".git");
    let Ok(meta) = fs::metadata(&git_path) else {
        return (git_path.clone(), git_path);
    };
    if meta.is_dir() {
        return (git_path.clone(), git_path);
    }
    // `.git` is a file — parse the `gitdir: ...` pointer.
    let Ok(content) = fs::read_to_string(&git_path) else {
        return (git_path.clone(), git_path);
    };
    let Some(gitdir_raw) = content
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("gitdir: "))
    else {
        return (git_path.clone(), git_path);
    };
    let gitdir = {
        let p = Path::new(gitdir_raw.trim());
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            repo_path.join(p)
        }
    };
    // `commondir` sits next to HEAD in per-worktree dirs — a pointer to the
    // shared `.git` root (usually the single token `../..`).
    let common_dir = match fs::read_to_string(gitdir.join("commondir")) {
        Ok(c) => {
            let p = Path::new(c.trim());
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                gitdir.join(p)
            }
        }
        Err(_) => gitdir.clone(),
    };
    (gitdir, common_dir)
}

/// The working tree containing `start`: the nearest ancestor with a `.git`,
/// or `None` outside any repository.
///
/// This answers "which checkout am I in?" and stops there — a linked worktree
/// stays itself. [`repo_root`] is the second half, collapsing that onto the
/// repository's main working tree; callers that key anything by repo identity
/// need both, in that order.
pub fn enclosing_working_tree(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if current.join(".git").exists() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}

/// The main working tree for a repo, given any path inside it (including a
/// linked or Review-managed worktree). A repo registers and stores reviews
/// under this single root so worktrees don't fork into separate entries.
///
/// Idempotent, and total: a path that isn't in a repository at all comes back
/// canonicalized, which is what lets a plain directory be identified the same
/// way a repository is.
pub fn repo_root(repo_path: &Path) -> PathBuf {
    let (_git_dir, common_dir) = resolve_git_dirs(repo_path);
    let canonical_common = canonical_path(&common_dir);
    if canonical_common.file_name().and_then(|n| n.to_str()) == Some(".git") {
        if let Some(parent) = canonical_common.parent() {
            return parent.to_path_buf();
        }
    }
    canonical_path(repo_path)
}

/// A repository's name for display ("review", not the full path).
///
/// The sidebar's registry entries and the workspace queue's refs both name repos
/// this way, so they share the derivation rather than each taking `file_name()`
/// and drifting apart.
pub fn display_name(repo_path: &Path) -> &str {
    repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .or_else(|| repo_path.to_str())
        .unwrap_or("unknown")
}

/// Compute a 16-character hex repo ID that is stable across worktrees.
///
/// The ID hashes the canonical git **common dir** rather than the working path,
/// so a repository and all of its worktrees resolve to the same ID (and share
/// one review store). Non-git paths fall back to hashing `<path>/.git`.
pub fn compute_repo_id(repo_path: &Path) -> Result<String, CentralError> {
    let (_git_dir, common_dir) = resolve_git_dirs(repo_path);
    let canonical = canonical_path(&common_dir);
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let result = hasher.finalize();
    Ok(hex::encode(&result[..8])) // 8 bytes = 16 hex chars
}

/// Get the **durable** storage directory for a specific repo
/// (`~/.spur/repos/<repo-id>/`): review state and `repo.json`. This is the
/// precious tier — never delete it to reclaim space.
pub fn get_repo_storage_dir(repo_path: &Path) -> Result<PathBuf, CentralError> {
    let root = get_central_root()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(root.join("repos").join(repo_id))
}

/// Get the **disposable** cache directory for a specific repo
/// (`~/.spur/cache/<repo-id>/`): reconstructable derived data (parsed hunks,
/// symbol diffs). Safe to delete at any time — `rm -rf ~/.spur/cache` never
/// touches durable review state. Kept separate from `get_repo_storage_dir` so
/// the two tiers can be cleared independently.
pub fn get_repo_cache_dir(repo_path: &Path) -> Result<PathBuf, CentralError> {
    let root = get_central_root()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(root.join("cache").join(repo_id))
}

/// Get the base directory for review-managed worktrees for a given repo.
///
/// Returns `~/.spur/worktrees/<repo-hash>/`.
pub fn get_worktree_base_dir(repo_path: &Path) -> Result<PathBuf, CentralError> {
    let root = get_central_root()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(root.join("worktrees").join(repo_id))
}

/// Drop stale duplicate entries that point at the same path under different
/// repo IDs — left behind when the repo-ID scheme changes (e.g. the move to
/// common-dir-based IDs re-registered repos without removing the old entry).
/// Keeps the most recently accessed entry per path. Returns true if anything
/// was removed.
fn prune_duplicate_paths(index: &mut RepoIndex) -> bool {
    // Winner per path: latest last_accessed (ISO 8601, so lexicographic
    // compare is chronological), repo_id as a deterministic tiebreak.
    let mut keep: HashMap<String, (String, String)> = HashMap::new();
    for entry in index.repos.values() {
        let candidate = (entry.last_accessed.clone(), entry.repo_id.clone());
        match keep.get(&entry.path) {
            Some(best) if *best >= candidate => {}
            _ => {
                keep.insert(entry.path.clone(), candidate);
            }
        }
    }
    let before = index.repos.len();
    index
        .repos
        .retain(|id, e| keep.get(&e.path).is_none_or(|(_, kid)| kid == id));
    index.repos.len() != before
}

/// Load the global repo index, straight off disk.
///
/// Deliberately uncached. `~/.spur/` is written by the app, the CLI and the
/// daemon at once, so any in-memory copy has to be checked against the file
/// before it can be trusted — and once you are stat-ing on every call, the cache
/// is only saving the parse of a small JSON document. Worse, a copy that went
/// unchecked would not merely serve a stale read: the next `save_index` would
/// write it back over whatever another process had registered in between.
fn load_index() -> Result<RepoIndex, CentralError> {
    let index_path = get_central_root()?.join("index.json");
    let mut index: RepoIndex = match fs::read_to_string(&index_path) {
        Ok(content) => serde_json::from_str(&content)?,
        // Nothing registered yet is the empty index, not an error.
        Err(e) if e.kind() == io::ErrorKind::NotFound => RepoIndex::default(),
        Err(e) => return Err(e.into()),
    };
    // Heal-on-read, mirroring review-file migration: prune stale duplicates
    // and persist so it only happens once. A failed write still leaves the
    // pruned index in memory for this run.
    if prune_duplicate_paths(&mut index) {
        if let Err(e) = save_index(&index) {
            log::warn!("[central] failed to persist pruned repo index: {e}");
        }
    }
    Ok(index)
}

/// Save the global repo index (atomic: write tmp + rename).
fn save_index(index: &RepoIndex) -> Result<(), CentralError> {
    let root = get_central_root()?;
    fs::create_dir_all(&root)?;

    let index_path = root.join("index.json");
    let tmp_path = root.join("index.json.tmp");
    let content = serde_json::to_string_pretty(index)?;
    fs::write(&tmp_path, &content)?;
    fs::rename(&tmp_path, &index_path)?;
    Ok(())
}

/// Register (upsert) a repo in the index and create its storage directory.
///
/// An upsert, so it refreshes `last_accessed` — which is the order
/// [`list_registered_repos`] returns, and so the order the sidebar reads. That
/// is right for "the human opened this repo" and wrong for "a workspace happens
/// to hold it"; see [`ensure_registered`].
pub fn register_repo(repo_path: &Path) -> Result<(), CentralError> {
    let repo_id = compute_repo_id(repo_path)?;
    let index = load_index()?;
    write_registration(repo_path, repo_id, index)
}

/// Put a repo in the index if it isn't there already, reporting whether that
/// wrote anything.
///
/// The "make sure this is on the list" call, as against [`register_repo`]'s
/// "put it on the list, now": a repo that arrived because a workspace attached
/// it has not been *used*, so it takes its place without pushing anything else
/// down the recency order, and re-attaching one already listed writes nothing at
/// all.
///
/// A path that is not a working tree is simply not registered — the index is the
/// git registry, and every reader of it needs a `LocalGitSource`.
pub fn ensure_registered(repo_path: &Path) -> Result<bool, CentralError> {
    if !is_working_tree(repo_path) {
        return Ok(false);
    }
    let repo_id = compute_repo_id(repo_path)?;
    let index = load_index()?;
    if index.repos.contains_key(&repo_id) {
        return Ok(false);
    }
    write_registration(repo_path, repo_id, index)?;
    Ok(true)
}

/// The write both of the above end in, taking the repo id and the index already
/// in hand so that neither is resolved a second time.
fn write_registration(
    repo_path: &Path,
    repo_id: String,
    mut index: RepoIndex,
) -> Result<(), CentralError> {
    let repo_dir = get_central_root()?.join("repos").join(&repo_id);
    fs::create_dir_all(repo_dir.join("reviews"))?;

    // Register under the repo's main working tree, not the (possibly worktree)
    // path we were handed, so every worktree maps to one canonical entry.
    let canonical = repo_root(repo_path);
    let canonical_str = canonical.to_string_lossy().to_string();
    let display_name = display_name(&canonical).to_owned();

    // Write repo.json
    let repo_json = serde_json::json!({
        "canonical_path": canonical_str,
        "display_name": display_name,
    });
    fs::write(
        repo_dir.join("repo.json"),
        serde_json::to_string_pretty(&repo_json)?,
    )?;

    index.repos.insert(
        repo_id.clone(),
        RepoIndexEntry {
            repo_id,
            path: canonical_str,
            name: display_name,
            last_accessed: now_iso8601(),
        },
    );
    save_index(&index)?;
    Ok(())
}

/// List all registered repos from the index.
pub fn list_registered_repos() -> Result<Vec<RepoIndexEntry>, CentralError> {
    let index = load_index()?;
    let mut repos: Vec<RepoIndexEntry> = index.repos.into_values().collect();
    repos.sort_by(|a, b| b.last_accessed.cmp(&a.last_accessed));
    Ok(repos)
}

/// Look up a single registered repo by id without sorting the full list.
pub fn get_registered_repo(repo_id: &str) -> Result<Option<RepoIndexEntry>, CentralError> {
    let index = load_index()?;
    Ok(index.repos.get(repo_id).cloned())
}

/// Return true iff `repo_path` is currently registered.
pub fn is_registered(repo_path: &Path) -> Result<bool, CentralError> {
    let repo_id = compute_repo_id(repo_path)?;
    Ok(load_index()?.repos.contains_key(&repo_id))
}

/// Unregister a repo from the index. Does not delete review files.
pub fn unregister_repo(repo_path: &Path) -> Result<(), CentralError> {
    let repo_id = compute_repo_id(repo_path)?;
    let mut index = load_index()?;
    index.repos.remove(&repo_id);
    save_index(&index)?;
    Ok(())
}

/// Whether `repo_path` is itself a working tree — the exact test
/// [`register_repo_if_valid`] applies, shared so "the index took this" and "a
/// surface calls this a repo" can never disagree.
///
/// A `.git` entry rather than `git rev-parse`, for two reasons: this is asked
/// per attachment on every read of the workspace queue, and the paths it is asked
/// about are already [`repo_root`]-normalized, so the cheap answer and the
/// honest one are the same one. `LocalGitSource::new` draws the line in the same
/// place, which is what makes "registered" and "diffable" the same set.
pub fn is_working_tree(repo_path: &Path) -> bool {
    repo_path.join(".git").exists()
}

/// Register a repo only if the given path is a valid git repository.
/// Returns Ok(true) if registered, Ok(false) if not a git repo.
pub fn register_repo_if_valid(repo_path: &Path) -> Result<bool, CentralError> {
    if !is_working_tree(repo_path) {
        return Ok(false);
    }
    register_repo(repo_path)?;
    Ok(true)
}

use crate::review::state::now_iso8601;

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::TempDir;

    /// The rule that matters most: a running Review app means migrating would
    /// move the home out from under something that writes to it, which is how
    /// you end up with two half-right queues.
    #[test]
    fn a_running_legacy_app_blocks_the_move() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join(".review");
        let target = tmp.path().join(".spur");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("workspaces.json"), "{}").unwrap();

        adopt_legacy_home(&legacy, &target, true);

        assert!(legacy.exists(), "legacy home must be left alone");
        assert!(!target.exists(), "nothing should have been created");
    }

    /// The symmetric rule, and the one that keeps people's shells: a live
    /// *daemon* must not block. Its socket travels with the rename, and the new
    /// app attaches to a protocol-compatible build rather than restarting it —
    /// so migrating and keeping your terminals is not a trade.
    #[test]
    #[cfg(unix)]
    fn a_live_daemon_does_not_block_the_move() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join(".review");
        let target = tmp.path().join(".spur");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("workspaces.json"), r#"{"v":1}"#).unwrap();

        let listener = std::os::unix::net::UnixListener::bind(legacy.join("daemon.sock")).unwrap();

        adopt_legacy_home(&legacy, &target, false);

        assert!(!legacy.exists(), "the home should have moved");
        assert_eq!(
            fs::read_to_string(target.join("workspaces.json")).unwrap(),
            r#"{"v":1}"#
        );
        // And the socket came with it, still bound to the same listener — which
        // is what lets the new app find the old daemon's sessions.
        assert!(target.join("daemon.sock").exists());
        drop(listener);
    }

    /// An existing `~/.spur` is the live home; a leftover `~/.review` beside it
    /// is not a reason to overwrite anything.
    #[test]
    fn an_existing_home_is_never_overwritten() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join(".review");
        let target = tmp.path().join(".spur");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("workspaces.json"), "keep me").unwrap();

        adopt_legacy_home(&legacy, &target, false);

        assert!(legacy.exists());
        assert_eq!(
            fs::read_to_string(target.join("workspaces.json")).unwrap(),
            "keep me"
        );
    }

    #[test]
    fn work_json_becomes_workspaces_json() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("work.json"), r#"{"workspaces":[]}"#).unwrap();

        adopt_legacy_workspaces_file(tmp.path());

        assert!(!tmp.path().join("work.json").exists());
        assert_eq!(
            fs::read_to_string(tmp.path().join("workspaces.json")).unwrap(),
            r#"{"workspaces":[]}"#
        );
    }

    /// Both files present means a newer build already wrote one. The new name
    /// wins and the old file is left for the user to delete.
    #[test]
    fn an_existing_workspaces_file_wins_over_the_legacy_one() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("work.json"), "old").unwrap();
        fs::write(tmp.path().join("workspaces.json"), "new").unwrap();

        adopt_legacy_workspaces_file(tmp.path());

        assert_eq!(
            fs::read_to_string(tmp.path().join("workspaces.json")).unwrap(),
            "new"
        );
        assert!(tmp.path().join("work.json").exists());
    }

    /// Mutex to serialize tests that modify SPUR_HOME env var.
    /// Also used by storage::tests and local_git::tests.
    pub static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Guard that restores SPUR_HOME on drop (even on panic).
    pub struct EnvGuard;
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var("SPUR_HOME");
        }
    }

    /// Create a SPUR_HOME temp dir and a fake repo temp dir.
    /// Returns (env_guard, spur_home, repo_dir) — all kept alive.
    /// Caller MUST hold ENV_LOCK.
    pub fn setup_test() -> (EnvGuard, TempDir, TempDir) {
        let spur_home = TempDir::new().unwrap();
        std::env::set_var("SPUR_HOME", spur_home.path());
        let repo_dir = TempDir::new().unwrap();
        (EnvGuard, spur_home, repo_dir)
    }

    /// The CLI and the app find each other through a file in `$TMPDIR`, so they
    /// have to agree on its name from two very different environments: a shell
    /// inside the app (which inherits `SPUR_HOME=~/.spur` from the daemon
    /// the app spawned) and Spur.app launched from Finder (which inherits
    /// nothing). Same home, same channel — whatever the environment says.
    #[test]
    fn the_open_request_name_is_keyed_on_the_resolved_home() {
        let _lock = ENV_LOCK.lock().unwrap();
        let default_home = dirs::home_dir().unwrap().join(".spur");

        // Finder's Spur.app: no SPUR_HOME at all.
        std::env::remove_var("SPUR_HOME");
        let bare = open_request_name();
        assert_eq!(bare, OPEN_REQUEST_NAME);

        // A shell inside the app: SPUR_HOME set, but set to the *default*
        // home. Keying on "is it set" gave this one a private channel and broke
        // `review .` for everybody.
        std::env::set_var("SPUR_HOME", &default_home);
        let _guard = EnvGuard;
        assert_eq!(
            open_request_name(),
            bare,
            "the default home spelled out is still the default home"
        );

        // A genuinely separate instance keeps its own channel, which is what
        // the hashing is for.
        let dev = TempDir::new().unwrap();
        std::env::set_var("SPUR_HOME", dev.path());
        let dev_name = open_request_name();
        assert_ne!(dev_name, bare);
        assert!(dev_name.starts_with(OPEN_REQUEST_NAME));

        // …and two spellings of that one home are one channel. On macOS every
        // temp path has two (`/var` is a symlink to `/private/var`), and
        // `$SPUR_HOME=/tmp/spur-dev` is the documented dev setup, so a CLI
        // and an app that spelled it differently would otherwise never meet.
        let canonical = dev.path().canonicalize().unwrap();
        assert_ne!(canonical, dev.path(), "the test needs two spellings");
        std::env::set_var("SPUR_HOME", &canonical);
        assert_eq!(open_request_name(), dev_name);
    }

    /// The CLI writes this file and the app reads it, so the format has exactly
    /// one test worth writing: what one end put in comes out at the other.
    ///
    /// Isolated by `SPUR_HOME` rather than by `TMPDIR`: a custom home hashes
    /// into the file name (see [`open_request_name`]), which is enough to keep
    /// the test clear of any real instance, and `TMPDIR` is read by every
    /// `TempDir::new` in the suite — including in tests that take no lock.
    #[test]
    fn an_open_request_round_trips_and_is_consumed_once() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();
        assert_ne!(
            open_request_path().file_name().unwrap(),
            OPEN_REQUEST_NAME,
            "the test must be on its own channel, not the default one"
        );

        let sent = OpenRequest {
            repo_path: "/repos/review".to_owned(),
            ref_name: Some("feature/x".to_owned()),
            // A request that names a file but no hunk: the blank line has to
            // survive as an absent field rather than shifting the ones after it.
            focused_file: Some("core/src/lib.rs".to_owned()),
            focused_hunk_hash: None,
        };
        write_open_request(&sent).unwrap();
        assert_eq!(read_open_request(), Some(sent));

        // The doorbell is answered once — the read deletes it, so a second
        // activation doesn't reopen what the first one already handled.
        assert_eq!(read_open_request(), None);

        // And a request older than the TTL is a crashed run's leftover, not an
        // instruction: acted on, it would yank the human off what they are
        // doing now.
        let stale = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            - OPEN_REQUEST_TTL.as_secs()
            - 1;
        fs::write(open_request_path(), format!("{stale}\n/repos/review\n\n\n")).unwrap();
        assert_eq!(read_open_request(), None);
        assert!(
            !open_request_path().exists(),
            "and it is cleared either way"
        );
    }

    #[test]
    #[cfg(unix)]
    fn canonical_central_root_resolves_a_symlinked_review_home() {
        let _lock = ENV_LOCK.lock().unwrap();
        let real = TempDir::new().unwrap();
        let link_dir = TempDir::new().unwrap();
        let link = link_dir.path().join("review-home");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();

        std::env::set_var("SPUR_HOME", &link);
        let _guard = EnvGuard;

        // The watchers compare against paths the OS hands back, and those are
        // resolved — on macOS a SPUR_HOME under /tmp arrives as /private/tmp.
        assert_eq!(get_central_root().unwrap(), link);
        assert_eq!(
            canonical_central_root().unwrap(),
            real.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn canonical_central_root_falls_back_when_the_root_is_absent() {
        let _lock = ENV_LOCK.lock().unwrap();
        let missing = "/nonexistent-review-home-for-tests";
        std::env::set_var("SPUR_HOME", missing);
        let _guard = EnvGuard;

        assert_eq!(canonical_central_root().unwrap(), PathBuf::from(missing));
    }

    #[test]
    fn test_compute_repo_id_is_deterministic() {
        let tmp = TempDir::new().unwrap();
        let id1 = compute_repo_id(tmp.path()).unwrap();
        let id2 = compute_repo_id(tmp.path()).unwrap();
        assert_eq!(id1, id2);
        assert_eq!(id1.len(), 16);
    }

    #[test]
    fn test_worktree_and_main_share_repo_id() {
        // Main repo: a real `.git` directory.
        let main = TempDir::new().unwrap();
        let git_dir = main.path().join(".git");
        let wt_gitdir = git_dir.join("worktrees").join("wt");
        fs::create_dir_all(&wt_gitdir).unwrap();
        // `commondir` points back to the shared `.git` (git writes `../..`).
        fs::write(wt_gitdir.join("commondir"), "../..\n").unwrap();

        // Linked worktree: `.git` is a file pointing at the per-worktree gitdir.
        let worktree = TempDir::new().unwrap();
        fs::write(
            worktree.path().join(".git"),
            format!("gitdir: {}\n", wt_gitdir.display()),
        )
        .unwrap();

        let main_id = compute_repo_id(main.path()).unwrap();
        let wt_id = compute_repo_id(worktree.path()).unwrap();
        assert_eq!(main_id, wt_id, "worktree must share the main repo's id");

        // And both resolve to the main working tree as the canonical root.
        assert_eq!(
            repo_root(worktree.path()),
            main.path().canonicalize().unwrap()
        );
        assert_eq!(repo_root(main.path()), main.path().canonicalize().unwrap());
    }

    #[test]
    fn test_prune_duplicate_paths_keeps_latest_accessed() {
        let mut index = RepoIndex::default();
        for (id, path, accessed) in [
            ("old-id-aaaa", "/repos/one", "2025-01-01T00:00:00Z"),
            ("new-id-bbbb", "/repos/one", "2026-06-01T00:00:00Z"),
            ("only-id-cccc", "/repos/two", "2024-01-01T00:00:00Z"),
        ] {
            index.repos.insert(
                id.to_owned(),
                RepoIndexEntry {
                    repo_id: id.to_owned(),
                    path: path.to_owned(),
                    name: "x".to_owned(),
                    last_accessed: accessed.to_owned(),
                },
            );
        }

        assert!(prune_duplicate_paths(&mut index));
        assert_eq!(index.repos.len(), 2);
        assert!(
            index.repos.contains_key("new-id-bbbb"),
            "most recently accessed duplicate must win"
        );
        assert!(index.repos.contains_key("only-id-cccc"));

        // Idempotent: a clean index is untouched.
        assert!(!prune_duplicate_paths(&mut index));
        assert_eq!(index.repos.len(), 2);
    }

    #[test]
    fn test_get_central_root_with_env() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::set_var("SPUR_HOME", "/tmp/test-review");
        let root = get_central_root().unwrap();
        assert_eq!(root, PathBuf::from("/tmp/test-review"));
        std::env::remove_var("SPUR_HOME");
    }

    #[test]
    fn test_register_and_list_repos() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _spur_home, repo_dir) = setup_test();
        register_repo(repo_dir.path()).unwrap();

        let repos = list_registered_repos().unwrap();
        assert_eq!(repos.len(), 1);
    }

    #[test]
    fn test_empty_index() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _spur_home, _repo_dir) = setup_test();
        let repos = list_registered_repos().unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_repo_storage_dir_structure() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _spur_home, repo_dir) = setup_test();
        register_repo(repo_dir.path()).unwrap();

        let storage_dir = get_repo_storage_dir(repo_dir.path()).unwrap();
        let central_root = get_central_root().unwrap();
        assert!(storage_dir.starts_with(&central_root));
        assert!(storage_dir.join("reviews").exists());
        assert!(storage_dir.join("repo.json").exists());
    }

    #[test]
    fn test_sanitize_path_component_basic() {
        assert_eq!(
            sanitize_path_component("feature/my-branch"),
            "feature_my-branch"
        );
        assert_eq!(
            sanitize_path_component("main..feature/x"),
            "main..feature_x"
        );
    }

    #[test]
    fn test_sanitize_path_component_special_chars() {
        assert_eq!(
            sanitize_path_component(r#"a\b:c*d?"e<f>g|h"#),
            "a_b_c_d__e_f_g_h"
        );
    }

    #[test]
    fn test_sanitize_path_component_no_change() {
        assert_eq!(sanitize_path_component("simple-name"), "simple-name");
        assert_eq!(sanitize_path_component("main..feature"), "main..feature");
    }
}
