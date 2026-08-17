//! The work queue — a user-ordered list of the workspaces they intend to work
//! on.
//!
//! A **workspace** is a container that becomes whatever is put in it. It holds
//! an optional title and an ordered list of **attachments** — the repositories
//! (or plain directories) its code side shows. Everything live — terminals,
//! pull requests, review state, diffs — is derived elsewhere and joined against
//! those attachments, or against the workspace id the daemon stamps on a
//! session.
//!
//! Three properties define the model:
//!
//! - **Global, not per-repo.** One queue spans every repository, so a workspace
//!   can attach `repo-a` and `repo-b` at once. It lives at `~/.review/work.json`
//!   (see [`storage`]).
//! - **Array order is priority order.** [`WorkState::workspaces`] is the queue,
//!   top to bottom; [`move_workspace`] is the only thing that reorders it.
//! - **Attachments are not exclusive.** Any number of workspaces may attach the
//!   same path; a workspace shows a path at most once. Nothing here can
//!   conflict, so nothing here has to ask.
//!
//! A title is optional because most workspaces need no naming: with none stored,
//! [`Workspace::display_title`] derives one at read time from the first
//! attachment, else "Untitled". A terminal's title never stands in — what a
//! workspace is about is its attachments, not what happens to be running in it.
//!
//! The one piece of bookkeeping is [`Workspace::auto_created`], which the
//! [`router`] alone sets and every mutation here clears — so it means, precisely,
//! "nothing but the router has ever touched this", which is the whole licence
//! for [`cleanup`] to reap one.

pub mod router;
pub mod storage;

use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::review::central;
use crate::review::state::{iso8601_from_system_time, now_iso8601, unique_id_seed};

/// Schema version of `work.json`. Bumped when the stored shape changes; an older
/// document loads as an empty queue (see [`storage::load`]) and a newer one is
/// refused.
pub const WORK_SCHEMA_VERSION: u32 = 2;

/// What a workspace with nothing to derive a title from is called.
const UNTITLED: &str = "Untitled";

/// The separator between a repo and the ref it is attached at ("django ·
/// master"). Distinct from anything a branch name can contain, so a derived
/// title reads as derived.
const TITLE_SEP: &str = " · ";

#[derive(Error, Debug)]
pub enum WorkError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Central storage error: {0}")]
    Central(#[from] central::CentralError),
    #[error("Version conflict: expected version {expected}, found {found}. Another process modified the work queue.")]
    VersionConflict { expected: u64, found: u64 },
    #[error("the work queue was written by a newer version of Review (schema v{found}, this build supports v{supported}); upgrade Review to open it")]
    SchemaTooNew { found: u32, supported: u32 },
    #[error("No workspace matches '{0}'.")]
    NotFound(String),
    #[error("'{query}' is ambiguous; it matches: {}", .matches.join(", "))]
    Ambiguous { query: String, matches: Vec<String> },
    #[error("Failed to save the work queue after repeated version conflicts.")]
    Contended,
}

/// Something a workspace is looking at: a repository, optionally at a ref.
///
/// `path` is normalized to the repo's main working tree (see
/// [`normalize_repo_path`]) so one repository has one identity no matter which
/// worktree — or which surface, CLI or app — attached it. A path outside any
/// repository normalizes to itself, which is the degenerate case: a plain
/// directory attaches exactly like a repo.
///
/// `ref_name` is a **view hint**, not identity: it is the branch or comparison
/// the workspace was looking at, and two attachments of the same path are the
/// same attachment whatever their refs say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub path: String,
    #[serde(default)]
    pub ref_name: Option<String>,
}

impl Attachment {
    pub fn new(path: impl AsRef<std::path::Path>, ref_name: Option<String>) -> Self {
        Self {
            path: normalize_repo_path(path.as_ref()),
            // An empty ref is no ref; the router hands one over for a directory
            // outside any repository, and the wire may spell it either way.
            ref_name: ref_name.filter(|name| !name.trim().is_empty()),
        }
    }

    /// This attachment with its path normalized. Every operation runs its
    /// attachments through here rather than trusting the caller: one can arrive
    /// deserialized straight off the wire (the app posts `{path, refName}`),
    /// which skips [`Attachment::new`] and would otherwise let one repository
    /// appear twice under two spellings of its path. Idempotent.
    fn normalized(&self) -> Self {
        Self::new(&self.path, self.ref_name.clone())
    }

