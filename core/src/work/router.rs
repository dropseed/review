//! The router: anything that arrives with a directory gets a workspace.
//!
//! A terminal, a peek, a `⌘K` landing — each of them starts life as a path, and
//! the model has no place for something unattached. [`route_to`] turns a cwd
//! into a workspace: the first one in queue order already attached to that
//! directory, otherwise a fresh workspace it mints (`auto_created: true`)
//! attached to it now. Nothing is ever unplaced, and nothing has to ask.
//!
//! Attachments are not exclusive, so the queue's order is what breaks the tie
//! when several workspaces show the same repository. That makes the router a
//! *heuristic*, and deliberately so: a wrong guess costs one drag of a terminal
//! onto the right card, while asking would cost a dialog on every ⌘T.
//!
//! [`preview_in`] answers the same question without writing, which is what a
//! landing preview ("this will join *reserved tunnels*" / "this will start
//! *django · master*") shows before the human commits. It is also the *only*
//! place the decision is made — [`route_to`] commits whatever it returns, so a
//! preview can never disagree with what actually happens.
//!
//! Two path facts do the work. An attachment is keyed by the repository's main
//! working tree, so a linked worktree routes to a workspace attached to the
//! repository rather than inventing a second one. And a cwd outside any
//! repository still routes: it attaches the *directory*, which dedupes exactly
//! like a repo does, so peeking at the same scratch directory twice lands in one
//! workspace instead of littering the queue.

use std::path::{Path, PathBuf};

use super::{mutate, push_new, Attachment, WorkError, WorkState, Workspace};
use crate::review::central;
use crate::sources::local_git::current_branch_or_head;

/// What a directory resolves to, resolved once.
///
/// Holding the answer rather than the question is what keeps the git and
/// filesystem work out of the retry loop in [`route_to`]: [`attachment`] is pure
/// string work over what [`locate`] already established.
///
/// [`attachment`]: Location::attachment
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    /// The working tree the directory sits in — a linked worktree stays itself
    /// — or the directory itself when it isn't in a repository. This is what a
    /// terminal started here belongs to.
    pub working_tree: PathBuf,
    /// The repository's main working tree, already `central::repo_root`
    /// normalized. Attachments are keyed by it, so [`Location::attachment`]
    /// builds one directly instead of re-resolving what is already canonical.
    pub root: PathBuf,
    /// The branch checked out here; empty outside a repository.
    pub ref_name: String,
}

impl Location {
    /// The attachment this location implies: the repository, at whatever is
    /// checked out in it.
    pub fn attachment(&self) -> Attachment {
        Attachment {
            path: self.root.to_string_lossy().into_owned(),
            ref_name: Some(self.ref_name.clone()).filter(|name| !name.is_empty()),
        }
    }
}

/// What routing a location would do, without doing it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteResult {
    /// A workspace is already attached here; routing joins it.
    Existing(Workspace),
    /// Nothing is; routing would mint a workspace holding this attachment.
    WouldCreate(Attachment),
}

/// Where something landed, and whether getting there invented the workspace —
/// the difference between "joined X" and "new workspace X".
#[derive(Debug, Clone)]
pub struct Landing {
    pub workspace: Workspace,
    pub created: bool,
}

/// Resolve a directory: which working tree it's in, which repository that
/// belongs to, and what's checked out there.
///
/// Total by design — a path outside any repository resolves to itself with no
/// ref, because "not a repo" is not a reason to have nowhere to go.
pub fn locate(cwd: &Path) -> Location {
    let working_tree = central::enclosing_working_tree(cwd);
    let ref_name = working_tree
        .as_deref()
        .and_then(current_branch_or_head)
        .unwrap_or_default();
    // Canonicalized for the same reason `enclosing_working_tree` canonicalizes
    // what it finds: a directory attachment is keyed by this path, and on macOS
    // the same directory is reachable as `/tmp/x` and `/private/tmp/x`. Without
    // this, peeking at one spelling and then the other litters the queue with
    // two workspaces for one directory.
    let working_tree =
        working_tree.unwrap_or_else(|| cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf()));
    Location {
        // Total for non-repo paths too, where it just canonicalizes — which is
        // exactly the identity a directory attachment needs.
        root: central::repo_root(&working_tree),
        working_tree,
        ref_name,
    }
}

/// What routing `location` would do, against a queue the caller already holds.
///
/// The one place the routing decision is made; [`route_to`] runs it inside its
/// own mutation rather than reading the queue a second time.
pub fn preview_in(state: &WorkState, location: &Location) -> RouteResult {
    let attachment = location.attachment();
    match state.first_attached(&attachment.path) {
        Some(workspace) => RouteResult::Existing(workspace.clone()),
        None => RouteResult::WouldCreate(attachment),
    }
}

