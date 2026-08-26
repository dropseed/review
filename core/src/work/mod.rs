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
//! A workspace may sit **under** another ([`Workspace::parent_id`]), which is
//! how one that is really a subtask of a larger one says so. The queue stays a
//! flat array: [`reflow`] keeps it in tree order — each workspace immediately
//! followed by its own subtree — so the array is literally the order surfaces
//! render, and everything that counts rows (the ⌘-digit shortcuts, the rail,
//! the palette, the sidebar's drop gaps) keeps working without knowing there is
//! a tree. Nesting moves a whole subtree; only the shape of the indentation is
//! new.
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

use std::collections::{HashMap, HashSet};
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
    #[error("'{child}' cannot sit under '{parent}' — that would nest it inside itself.")]
    Cycle { child: String, parent: String },
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
    /// The workspace this one sits under, or `None` for one at the top level.
    ///
    /// The whole of the hierarchy: the queue stays a flat array, and nesting is
    /// this one back-reference. [`reflow`] keeps the array in tree order — every
    /// workspace immediately followed by its own subtree — so the array *is* the
    /// order every surface renders, and the digit shortcuts, the rail, the
    /// palette and the drop gaps all keep counting rows without knowing there is
    /// a tree at all.
    ///
    /// Additive on purpose: adding it does not bump [`WORK_SCHEMA_VERSION`],
    /// because an older document loads as an *empty queue* (see
    /// [`storage::load`]) and nesting is not worth anyone's queue. A document
    /// written here and read by an older build loses the nesting and keeps the
    /// workspaces.
    #[serde(default)]
    pub parent_id: Option<String>,
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

/// An attachment as a surface renders it: what is stored, plus what the
/// filesystem says about it right now.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    #[serde(flatten)]
    pub attachment: Attachment,
    /// Whether the path is a repository working tree. **Not stored** — it is a
    /// fact about the filesystem, like `display_title` is a fact about the
    /// queue, and `git init` in an attached directory must change it with no
    /// write to `work.json`.
    ///
    /// This is what tells a surface which half of itself to draw: everything
    /// built on a diff — comparisons, hunks, review state, the branch picker —
    /// has nothing to say about a plain directory, which is browsable and
    /// nothing more. It is the same test the registry applies (see
    /// [`central::is_working_tree`]), so an attachment that reads `true` here is
    /// exactly one the sidebar has an activity row for.
    pub is_git_repo: bool,
}

/// A workspace as a surface renders it: everything stored, plus everything that
/// has to be derived.
///
/// Nothing here is stored, and all of it for the same reason: the ground under
/// it moves with no write to the workspace. Attach a repo and `display_title`
/// changes; rename a parent and `ancestors` does; `git init` an attached
/// directory and its `is_git_repo` does. Sending the derived title beside the
/// raw `title` is also what lets a rename field prefill with what the human
/// typed rather than with what was derived for them.
///
/// The stored fields are spelled out rather than flattened because the view
/// re-states `attachments` in [`AttachmentView`]'s richer shape, and a flattened
/// `Workspace` would emit that key twice. A field added to [`Workspace`] has to
/// be added here too; `serializes_with_the_frontend_contract` asserts the whole
/// object, so forgetting fails a test rather than quietly dropping off the wire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub id: String,
    pub title: Option<String>,
    pub attachments: Vec<AttachmentView>,
    pub parent_id: Option<String>,
    pub auto_created: bool,
    pub created_at: String,
    pub display_title: String,
    /// How many workspaces this one sits under — what a card indents by, and
    /// what makes the flat array readable as a tree without walking it again.
    pub depth: usize,
    /// Every workspace above this one, outermost first. Empty at the top level.
    pub ancestors: Vec<Ancestor>,
}

/// One workspace above another, named — a rung of the breadcrumb a surface
/// draws when it shows a nested workspace out of the queue's context.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ancestor {
    pub id: String,
    pub display_title: String,
}

/// One workspace as a surface renders it, ancestry resolved against `queue`.
///
/// Ancestry is derived here rather than stored for the same reason
/// `display_title` is: the rungs move underneath it — renaming a parent changes
/// what its children's breadcrumbs say, with no write to the children.
pub fn view_of(queue: &[Workspace], workspace: Workspace) -> WorkspaceView {
    let ancestors = ancestors_of(queue, &workspace);
    let display_title = workspace.display_title();
    let attachments = workspace
        .attachments
        .into_iter()
        .map(|attachment| AttachmentView {
            is_git_repo: central::is_working_tree(std::path::Path::new(&attachment.path)),
            attachment,
        })
        .collect();
    WorkspaceView {
        id: workspace.id,
        title: workspace.title,
        attachments,
        parent_id: workspace.parent_id,
        auto_created: workspace.auto_created,
        created_at: workspace.created_at,
        display_title,
        depth: ancestors.len(),
        ancestors,
    }
}