    /// The directory name, for display ("review", not the full path).
    pub fn repo_name(&self) -> &str {
        central::display_name(std::path::Path::new(&self.path))
    }

    /// This attachment on one line: "review · feature/x", or just the directory
    /// name when it carries no ref.
    pub fn label(&self) -> String {
        match self.ref_name.as_deref().filter(|name| !name.is_empty()) {
            Some(ref_name) => format!("{}{TITLE_SEP}{ref_name}", self.repo_name()),
            None => self.repo_name().to_owned(),
        }
    }
}

/// One unit of intent in the queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    /// 8 hex characters. Commands accept any unique prefix.
    pub id: String,
    /// The title the human gave it. `None` means "derive one" — see
    /// [`Workspace::display_title`] — and renaming to an empty string returns
    /// here.
    #[serde(default)]
    pub title: Option<String>,
    /// What this workspace is looking at, in tab order.
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    /// Whether the router invented this and nothing has touched it since. Every
    /// mutation below clears it (see [`adopt_at`]), which is what makes
    /// [`cleanup`] safe. Internal plumbing: no surface shows it.
    #[serde(default)]
    pub auto_created: bool,
    /// RFC 3339 timestamp.
    pub created_at: String,
}

impl Workspace {
    /// What to call this workspace, derived when nobody named it.
    ///
    /// Two rungs: the stored title, then the first attachment's label. What a
    /// workspace is *about* is its attachments — a terminal's title never
    /// stands in, because a terminal is something running in the workspace,
    /// not what the workspace is. A workspace with neither reads "Untitled",
    /// which is the honest answer until something is attached or typed.
    pub fn display_title(&self) -> String {
        if let Some(title) = self.title.as_deref().filter(|t| !t.trim().is_empty()) {
            return title.to_owned();
        }
        if let Some(attachment) = self.attachments.first() {
            return attachment.label();
        }
        UNTITLED.to_owned()
    }

    /// Where `path` sits among the attachments, if it is attached at all.
    /// Identity is the path alone — a ref is a view hint, so re-attaching a repo
    /// at another ref moves the hint rather than opening a second tab.
    fn attachment_index(&self, path: &str) -> Option<usize> {
        self.attachments
            .iter()
            .position(|attached| attached.path == path)
    }
}

/// A workspace as a surface renders it: everything stored, plus the title to
/// show.
///
/// `display_title` is not stored because its lower rungs move underneath it —
/// attach a repo and the derived title changes with no write. Sending both this
/// and the raw `title` is what lets a rename field prefill with what the human
/// typed rather than with what was derived for them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    #[serde(flatten)]
    pub workspace: Workspace,
    pub display_title: String,
}

impl From<Workspace> for WorkspaceView {
    fn from(workspace: Workspace) -> Self {
        let display_title = workspace.display_title();
        WorkspaceView {
            workspace,
            display_title,
        }
    }
}

/// Every workspace as a surface renders it.
pub fn views(workspaces: Vec<Workspace>) -> Vec<WorkspaceView> {
    workspaces.into_iter().map(Into::into).collect()
}

/// The whole queue, as stored. Array order is priority order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkState {
    /// Shape of this document; see [`WORK_SCHEMA_VERSION`].
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// Optimistic-concurrency counter, bumped on every write.
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
}

fn default_schema_version() -> u32 {
    WORK_SCHEMA_VERSION
}

impl Default for WorkState {
    fn default() -> Self {
        Self {
            schema_version: WORK_SCHEMA_VERSION,
            version: 0,
            workspaces: Vec::new(),
        }
    }
}

impl WorkState {
    /// The first workspace in priority order attached to `path`, if any.
    ///
    /// The routing rule in one place: attachments are not exclusive, so "which
    /// workspace does this directory belong to?" has no unique answer and the
    /// queue's own order decides. A wrong guess costs a terminal drag.
    pub(crate) fn first_attached(&self, path: &str) -> Option<&Workspace> {
        self.workspaces
            .iter()
            .find(|ws| ws.attachment_index(path).is_some())
    }
}

/// Normalize a repo path to the repository's main working tree, canonicalized.
///
/// Attachments are keyed by this, so a repo attached from a linked worktree,
/// from the app, and from a relative CLI path all collapse to the same identity
/// — the same normalization [`central::list_registered_repos`] entries carry,
/// which is what the frontend joins these against.
pub fn normalize_repo_path(path: &std::path::Path) -> String {
    central::repo_root(path).to_string_lossy().to_string()
}