/// The location a repository and a branch name imply, for a caller holding
/// both already — a ⌘K row, a repo tab.
///
/// No filesystem walk and no `git`: routing keys on the repository root, and it
/// is in hand. The working tree is the repository's own, because a caller naming
/// a branch is naming the repository rather than some checkout of it.
pub fn location_of_ref(repo_path: &Path, ref_name: &str) -> Location {
    let root = central::repo_root(repo_path);
    Location {
        working_tree: root.clone(),
        root,
        ref_name: ref_name.to_owned(),
    }
}

/// [`preview_in`] for a caller that has only a path.
pub fn preview(cwd: &Path) -> Result<RouteResult, WorkError> {
    Ok(preview_in(&super::list()?, &locate(cwd)))
}

/// Resolve `cwd` to its workspace and commit that: the single front door.
pub fn route_to(cwd: &Path, explicit: Option<&str>) -> Result<Landing, WorkError> {
    land(&locate(cwd), explicit)
}

/// [`route_to`] for a caller that has already located its directory (and needs
/// the rest of the [`Location`] for its own purposes).
///
/// An `explicit` workspace (a unique id prefix) is the human naming where this
/// goes, and naming it answers the only question routing exists to answer — so
/// the session lands there and **nothing is written**. What a workspace is
/// attached to is a separate question, asked with [`super::attach`]; a shell
/// that happened to open in a checkout must not answer it.
///
/// Locating happened once, before this; only the queue read-modify-write can be
/// retried, and a retry costs a couple of string clones rather than another walk
/// up the filesystem and another `git` invocation.
pub fn land(location: &Location, explicit: Option<&str>) -> Result<Landing, WorkError> {
    if let Some(query) = explicit {
        return Ok(Landing {
            workspace: super::get(query)?,
            created: false,
        });
    }

    // The lookup and the creation are one mutation, so two terminals opened in
    // the same unattached directory at once can't both mint a workspace for it —
    // the loser reloads and finds the winner's attachment.
    let (_state, landing) = mutate(|state| match preview_in(state, location) {
        RouteResult::Existing(workspace) => Ok((
            Landing {
                workspace,
                created: false,
            },
            false,
        )),
        RouteResult::WouldCreate(attachment) => {
            let workspace = push_new(state, None, vec![attachment], true);
            Ok((
                Landing {
                    workspace,
                    created: true,
                },
                true,
            ))
        }
    })?;
    Ok(landing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use crate::test_git::git;
    use crate::work::{add, attach, list, move_workspace};
    use tempfile::TempDir;

    /// A repo on `trunk` with one commit, plus a `feature` branch.
    fn repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "trunk"]);
        git(p, &["config", "user.email", "t@example.com"]);
        git(p, &["config", "user.name", "T"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "first"]);
        git(p, &["branch", "feature"]);
        dir
    }

    /// The directory name of a temp path, which is what a derived title uses.
    fn name_of(dir: &Path) -> String {
        dir.file_name().unwrap().to_string_lossy().into_owned()
    }

    fn route(cwd: &Path) -> Landing {
        route_to(cwd, None).unwrap()
    }

    fn attachment_of(repo: &Path, ref_name: Option<&str>) -> Attachment {
        Attachment::new(repo, ref_name.map(ToOwned::to_owned))
    }

    #[test]
    fn an_unattached_directory_gets_a_workspace_and_the_next_route_joins_it() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let repo = repo();

        let first = route(repo.path());
        assert!(first.created);
        assert!(first.workspace.auto_created, "the router minted it");
        assert_eq!(first.workspace.title, None, "and named nothing");
        // The ref it was found on rides along as a hint, so the derived title
        // reads like the checkout it came from.
        assert_eq!(
            first.workspace.display_title(),
            format!("{} · trunk", name_of(repo.path()))
        );

        // The attachment it took is what makes the second route a join, not a
        // second workspace for the same repo.
        let second = route(repo.path());
        assert!(!second.created);
        assert_eq!(second.workspace.id, first.workspace.id);
        assert_eq!(list().unwrap().workspaces.len(), 1);
    }

    #[test]
    fn an_attached_repo_routes_to_the_workspace_showing_it() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let repo = repo();

        let mine = add(
            Some("reserved tunnels"),
            vec![attachment_of(repo.path(), Some("trunk"))],
        )
        .unwrap()
        .1;

        match preview(repo.path()).unwrap() {
            RouteResult::Existing(found) => assert_eq!(found.id, mine.id),
            other @ RouteResult::WouldCreate(_) => panic!("expected the holder, got {other:?}"),
        }
        let landing = route(repo.path());
        assert!(!landing.created);
        assert_eq!(landing.workspace.id, mine.id);
        // Routing to an existing workspace changes nothing about it — the ref
        // hint is the workspace's, not the shell's.
        assert_eq!(
            landing.workspace.attachments,
            vec![attachment_of(repo.path(), Some("trunk"))]
        );
    }

    /// Nothing is exclusive, so several workspaces can show one repo. Priority
    /// order is the tie-break, and moving one to the top moves the routing with
    /// it.
    #[test]
    fn queue_order_decides_between_workspaces_showing_the_same_repo() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let repo = repo();

        let first = add(Some("first"), vec![attachment_of(repo.path(), None)])
            .unwrap()
            .1;
        let second = add(Some("second"), vec![attachment_of(repo.path(), None)])
            .unwrap()
            .1;

        assert_eq!(route(repo.path()).workspace.id, first.id);

        move_workspace(&second.id, 0, false).unwrap();
        assert_eq!(route(repo.path()).workspace.id, second.id);
        // Routing joined; it never created.
        assert_eq!(list().unwrap().workspaces.len(), 2);
    }

    #[test]
    fn a_worktree_routes_to_a_workspace_attached_to_the_repository() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let repo = repo();

        // A real linked worktree, checked out on `feature`.
        let wt_parent = TempDir::new().unwrap();
        let worktree = wt_parent.path().join("wt");
        git(
            repo.path(),
            &["worktree", "add", worktree.to_str().unwrap(), "feature"],
        );

        // Attached from the main tree...
        let mine = add(Some("the feature"), vec![attachment_of(repo.path(), None)])
            .unwrap()
            .1;
        // ...and routing from inside the worktree finds it, because the
        // attachment's path collapses onto the main working tree.
        let landing = route(&worktree);
        assert!(!landing.created);
        assert_eq!(landing.workspace.id, mine.id);
        assert_eq!(list().unwrap().workspaces.len(), 1);

        // The workspace is the main tree's, but the session that lands here
        // still belongs to the worktree it is actually in.
        let location = locate(&worktree);
        assert_eq!(location.working_tree, worktree);
        assert_eq!(location.root, repo.path().canonicalize().unwrap());
    }

    /// The ⌘T case: the human named the workspace, so routing has nothing left
    /// to decide and nothing to write.
    #[test]
    fn naming_a_workspace_lands_there_and_attaches_nothing() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let repo = repo();

        let mine = add(Some("real work"), vec![]).unwrap().1;
        let before = list().unwrap().version;

        let landing = route_to(repo.path(), Some(&mine.id[..4])).unwrap();
        assert!(!landing.created);
        assert_eq!(landing.workspace.id, mine.id);
        assert!(
            landing.workspace.attachments.is_empty(),
            "the session landed here; the repo did not"
        );
        assert_eq!(
            list().unwrap().version,
            before,
            "a gesture that decided nothing writes nothing"
        );

        // …and an unknown id is an error, not a silent new workspace.
        assert!(matches!(
            route_to(repo.path(), Some("nope")),
            Err(WorkError::NotFound(_))
        ));
    }

    #[test]
    fn attaching_a_repo_takes_over_the_routing_for_it() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let repo = repo();

        // The router got there first, and the human then attached the same repo
        // to a workspace of their own, higher in the queue.
        let ghost = route(repo.path()).workspace;
        let mine = add(Some("real work"), vec![]).unwrap().1;
        attach(&mine.id, attachment_of(repo.path(), None)).unwrap();
        move_workspace(&mine.id, 0, false).unwrap();

        // Nothing was taken from the router's workspace — it is simply no longer
        // the first answer, and cleanup collects it once nothing runs in it.
        assert_eq!(route(repo.path()).workspace.id, mine.id);
        let state = list().unwrap();
        assert_eq!(state.workspaces.len(), 2);
        let ghost = state.workspaces.iter().find(|w| w.id == ghost.id).unwrap();
        assert_eq!(
            ghost.attachments,
            vec![attachment_of(repo.path(), Some("trunk"))]
        );
    }

    #[test]
    fn a_directory_outside_any_repo_routes_and_dedupes_like_a_repo() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _tmp) = setup_test();
        let plain = TempDir::new().unwrap();
        let dir = plain.path().join("scratch");
        std::fs::create_dir(&dir).unwrap();

        let location = locate(&dir);
        assert_eq!(location.ref_name, "");
        assert_eq!(
            preview(&dir).unwrap(),
            RouteResult::WouldCreate(location.attachment())
        );

        let first = route(&dir);
        assert!(first.created);
        assert_eq!(first.workspace.display_title(), "scratch");
        assert_eq!(first.workspace.attachments, vec![location.attachment()]);

        // The directory is attached like any repo, so coming back here joins
        // rather than littering the queue with a second workspace.
        let second = route(&dir);
        assert!(!second.created);
        assert_eq!(second.workspace.id, first.workspace.id);
        assert_eq!(list().unwrap().workspaces.len(), 1);

        // …including by another spelling of the same directory. On macOS every
        // temp path is one (`/var` is a symlink to `/private/var`), and a shell
        // started from each would otherwise get a workspace of its own.
        let canonical = dir.canonicalize().unwrap();
        assert_ne!(canonical, dir, "the test needs two spellings");
        let third = route(&canonical);
        assert!(!third.created);
        assert_eq!(third.workspace.id, first.workspace.id);
        assert_eq!(list().unwrap().workspaces.len(), 1);
    }
}
