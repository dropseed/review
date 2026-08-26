//! Tauri command handlers for the desktop application.
//!
//! All #[tauri::command] functions are defined here as thin wrappers
//! that delegate to core business logic modules.

// Tauri's IPC protocol requires command parameters to be owned types.
#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require owned parameters for IPC deserialization"
)]

use log::{debug, error, info, warn};
use review::classify::{self, ClassifyResponse};
use review::diff::parser::DiffHunk;
use review::lsp::client::LspClient;
use review::lsp::registry;
use review::review::state::{ReviewState, ReviewSummary};
use review::review::storage::{self, GlobalReviewSummary};
use review::service::pr::ReviewTierInfo;
use review::service::usage::AgentUsage;
use review::service::viewer_prs::ViewerPrSnapshot;
use review::service::worktrees::RepoWorktrees;
use review::service::{
    CommitOutputLine, CommitResult, ExpandedContextResult, FileContent, RepoFileSymbols,
    RepoLocalActivity, ReviewFreshnessInput, ReviewFreshnessResult, VscodeThemeDetection,
};
use review::sources::github::{GhCliProvider, GitHubPrRef, GitHubProvider, PullRequest};
use review::sources::local_git::{
    CommitComparison, DiffShortStat, HunkAttribution, LocalGitSource, RemoteInfo, SearchMatch,
    WorktreeCheckout, WorktreeInfo,
};
use review::sources::traits::{
    BranchList, CommitDetail, CommitEntry, Comparison, FileEntry, GitStatusSummary,
};
use review::symbols::{self, FileSymbolDiff, Symbol};
use review::trust::patterns::TrustCategory;
use review::work::{Attachment, WorkspaceView};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tokio::sync::Mutex as TokioMutex;

use super::terminal_commands::TerminalState;

use std::path::PathBuf;
use std::time::Instant;

/// Server status for LSP servers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStatus {
    pub name: String,
    pub language: String,
    pub state: LspServerState,
}

/// Possible states for an LSP server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LspServerState {
    Starting,
    Ready,
    Error,
    Stopped,
}

/// Key for the LSP server map: (repo_path, language).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct LspServerKey {
    repo_path: String,
    language: String,
}

/// Managed state for LSP server handles. The type is `pub` because Tauri's
/// `manage`/`State` need to name it, but the map inside is crate-internal —
/// its key and handle types are, and neither exposes anything to construct.
pub struct LspServers(pub(crate) TokioMutex<HashMap<LspServerKey, LspServerHandle>>);

pub(crate) struct LspServerHandle {
    client: std::sync::Arc<LspClient>,
    name: String,
    language: String,
    /// When this server's workspace was last opened or queried. Drives which
    /// roots survive [`evict_cold_lsp_roots`].
    last_used: Instant,
}

/// How many workspace roots keep their language servers running.
///
/// Servers stay warm across review switches — restarting rust-analyzer on every
/// switch costs a full re-index, and reviews ping-pong between a handful of
/// roots (a repo and its worktrees). The cap is what keeps that from growing
/// into one indexed workspace per review the user ever opened.
const MAX_WARM_LSP_ROOTS: usize = 3;

// Types are now imported from review::service::{FileContent, ...}

// --- Tauri Commands ---

/// Run a blocking body on the blocking pool, flattening the join error into the
/// command's own `String` error.
///
/// Every async command here was spelling out the same two conversions by hand —
/// one for the `JoinHandle`, one for the body's own result. `server/handlers.rs`
/// has had this helper on the Axum side all along; this is its twin.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// [`blocking`] for a body that cannot fail, where only the join can.
async fn blocking_infallible<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_current_repo() -> Result<String, String> {
    // Check command-line arguments first (for `review open` CLI command)
    // Args are passed like: Review /path/to/repo
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let repo_path = &args[1];
        let path = PathBuf::from(repo_path);
        if path.join(".git").exists() {
            return Ok(repo_path.clone());
        }
    }

    // Check current working directory and walk up to find .git
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    let mut current = cwd.as_path();
    loop {
        if current.join(".git").exists() {
            let repo_path = current.to_string_lossy().to_string();
            return Ok(repo_path);
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }

    Err("No git repository found.".to_owned())
}

#[tauri::command]
pub fn check_github_available(repo_path: String) -> bool {
    let provider = GhCliProvider::new(PathBuf::from(&repo_path));
    provider.is_available()
}

#[tauri::command]
pub fn list_pull_requests(repo_path: String) -> Result<Vec<PullRequest>, String> {
    let provider = GhCliProvider::new(PathBuf::from(&repo_path));
    provider.list_pull_requests().map_err(|e| e.to_string())
}

/// Every open PR the user has out, joined to the repos Review has registered.
///
/// `refresh` queries GitHub; without it this reads the cached snapshot off
/// disk, which is what the sidebar paints with before `gh` has answered.
#[tauri::command]
pub async fn get_viewer_prs(refresh: bool) -> Result<ViewerPrSnapshot, String> {
    blocking_infallible(move || {
        let t0 = Instant::now();
        let snapshot = review::service::viewer_prs::get_viewer_prs(refresh);
        info!(
            "get_viewer_prs refresh={} -> {} prs in {:?}",
            refresh,
            snapshot.prs.len(),
            t0.elapsed()
        );
        snapshot
    })
    .await
}

#[tauri::command]
pub async fn list_files(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    blocking(move || list_files_sync(repo_path, comparison)).await
}