/// Mint an 8-hex-character workspace id from [`unique_id_seed`]. The caller
/// re-rolls on the (astronomically unlikely) chance the truncated hash matches
/// an existing workspace.
fn new_id() -> String {
    let mut hasher = Sha256::new();
    hasher.update(unique_id_seed().as_bytes());
    hex::encode(&hasher.finalize()[..4])
}

/// Resolve a user-supplied id to its index in the queue, accepting a unique
/// prefix so nobody has to echo a full id back. Exact match wins; otherwise the
/// prefix must be unambiguous. Mirrors `review terminal`'s id resolution.
///
/// Returning the index rather than the id is what lets every mutation address
/// its workspace in one step — the id would only have to be looked up again.
fn resolve_index(state: &WorkState, query: &str) -> Result<usize, WorkError> {
    let mut matches = Vec::new();
    for (index, ws) in state.workspaces.iter().enumerate() {
        if ws.id == query {
            return Ok(index);
        }
        if ws.id.starts_with(query) {
            matches.push(index);
        }
    }
    match matches.len() {
        0 => Err(WorkError::NotFound(query.to_owned())),
        1 => Ok(matches[0]),
        _ => Err(WorkError::Ambiguous {
            query: query.to_owned(),
            matches: matches
                .into_iter()
                .map(|i| state.workspaces[i].id.clone())
                .collect(),
        }),
    }
}

const MAX_SAVE_RETRIES: usize = 5;

/// Load the queue, apply a mutation, and save — retrying on version conflicts
/// so a concurrent write (the app and the CLI both touch this file) doesn't
/// fail the command. Mirrors `cli::common::mutate_review`.
///
/// `apply` returns `(value, changed)`. A `false` `changed` is a genuine no-op
/// (re-attaching a path the workspace already shows, moving a workspace to where
/// it already is): the state is returned untouched, with no version bump, no
/// write, and no file-watcher churn.
fn mutate<T, F>(apply: F) -> Result<(WorkState, T), WorkError>
where
    F: Fn(&mut WorkState) -> Result<(T, bool), WorkError>,
{
    for attempt in 0..MAX_SAVE_RETRIES {
        let mut state = storage::load()?;
        let (value, changed) = apply(&mut state)?;
        if !changed {
            return Ok((state, value));
        }
        state.version += 1;
        match storage::save(&state) {
            Ok(()) => return Ok((state, value)),
            Err(WorkError::VersionConflict { .. }) if attempt + 1 < MAX_SAVE_RETRIES => {}
            Err(e) => return Err(e),
        }
    }
    Err(WorkError::Contended)
}

/// The whole queue, in priority order.
pub fn list() -> Result<WorkState, WorkError> {
    storage::load()
}

/// One workspace by id (a unique prefix is accepted).
pub fn get(id: &str) -> Result<Workspace, WorkError> {
    let state = storage::load()?;
    let index = resolve_index(&state, id)?;
    Ok(state.workspaces[index].clone())
}

/// Take a workspace out of the router's hands, returning whether that changed
/// anything.
///
/// Every mutation below calls this: touching a workspace in any way — naming it,
/// prioritizing it, attaching to it, detaching from it — is the human taking it
/// over, and only that keeps `auto_created` meaning "nothing but the router has
/// ever touched this", which is the whole licence for [`cleanup`] to reap one.
fn adopt_at(state: &mut WorkState, index: usize) -> bool {
    let changed = state.workspaces[index].auto_created;
    state.workspaces[index].auto_created = false;
    changed
}

/// Build and append a workspace, minting an id no existing workspace shares.
fn push_new(
    state: &mut WorkState,
    title: Option<String>,
    attachments: Vec<Attachment>,
    auto_created: bool,
) -> Workspace {
    let mut id = new_id();
    while state.workspaces.iter().any(|ws| ws.id == id) {
        id = new_id();
    }
    let workspace = Workspace {
        id,
        title: title.filter(|t| !t.trim().is_empty()),
        attachments,
        auto_created,
        created_at: now_iso8601(),
    };
    state.workspaces.push(workspace.clone());
    workspace
}

