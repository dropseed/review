//! The work queue — a user-ordered list of what they intend to work on.
//!
//! A work item stores **intent only**: a title and the git refs it is about.
//! Everything live — terminals, pull requests, review state, diffs — is derived
//! elsewhere and joined against these refs by the UI. That keeps the queue
//! stable while the world underneath it moves.
//!
//! Two properties define the model:
//!
//! - **Global, not per-repo.** One queue spans every repository, so an item can
//!   bind `repo-a:feature` and `repo-b:main` at once. It lives at
//!   `~/.review/work.json` (see [`storage`]).
//! - **Array order is priority order.** [`WorkState::items`] is the queue, top
//!   to bottom; [`move_item`] is the only thing that reorders it.
//!
//! A given ref (`repoPath` + `ref`) belongs to at most one item, so "what am I
//! working on for this branch?" always has one answer. Binds that would break
//! that are rejected, naming the item that already holds the ref.

pub mod storage;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::review::central;
use crate::review::state::{now_iso8601, unique_id_seed};

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
    #[error("No work item matches '{0}'.")]
    NotFound(String),
    #[error("'{query}' is ambiguous; it matches: {}", .matches.join(", "))]
    Ambiguous { query: String, matches: Vec<String> },
    #[error("{ref_name} ({repo_name}) is already bound to work item {item_id} ({item_title}).")]
    RefBound {
        ref_name: String,
        repo_name: String,
        item_id: String,
        item_title: String,
    },
    #[error("A work item needs a title (or at least one ref).")]
    Empty,
    #[error("Failed to save the work queue after repeated version conflicts.")]
    Contended,
}

/// A git ref an item is about, qualified by the repository it lives in.
///
/// `repo_path` is normalized to the repo's main working tree (see
/// [`normalize_repo_path`]) so a branch has one identity no matter which
/// worktree — or which surface, CLI or app — bound it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRef {
    pub repo_path: String,
    /// Matches the `ref` field every other review type exposes to the frontend.
    #[serde(rename = "ref")]
    pub ref_name: String,
}

impl WorkRef {
    pub fn new(repo_path: impl AsRef<std::path::Path>, ref_name: impl Into<String>) -> Self {
        Self {
            repo_path: normalize_repo_path(repo_path.as_ref()),
            ref_name: ref_name.into(),
        }
    }

    /// This ref with its repo path normalized. Every operation runs its refs
    /// through here rather than trusting the caller: a `WorkRef` can also arrive
    /// deserialized straight off the wire (the app posts `{repoPath, ref}`),
    /// which skips [`WorkRef::new`] and would otherwise let the same branch bind
    /// twice under two spellings of its path. Idempotent.
    fn normalized(&self) -> Self {
        Self::new(&self.repo_path, self.ref_name.clone())
    }

    /// The repo's directory name, for display ("review", not the full path).
    pub fn repo_name(&self) -> &str {
        central::display_name(std::path::Path::new(&self.repo_path))
    }
}

/// One unit of intent in the queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    /// 8 hex characters. Commands accept any unique prefix.
    pub id: String,
    /// May be empty when the item is identified by its refs alone.
    pub title: String,
    #[serde(default)]
    pub refs: Vec<WorkRef>,
    /// RFC 3339 timestamp.
    pub created_at: String,
}

impl WorkItem {
    /// What to call this item in output: its title, else its first ref.
    pub fn display_title(&self) -> String {
        if !self.title.is_empty() {
            return self.title.clone();
        }
        match self.refs.first() {
            Some(r) => format!("{} {}", r.repo_name(), r.ref_name),
            None => "(untitled)".to_owned(),
        }
    }
}

/// The whole queue, as stored. Array order is priority order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkState {
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub items: Vec<WorkItem>,
}

impl WorkState {
    /// The item holding `work_ref`, if any.
    fn holder(&self, work_ref: &WorkRef) -> Option<&WorkItem> {
        self.items.iter().find(|item| item.refs.contains(work_ref))
    }
}