/// The chain above `workspace`, outermost first, so a surface can print
/// "Ship it › API › migration" straight through.
///
/// Tolerant of a document the invariants do not hold for — a parent that is not
/// in `queue` ends the chain, and a cycle breaks it — because this also runs on
/// a single workspace read out of a list that no longer holds its parent.
fn ancestors_of(queue: &[Workspace], workspace: &Workspace) -> Vec<Ancestor> {
    let mut chain = Vec::new();
    let mut seen: HashSet<&str> = HashSet::from([workspace.id.as_str()]);
    let mut next = workspace.parent_id.as_deref();
    while let Some(id) = next {
        if !seen.insert(id) {
            break;
        }
        let Some(parent) = queue.iter().find(|ws| ws.id == id) else {
            break;
        };
        chain.push(Ancestor {
            id: parent.id.clone(),
            display_title: parent.display_title(),
        });
        next = parent.parent_id.as_deref();
    }
    chain.reverse();
    chain
}

/// Every workspace as a surface renders it.
pub fn views(workspaces: Vec<Workspace>) -> Vec<WorkspaceView> {
    workspaces
        .iter()
        .map(|ws| view_of(&workspaces, ws.clone()))
        .collect()
}

/// Display titles for every workspace in the queue, keyed by id — the index a
/// surface joins workspace attribution against.
///
/// Read-only, and forgiving: building it is not one of the two reads that clean
/// the queue up, and an unreadable `work.json` costs titles rather than the
/// listing they decorate.
pub fn title_index() -> HashMap<String, String> {
    list()
        .map(|state| {
            state
                .workspaces
                .into_iter()
                .map(|ws| (ws.id.clone(), ws.display_title()))
                .collect()
        })
        .unwrap_or_default()
}