/// Append a workspace to the end of the queue. [`move_workspace`] is the only
/// thing that reorders, so a caller that wants it elsewhere adds then moves —
/// which is what every surface does.
///
/// Neither a title nor an attachment is required: an empty workspace is what the
/// sidebar's `+` makes, and it becomes whatever is put in it. Repeated
/// attachments of one path collapse.
pub fn add(
    title: Option<&str>,
    attachments: Vec<Attachment>,
) -> Result<(WorkState, Workspace), WorkError> {
    let title = title.map(str::trim).map(ToOwned::to_owned);
    mutate(move |state| {
        let mut resolved: Vec<Attachment> = Vec::new();
        for attachment in &attachments {
            push_unique(&mut resolved, attachment.normalized());
        }
        // A workspace the human asked for is theirs from birth; only the
        // router's `push_new` call opts out.
        Ok((push_new(state, title.clone(), resolved, false), true))
    })
}

/// Attach `attachment` unless its path is already there, in which case the
/// stored ref hint follows the new one.
fn push_unique(attachments: &mut Vec<Attachment>, attachment: Attachment) {
    match attachments
        .iter()
        .position(|attached| attached.path == attachment.path)
    {
        Some(index) => attachments[index].ref_name = attachment.ref_name,
        None => attachments.push(attachment),
    }
}

/// Remove a workspace, returning the one that was removed.
pub fn remove(id: &str) -> Result<(WorkState, Workspace), WorkError> {
    mutate(|state| {
        let index = resolve_index(state, id)?;
        Ok((state.workspaces.remove(index), true))
    })
}

/// Retitle a workspace. An empty title clears the stored one, which resumes
/// derivation (see [`Workspace::display_title`]).
pub fn rename(id: &str, title: Option<&str>) -> Result<(WorkState, Workspace), WorkError> {
    let title = title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(ToOwned::to_owned);
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        let changed = state.workspaces[index].title != title;
        state.workspaces[index].title.clone_from(&title);
        let adopted = adopt_at(state, index);
        Ok((state.workspaces[index].clone(), changed || adopted))
    })
}

/// Move a workspace to `to_index` (0-based). An index past the end clamps to
/// last.
///
/// `reorderWorkspaces` in `desktop/ui/stores/slices/workspaceSlice.ts` is the
/// mirror of this, applied optimistically before the round trip. The two clamps
/// have to agree or the list visibly jumps when the authoritative answer
/// arrives.
pub fn move_workspace(id: &str, to_index: usize) -> Result<(WorkState, Workspace), WorkError> {
    mutate(move |state| {
        let from = resolve_index(state, id)?;
        let to = to_index.min(state.workspaces.len().saturating_sub(1));
        if from == to {
            let adopted = adopt_at(state, from);
            return Ok((state.workspaces[from].clone(), adopted));
        }
        let workspace = state.workspaces.remove(from);
        state.workspaces.insert(to, workspace);
        adopt_at(state, to);
        Ok((state.workspaces[to].clone(), true))
    })
}

/// Show a path in a workspace. Attachments are not exclusive, so this can never
/// conflict: any number of workspaces may attach the same repository, and a
/// workspace already showing the path only updates its ref hint.
pub fn attach(id: &str, attachment: Attachment) -> Result<(WorkState, Workspace), WorkError> {
    let attachment = attachment.normalized();
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        let before = state.workspaces[index].attachments.clone();
        push_unique(&mut state.workspaces[index].attachments, attachment.clone());
        let changed = state.workspaces[index].attachments != before;
        let adopted = adopt_at(state, index);
        Ok((state.workspaces[index].clone(), changed || adopted))
    })
}

/// Stop showing a path. Detaching one the workspace doesn't show is a no-op.
pub fn detach(id: &str, path: &std::path::Path) -> Result<(WorkState, Workspace), WorkError> {
    let path = normalize_repo_path(path);
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        let before = state.workspaces[index].attachments.len();
        state.workspaces[index]
            .attachments
            .retain(|attached| attached.path != path);
        let changed = state.workspaces[index].attachments.len() != before;
        let adopted = adopt_at(state, index);
        Ok((state.workspaces[index].clone(), changed || adopted))
    })
}

/// How long a workspace is safe from [`cleanup`] after it is created.
///
/// The router mints a workspace *before* the terminal it was minted for exists:
/// `route_to` writes the queue, then the caller asks the daemon to start the
/// session. A reader landing between those two steps sees an auto-created
/// workspace with no live terminal and would reap the thing that is about to be
/// used. A minute is far longer than that window and far shorter than a
/// workspace anyone would miss.
pub const CLEANUP_GRACE: Duration = Duration::from_secs(60);