/// Normalize a repo path to the repository's main working tree, canonicalized.
///
/// Bindings are keyed by this, so a ref bound from a linked worktree, from the
/// app, and from a relative CLI path all collapse to the same identity — the
/// same normalization [`central::list_registered_repos`] entries carry, which is
/// what the frontend joins these refs against.
pub fn normalize_repo_path(path: &std::path::Path) -> String {
    central::repo_root(path).to_string_lossy().to_string()
}

/// Mint an 8-hex-character item id from [`unique_id_seed`]. The caller re-rolls
/// on the (astronomically unlikely) chance the truncated hash matches an
/// existing item.
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
/// its item in one step — the id would only have to be looked up again.
fn resolve_index(state: &WorkState, query: &str) -> Result<usize, WorkError> {
    let mut matches = Vec::new();
    for (index, item) in state.items.iter().enumerate() {
        if item.id == query {
            return Ok(index);
        }
        if item.id.starts_with(query) {
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
                .map(|i| state.items[i].id.clone())
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
/// (re-binding a ref the item already holds, moving an item to where it already
/// is): the state is returned untouched, with no version bump, no write, and no
/// file-watcher churn.
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

/// Reject a ref that another item already holds. `skip_id` is the item doing
/// the binding, which is allowed to already hold it; `None` when there is no
/// such item yet (a fresh `add`).
fn check_ref_free(
    state: &WorkState,
    work_ref: &WorkRef,
    skip_id: Option<&str>,
) -> Result<(), WorkError> {
    if let Some(holder) = state.holder(work_ref) {
        if Some(holder.id.as_str()) != skip_id {
            return Err(WorkError::RefBound {
                ref_name: work_ref.ref_name.clone(),
                repo_name: work_ref.repo_name().to_owned(),
                item_id: holder.id.clone(),
                item_title: holder.display_title(),
            });
        }
    }
    Ok(())
}

/// Append an item to the end of the queue. [`move_item`] is the only thing that
/// reorders, so a caller that wants it elsewhere adds then moves — which is
/// what every surface does.
///
/// The title may be empty only when the item carries refs — an item with
/// neither is nothing at all. Duplicate refs in `refs` collapse; a ref another
/// item already holds is an error, so a half-added item is never written.
pub fn add(title: &str, refs: Vec<WorkRef>) -> Result<(WorkState, WorkItem), WorkError> {
    let title = title.trim().to_owned();
    if title.is_empty() && refs.is_empty() {
        return Err(WorkError::Empty);
    }

    mutate(move |state| {
        let mut deduped: Vec<WorkRef> = Vec::new();
        for work_ref in &refs {
            let work_ref = work_ref.normalized();
            check_ref_free(state, &work_ref, None)?;
            if !deduped.contains(&work_ref) {
                deduped.push(work_ref);
            }
        }

        let mut id = new_id();
        while state.items.iter().any(|item| item.id == id) {
            id = new_id();
        }
        let item = WorkItem {
            id,
            title: title.clone(),
            refs: deduped,
            created_at: now_iso8601(),
        };
        state.items.push(item.clone());
        Ok((item, true))
    })
}

/// Remove an item, returning the item that was removed.
pub fn remove(id: &str) -> Result<(WorkState, WorkItem), WorkError> {
    mutate(|state| {
        let index = resolve_index(state, id)?;
        Ok((state.items.remove(index), true))
    })
}

/// Retitle an item. A blank title is only allowed when the item has refs to
/// identify it by.
pub fn rename(id: &str, title: &str) -> Result<(WorkState, WorkItem), WorkError> {
    let title = title.trim().to_owned();
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        if title.is_empty() && state.items[index].refs.is_empty() {
            return Err(WorkError::Empty);
        }
        let changed = state.items[index].title != title;
        state.items[index].title = title.clone();
        Ok((state.items[index].clone(), changed))
    })
}

/// Move an item to `to_index` (0-based). An index past the end clamps to last.
///
/// `reorderWorkItems` in `desktop/ui/stores/slices/workSlice.ts` is the mirror
/// of this, applied optimistically before the round trip. The two clamps have
/// to agree or the list visibly jumps when the authoritative answer arrives.
pub fn move_item(id: &str, to_index: usize) -> Result<(WorkState, WorkItem), WorkError> {
    mutate(move |state| {
        let from = resolve_index(state, id)?;
        let to = to_index.min(state.items.len().saturating_sub(1));
        if from == to {
            return Ok((state.items[from].clone(), false));
        }
        let item = state.items.remove(from);
        state.items.insert(to, item.clone());
        Ok((item, true))
    })
}

/// Bind a ref to an item. Binding a ref the item already holds is a no-op;
/// binding one another item holds is an error naming that item.
pub fn bind(id: &str, work_ref: WorkRef) -> Result<(WorkState, WorkItem), WorkError> {
    let work_ref = work_ref.normalized();
    mutate(move |state| {
        let index = resolve_index(state, id)?;
        let holder_id = state.items[index].id.clone();
        check_ref_free(state, &work_ref, Some(&holder_id))?;
        if state.items[index].refs.contains(&work_ref) {
            return Ok((state.items[index].clone(), false));
        }
        state.items[index].refs.push(work_ref.clone());
        Ok((state.items[index].clone(), true))
    })
}

/// Unbind a ref from an item. Unbinding a ref it doesn't hold is a no-op.
pub fn unbind(id: &str, work_ref: &WorkRef) -> Result<(WorkState, WorkItem), WorkError> {
    let work_ref = work_ref.normalized();
    mutate(|state| {
        let index = resolve_index(state, id)?;
        let before = state.items[index].refs.len();
        state.items[index].refs.retain(|r| *r != work_ref);
        let changed = state.items[index].refs.len() != before;
        Ok((state.items[index].clone(), changed))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use std::path::PathBuf;

    /// A ref that skips path normalization, so tests don't depend on temp dirs
    /// resolving to anything in particular.
    fn work_ref(repo: &str, name: &str) -> WorkRef {
        WorkRef {
            repo_path: repo.to_owned(),
            ref_name: name.to_owned(),
        }
    }

    fn titles(state: &WorkState) -> Vec<&str> {
        state.items.iter().map(|i| i.title.as_str()).collect()
    }

    #[test]
    fn missing_file_is_an_empty_queue() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let state = list().unwrap();
        assert_eq!(state.version, 0);
        assert!(state.items.is_empty());
        assert!(!storage::work_path().unwrap().exists());
    }

    #[test]
    fn add_appends_and_move_is_what_reorders() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add("first", vec![]).unwrap();
        add("second", vec![]).unwrap();
        let (state, urgent) = add("urgent", vec![]).unwrap();
        // New items land at the end — the newest thing is the least prioritized
        // until it's moved.
        assert_eq!(titles(&state), ["first", "second", "urgent"]);

        // Getting it to the top is a separate step, on every surface.
        let (state, _) = move_item(&urgent.id, 0).unwrap();
        assert_eq!(titles(&state), ["urgent", "first", "second"]);

        // Every write bumps the version.
        assert_eq!(state.version, 4);
    }

    #[test]
    fn ids_are_8_hex_chars_and_unique() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (_, a) = add("a", vec![]).unwrap();
        let (state, b) = add("b", vec![]).unwrap();
        assert_eq!(a.id.len(), 8);
        assert!(a.id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a.id, b.id);
        assert_eq!(state.items.len(), 2);
    }

    #[test]
    fn add_requires_a_title_or_a_ref() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        assert!(matches!(add("   ", vec![]), Err(WorkError::Empty)));
        // A ref alone is enough — the item is named by what it's bound to.
        let (_, item) = add("", vec![work_ref("/r", "main")]).unwrap();
        assert_eq!(item.title, "");
        assert_eq!(item.display_title(), "r main");
    }

    #[test]
    fn roundtrips_through_disk() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (_, item) = add("persisted", vec![work_ref("/r", "feature")]).unwrap();
        let reloaded = list().unwrap();
        assert_eq!(reloaded.items, vec![item]);
    }

    #[test]
    fn serializes_with_the_frontend_contract() {
        let item = WorkItem {
            id: "0a1b2c3d".to_owned(),
            title: "Ship it".to_owned(),
            refs: vec![work_ref("/repos/review", "feature/x")],
            created_at: "2026-08-12T00:00:00.000Z".to_owned(),
        };
        let json = serde_json::to_value(WorkState {
            version: 3,
            items: vec![item],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "version": 3,
                "items": [{
                    "id": "0a1b2c3d",
                    "title": "Ship it",
                    "refs": [{ "repoPath": "/repos/review", "ref": "feature/x" }],
                    "createdAt": "2026-08-12T00:00:00.000Z",
                }],
            })
        );
    }

    #[test]
    fn remove_takes_the_named_item_only() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add("a", vec![]).unwrap();
        let (_, b) = add("b", vec![]).unwrap();
        add("c", vec![]).unwrap();

        let (state, removed) = remove(&b.id).unwrap();
        assert_eq!(removed.id, b.id);
        assert_eq!(titles(&state), ["a", "c"]);
    }

    #[test]
    fn ids_resolve_by_unique_prefix() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (_, item) = add("prefixed", vec![]).unwrap();
        let (state, renamed) = rename(&item.id[..4], "renamed").unwrap();
        assert_eq!(renamed.id, item.id);
        assert_eq!(titles(&state), ["renamed"]);

        assert!(matches!(remove("zzzz"), Err(WorkError::NotFound(_))));
    }

    #[test]
    fn ambiguous_prefixes_are_rejected() {
        let state = WorkState {
            version: 1,
            items: vec![
                WorkItem {
                    id: "abc10000".to_owned(),
                    title: "one".to_owned(),
                    refs: vec![],
                    created_at: String::new(),
                },
                WorkItem {
                    id: "abc20000".to_owned(),
                    title: "two".to_owned(),
                    refs: vec![],
                    created_at: String::new(),
                },
            ],
        };
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

        add("a", vec![]).unwrap();
        add("b", vec![]).unwrap();
        let (_, c) = add("c", vec![]).unwrap();

        // To the top.
        let (state, _) = move_item(&c.id, 0).unwrap();
        assert_eq!(titles(&state), ["c", "a", "b"]);

        // Past the end clamps to last.
        let (state, _) = move_item(&c.id, 99).unwrap();
        assert_eq!(titles(&state), ["a", "b", "c"]);

        // Moving where it already is writes nothing.
        let before = state.version;
        let (state, _) = move_item(&c.id, 2).unwrap();
        assert_eq!(state.version, before);
    }

    #[test]
    fn a_ref_belongs_to_at_most_one_item() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (_, owner) = add("owner", vec![work_ref("/r", "feature")]).unwrap();
        let (_, other) = add("other", vec![]).unwrap();

        // Binding it elsewhere names the item that already holds it.
        let err = bind(&other.id, work_ref("/r", "feature")).unwrap_err();
        match err {
            WorkError::RefBound { item_id, .. } => assert_eq!(item_id, owner.id),
            other => panic!("expected RefBound, got {other:?}"),
        }
        // …and adding a new item on that ref fails the same way, leaving the
        // queue untouched rather than half-written.
        assert!(matches!(
            add("third", vec![work_ref("/r", "feature")]),
            Err(WorkError::RefBound { .. })
        ));
        assert_eq!(list().unwrap().items.len(), 2);

        // A different repo with the same branch name is a different ref.
        bind(&other.id, work_ref("/other-repo", "feature")).unwrap();
        // As is a different branch in the same repo.
        let (state, _) = bind(&other.id, work_ref("/r", "main")).unwrap();
        assert_eq!(state.items[1].refs.len(), 2);
    }

    #[test]
    fn add_dedupes_repeated_refs() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (_, item) = add(
            "dupes",
            vec![
                work_ref("/r", "main"),
                work_ref("/r", "main"),
                work_ref("/r", "dev"),
            ],
        )
        .unwrap();
        assert_eq!(
            item.refs,
            vec![work_ref("/r", "main"), work_ref("/r", "dev")]
        );
    }

    #[test]
    fn rebinding_and_unbinding_absent_refs_are_no_ops() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (state, item) = add("item", vec![work_ref("/r", "main")]).unwrap();
        let version = state.version;

        // Already bound to this same item — nothing to write.
        let (state, _) = bind(&item.id, work_ref("/r", "main")).unwrap();
        assert_eq!(state.version, version);

        // Never bound — nothing to remove.
        let (state, _) = unbind(&item.id, &work_ref("/r", "nope")).unwrap();
        assert_eq!(state.version, version);

        // A real unbind does write, and frees the ref for another item.
        let (state, updated) = unbind(&item.id, &work_ref("/r", "main")).unwrap();
        assert_eq!(state.version, version + 1);
        assert!(updated.refs.is_empty());
        let (_, second) = add("second", vec![]).unwrap();
        bind(&second.id, work_ref("/r", "main")).unwrap();
    }

    #[test]
    fn rename_keeps_a_ref_bound_item_nameable() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let (_, bare) = add("titled", vec![]).unwrap();
        // An item with no refs can't be left nameless.
        assert!(matches!(rename(&bare.id, "  "), Err(WorkError::Empty)));

        let (_, bound) = add("bound", vec![work_ref("/r", "main")]).unwrap();
        let (_, cleared) = rename(&bound.id, "").unwrap();
        assert_eq!(cleared.title, "");
    }

    #[test]
    fn save_rejects_a_stale_version() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        add("a", vec![]).unwrap(); // on-disk version is now 1

        // A writer that loaded version 0 and is trying to write version 1 has
        // been overtaken; `mutate` swallows this by reloading, but the raw save
        // must report it.
        let stale = WorkState {
            version: 1,
            items: vec![],
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

        add("existing", vec![]).unwrap();

        // Simulate another process winning the race: the first `apply` pass
        // writes a competing version behind our back, so the save conflicts and
        // `mutate` reloads and reapplies on the newer state.
        let interfered = std::cell::Cell::new(false);
        let (state, _) = mutate(|state| {
            if !interfered.get() {
                interfered.set(true);
                let mut theirs = storage::load().unwrap();
                theirs.items.push(WorkItem {
                    id: "deadbeef".to_owned(),
                    title: "theirs".to_owned(),
                    refs: vec![],
                    created_at: now_iso8601(),
                });
                theirs.version += 1;
                storage::save(&theirs).unwrap();
            }
            state.items.push(WorkItem {
                id: "cafed00d".to_owned(),
                title: "ours".to_owned(),
                refs: vec![],
                created_at: now_iso8601(),
            });
            Ok(((), true))
        })
        .unwrap();

        assert!(interfered.get(), "the test must have forced a conflict");
        // Both writes survive: the retry reapplied on top of theirs.
        assert_eq!(titles(&state), ["existing", "theirs", "ours"]);
        assert_eq!(state, list().unwrap());
    }

    #[test]
    fn repo_paths_normalize_to_the_repo_root() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();

        // A path with a `.` segment and one without resolve to the same string,
        // so they count as the same binding.
        let direct = WorkRef::new(repo.path(), "main");
        let indirect = WorkRef::new(PathBuf::from(repo.path()).join("."), "main");
        assert_eq!(direct, indirect);

        add("normalized", vec![direct]).unwrap();
        let (_, other) = add("other", vec![]).unwrap();
        assert!(matches!(
            bind(&other.id, indirect),
            Err(WorkError::RefBound { .. })
        ));
    }

    #[test]
    fn refs_from_the_wire_are_normalized_too() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();
        let canonical = normalize_repo_path(repo.path());

        // A struct built by serde (the app posts `{repoPath, ref}`) never went
        // through `WorkRef::new`, so the operations have to normalize it.
        let raw = WorkRef {
            repo_path: repo.path().join(".").to_string_lossy().to_string(),
            ref_name: "main".to_owned(),
        };
        assert_ne!(raw.repo_path, canonical, "the test path must need fixing");

        let (_, item) = add("from the app", vec![raw.clone()]).unwrap();
        assert_eq!(item.refs[0].repo_path, canonical);

        // …and the stored, canonical form is what an unbind of the raw ref hits.
        let (_, unbound) = unbind(&item.id, &raw).unwrap();
        assert!(unbound.refs.is_empty());
    }
}