/// Synchronous implementation of `list_files`, callable from blocking contexts.
pub fn list_files_sync(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_files(&PathBuf::from(&repo_path), &comparison)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all_files(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    blocking(move || list_all_files_sync(repo_path, comparison)).await
}

/// Synchronous implementation of `list_all_files`, callable from blocking contexts.
pub fn list_all_files_sync(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_all_files(&PathBuf::from(&repo_path), &comparison)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_repo_files(repo_path: String) -> Result<Vec<FileEntry>, String> {
    blocking(move || list_repo_files_sync(repo_path)).await
}

/// Synchronous implementation of `list_repo_files`, callable from blocking contexts.
pub fn list_repo_files_sync(repo_path: String) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_repo_files(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
}

/// List the repository's files as of a ref — a read-only peek, no checkout.
#[tauri::command]
pub async fn list_files_at_ref(
    repo_path: String,
    git_ref: String,
) -> Result<Vec<FileEntry>, String> {
    blocking(move || {
        review::service::files::list_files_at_ref(&PathBuf::from(&repo_path), &git_ref)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn list_directory_contents(
    repo_path: String,
    dir_path: String,
) -> Result<Vec<FileEntry>, String> {
    blocking(move || list_directory_contents_sync(repo_path, dir_path)).await
}

/// Synchronous implementation of `list_directory_contents`, callable from blocking contexts.
pub fn list_directory_contents_sync(
    repo_path: String,
    dir_path: String,
) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_directory_contents(&PathBuf::from(&repo_path), &dir_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_content(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
) -> Result<FileContent, String> {
    blocking(move || {
        review::service::files::get_file_content(
            &PathBuf::from(&repo_path),
            &file_path,
            &comparison,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

/// Batch-load all hunks for multiple files in a single IPC call.
#[tauri::command]
pub async fn get_all_hunks(
    repo_path: String,
    comparison: Comparison,
    file_paths: Vec<String>,
) -> Result<Vec<DiffHunk>, String> {
    blocking(move || get_all_hunks_sync(repo_path, comparison, file_paths)).await
}

/// Synchronous implementation of `get_all_hunks`, callable from blocking contexts.
pub fn get_all_hunks_sync(
    repo_path: String,
    comparison: Comparison,
    file_paths: Vec<String>,
) -> Result<Vec<DiffHunk>, String> {
    review::service::files::get_all_hunks(&PathBuf::from(&repo_path), &comparison, &file_paths)
        .map_err(|e| e.to_string())
}

/// Recompute only the named files of the comparison — the file watcher's path.
#[tauri::command]
pub async fn get_files_delta(
    repo_path: String,
    comparison: Comparison,
    file_paths: Vec<String>,
) -> Result<review::service::FilesDelta, String> {
    blocking(move || {
        review::service::files::files_delta(&PathBuf::from(&repo_path), &comparison, &file_paths)
            .map_err(|e| e.to_string())
    })
    .await
}

/// Detect the comparison's move pairs from the diff on disk.
#[tauri::command]
pub async fn get_comparison_move_pairs(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<review::diff::parser::MovePair>, String> {
    blocking(move || {
        review::service::files::comparison_move_pairs(&PathBuf::from(&repo_path), &comparison)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub fn get_diff_shortstat(
    repo_path: String,
    comparison: Comparison,
) -> Result<DiffShortStat, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .get_diff_shortstat(&comparison)
        .map_err(|e| e.to_string())
}

/// Resolve a review's `ref` (+ optional base override) into a `ResolvedReview`
/// (identity + concrete `Comparison`) the normal review flow can open.
#[tauri::command]
pub fn resolve_review(
    repo_path: String,
    r#ref: String,
    base_override: Option<String>,
) -> Result<review::service::targets::ResolvedReview, String> {
    let t0 = Instant::now();
    let resolved = review::service::targets::resolve(
        &PathBuf::from(&repo_path),
        &r#ref,
        base_override.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    info!("resolve_review {} in {:?}", r#ref, t0.elapsed());
    Ok(resolved)
}

#[tauri::command]
pub fn load_review_state(repo_path: String, r#ref: String) -> Result<ReviewState, String> {
    let t0 = Instant::now();
    let state = storage::load_review_state(&PathBuf::from(&repo_path), &r#ref)
        .map_err(|e| e.to_string())?;
    info!("load_review_state {} in {:?}", r#ref, t0.elapsed());
    Ok(state)
}

/// Carry persisted decisions forward onto the live diff the UI just loaded, so a
/// review reflects prior work even after edits shifted hunk IDs. Reconciles
/// in-memory against the supplied hunks (no `git diff`); persistence happens on
/// the next save.
#[tauri::command]
pub fn reconcile_review_state(
    state: ReviewState,
    hunks: Vec<DiffHunk>,
) -> Result<review::service::review_io::ReviewLoadResult, String> {
    let t0 = Instant::now();
    let key = state.ref_name.clone();
    let result = review::service::review_io::reconcile_review(state, &hunks);
    info!(
        "reconcile_review_state {key} carried={} in {:?}",
        result.carried_forward,
        t0.elapsed()
    );
    Ok(result)
}

#[tauri::command]
pub fn save_review_state(
    repo_path: String,
    state: ReviewState,
    hunks: Option<Vec<DiffHunk>>,
) -> Result<u64, String> {
    let t0 = Instant::now();
    let key = state.ref_name.clone();
    // Reconciles against the hunks the UI already loaded (when present) so stable
    // keys are (re)stamped and decisions carry across hunk-ID drift — without a
    // second `git diff`.
    let version = review::service::review_io::save_review(
        &PathBuf::from(&repo_path),
        state,
        hunks.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    info!("save_review_state {key} v{version} in {:?}", t0.elapsed());
    Ok(version)
}

#[tauri::command]
pub fn list_saved_reviews(repo_path: String) -> Result<Vec<ReviewSummary>, String> {
    storage::list_saved_reviews(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
}

/// Set (or clear) a review's base override in place — no re-key — and return the
/// re-resolved review so the UI can refresh its diff.
#[tauri::command]
pub fn set_base_override(
    repo_path: String,
    r#ref: String,
    base_override: Option<String>,
) -> Result<review::service::targets::ResolvedReview, String> {
    review::service::targets::set_base_override(&PathBuf::from(&repo_path), &r#ref, base_override)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_review(repo_path: String, r#ref: String) -> Result<(), String> {
    storage::delete_review(&PathBuf::from(&repo_path), &r#ref).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn review_exists(repo_path: String, r#ref: String) -> Result<bool, String> {
    storage::review_exists(&PathBuf::from(&repo_path), &r#ref).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_review_exists(
    repo_path: String,
    r#ref: String,
    base_override: Option<String>,
    github_pr: Option<GitHubPrRef>,
) -> Result<(), String> {
    storage::ensure_review_exists(&PathBuf::from(&repo_path), &r#ref, base_override, github_pr)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_reviews_global() -> Result<Vec<GlobalReviewSummary>, String> {
    storage::list_all_reviews_global().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_review_root() -> Result<String, String> {
    review::review::central::get_central_root()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_review_storage_path(repo_path: String) -> Result<String, String> {
    review::review::central::get_repo_storage_dir(&PathBuf::from(&repo_path))
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ============================================================
// Work queue
//
// The queue is global and cross-repo, so none of these take a repo path — only
// the attachments a workspace holds do. See `ApiClient` for why every mutation
// returns the full list.
//
// `work_list` talks to the terminal daemon as well, because one fact about a
// workspace lives there rather than in `work.json`: whether anything is running
// in it (cleanup). It degrades to "leave it alone" when the daemon has not been
// contacted yet.
// ============================================================

/// What the daemon can say about the queue, or `None` when nobody can say —
/// see `work::cleanup` for why the difference matters.
async fn live_workspaces(terminals: &TerminalState) -> Option<HashSet<String>> {
    terminals.connected().await?.live_workspaces().await.ok()
}

/// What cleanup may not touch: whatever has a live terminal, plus whatever is on
/// screen right now.
///
/// The second half is this window's to add. A ⌘K peek is a router-made
/// workspace with no terminal, so neither adoption, liveness, nor the creation
/// grace covers the one case a reader is most likely to hit — reading the diff
/// for longer than the grace period, while the queue refreshes underneath. The
/// workspace the stage is showing is in use by definition.
///
/// `None` in means `None` out: liveness is unknown, and cleanup must not run at
/// all rather than run against a set of one.
fn in_use(live: Option<HashSet<String>>, focused: Option<String>) -> Option<HashSet<String>> {
    let mut live = live?;
    if let Some(focused) = focused {
        live.insert(focused);
    }
    Some(live)
}

/// `focused` is the workspace the stage is showing, so the read that cleans up
/// does not reap it out from under the human. Absent when nothing is focused.
#[tauri::command]
pub async fn work_list(
    terminals: tauri::State<'_, TerminalState>,
    focused: Option<String>,
) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    // The read that cleans up: this and `review workspace list` are the two places
    // that hold the queue and the liveness answer at once.
    let live = live_workspaces(&terminals).await;
    let in_use = in_use(live, focused);
    let state = review::work::list_with_liveness(in_use.as_ref()).map_err(|e| e.to_string())?;
    let views = review::work::views(state.workspaces);
    info!(
        "work_list -> {} workspaces in {:?}",
        views.len(),
        t0.elapsed()
    );
    Ok(views)
}

#[tauri::command]
pub fn work_add(
    title: Option<String>,
    attachments: Vec<Attachment>,
) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let (state, item) =
        review::work::add(title.as_deref(), attachments).map_err(|e| e.to_string())?;
    info!("work_add {} in {:?}", item.id, t0.elapsed());
    Ok(review::work::views(state.workspaces))
}

/// Remove a workspace. `recursive` takes everything nested under it as well —
/// the frontend asks the human first (the confirmation names the
/// sub-workspaces and their terminals before it takes them) and sends the
/// answer here. Absent means the safe reading: the children come up a level
/// and stay in the queue.
#[tauri::command]
pub fn work_remove(id: String, recursive: Option<bool>) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let mode = if recursive.unwrap_or(false) {
        review::work::Removal::Subtree
    } else {
        review::work::Removal::PromoteChildren
    };
    let (state, removed) = review::work::remove(&id, mode).map_err(|e| e.to_string())?;
    info!(
        "work_remove {} (+{} nested) in {:?}",
        removed.workspace.id,
        removed.descendants.len(),
        t0.elapsed()
    );
    Ok(review::work::views(state.workspaces))
}

/// Put a workspace under another — the sidebar's card-onto-card drop. A null
/// `parentId` takes it back out to the top level.
#[tauri::command]
pub fn work_nest(id: String, parent_id: Option<String>) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let (state, item) =
        review::work::set_parent(&id, parent_id.as_deref()).map_err(|e| e.to_string())?;
    info!(
        "work_nest {} under {:?} in {:?}",
        item.id,
        item.parent_id,
        t0.elapsed()
    );
    Ok(review::work::views(state.workspaces))
}

/// Retitle an item. An absent (or empty) `title` clears the stored one and the
/// title goes back to being derived.
#[tauri::command]
pub fn work_rename(id: String, title: Option<String>) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let (state, item) = review::work::rename(&id, title.as_deref()).map_err(|e| e.to_string())?;
    info!("work_rename {} in {:?}", item.id, t0.elapsed());
    Ok(review::work::views(state.workspaces))
}

/// Reorder an item. `position` is 0-based, matching the array the frontend
/// dragged (the CLI's `review workspace reorder` is the 1-based surface).
///
/// `keepParent` is the card menu's move verbs: reorder among the siblings and
/// leave the nesting alone. Without it the row lands at the depth of the row it
/// displaces, which is what a drag means.
#[tauri::command]
pub fn work_move(
    id: String,
    position: usize,
    keep_parent: Option<bool>,
) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let (state, item) = review::work::move_workspace(&id, position, keep_parent.unwrap_or(false))
        .map_err(|e| e.to_string())?;
    info!("work_move {} -> {position} in {:?}", item.id, t0.elapsed());
    Ok(review::work::views(state.workspaces))
}

/// Show a repo in a workspace — opening a repo tab. Nothing is exclusive, so
/// this cannot fail on another workspace showing the same repo.
#[tauri::command]
pub fn work_attach(
    id: String,
    path: String,
    r#ref: Option<String>,
) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let (state, item) =
        review::work::attach(&id, Attachment::new(&path, r#ref)).map_err(|e| e.to_string())?;
    info!("work_attach {} {} in {:?}", item.id, path, t0.elapsed());
    Ok(review::work::views(state.workspaces))
}

/// Stop showing a repo — closing a repo tab.
#[tauri::command]
pub fn work_detach(id: String, path: String) -> Result<Vec<WorkspaceView>, String> {
    let t0 = Instant::now();
    let (state, item) =
        review::work::detach(&id, std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    info!("work_detach {} {} in {:?}", item.id, path, t0.elapsed());
    Ok(review::work::views(state.workspaces))
}

/// Where a repo+branch landed, as the frontend reads it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteLanding {
    workspace: WorkspaceView,
    /// Whether getting here minted the workspace.
    created: bool,
    /// The whole queue as it now stands — the same thing `work_add` and
    /// `work_attach` return, and for the same reason. Routing can add a
    /// workspace, so the caller needs the new list; it already had to be read
    /// here to resolve `workspace`'s ancestry, and handing it back is what
    /// spares the frontend a second round trip for a list this call was holding
    /// anyway.
    workspaces: Vec<WorkspaceView>,
}

/// Route a repo+branch to its workspace and commit that — the front door ⌘K
/// opens.
///
/// The preview the palette draws beside a branch ("joins X" / "new workspace")
/// is computed in the frontend against the attachments it already holds, so it
/// costs nothing per keystroke. This is what makes the promise true: pressing
/// Enter lands through `router::land`, which is the same decision the preview
/// mirrored, and *commits* it.
///
/// `workspace_id` names a workspace explicitly, which lands there and writes
/// nothing — attaching the repo is `work_attach`'s job.
#[tauri::command]
pub async fn work_route(
    repo_path: String,
    r#ref: String,
    workspace_id: Option<String>,
) -> Result<RouteLanding, String> {
    let t0 = Instant::now();
    let location = review::work::router::location_of_ref(std::path::Path::new(&repo_path), &r#ref);
    // Off the UI thread: landing is a read-modify-write of the queue file, and
    // path normalization touches the filesystem.
    let landing = tokio::task::spawn_blocking(move || {
        review::work::router::land(&location, workspace_id.as_deref())
    })
    .await
    .map_err(|e| format!("routing panicked: {e}"))?
    .map_err(|e| e.to_string())?;

    info!(
        "work_route {} {} -> {} (created: {}) in {:?}",
        repo_path,
        r#ref,
        landing.workspace.id,
        landing.created,
        t0.elapsed()
    );
    let queue = review::work::list().map_err(|e| e.to_string())?.workspaces;
    Ok(RouteLanding {
        workspace: review::work::view_of(&queue, landing.workspace),
        created: landing.created,
        workspaces: review::work::views(queue),
    })
}

#[tauri::command]
pub fn get_current_branch(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_current_branch().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_user(repo_path: String) -> Result<Option<String>, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    Ok(source.get_user_name())
}

#[tauri::command]
pub fn get_remote_info(repo_path: String) -> Result<Option<RemoteInfo>, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_remote_info().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_origin(repo_path: String) -> Result<(), String> {
    let t0 = Instant::now();
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.fetch_origin().map_err(|e| e.to_string())?;
    info!("[fetch_origin] {} in {:?}", repo_path, t0.elapsed());
    Ok(())
}

#[tauri::command]
pub fn get_default_branch(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_default_branch().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_review_worktree(
    repo_path: String,
    name: String,
    git_ref: String,
) -> Result<WorktreeInfo, String> {
    let t0 = std::time::Instant::now();
    let source = LocalGitSource::new(repo_path.into()).map_err(|e| e.to_string())?;
    let result = source
        .create_review_worktree(&name, &git_ref)
        .map_err(|e| e.to_string())?;
    info!(
        "create_review_worktree name={} ref={} path={} in {:?}",
        name,
        git_ref,
        result.path,
        t0.elapsed()
    );
    Ok(result)
}

#[tauri::command]
pub fn remove_review_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    let source = LocalGitSource::new(repo_path.into()).map_err(|e| e.to_string())?;
    source
        .remove_review_worktree(&worktree_path)
        .map_err(|e| e.to_string())?;
    info!(
        "remove_review_worktree path={} in {:?}",
        worktree_path,
        t0.elapsed()
    );
    Ok(())
}

/// Every named repo's worktrees, each with its dirty flag — the picker's
/// situational awareness, batched so listing twenty repos is one call.
#[tauri::command]
pub async fn list_worktree_status(repo_paths: Vec<String>) -> Result<Vec<RepoWorktrees>, String> {
    blocking(move || {
        let t0 = std::time::Instant::now();
        let result = review::service::worktrees::status(&repo_paths);
        info!(
            "list_worktree_status {} repos in {:?}",
            result.len(),
            t0.elapsed()
        );
        Ok(result)
    })
    .await
}

/// Give a branch a worktree, or report the one it already has.
#[tauri::command]
pub async fn create_worktree(
    repo_path: String,
    branch: String,
) -> Result<WorktreeCheckout, String> {
    blocking(move || {
        let t0 = std::time::Instant::now();
        let result = review::service::worktrees::create(&PathBuf::from(&repo_path), &branch)
            .map_err(|e| e.to_string())?;
        info!(
            "create_worktree branch={} path={} created={} in {:?}",
            branch,
            result.path,
            result.created,
            t0.elapsed()
        );
        Ok(result)
    })
    .await
}

/// Remove a worktree. Refuses the main checkout, a path outside this repo, and
/// anything holding uncommitted work — see `LocalGitSource::remove_worktree`.
#[tauri::command]
pub async fn remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    blocking(move || {
        let t0 = std::time::Instant::now();
        review::service::worktrees::remove(&PathBuf::from(&repo_path), &worktree_path)
            .map_err(|e| e.to_string())?;
        info!(
            "remove_worktree path={} in {:?}",
            worktree_path,
            t0.elapsed()
        );
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn get_review_tier(repo_path: String, r#ref: String) -> Result<ReviewTierInfo, String> {
    review::service::pr::tier(&PathBuf::from(&repo_path), &r#ref).map_err(|e| e.to_string())
}

/// Rate-limit usage for the coding agents installed on this machine.
///
/// `force` bypasses the service-side cache, for the refresh button.
#[tauri::command]
pub async fn get_agent_usage(force: bool) -> Result<Vec<AgentUsage>, String> {
    blocking(move || review::service::usage::report(force).map_err(|e| e.to_string())).await
}

/// Listed → Fetched: pull a PR's head (and base) so its diff can be read locally.
#[tauri::command]
pub async fn fetch_pull_request(repo_path: String, pr: GitHubPrRef) -> Result<String, String> {
    blocking(move || {
        let t0 = std::time::Instant::now();
        let result = review::service::pr::fetch(&PathBuf::from(&repo_path), &pr)
            .map_err(|e| e.to_string())?;
        info!(
            "fetch_pull_request #{} -> {} in {:?}",
            pr.number,
            result,
            t0.elapsed()
        );
        Ok(result)
    })
    .await
}

/// Fetched → Materialized: provision a worktree so terminals, LSP, and staging
/// have files on disk to work with.
#[tauri::command]
pub async fn materialize_review(repo_path: String, r#ref: String) -> Result<String, String> {
    blocking(move || {
        let t0 = std::time::Instant::now();
        let path = review::service::pr::materialize(&PathBuf::from(&repo_path), &r#ref)
            .map_err(|e| e.to_string())?;
        info!(
            "materialize_review ref={} -> {} in {:?}",
            r#ref,
            path,
            t0.elapsed()
        );
        Ok(path)
    })
    .await
}

/// Materialized → Fetched: drop the worktree, keep the review record.
#[tauri::command]
pub fn release_review_worktree(repo_path: String, r#ref: String) -> Result<(), String> {
    review::service::pr::release(&PathBuf::from(&repo_path), &r#ref).map_err(|e| e.to_string())
}

/// Reclaim disk from PR reviews whose PR has merged or closed.
#[tauri::command]
pub async fn reclaim_closed_prs(repo_path: String) -> Result<Vec<String>, String> {
    blocking(move || {
        review::service::pr::reclaim_closed(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub fn resolve_ref(repo_path: String, git_ref: String) -> Result<String, String> {
    let source = LocalGitSource::new(repo_path.into()).map_err(|e| e.to_string())?;
    Ok(source.resolve_ref_or_empty_tree(&git_ref))
}

#[tauri::command]
pub fn update_worktree_head(
    repo_path: String,
    worktree_path: String,
    commit_sha: String,
) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    let source = LocalGitSource::new(repo_path.into()).map_err(|e| e.to_string())?;
    source
        .update_worktree_head(&worktree_path, &commit_sha)
        .map_err(|e| e.to_string())?;
    info!(
        "update_worktree_head path={} sha={} in {:?}",
        worktree_path,
        &commit_sha[..8.min(commit_sha.len())],
        t0.elapsed()
    );
    Ok(())
}

#[tauri::command]
pub fn list_all_local_activity() -> Result<Vec<RepoLocalActivity>, String> {
    review::service::activity::list_all_local_activity().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn register_repo(app: tauri::AppHandle, repo_path: String) -> Result<bool, String> {
    let registered = review::review::central::register_repo_if_valid(&PathBuf::from(&repo_path))
        .map_err(|e| e.to_string())?;
    if registered {
        if let Err(e) = super::watchers::start_local_activity_watcher_for(&repo_path, app) {
            error!("[register_repo] Failed to start watcher for {repo_path}: {e}");
        }
    }
    Ok(registered)
}

#[tauri::command]
pub fn unregister_repo(repo_path: String) -> Result<(), String> {
    review::review::central::unregister_repo(&PathBuf::from(&repo_path))
        .map_err(|e| e.to_string())?;
    super::watchers::stop_local_activity_watcher(&repo_path);
    Ok(())
}

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<BranchList, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.list_branches().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_status(repo_path: String) -> Result<GitStatusSummary, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_file(repo_path: String, path: String) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.stage_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_file(repo_path: String, path: String) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.unstage_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_all(repo_path: String) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.unstage_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_hunks(
    repo_path: String,
    file_path: String,
    content_hashes: Vec<String>,
) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .stage_hunks(&file_path, &content_hashes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_hunks(
    repo_path: String,
    file_path: String,
    content_hashes: Vec<String>,
) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .unstage_hunks(&file_path, &content_hashes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_commit(
    app: tauri::AppHandle,
    repo_path: String,
    message: String,
    request_id: String,
) -> Result<CommitResult, String> {
    use tauri::Emitter;

    let t0 = Instant::now();
    let event_name = format!("commit:output:{request_id}");

    debug!("[git_commit] repo_path={repo_path}, request_id={request_id}");

    let (tx, mut rx) = tokio::sync::mpsc::channel::<CommitOutputLine>(128);

    // Forward lines from the channel to Tauri events
    let emit_handle = app.clone();
    let emit_event = event_name.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            let _ = emit_handle.emit(&emit_event, &line);
        }
    });

    let result = tokio::task::spawn_blocking(move || {
        review::service::commit::git_commit_streaming(
            &PathBuf::from(&repo_path),
            &message,
            move |line| {
                let _ = tx.blocking_send(line);
            },
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    // Wait for all events to be emitted
    let _ = emit_task.await;

    match &result {
        Ok(r) if r.success => {
            info!("[git_commit] SUCCESS in {:?}", t0.elapsed());
        }
        Ok(r) => {
            info!("[git_commit] FAILED: {} in {:?}", r.summary, t0.elapsed());
        }
        Err(e) => {
            error!("[git_commit] ERROR: {} in {:?}", e, t0.elapsed());
        }
    }

    result
}

#[tauri::command]
pub fn get_working_tree_file_content(
    repo_path: String,
    file_path: String,
    cached: bool,
) -> Result<FileContent, String> {
    review::service::files::get_working_tree_file_content(
        &PathBuf::from(&repo_path),
        &file_path,
        cached,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_status_raw(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_status_raw().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_commits(
    repo_path: String,
    limit: Option<usize>,
    branch: Option<String>,
    range: Option<String>,
) -> Result<Vec<CommitEntry>, String> {
    let limit = limit.unwrap_or(50);
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .list_commits(limit, branch.as_deref(), range.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_commit_detail(repo_path: String, hash: String) -> Result<CommitDetail, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_commit_detail(&hash).map_err(|e| e.to_string())
}

/// Resolve a commit into the comparison that shows it — `parent..sha`, taking a
/// merge's first parent and the empty tree for a root commit.
#[tauri::command]
pub fn commit_comparison(repo_path: String, git_ref: String) -> Result<CommitComparison, String> {
    let t0 = Instant::now();
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    let resolved = source
        .commit_comparison(&git_ref)
        .map_err(|e| e.to_string())?;
    info!(
        "commit_comparison: {git_ref} -> {} in {:?}",
        resolved.comparison.key,
        t0.elapsed()
    );
    Ok(resolved)
}

#[tauri::command]
pub async fn get_hunk_attribution(
    repo_path: String,
    comparison: Comparison,
) -> Result<HunkAttribution, String> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
        source
            .attribute_hunks_to_commits(&comparison)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub fn classify_hunks_static(hunks: Vec<DiffHunk>) -> ClassifyResponse {
    let t0 = Instant::now();
    debug!(
        "[classify_hunks_static] Classifying {} hunks with static rules",
        hunks.len()
    );
    let result = classify::classify_hunks_static(&hunks);
    info!(
        "[classify_hunks_static] Classified {} of {} hunks in {:?}",
        result.classifications.len(),
        hunks.len(),
        t0.elapsed()
    );
    result
}

/// Validate that a path is within .git/review/ or ~/.review/ for security
fn validate_review_path(path: &str) -> Result<PathBuf, String> {
    review::service::util::validate_review_path(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let validated_path = validate_review_path(&path)?;
    std::fs::write(&validated_path, contents)
        .map_err(|e| format!("Failed to write file {path}: {e}"))
}

#[tauri::command]
pub fn append_to_file(path: String, contents: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let validated_path = validate_review_path(&path)?;

    if let Some(parent) = validated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories for {path}: {e}"))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&validated_path)
        .map_err(|e| format!("Failed to open file {path}: {e}"))?;

    file.write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to append to file {path}: {e}"))
}

#[tauri::command]
pub fn get_expanded_context(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
    start_line: u32,
    end_line: u32,
) -> Result<ExpandedContextResult, String> {
    review::service::files::get_expanded_context(
        &PathBuf::from(&repo_path),
        &file_path,
        &comparison,
        start_line,
        end_line,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn match_trust_pattern(label: String, pattern: String) -> bool {
    review::trust::matches_pattern(&label, &pattern)
}

#[tauri::command]
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    review::trust::patterns::get_trust_taxonomy()
}

#[tauri::command]
pub fn should_skip_file(path: String) -> bool {
    review::filters::should_skip_file(&path)
}

// File watching
#[tauri::command]
pub fn start_file_watcher(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    super::watchers::start_watching(&repo_path, app)
}

#[tauri::command]
pub fn stop_file_watcher(app: tauri::AppHandle, repo_path: String) {
    super::watchers::stop_watching(&repo_path, app);
}

/// Consume a pending CLI open request (signal file written by the `review` CLI).
/// Returns `Some(CliOpenRequest)` on cold start when the CLI launched the app,
/// or `None` if there is no pending request.
#[tauri::command]
pub fn consume_cli_request() -> Option<CliOpenRequest> {
    let req = super::read_open_request()?;
    Some(CliOpenRequest {
        repo_path: req.repo_path,
        ref_name: req.ref_name,
        focused_file: req.focused_file,
        focused_hunk_hash: req.focused_hunk_hash,
    })
}

#[derive(Debug, Serialize)]
pub struct CliOpenRequest {
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    #[serde(rename = "ref")]
    pub ref_name: Option<String>,
    #[serde(rename = "focusedFile")]
    pub focused_file: Option<String>,
    #[serde(rename = "focusedHunkHash")]
    pub focused_hunk_hash: Option<String>,
}

#[tauri::command]
pub async fn get_file_symbol_diffs(
    repo_path: String,
    file_paths: Vec<String>,
    comparison: Comparison,
) -> Result<Vec<FileSymbolDiff>, String> {
    blocking(move || {
        review::service::symbols::get_file_symbol_diffs(
            &PathBuf::from(&repo_path),
            &file_paths,
            &comparison,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_repo_symbols(repo_path: String) -> Result<Vec<RepoFileSymbols>, String> {
    blocking(move || {
        review::service::symbols::get_repo_symbols(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_file_symbols(
    repo_path: String,
    file_path: String,
    git_ref: Option<String>,
) -> Result<Option<Vec<Symbol>>, String> {
    blocking(move || {
        review::service::symbols::get_file_symbols(
            &PathBuf::from(&repo_path),
            &file_path,
            git_ref.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn find_symbol_definitions(
    repo_path: String,
    symbol_name: String,
    git_ref: Option<String>,
) -> Result<Vec<symbols::SymbolDefinition>, String> {
    blocking(move || {
        review::service::symbols::find_symbol_definitions(
            &PathBuf::from(&repo_path),
            &symbol_name,
            git_ref.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub fn search_file_contents(
    repo_path: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
) -> Result<Vec<SearchMatch>, String> {
    review::service::files::search_file_contents(
        &PathBuf::from(&repo_path),
        &query,
        case_sensitive,
        max_results,
    )
    .map_err(|e| e.to_string())
}

// --- Review freshness checking ---

#[tauri::command]
pub async fn check_reviews_freshness(
    reviews: Vec<ReviewFreshnessInput>,
) -> Vec<ReviewFreshnessResult> {
    review::service::freshness::check_reviews_freshness(reviews).await
}

// --- Dev mode detection ---

#[tauri::command]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub fn is_git_repo(path: String) -> bool {
    review::service::util::is_git_repo(&PathBuf::from(&path))
}

// --- Standalone file support ---

#[tauri::command]
pub fn path_is_file(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

#[tauri::command]
pub async fn read_raw_file(path: String) -> Result<FileContent, String> {
    blocking(move || {
        review::service::files::read_raw_file(std::path::Path::new(&path))
            .map_err(|e| e.to_string())
    })
    .await
}

/// Get a file's content as of a ref (no diff, no working-tree read).
#[tauri::command]
pub async fn get_file_content_at_ref(
    repo_path: String,
    file_path: String,
    git_ref: String,
) -> Result<FileContent, String> {
    blocking(move || {
        review::service::files::get_file_content_at_ref(
            &PathBuf::from(&repo_path),
            &file_path,
            &git_ref,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

// --- CLI sidecar install ---

/// Well-known install location for the `review` CLI symlink.
const CLI_SYMLINK_PATH: &str = "/usr/local/bin/review";

#[derive(Debug, Serialize)]
pub struct CliInstallStatus {
    pub installed: bool,
    pub symlink_target: Option<String>,
}

#[tauri::command]
pub fn get_cli_install_status() -> CliInstallStatus {
    let path = std::path::Path::new(CLI_SYMLINK_PATH);
    match std::fs::read_link(path) {
        Ok(target) => CliInstallStatus {
            installed: true,
            symlink_target: Some(target.to_string_lossy().to_string()),
        },
        Err(_) => CliInstallStatus {
            installed: false,
            symlink_target: None,
        },
    }
}

/// Run a shell command with administrator privileges via osascript.
/// Returns an error if the user cancels or the command fails.
fn run_admin_shell_command(shell_command: &str, cancel_message: &str) -> Result<(), String> {
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        shell_command
    );

    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Failed to run osascript: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("(-128)") {
            return Err(cancel_message.to_owned());
        }
        return Err(stderr.trim().to_owned());
    }

    Ok(())
}

#[tauri::command]
pub fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // The sidecar binary lives next to the main binary inside the app bundle:
    //   Review.app/Contents/MacOS/review-cli
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not determine resource dir: {e}"))?;

    // resource_dir points to Contents/Resources; the binary is in Contents/MacOS
    let sidecar_path = resource_dir
        .parent()
        .ok_or("Could not determine app bundle path")?
        .join("MacOS")
        .join("review-cli");

    if !sidecar_path.exists() {
        return Err(format!(
            "Sidecar binary not found at {}",
            sidecar_path.display()
        ));
    }

    let shell_command = format!("ln -sf '{}' '{}'", sidecar_path.display(), CLI_SYMLINK_PATH);
    run_admin_shell_command(&shell_command, "Installation cancelled")
        .map_err(|e| format!("Failed to create symlink: {e}"))?;

    info!(
        "[install_cli] Symlinked {} -> {}",
        CLI_SYMLINK_PATH,
        sidecar_path.display()
    );
    Ok(sidecar_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn uninstall_cli() -> Result<(), String> {
    let symlink_path = std::path::Path::new(CLI_SYMLINK_PATH);
    if symlink_path.symlink_metadata().is_ok() {
        let shell_command = format!("rm '{}'", CLI_SYMLINK_PATH);
        run_admin_shell_command(&shell_command, "Uninstall cancelled")
            .map_err(|e| format!("Failed to remove symlink: {e}"))?;

        info!("[uninstall_cli] Removed {CLI_SYMLINK_PATH}");
    }
    Ok(())
}

// --- Menu state ---

/// Apply the frontend's verdict on which menu items are available.
///
/// The rules live in the command registry (`ui/commands/appCommands.ts`), not
/// here. They used to live in both, with a coarse `(has_repo, view)` model on
/// this side that disagreed with the commands' own predicates — and because
/// macOS lets a *disabled* item's accelerator fall through to the webview, a
/// greyed-out menu item's shortcut still ran.
#[tauri::command]
pub fn set_menu_enabled(
    app: tauri::AppHandle,
    states: std::collections::HashMap<String, bool>,
) -> Result<(), String> {
    use tauri::Manager;

    let items: tauri::State<'_, super::MenuItems> = app.state();
    for (id, enabled) in states {
        if let Some(item) = items.0.get(&id) {
            item.set_enabled(enabled).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// --- Sentry consent ---

#[tauri::command]
pub fn set_sentry_consent(enabled: bool, state: tauri::State<'_, super::SentryConsent>) {
    state.0.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn generate_commit_message(
    app: tauri::AppHandle,
    repo_path: String,
    request_id: String,
) -> Result<String, String> {
    use tauri::Emitter;

    let t0 = Instant::now();
    let event_name = format!("commit-message:chunk:{request_id}");

    debug!("[generate_commit_message] repo_path={repo_path}, request_id={request_id}");

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(128);

    let emit_handle = app.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = emit_handle.emit(&event_name, &chunk);
        }
    });

    let result = tokio::task::spawn_blocking(move || {
        let repo_path = PathBuf::from(&repo_path);
        let source = LocalGitSource::new(repo_path.clone()).map_err(|e| e.to_string())?;
        let staged_diff = source.get_staged_diff().map_err(|e| e.to_string())?;
        if staged_diff.trim().is_empty() {
            return Err("No staged changes to generate a message for".to_owned());
        }
        let recent_messages = source.get_recent_commit_messages(10).unwrap_or_default();

        let mut on_text = |text: &str| {
            let _ = tx.blocking_send(text.to_owned());
        };
        review::ai::commit_message::generate_commit_message_streaming(
            &staged_diff,
            &recent_messages,
            &repo_path,
            &mut on_text,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    // Wait for all events to be emitted
    let _ = emit_task.await;

    match &result {
        Ok(msg) => info!(
            "[generate_commit_message] SUCCESS: {} chars in {:?}",
            msg.len(),
            t0.elapsed()
        ),
        Err(e) => error!(
            "[generate_commit_message] ERROR: {} in {:?}",
            e,
            t0.elapsed()
        ),
    }

    result
}

// --- Settings file I/O ---

/// Return the path to `~/.review/settings.json` (respects `$REVIEW_HOME`).
fn settings_path() -> Result<PathBuf, String> {
    let root = review::review::central::get_central_root().map_err(|e| e.to_string())?;
    Ok(root.join("settings.json"))
}

/// Read a single key from `settings.json`. Returns `None` if the file or key is missing.
pub fn read_setting(key: &str) -> Option<serde_json::Value> {
    let path = settings_path().ok()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
    obj.get(key).cloned()
}

/// Atomically write JSON to a file (write tmp + rename).
fn atomic_write_json(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the entire `settings.json` file. Returns `null` if the file doesn't exist.
#[tauri::command]
pub fn read_settings() -> Result<Option<serde_json::Value>, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

/// Atomically write the full settings JSON to `settings.json`.
#[tauri::command]
pub fn write_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path()?;
    atomic_write_json(&path, &settings)
}

/// Create the settings file if it doesn't exist, then open it with the system editor.
#[tauri::command]
pub fn open_settings_file(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = settings_path()?;
    if !path.exists() {
        // Create with empty object so the user has a valid JSON file to edit
        atomic_write_json(&path, &serde_json::json!({}))?;
    }
    app.opener()
        .open_path(path.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| e.to_string())
}

// --- VS Code theme detection ---

/// Detect the active VS Code theme by reading VS Code settings and extension files.
#[tauri::command]
pub fn detect_vscode_theme() -> Result<VscodeThemeDetection, String> {
    review::service::vscode::detect_vscode_theme().map_err(|e| e.to_string())
}

// --- Window background color ---

/// Set the background color of a window (affects title bar on macOS).
#[tauri::command]
pub fn set_window_background_color(
    window: tauri::WebviewWindow,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), String> {
    window
        .set_background_color(Some(tauri::window::Color(r, g, b, 255)))
        .map_err(|e| e.to_string())
}

/// List files in a plain directory (no git needed).
#[tauri::command]
pub async fn list_directory_plain(dir_path: String) -> Result<Vec<FileEntry>, String> {
    blocking(move || {
        review::service::files::list_directory_plain(std::path::Path::new(&dir_path))
            .map_err(|e| e.to_string())
    })
    .await
}

// --- LSP Commands ---

/// Get the LSP client for a given key.
async fn get_lsp_client(
    state: &tauri::State<'_, LspServers>,
    key: &LspServerKey,
) -> Result<std::sync::Arc<LspClient>, String> {
    let servers = state.0.lock().await;
    servers
        .get(key)
        .map(|h| std::sync::Arc::clone(&h.client))
        .ok_or_else(|| "No LSP server running for this file".to_owned())
}

#[tauri::command]
pub async fn lsp_goto_definition(
    state: tauri::State<'_, LspServers>,
    repo_path: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Vec<review::symbols::SymbolDefinition>, String> {
    let key = find_lsp_key_for_file(&state, &repo_path, &file_path).await?;
    let client = get_lsp_client(&state, &key).await?;

    review::service::symbols::find_definitions_via_lsp(
        &client,
        &PathBuf::from(&repo_path),
        &file_path,
        line,
        character,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_hover(
    state: tauri::State<'_, LspServers>,
    repo_path: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Option<serde_json::Value>, String> {
    let key = find_lsp_key_for_file(&state, &repo_path, &file_path).await?;
    let client = get_lsp_client(&state, &key).await?;

    let hover = review::service::symbols::find_hover_via_lsp(
        &client,
        &PathBuf::from(&repo_path),
        &file_path,
        line,
        character,
    )
    .await
    .map_err(|e| e.to_string())?;

    match hover {
        Some(h) => serde_json::to_value(h).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn lsp_find_references(
    state: tauri::State<'_, LspServers>,
    repo_path: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Vec<review::symbols::SymbolDefinition>, String> {
    let key = find_lsp_key_for_file(&state, &repo_path, &file_path).await?;
    let client = get_lsp_client(&state, &key).await?;

    review::service::symbols::find_references_via_lsp(
        &client,
        &PathBuf::from(&repo_path),
        &file_path,
        line,
        character,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn init_lsp_servers(
    state: tauri::State<'_, LspServers>,
    repo_path: String,
) -> Result<Vec<LspServerStatus>, String> {
    let t0 = Instant::now();
    let repo = PathBuf::from(&repo_path);
    let discovered = registry::discover_servers(&repo);

    let mut statuses = Vec::new();

    for config in discovered {
        let key = LspServerKey {
            repo_path: repo_path.clone(),
            language: config.language.clone(),
        };

        // Already running — including from an earlier visit to this review,
        // which is the point of keeping roots warm.
        {
            let mut servers = state.0.lock().await;
            if let Some(handle) = servers.get_mut(&key) {
                handle.last_used = Instant::now();
                statuses.push(LspServerStatus {
                    name: config.name.clone(),
                    language: config.language.clone(),
                    state: LspServerState::Ready,
                });
                continue;
            }
        }

        match start_and_register_server(&state, &repo_path, &config.language).await {
            Ok(status) => {
                info!(
                    "[init_lsp_servers] started {} for {}",
                    status.name, status.language
                );
                statuses.push(status);
            }
            Err(e) => {
                error!(
                    "[init_lsp_servers] failed to start {} for {}: {e}",
                    config.name, config.language
                );
                statuses.push(LspServerStatus {
                    name: config.name.clone(),
                    language: config.language.clone(),
                    state: LspServerState::Error,
                });
            }
        }
    }

    evict_cold_lsp_roots(&state).await;

    info!(
        "[init_lsp_servers] {} servers for {} in {:?}",
        statuses.len(),
        repo_path,
        t0.elapsed()
    );

    Ok(statuses)
}

/// Shut down the language servers of every root past the warm-root budget,
/// least recently used first.
async fn evict_cold_lsp_roots(state: &tauri::State<'_, LspServers>) {
    let evicted: Vec<LspServerHandle> = {
        let mut servers = state.0.lock().await;

        // Recency is per root, not per server: a root's servers live and die
        // together, so one cold Cargo workspace frees all of its processes.
        let mut roots: HashMap<&str, Instant> = HashMap::new();
        for (key, handle) in servers.iter() {
            roots
                .entry(key.repo_path.as_str())
                .and_modify(|seen| *seen = (*seen).max(handle.last_used))
                .or_insert(handle.last_used);
        }
        if roots.len() <= MAX_WARM_LSP_ROOTS {
            return;
        }

        // Everything past the newest N roots goes, servers and all.
        let cold: std::collections::HashSet<String> = {
            let mut by_recency: Vec<(&str, Instant)> = roots.into_iter().collect();
            by_recency.sort_unstable_by_key(|r| std::cmp::Reverse(r.1));
            by_recency[MAX_WARM_LSP_ROOTS..]
                .iter()
                .map(|(root, _)| (*root).to_owned())
                .collect()
        };

        let keys: Vec<LspServerKey> = servers
            .keys()
            .filter(|key| cold.contains(&key.repo_path))
            .cloned()
            .collect();
        keys.into_iter()
            .filter_map(|key| servers.remove(&key))
            .collect()
    };

    // The caller is a review switch waiting to render — say goodbye off to the
    // side rather than making it wait through a handshake per dead server.
    tokio::spawn(async move {
        for handle in evicted {
            let _ = handle.client.shutdown().await;
            info!(
                "[lsp] evicted {} for {} (cold workspace)",
                handle.name, handle.language
            );
        }
    });
}

#[tauri::command]
pub async fn stop_all_lsp_servers(
    state: tauri::State<'_, LspServers>,
    repo_path: String,
) -> Result<(), String> {
    let handles: Vec<LspServerHandle> = {
        let mut servers = state.0.lock().await;
        let keys: Vec<LspServerKey> = servers
            .keys()
            .filter(|k| k.repo_path == repo_path)
            .cloned()
            .collect();
        keys.into_iter()
            .filter_map(|k| servers.remove(&k))
            .collect()
    };
    for handle in handles {
        let _ = handle.client.shutdown().await;
        info!(
            "[stop_all_lsp_servers] stopped {} for {}",
            handle.name, handle.language
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn restart_lsp_server(
    state: tauri::State<'_, LspServers>,
    repo_path: String,
    language: String,
) -> Result<LspServerStatus, String> {
    let key = LspServerKey {
        repo_path: repo_path.clone(),
        language: language.clone(),
    };

    // Remove existing server for this language
    let old = {
        let mut servers = state.0.lock().await;
        servers.remove(&key)
    };
    if let Some(handle) = old {
        let _ = handle.client.shutdown().await;
        info!(
            "[restart_lsp_server] shut down old {} for {}",
            handle.name, handle.language
        );
    }

    // Re-discover and start
    let status = start_and_register_server(&state, &repo_path, &language).await?;

    info!(
        "[restart_lsp_server] restarted {} for {}",
        status.name, language
    );

    Ok(status)
}

#[tauri::command]
pub async fn discover_lsp_servers(repo_path: String) -> Result<Vec<LspServerStatus>, String> {
    let repo = PathBuf::from(&repo_path);
    let discovered = registry::discover_servers(&repo);
    Ok(discovered
        .iter()
        .map(|s| LspServerStatus {
            name: s.name.to_owned(),
            language: s.language.to_owned(),
            state: LspServerState::Stopped,
        })
        .collect())
}

/// Discover, start, and register an LSP server for a given language.
///
/// Looks up the server configuration via `discover_servers`, starts the
/// process, wraps it in an `Arc`, and inserts it into the managed map.
async fn start_and_register_server(
    state: &tauri::State<'_, LspServers>,
    repo_path: &str,
    language: &str,
) -> Result<LspServerStatus, String> {
    let repo = PathBuf::from(repo_path);
    let discovered = registry::discover_servers(&repo);
    let config = discovered
        .into_iter()
        .find(|s| s.language == language)
        .ok_or_else(|| format!("No LSP server found for {language}"))?;

    let args: Vec<&str> = config.args.iter().map(|s| s.as_str()).collect();
    let client = LspClient::start(&config.command, &args, &repo)
        .await
        .map_err(|e| format!("Failed to start LSP server: {e}"))?;

    let key = LspServerKey {
        repo_path: repo_path.to_owned(),
        language: language.to_owned(),
    };
    let handle = LspServerHandle {
        client: std::sync::Arc::new(client),
        name: config.name.to_owned(),
        language: language.to_owned(),
        last_used: Instant::now(),
    };
    // The spawn happens outside the lock, so two concurrent inits (dev
    // StrictMode fires every effect twice) can both pass the already-running
    // check and both reach here. Whoever registers second must shut their
    // process down — a plain insert would overwrite the first handle and
    // orphan a live server nothing can reach again.
    let duplicate = {
        let mut servers = state.0.lock().await;
        match servers.entry(key) {
            std::collections::hash_map::Entry::Occupied(mut existing) => {
                existing.get_mut().last_used = Instant::now();
                Some(handle)
            }
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(handle);
                None
            }
        }
    };
    if let Some(loser) = duplicate {
        if let Err(e) = loser.client.shutdown().await {
            warn!(
                "[init_lsp_servers] shutting down duplicate {} failed: {e}",
                config.name
            );
        }
    }

    Ok(LspServerStatus {
        name: config.name.to_owned(),
        language: language.to_owned(),
        state: LspServerState::Ready,
    })
}

/// Find (or restart) the LSP server for a file.
///
/// If the server exists but has died, removes it and attempts a restart.
async fn find_lsp_key_for_file(
    state: &tauri::State<'_, LspServers>,
    repo_path: &str,
    file_path: &str,
) -> Result<LspServerKey, String> {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let language = registry::language_for_extension(ext)
        .ok_or_else(|| format!("No LSP support for .{ext} files"))?;

    let key = LspServerKey {
        repo_path: repo_path.to_owned(),
        language: language.to_owned(),
    };

    // Check if server exists and is alive; remove dead entries atomically
    {
        let mut servers = state.0.lock().await;
        if let Some(handle) = servers.get_mut(&key) {
            if handle.client.is_alive() {
                handle.last_used = Instant::now();
                return Ok(key);
            }
            info!(
                "[lsp] server {} for {} died, will restart",
                handle.name, handle.language
            );
        }
        servers.remove(&key);
    }

    let status = start_and_register_server(state, repo_path, language).await?;

    info!(
        "[lsp] restarted {} for {} (auto-recovery)",
        status.name, language
    );

    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(of: &[&str]) -> HashSet<String> {
        of.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn the_focused_workspace_counts_as_in_use() {
        // A ⌘K peek has no terminal, so nothing else in `cleanup`'s three
        // rules keeps it while it is being read.
        let live = in_use(Some(ids(&["running"])), Some("peeked".to_owned()));
        assert_eq!(live.unwrap(), ids(&["running", "peeked"]));
    }

    #[test]
    fn nothing_focused_leaves_the_live_set_alone() {
        assert_eq!(
            in_use(Some(ids(&["running"])), None).unwrap(),
            ids(&["running"])
        );
    }

    #[test]
    fn an_unknown_liveness_answer_stays_unknown() {
        // `None` is "the daemon could not be reached", not "nothing is
        // running" — cleanup must not run, and a focused id is not a
        // reason to start.
        assert!(in_use(None, Some("peeked".to_owned())).is_none());
    }
}