/// Drop the router's workspaces that nothing is using, returning whether any
/// went.
///
/// `live` is the set of workspace ids that currently have a terminal — which is
/// why this takes it rather than looking: the daemon owns that fact, this module
/// owns the queue, and the caller is whoever holds both. **A caller that cannot
/// answer must not call this**: an empty set means "nothing is running", not
/// "I don't know", and the difference is every auto-created workspace in the
/// queue.
///
/// Three things save a workspace, and each is a different kind of "someone wants
/// this": a human touched it (see [`adopt_at`]), it has a live terminal, or it is
/// younger than `grace` (see [`CLEANUP_GRACE`]).
///
/// Timestamps are compared as strings, which works because
/// [`iso8601_from_system_time`] is fixed-width UTC and therefore sorts
/// chronologically — no date parser for a question this coarse. A workspace with
/// an unreadable (or empty) `created_at` sorts before every cutoff and so gets no
/// grace, which is the safe direction: it is still protected by being adopted or
/// live.
pub fn cleanup(state: &mut WorkState, live: &HashSet<String>, grace: Duration) -> bool {
    let cutoff = iso8601_from_system_time(
        SystemTime::now()
            .checked_sub(grace)
            .unwrap_or(SystemTime::UNIX_EPOCH),
    );
    let before = state.workspaces.len();
    state
        .workspaces
        .retain(|ws| !ws.auto_created || live.contains(&ws.id) || ws.created_at > cutoff);
    state.workspaces.len() != before
}

/// The queue, cleaned when the caller could answer "what is live", and left
/// alone when it could not.
///
/// `None` means "nobody can say", not "nothing is running" — see [`cleanup`] for
/// why that difference is every auto-created workspace in the queue. Both readers
/// that hold the queue and the daemon's answer at once (the app's `work_list` and
/// `review work list`) go through here, so the distinction is decided once
/// instead of being restated at each of them.
pub fn list_with_liveness(live: Option<&HashSet<String>>) -> Result<WorkState, WorkError> {
    match live {
        Some(live) => list_cleaned(live),
        None => list(),
    }
}