/// What to show for a workspace id. Attribution is the daemon's and the queue
/// never sees it, so an id with no workspace behind it prints as itself rather
/// than vanishing; nothing attributed at all prints as a dash.
pub fn label_for<'a>(titles: &'a HashMap<String, String>, id: Option<&'a str>) -> &'a str {
    match id {
        Some(id) => titles.get(id).map_or(id, String::as_str),
        None => "-",
    }
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

/// Whether `candidate` is `root` itself or sits anywhere beneath it.
///
/// Walks *up* from the candidate rather than down from the root, which is the
/// cheap direction in a flat array — and the one that terminates on a document
/// whose invariants have not been restored yet, because the step count is
/// bounded by the queue's length.
fn is_within(workspaces: &[Workspace], candidate: &str, root: &str) -> bool {
    let mut next = Some(candidate);
    for _ in 0..=workspaces.len() {
        match next {
            Some(id) if id == root => return true,
            Some(id) => {
                next = workspaces
                    .iter()
                    .find(|ws| ws.id == id)
                    .and_then(|ws| ws.parent_id.as_deref());
            }
            None => return false,
        }
    }
    false
}

/// How many rows the workspace at `index` occupies — itself plus everything
/// nested under it.
///
/// Rests on the contiguity [`reflow`] maintains: a subtree is a run, so this
/// counts forward while the rows still belong to it and stops at the first one
/// that doesn't. Every operation that moves a workspace moves this many rows,
/// which is what makes "drag the parent" mean "drag the lot".
fn subtree_len(workspaces: &[Workspace], index: usize) -> usize {
    let Some(root) = workspaces.get(index) else {
        return 0;
    };
    let root = root.id.clone();
    let mut len = 1;
    while let Some(next) = workspaces.get(index + len) {
        if !is_within(workspaces, &next.id, &root) {
            break;
        }
        len += 1;
    }
    len
}

/// Lift the subtree rooted at `from` out of the queue and put it back so its
/// root sits at row `dest`.
///
/// `dest` is in the coordinates of the list **with the subtree already out** —
/// which is also the row the root ends up on, so a caller that knows where it
/// wants the card can say so without compensating for the hole it left.
fn place_subtree(state: &mut WorkState, from: usize, dest: usize) {
    let size = subtree_len(&state.workspaces, from);
    let subtree: Vec<Workspace> = state.workspaces.drain(from..from + size).collect();
    let dest = dest.min(state.workspaces.len());
    let tail = state.workspaces.split_off(dest);
    state.workspaces.extend(subtree);
    state.workspaces.extend(tail);
}

/// The row just past the end of the subtree rooted at `index` — where a new
/// last child of that workspace goes.
fn subtree_end(workspaces: &[Workspace], index: usize) -> usize {
    index + subtree_len(workspaces, index)
}

/// Restore the queue's two structural invariants, reporting whether anything
/// had to move: every `parent_id` names a workspace that is really above it,
/// and the array is in tree order.
///
/// Run after every mutation and on every read, because both are places a
/// crooked document can arrive: a mutation that re-parents leaves the array in
/// the old order, and `work.json` can be hand-edited or written by a build that
/// spelled the tree differently.
///
/// Nothing is ever dropped here. A parent that isn't in the queue (removed
/// behind the child's back, reaped by [`cleanup`]) is cleared, so the child
/// comes up to the top level rather than disappearing with it — the same
/// promotion [`Removal::PromoteChildren`] does deliberately, applied to the
/// cases nobody chose.
pub(crate) fn reflow(state: &mut WorkState) -> bool {
    let before: Vec<String> = state.workspaces.iter().map(|ws| ws.id.clone()).collect();
    let ids: HashSet<String> = before.iter().cloned().collect();
    let mut changed = false;

    for ws in &mut state.workspaces {
        let dangling = ws
            .parent_id
            .as_deref()
            .is_some_and(|parent| parent == ws.id || !ids.contains(parent));
        if dangling {
            ws.parent_id = None;
            changed = true;
        }
    }

    // Break any cycle at its first member in array order: after that link is
    // cut the rest of the ring is a plain chain, so one pass settles it. A
    // cycle is unreachable from the top level, so leaving one in would hide
    // every workspace it holds.
    for index in 0..state.workspaces.len() {
        let id = state.workspaces[index].id.clone();
        let Some(parent) = state.workspaces[index].parent_id.clone() else {
            continue;
        };
        if is_within(&state.workspaces, &parent, &id) {
            state.workspaces[index].parent_id = None;
            changed = true;
        }
    }

    let mut ordered: Vec<Workspace> = Vec::with_capacity(state.workspaces.len());
    push_subtrees(&state.workspaces, None, &mut ordered);
    debug_assert_eq!(ordered.len(), state.workspaces.len());
    if ordered.len() != state.workspaces.len() {
        // Unreachable once the fixes above have run, but a *reordering* must
        // never be the thing that loses a workspace.
        for ws in &state.workspaces {
            if !ordered.iter().any(|kept| kept.id == ws.id) {
                ordered.push(ws.clone());
            }
        }
    }
    if ordered.iter().map(|ws| &ws.id).ne(before.iter()) {
        changed = true;
    }
    state.workspaces = ordered;
    changed
}

/// Append every child of `parent` in array order, each followed by its own
/// subtree — the walk that turns the back-references into the rendered list.
fn push_subtrees(src: &[Workspace], parent: Option<&str>, out: &mut Vec<Workspace>) {
    for ws in src.iter().filter(|ws| ws.parent_id.as_deref() == parent) {
        out.push(ws.clone());
        push_subtrees(src, Some(&ws.id), out);
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
    for _ in 0..MAX_SAVE_RETRIES {
        let mut state = storage::load()?;
        let (value, changed) = apply(&mut state)?;
        // Every write leaves the array in tree order, so no mutation has to
        // think about where a subtree ended up — and a hand-edited queue is
        // healed by the next write rather than staying crooked.
        let reflowed = reflow(&mut state);
        if !changed && !reflowed {
            return Ok((state, value));
        }
        state.version += 1;
        match storage::save(&state) {
            Ok(()) => return Ok((state, value)),
            Err(WorkError::VersionConflict { .. }) => {}
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
        // Always at the top level. Nesting is a second gesture, never a side
        // effect of creating something — see [`set_parent`].
        parent_id: None,
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
    let (state, workspace) = mutate(move |state| {
        let mut resolved: Vec<Attachment> = Vec::new();
        for attachment in &attachments {
            push_unique(&mut resolved, attachment.normalized());
        }
        // A workspace the human asked for is theirs from birth; only the
        // router's `push_new` call opts out.
        Ok((push_new(state, title.clone(), resolved, false), true))
    })?;
    // After the write, not inside it: `mutate` retries its closure, and
    // registering is filesystem work with nothing to roll back.
    register_attachments(&workspace.attachments);
    Ok((state, workspace))
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

/// Put attached paths into the repo index, so everything reading the registry
/// has a row for them.
///
/// Attaching is the gesture that says "show me this", and it used to say so only
/// to the queue. The sidebar's tree is built from the *registered* repos
/// (`central::list_registered_repos` → `activity_cache::snapshot_all`), so a
/// workspace could hold an attachment whose repo had no activity row and whose
/// code side therefore had nothing to open. Doing it here rather than at each
/// surface is what makes the app, the CLI and the router agree.
///
/// Non-git paths are deliberately left out: the index is the *git* registry and
/// every reader of it needs a `LocalGitSource`. That a plain directory is
/// attached is carried by the attachment itself — see
/// [`AttachmentView::is_git_repo`], which asks the same question this does.
///
/// Best-effort: a failure costs a sidebar row rather than the attachment.
/// [`central::ensure_registered`] decides what counts as a repo and skips one it
/// already holds, so this is the loop and nothing else.
fn register_attachments(attachments: &[Attachment]) {
    for attachment in attachments {
        let path = std::path::Path::new(&attachment.path);
        if let Err(e) = central::ensure_registered(path) {
            log::warn!("[work] could not register {}: {e}", attachment.path);
        }
    }
}

/// What a removal does with the workspaces nested under the one going away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Removal {
    /// The children come up to the removed workspace's own level and stay in
    /// the queue. The default, and what every non-interactive surface does:
    /// removal is one card acknowledged, and a sweep that also took work
    /// nobody looked at would make the gesture unsafe to use.
    #[default]
    PromoteChildren,
    /// The whole subtree goes. Only ever from a surface that named what it was
    /// about to take and was told yes.
    Subtree,
}

/// What a removal took.
#[derive(Debug, Clone)]
pub struct Removed {
    /// The workspace named.
    pub workspace: Workspace,
    /// Everything that went with it, in queue order. Empty unless the removal
    /// was [`Removal::Subtree`] and there was something under it.
    pub descendants: Vec<Workspace>,
}

/// Remove a workspace, and — depending on `mode` — the workspaces under it.
pub fn remove(id: &str, mode: Removal) -> Result<(WorkState, Removed), WorkError> {
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        let mut gone: Vec<Workspace> = match mode {
            Removal::Subtree => {
                let size = subtree_len(&state.workspaces, index);
                state.workspaces.drain(index..index + size).collect()
            }
            Removal::PromoteChildren => {
                let removed = state.workspaces.remove(index);
                // Straight to wherever their parent sat, not to the top: a
                // grandchild whose parent is removed belongs where the parent
                // was, and the rest of the chain below it is untouched.
                for ws in &mut state.workspaces {
                    if ws.parent_id.as_deref() == Some(removed.id.as_str()) {
                        ws.parent_id.clone_from(&removed.parent_id);
                    }
                }
                vec![removed]
            }
        };
        let workspace = gone.remove(0);
        Ok((
            Removed {
                workspace,
                descendants: gone,
            },
            true,
        ))
    })
}

/// Put a workspace under another, or (with `parent` as `None`) back at the top
/// level. The whole subtree travels with it.
///
/// Nesting is where the queue can be asked for something impossible, and the
/// two impossible things are the same thing: a workspace cannot sit under
/// itself, directly or through any chain, because the result would be a ring
/// nothing could reach. Everything else is allowed — depth is not capped, and
/// a workspace with terminals nests exactly like an empty one.
///
/// It lands as the **last** child of its new parent, and unnesting leaves it
/// immediately after the subtree it just left, so a re-parent moves a card by
/// one indent rather than teleporting it across the queue.
///
/// Both workspaces are adopted (see [`adopt_at`]): building structure here is
/// as much a human touching them as naming one is.
pub fn set_parent(id: &str, parent: Option<&str>) -> Result<(WorkState, Workspace), WorkError> {
    let parent = parent.map(ToOwned::to_owned);
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        let child_id = state.workspaces[index].id.clone();

        let (new_parent, dest_before_lift) = match parent.as_deref() {
            Some(query) => {
                let parent_index = resolve_index(state, query)?;
                let parent_id = state.workspaces[parent_index].id.clone();
                if is_within(&state.workspaces, &parent_id, &child_id) {
                    return Err(WorkError::Cycle {
                        child: state.workspaces[index].display_title(),
                        parent: state.workspaces[parent_index].display_title(),
                    });
                }
                adopt_at(state, parent_index);
                (
                    Some(parent_id),
                    subtree_end(&state.workspaces, parent_index),
                )
            }
            // Out to the top level, but staying put: the row after everything
            // the old parent still holds.
            None => {
                let after = state.workspaces[index]
                    .parent_id
                    .clone()
                    .and_then(|old| resolve_index(state, &old).ok())
                    .map_or(index + 1, |old_index| {
                        subtree_end(&state.workspaces, old_index)
                    });
                (None, after)
            }
        };

        let changed = state.workspaces[index].parent_id != new_parent;
        state.workspaces[index].parent_id = new_parent;
        let adopted = adopt_at(state, index);
        if changed {
            let size = subtree_len(&state.workspaces, index);
            // `dest_before_lift` counts the subtree that is about to come out
            // whenever it sits above it.
            let dest =
                dest_before_lift.saturating_sub(if dest_before_lift > index { size } else { 0 });
            place_subtree(state, index, dest);
        }
        let moved = state
            .workspaces
            .iter()
            .find(|ws| ws.id == child_id)
            .expect("the workspace was only moved")
            .clone();
        Ok((moved, changed || adopted))
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

/// Move a workspace to row `to_index` (0-based), taking everything nested
/// under it. An index past the end clamps to last.
///
/// `to_index` is the row the card ends up on, so a caller does not have to
/// compensate for the hole its own subtree leaves behind.
///
/// **The destination decides the depth**, unless `keep_parent` says otherwise:
/// the workspace lands as a sibling of the row it displaces — the one the
/// insertion line sits above — and at the end of the list, where there is no
/// such row, at the top level. That is what makes the sidebar's indented
/// insertion line honest, and it is the only way out of a subtree by drag: drop
/// above any top-level card, or below the last one. Nesting *in* has its own
/// gesture ([`set_parent`], the app's card-onto-card drop) precisely because a
/// vertical position cannot express "one level deeper" on its own.
///
/// `keep_parent` is the other question a caller can be asking: **move this
/// among its siblings**, which is what the card menu's "Move up" / "Move down"
/// / "Move to top" mean — a verb aimed at position must not silently change
/// what a workspace is nested under. The parent is left alone and [`reflow`]
/// settles the row back inside its parent's subtree, which is how "down past
/// the last sibling" becomes "last child" rather than a card falling out of the
/// group it was in.
///
/// `reorderWorkspaces` in `desktop/ui/stores/slices/workspaceSlice.ts` is the
/// mirror of this, applied optimistically before the round trip. The two have
/// to agree — on the clamp and now on the depth — or the list visibly jumps
/// when the authoritative answer arrives.
pub fn move_workspace(
    id: &str,
    to_index: usize,
    keep_parent: bool,
) -> Result<(WorkState, Workspace), WorkError> {
    mutate(move |state| {
        let from = resolve_index(state, id)?;
        let size = subtree_len(&state.workspaces, from);
        let dest = to_index.min(state.workspaces.len() - size);
        // Where it already is. Checked before anything moves, because "the row
        // it displaces" is a different row once the subtree is out — a no-op
        // move must not quietly re-parent the card.
        if from == dest {
            let adopted = adopt_at(state, from);
            return Ok((state.workspaces[from].clone(), adopted));
        }
        place_subtree(state, from, dest);
        if !keep_parent {
            let sibling_of = state
                .workspaces
                .get(dest + size)
                .and_then(|below| below.parent_id.clone());
            state.workspaces[dest].parent_id = sibling_of;
        }
        adopt_at(state, dest);
        Ok((state.workspaces[dest].clone(), true))
    })
}

/// Show a path in a workspace. Attachments are not exclusive, so this can never
/// conflict: any number of workspaces may attach the same repository, and a
/// workspace already showing the path only updates its ref hint.
pub fn attach(id: &str, attachment: Attachment) -> Result<(WorkState, Workspace), WorkError> {
    let attachment = attachment.normalized();
    let registered = attachment.clone();
    let result = mutate(move |state| {
        let index = resolve_index(state, id)?;
        let before = state.workspaces[index].attachments.clone();
        push_unique(&mut state.workspaces[index].attachments, attachment.clone());
        let changed = state.workspaces[index].attachments != before;
        let adopted = adopt_at(state, index);
        Ok((state.workspaces[index].clone(), changed || adopted))
    })?;
    // Unconditionally, even when the queue write was a no-op: re-attaching a
    // path the workspace already shows is exactly how someone whose repo went
    // missing from the sidebar would try to get it back.
    register_attachments(&[registered]);
    Ok(result)
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
/// Nothing nested under a reaped workspace is reaped with it: [`reflow`] runs
/// on the same write and brings the orphans up to the top level. In practice
/// the case is unreachable — nesting anything under a workspace adopts it (see
/// [`set_parent`]) — but the reaping rule stays "this one workspace", never
/// "this one and whatever was under it".
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
/// `review workspace list`) go through here, so the distinction is decided once
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

    #[test]
    fn label_for_falls_back_to_the_raw_id() {
        let titles = HashMap::from([("ws-1".to_owned(), "review · main".to_owned())]);
        assert_eq!(label_for(&titles, Some("ws-1")), "review · main");
        // Attribution the queue has never heard of still names itself.
        assert_eq!(label_for(&titles, Some("ws-gone")), "ws-gone");
        assert_eq!(label_for(&titles, None), "-");
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
        let (state, _) = move_workspace(&urgent.id, 0, false).unwrap();
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
            (1, &(|id: &str| move_workspace(id, 0, false))),
            (2, &(|id: &str| attach(id, at("/r", Some("extra"))))),
            (3, &(|id: &str| detach(id, std::path::Path::new("/r")))),
            (4, &(|id: &str| set_parent(id, None))),
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
            parent_id: None,
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
                    "parentId": null,
                    "autoCreated": false,
                    "createdAt": "2026-08-12T00:00:00.000Z",
                }],
            })
        );

        // The view is the stored shape plus what has to be derived: the title
        // to show beside the raw one (so a rename field prefills with what the
        // human typed), the place in the tree (so a surface can indent without
        // walking the list), and per attachment whether the path is a repo at
        // all. Asserted whole, because the view spells its stored fields out
        // rather than flattening them — a field added to `Workspace` and not
        // here would otherwise drop off the wire in silence.
        let view = serde_json::to_value(view_of(&[], workspace)).unwrap();
        assert_eq!(
            view,
            serde_json::json!({
                "id": "0a1b2c3d",
                "title": "Ship it",
                "attachments": [
                    // Neither temp path exists, so neither is a repository —
                    // the fact is the filesystem's, read at serialization time.
                    { "path": "/repos/review", "refName": "feature/x", "isGitRepo": false },
                    { "path": "/repos/django", "refName": null, "isGitRepo": false },
                ],
                "parentId": null,
                "autoCreated": false,
                "createdAt": "2026-08-12T00:00:00.000Z",
                "displayTitle": "Ship it",
                "depth": 0,
                "ancestors": [],
            })
        );
    }

    /// The queue is where attachments are made, so it is where the repo index
    /// has to hear about them — otherwise the sidebar has no activity row for a
    /// repo a card is showing, and its code side has nothing to open.
    #[test]
    fn attaching_a_repo_registers_it() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();
        let canonical = normalize_repo_path(repo.path());

        assert!(
            !central::is_registered(repo.path()).unwrap(),
            "the test needs an unregistered repo"
        );

        // Every surface that persists an attachment goes through one of these
        // three, so all three have to register.
        let ws = add(Some("by add"), vec![Attachment::new(repo.path(), None)])
            .unwrap()
            .1;
        assert!(central::is_registered(repo.path()).unwrap());
        assert!(central::list_registered_repos()
            .unwrap()
            .iter()
            .any(|entry| entry.path == canonical));

        central::unregister_repo(repo.path()).unwrap();
        attach(
            &ws.id,
            Attachment::new(repo.path(), Some("main".to_owned())),
        )
        .unwrap();
        assert!(central::is_registered(repo.path()).unwrap());

        central::unregister_repo(repo.path()).unwrap();
        router::route_to(repo.path(), None).unwrap();
        assert!(central::is_registered(repo.path()).unwrap());
    }

    /// A plain directory attaches exactly like a repo, and the *only* thing
    /// that differs is what the view says about it — the git registry never
    /// hears about it, because everything downstream of the registry needs a
    /// `LocalGitSource`.
    #[test]
    fn a_plain_directory_attaches_but_is_not_registered() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, plain) = setup_test();
        let canonical = normalize_repo_path(plain.path());

        let (state, ws) = add(Some("scratch"), vec![Attachment::new(plain.path(), None)]).unwrap();
        assert_eq!(ws.attachments[0].path, canonical);
        assert!(
            central::list_registered_repos().unwrap().is_empty(),
            "the index is the git registry; a directory has no place in it"
        );

        let view = view_of(&state.workspaces, ws);
        assert!(!view.attachments[0].is_git_repo);

        // …and `git init` in it flips the answer with no write to the queue.
        std::fs::create_dir_all(plain.path().join(".git")).unwrap();
        let view = view_of(&state.workspaces, state.workspaces[0].clone());
        assert!(view.attachments[0].is_git_repo);
    }

    #[test]
    fn remove_takes_the_named_workspace_only() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("a", vec![]);
        let b = add_ws("b", vec![]);
        add_ws("c", vec![]);

        let (state, removed) = remove(&b.id, Removal::PromoteChildren).unwrap();
        assert_eq!(removed.workspace.id, b.id);
        assert!(removed.descendants.is_empty());
        assert_eq!(shown(&state), ["a", "c"]);
    }

    /// The rendered shape of the queue: every workspace, indented by depth.
    fn tree(state: &WorkState) -> Vec<String> {
        let views = views(state.workspaces.clone());
        views
            .iter()
            .map(|view| format!("{}{}", "  ".repeat(view.depth), view.display_title))
            .collect()
    }

    #[test]
    fn nesting_puts_a_workspace_under_another_and_the_array_follows() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let parent = add_ws("ship it", vec![]);
        let child = add_ws("the api half", vec![]);
        add_ws("unrelated", vec![]);

        let (state, nested) = set_parent(&child.id, Some(&parent.id)).unwrap();
        assert_eq!(nested.parent_id.as_deref(), Some(parent.id.as_str()));
        // The array *is* the rendered order: the child moved up next to its
        // parent, and nothing else had to know.
        assert_eq!(tree(&state), ["ship it", "  the api half", "unrelated"]);

        // And the breadcrumb a surface reads out of the queue's context.
        let view = view_of(&state.workspaces, nested);
        assert_eq!(view.depth, 1);
        assert_eq!(
            view.ancestors
                .iter()
                .map(|a| &a.display_title)
                .collect::<Vec<_>>(),
            ["ship it"]
        );
    }

    #[test]
    fn nesting_is_arbitrarily_deep_and_a_new_child_goes_last() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let a = add_ws("a", vec![]);
        let b = add_ws("b", vec![]);
        let c = add_ws("c", vec![]);
        let d = add_ws("d", vec![]);

        set_parent(&b.id, Some(&a.id)).unwrap();
        set_parent(&c.id, Some(&b.id)).unwrap();
        // A second child of `a` lands after everything `a` already holds,
        // rather than jumping in front of its own nephews.
        let (state, _) = set_parent(&d.id, Some(&a.id)).unwrap();
        assert_eq!(tree(&state), ["a", "  b", "    c", "  d"]);
    }

    #[test]
    fn a_workspace_cannot_sit_under_itself() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let parent = add_ws("parent", vec![]);
        let child = add_ws("child", vec![]);
        set_parent(&child.id, Some(&parent.id)).unwrap();

        assert!(matches!(
            set_parent(&parent.id, Some(&parent.id)),
            Err(WorkError::Cycle { .. })
        ));
        // Nor under anything already beneath it — the same ring, one hop out.
        assert!(matches!(
            set_parent(&parent.id, Some(&child.id)),
            Err(WorkError::Cycle { .. })
        ));
        assert_eq!(tree(&list().unwrap()), ["parent", "  child"]);
    }

    #[test]
    fn unnesting_leaves_it_where_it_was_standing() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let parent = add_ws("parent", vec![]);
        let first = add_ws("first", vec![]);
        let second = add_ws("second", vec![]);
        add_ws("after", vec![]);
        set_parent(&first.id, Some(&parent.id)).unwrap();
        set_parent(&second.id, Some(&parent.id)).unwrap();

        // Out one indent, not across the queue: it comes to rest after the
        // siblings it left behind, above everything that was already below.
        let (state, _) = set_parent(&first.id, None).unwrap();
        assert_eq!(tree(&state), ["parent", "  second", "first", "after"]);
    }

    #[test]
    fn moving_a_parent_takes_its_subtree() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let a = add_ws("a", vec![]);
        let child = add_ws("a's child", vec![]);
        add_ws("b", vec![]);
        add_ws("c", vec![]);
        set_parent(&child.id, Some(&a.id)).unwrap();
        assert_eq!(tree(&list().unwrap()), ["a", "  a's child", "b", "c"]);

        // Dragging the parent down past `b` moves both rows, and `a` stays a
        // top-level card because the row it displaced is one.
        let (state, _) = move_workspace(&a.id, 1, false).unwrap();
        assert_eq!(tree(&state), ["b", "a", "  a's child", "c"]);

        // Past the end clamps to the last row the subtree can occupy.
        let (state, _) = move_workspace(&a.id, 99, false).unwrap();
        assert_eq!(tree(&state), ["b", "c", "a", "  a's child"]);
    }

    /// The rule the sidebar's indented insertion line draws: you land as a
    /// sibling of the row you displaced.
    #[test]
    fn a_move_lands_at_the_depth_of_the_row_it_displaces() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let parent = add_ws("parent", vec![]);
        let child = add_ws("child", vec![]);
        let loose = add_ws("loose", vec![]);
        set_parent(&child.id, Some(&parent.id)).unwrap();
        assert_eq!(tree(&list().unwrap()), ["parent", "  child", "loose"]);

        // Dropped onto the row `child` occupies: it becomes `parent`'s child
        // too, above the one it pushed down.
        let (state, moved) = move_workspace(&loose.id, 1, false).unwrap();
        assert_eq!(moved.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(tree(&state), ["parent", "  loose", "  child"]);

        // …and dropping it at the end is how it gets back out: there is no row
        // below to be a sibling of, so it lands at the top level.
        let (state, moved) = move_workspace(&loose.id, 2, false).unwrap();
        assert_eq!(moved.parent_id, None);
        assert_eq!(tree(&state), ["parent", "  child", "loose"]);
    }

    /// The card menu's move verbs, which are asking a different question from
    /// a drag: reorder within this group, never out of it.
    #[test]
    fn keeping_the_parent_reorders_within_the_group() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let parent = add_ws("parent", vec![]);
        let first = add_ws("first", vec![]);
        let second = add_ws("second", vec![]);
        add_ws("after", vec![]);
        set_parent(&first.id, Some(&parent.id)).unwrap();
        set_parent(&second.id, Some(&parent.id)).unwrap();
        assert_eq!(
            tree(&list().unwrap()),
            ["parent", "  first", "  second", "after"]
        );

        // Row 3 is past the last sibling — where the drag rule would drop it
        // out of the group. Keeping the parent, `reflow` settles it back in as
        // the last child, which is what "move down" meant.
        let (state, moved) = move_workspace(&first.id, 3, true).unwrap();
        assert_eq!(moved.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(tree(&state), ["parent", "  second", "  first", "after"]);

        // The same row without it takes the card out, at the depth of the row
        // it displaced.
        let (state, moved) = move_workspace(&second.id, 3, false).unwrap();
        assert_eq!(moved.parent_id, None);
        assert_eq!(tree(&state), ["parent", "  first", "after", "second"]);
    }

    #[test]
    fn removing_a_parent_promotes_or_takes_the_subtree() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let build = |suffix: &str| {
            let parent = add_ws(&format!("parent{suffix}"), vec![]);
            let child = add_ws(&format!("child{suffix}"), vec![]);
            let grandchild = add_ws(&format!("grandchild{suffix}"), vec![]);
            set_parent(&child.id, Some(&parent.id)).unwrap();
            set_parent(&grandchild.id, Some(&child.id)).unwrap();
            parent
        };

        // Promote: the child comes up to where its parent stood, and its own
        // child stays under it.
        let parent = build("-p");
        let (state, removed) = remove(&parent.id, Removal::PromoteChildren).unwrap();
        assert!(removed.descendants.is_empty());
        assert_eq!(tree(&state), ["child-p", "  grandchild-p"]);

        // Subtree: the lot, in queue order, and the caller can say what went.
        let parent = build("-s");
        let (state, removed) = remove(&parent.id, Removal::Subtree).unwrap();
        assert_eq!(removed.workspace.id, parent.id);
        assert_eq!(
            removed
                .descendants
                .iter()
                .map(|ws| ws.display_title())
                .collect::<Vec<_>>(),
            ["child-s", "grandchild-s"]
        );
        assert_eq!(tree(&state), ["child-p", "  grandchild-p"]);
    }

    /// `work.json` is a file people (and older builds) can write. Every read
    /// runs it through [`reflow`], which must fix it without losing anything.
    #[test]
    fn a_crooked_document_is_straightened_on_read() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let mut state = WorkState::default();
        for (id, parent) in [
            ("aaaaaaaa", None),
            // Out of tree order, and pointing at a parent further down.
            ("bbbbbbbb", Some("cccccccc")),
            ("cccccccc", Some("aaaaaaaa")),
            // A parent nothing in the queue holds: promoted, never dropped.
            ("dddddddd", Some("99999999")),
            // A ring, which would otherwise be unreachable from the top.
            ("eeeeeeee", Some("ffffffff")),
            ("ffffffff", Some("eeeeeeee")),
        ] {
            state.workspaces.push(Workspace {
                id: id.to_owned(),
                title: Some(id[..1].to_owned()),
                attachments: vec![],
                parent_id: parent.map(ToOwned::to_owned),
                auto_created: false,
                created_at: "2026-08-12T00:00:00.000Z".to_owned(),
            });
        }
        storage::save(&state).unwrap();

        let loaded = list().unwrap();
        assert_eq!(tree(&loaded), ["a", "  c", "    b", "d", "e", "  f"]);
        assert_eq!(loaded.workspaces.len(), 6, "reflow never drops one");
        // A read stays a read: the file is only straightened by the next write.
        assert_eq!(loaded.version, state.version);
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

        assert!(matches!(
            remove("zzzz", Removal::PromoteChildren),
            Err(WorkError::NotFound(_))
        ));
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
                parent_id: None,
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
        let (state, _) = move_workspace(&c.id, 0, false).unwrap();
        assert_eq!(shown(&state), ["c", "a", "b"]);

        // Past the end clamps to last.
        let (state, _) = move_workspace(&c.id, 99, false).unwrap();
        assert_eq!(shown(&state), ["a", "b", "c"]);

        // Moving where it already is writes nothing.
        let before = state.version;
        let (state, _) = move_workspace(&c.id, 2, false).unwrap();
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
    fn mutate_gives_up_with_contended_after_exhausting_every_retry() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add_ws("existing", vec![]);

        // A competing writer wins the race on every single attempt, so no
        // retry ever lands a save. `mutate` must give up with the friendly
        // `Contended` error rather than leaking the raw conflict from its
        // last attempt.
        let result = mutate(|state| {
            let mut theirs = storage::load().unwrap();
            push_new(&mut theirs, Some("theirs".to_owned()), vec![], false);
            theirs.version += 1;
            storage::save(&theirs).unwrap();
            push_new(state, Some("ours".to_owned()), vec![], false);
            Ok(((), true))
        });

        assert!(matches!(result, Err(WorkError::Contended)));
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