/// The queue, with the router's dead leftovers reaped on the way out.
///
/// Cleanup is lazy — it happens on read, in the one place that has both the
/// queue and the liveness answer — so the daemon never writes `work.json` and
/// there is only ever one writer. Nothing is written when nothing is reaped.
pub fn list_cleaned(live: &HashSet<String>) -> Result<WorkState, WorkError> {
    let (state, ()) = mutate(|state| Ok(((), cleanup(state, live, CLEANUP_GRACE))))?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use std::path::PathBuf;

    /// An attachment that skips path normalization, so tests don't depend on
    /// temp dirs resolving to anything in particular.
    fn at(path: &str, ref_name: Option<&str>) -> Attachment {
        Attachment {
            path: path.to_owned(),
            ref_name: ref_name.map(ToOwned::to_owned),
        }
    }

    fn shown(state: &WorkState) -> Vec<String> {
        state
            .workspaces
            .iter()
            .map(|ws| ws.display_title())
            .collect()
    }

    fn add_ws(title: &str, attachments: Vec<Attachment>) -> Workspace {
        add(Some(title), attachments).unwrap().1
    }

    /// A workspace as [`router`] alone creates them. Tests can't build one
    /// through the public mutations — every one of those adopts it, which is the
    /// property under test.
    fn auto(attachments: Vec<Attachment>) -> Workspace {
        mutate(move |state| {
            let mut resolved = Vec::new();
            for attachment in &attachments {
                push_unique(&mut resolved, attachment.normalized());
            }
            Ok((push_new(state, None, resolved, true), true))
        })
        .unwrap()
        .1
    }

    #[test]
    fn missing_file_is_an_empty_queue() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let state = list().unwrap();
        assert_eq!(state.version, 0);
        assert_eq!(state.schema_version, WORK_SCHEMA_VERSION);
        assert!(state.workspaces.is_empty());
        assert!(!storage::work_path().unwrap().exists());
    }

    #[test]
    fn add_appends_and_move_is_what_reorders() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("first", vec![]);
        add_ws("second", vec![]);
        let urgent = add_ws("urgent", vec![]);
        // New workspaces land at the end — the newest thing is the least
        // prioritized until it's moved.
        assert_eq!(shown(&list().unwrap()), ["first", "second", "urgent"]);

        // Getting it to the top is a separate step, on every surface.
        let (state, _) = move_workspace(&urgent.id, 0).unwrap();
        assert_eq!(shown(&state), ["urgent", "first", "second"]);

        // Every write bumps the version.
        assert_eq!(state.version, 4);
    }

    #[test]
    fn a_workspace_needs_nothing_at_all() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        // What the sidebar's `+` makes: no title, no attachment, and it is the
        // human's from birth.
        let (state, ws) = add(None, vec![]).unwrap();
        assert_eq!(ws.title, None);
        assert!(ws.attachments.is_empty());
        assert!(!ws.auto_created);
        assert_eq!(state.workspaces.len(), 1);
    }

    #[test]
    fn ids_are_8_hex_chars_and_unique() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let a = add_ws("a", vec![]);
        let b = add_ws("b", vec![]);
        assert_eq!(a.id.len(), 8);
        assert!(a.id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a.id, b.id);
        assert_eq!(list().unwrap().workspaces.len(), 2);
    }

    /// The titling ladder, rung by rung.
    #[test]
    fn a_title_is_derived_until_someone_sets_one() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        // Nothing to go on.
        let bare = add(None, vec![]).unwrap().1;
        assert_eq!(bare.display_title(), "Untitled");

        // An attachment names it, and carries its ref when it has one.
        let (_, attached) = attach(&bare.id, at("/repos/review", None)).unwrap();
        assert_eq!(attached.display_title(), "review");
        let (_, at_ref) = attach(&bare.id, at("/repos/review", Some("feature/x"))).unwrap();
        assert_eq!(at_ref.display_title(), "review · feature/x");

        // A stored title outranks everything, and clearing it goes back down the
        // ladder.
        let (_, named) = rename(&bare.id, Some("Ship it")).unwrap();
        assert_eq!(named.display_title(), "Ship it");
        let (_, cleared) = rename(&bare.id, Some("   ")).unwrap();
        assert_eq!(cleared.title, None);
        assert_eq!(cleared.display_title(), "review · feature/x");
    }

    #[test]
    fn attachments_are_not_exclusive() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let first = add_ws("first", vec![at("/r", Some("main"))]);
        let second = add_ws("second", vec![]);

        // The same repo, in two workspaces, at the same ref: no conflict, no
        // error, nothing taken from anyone.
        let (state, second) = attach(&second.id, at("/r", Some("main"))).unwrap();
        assert_eq!(second.attachments, vec![at("/r", Some("main"))]);
        let held = state.workspaces.iter().find(|w| w.id == first.id).unwrap();
        assert_eq!(held.attachments, vec![at("/r", Some("main"))]);
    }

    #[test]
    fn a_workspace_shows_a_path_once() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        // Repeats collapse on the way in…
        let ws = add_ws(
            "dupes",
            vec![at("/r", None), at("/r", None), at("/other", None)],
        );
        assert_eq!(ws.attachments, vec![at("/r", None), at("/other", None)]);

        // …and re-attaching an attached path moves its ref hint instead of
        // opening a second tab.
        let (state, ws) = attach(&ws.id, at("/r", Some("feature"))).unwrap();
        assert_eq!(
            ws.attachments,
            vec![at("/r", Some("feature")), at("/other", None)]
        );

        // Re-attaching what is already there, ref and all, writes nothing.
        let version = state.version;
        let (state, _) = attach(&ws.id, at("/r", Some("feature"))).unwrap();
        assert_eq!(state.version, version);

        // Detaching keys on the path alone, whatever the ref hint says.
        let (state, ws) = detach(&ws.id, std::path::Path::new("/r")).unwrap();
        assert_eq!(ws.attachments, vec![at("/other", None)]);
        // …and detaching what isn't there writes nothing.
        let version = state.version;
        let (state, _) = detach(&ws.id, std::path::Path::new("/r")).unwrap();
        assert_eq!(state.version, version);
    }

    /// The licence to reap an auto-created workspace rests entirely on
    /// `auto_created` meaning "nothing but the router ever touched this", so
    /// every way of touching one has to end that.
    #[test]
    fn any_human_mutation_adopts_the_workspace_it_touches() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        type Mutation = dyn Fn(&str) -> Result<(WorkState, Workspace), WorkError>;
        for (n, mutate_it) in [
            (0, &(|id: &str| rename(id, Some("named"))) as &Mutation),
            (1, &(|id: &str| move_workspace(id, 0))),
            (2, &(|id: &str| attach(id, at("/r", Some("extra"))))),
            (3, &(|id: &str| detach(id, std::path::Path::new("/r")))),
        ] {
            let ghost = auto(vec![at("/r", Some(&format!("b{n}")))]);
            let (_state, touched) = mutate_it(&ghost.id).unwrap();
            assert!(!touched.auto_created, "mutation {n} left it the router's");
        }
    }

    #[test]
    fn roundtrips_through_disk() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let ws = add_ws("persisted", vec![at("/r", Some("feature"))]);
        let reloaded = list().unwrap();
        assert_eq!(reloaded.workspaces, vec![ws]);
    }

    #[test]
    fn serializes_with_the_frontend_contract() {
        let workspace = Workspace {
            id: "0a1b2c3d".to_owned(),
            title: Some("Ship it".to_owned()),
            attachments: vec![
                at("/repos/review", Some("feature/x")),
                at("/repos/django", None),
            ],
            auto_created: false,
            created_at: "2026-08-12T00:00:00.000Z".to_owned(),
        };
        let json = serde_json::to_value(WorkState {
            schema_version: WORK_SCHEMA_VERSION,
            version: 3,
            workspaces: vec![workspace.clone()],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "schemaVersion": 2,
                "version": 3,
                "workspaces": [{
                    "id": "0a1b2c3d",
                    "title": "Ship it",
                    "attachments": [
                        { "path": "/repos/review", "refName": "feature/x" },
                        { "path": "/repos/django", "refName": null },
                    ],
                    "autoCreated": false,
                    "createdAt": "2026-08-12T00:00:00.000Z",
                }],
            })
        );

        // The wire adds the derived title beside the stored one, so a rename
        // field can prefill with what the human typed.
        let view = serde_json::to_value(&WorkspaceView::from(workspace)).unwrap();
        assert_eq!(view["title"], "Ship it");
        assert_eq!(view["displayTitle"], "Ship it");
        assert_eq!(view["id"], "0a1b2c3d");
    }

    #[test]
    fn remove_takes_the_named_workspace_only() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("a", vec![]);
        let b = add_ws("b", vec![]);
        add_ws("c", vec![]);

        let (state, removed) = remove(&b.id).unwrap();
        assert_eq!(removed.id, b.id);
        assert_eq!(shown(&state), ["a", "c"]);
    }

    #[test]
    fn ids_resolve_by_unique_prefix() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let ws = add_ws("prefixed", vec![]);
        let (state, renamed) = rename(&ws.id[..4], Some("renamed")).unwrap();
        assert_eq!(renamed.id, ws.id);
        assert_eq!(shown(&state), ["renamed"]);
        assert_eq!(get(&ws.id[..4]).unwrap().title.unwrap(), "renamed");

        assert!(matches!(remove("zzzz"), Err(WorkError::NotFound(_))));
    }

    #[test]
    fn ambiguous_prefixes_are_rejected() {
        let mut state = WorkState {
            version: 1,
            ..WorkState::default()
        };
        for id in ["abc10000", "abc20000"] {
            state.workspaces.push(Workspace {
                id: id.to_owned(),
                title: None,
                attachments: vec![],
                auto_created: false,
                created_at: String::new(),
            });
        }
        assert!(matches!(
            resolve_index(&state, "abc"),
            Err(WorkError::Ambiguous { .. })
        ));
        // An exact id still wins even though it's also a prefix of nothing else.
        assert_eq!(resolve_index(&state, "abc10000").unwrap(), 0);
    }

    #[test]
    fn move_reorders_and_clamps() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("a", vec![]);
        add_ws("b", vec![]);
        let c = add_ws("c", vec![]);

        // To the top.
        let (state, _) = move_workspace(&c.id, 0).unwrap();
        assert_eq!(shown(&state), ["c", "a", "b"]);

        // Past the end clamps to last.
        let (state, _) = move_workspace(&c.id, 99).unwrap();
        assert_eq!(shown(&state), ["a", "b", "c"]);

        // Moving where it already is writes nothing.
        let before = state.version;
        let (state, _) = move_workspace(&c.id, 2).unwrap();
        assert_eq!(state.version, before);
    }

    /// Cleanup's whole safety argument: three independent reasons to keep a
    /// workspace, and a caller with no liveness answer must not reap at all.
    #[test]
    fn cleanup_reaps_only_dead_untouched_router_workspaces() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let mine = add_ws("mine", vec![]);
        let dead = auto(vec![at("/r", Some("dead"))]);
        let live = auto(vec![at("/r", Some("live"))]);
        // Old enough that only adoption or a terminal can save them.
        age_all(Duration::from_secs(600));

        let running: HashSet<String> = [live.id.clone()].into_iter().collect();
        let state = list_cleaned(&running).unwrap();
        assert_eq!(
            state
                .workspaces
                .iter()
                .map(|w| w.id.as_str())
                .collect::<Vec<_>>(),
            [mine.id.as_str(), live.id.as_str()],
            "the human's and the live one survive; {} should be gone",
            dead.id
        );

        // A second read has nothing left to reap, so it writes nothing.
        let version = state.version;
        assert_eq!(list_cleaned(&running).unwrap().version, version);
    }

    #[test]
    fn cleanup_spares_the_young_and_never_runs_blind() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let fresh = auto(vec![at("/r", Some("fresh"))]);
        // Just created, no terminal registered yet: the create-then-start race.
        let state = list_cleaned(&HashSet::new()).unwrap();
        assert_eq!(
            state.workspaces.len(),
            1,
            "{} was reaped too early",
            fresh.id
        );

        // Past the grace it goes — but only because the caller could answer
        // "nothing is live". A caller that cannot answer calls `list` instead,
        // and `cleanup` is the only thing that ever removes one.
        age_all(Duration::from_secs(600));
        assert!(list_cleaned(&HashSet::new()).unwrap().workspaces.is_empty());
        assert!(list().unwrap().workspaces.is_empty());
    }

    /// Backdate every workspace's `created_at` by `age`, so grace-period
    /// behaviour is testable without sleeping.
    fn age_all(age: Duration) {
        let stamp = iso8601_from_system_time(SystemTime::now() - age);
        mutate(|state| {
            for ws in &mut state.workspaces {
                ws.created_at.clone_from(&stamp);
            }
            Ok(((), true))
        })
        .unwrap();
    }

    #[test]
    fn save_rejects_a_stale_version() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("a", vec![]); // on-disk version is now 1

        // A writer that loaded version 0 and is trying to write version 1 has
        // been overtaken; `mutate` swallows this by reloading, but the raw save
        // must report it.
        let stale = WorkState {
            version: 1,
            ..WorkState::default()
        };
        assert!(matches!(
            storage::save(&stale),
            Err(WorkError::VersionConflict {
                expected: 0,
                found: 1
            })
        ));
    }

    #[test]
    fn mutate_retries_over_a_concurrent_write() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("existing", vec![]);

        // Simulate another process winning the race: the first `apply` pass
        // writes a competing version behind our back, so the save conflicts and
        // `mutate` reloads and reapplies on the newer state.
        let interfered = std::cell::Cell::new(false);
        let (state, ()) = mutate(|state| {
            if !interfered.get() {
                interfered.set(true);
                let mut theirs = storage::load().unwrap();
                push_new(&mut theirs, Some("theirs".to_owned()), vec![], false);
                theirs.version += 1;
                storage::save(&theirs).unwrap();
            }
            push_new(state, Some("ours".to_owned()), vec![], false);
            Ok(((), true))
        })
        .unwrap();

        assert!(interfered.get(), "the test must have forced a conflict");
        // Both writes survive: the retry reapplied on top of theirs.
        assert_eq!(shown(&state), ["existing", "theirs", "ours"]);
        assert_eq!(state, list().unwrap());
    }

    #[test]
    fn repo_paths_normalize_to_the_repo_root() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();

        // A path with a `.` segment and one without resolve to the same string,
        // so they count as the same attachment.
        let direct = Attachment::new(repo.path(), Some("main".to_owned()));
        let indirect = Attachment::new(PathBuf::from(repo.path()).join("."), None);
        assert_eq!(direct.path, indirect.path);

        let ws = add_ws("normalized", vec![direct]);
        let (_, same) = attach(&ws.id, indirect).unwrap();
        assert_eq!(same.attachments.len(), 1, "one repo, one tab");
    }

    #[test]
    fn attachments_from_the_wire_are_normalized_too() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();
        let canonical = normalize_repo_path(repo.path());

        // A struct built by serde (the app posts `{path, refName}`) never went
        // through `Attachment::new`, so the operations have to normalize it.
        let raw = Attachment {
            path: repo.path().join(".").to_string_lossy().to_string(),
            ref_name: Some(String::new()),
        };
        assert_ne!(raw.path, canonical, "the test path must need fixing");

        let ws = add_ws("from the app", vec![raw.clone()]);
        assert_eq!(ws.attachments[0].path, canonical);
        assert_eq!(ws.attachments[0].ref_name, None, "an empty ref is no ref");

        // …and the stored, canonical form is what a detach of the raw path hits.
        let (_, detached) = detach(&ws.id, std::path::Path::new(&raw.path)).unwrap();
        assert!(detached.attachments.is_empty());
    }
}
