//! Workspace subcommands: `workspace [list] | add | remove | rename | reorder |
//! attach | detach | resolve` (aliased as `work`).
//!
//! The queue is the global, user-ordered list of the workspaces you intend to
//! work on next (see [`crate::work`]). It is cross-repo, so nothing here
//! resolves a comparison — `--repo` only says which repository an [`Attachment`]
//! points at, defaulting to the repo the command was run in.
//!
//! Positions are **1-based here** and 0-based in the core module, matching how
//! the list prints. Ids accept unique prefixes, like `review terminal`.

use std::collections::HashSet;
use std::path::PathBuf;

use clap::{Args, Subcommand};
use serde_json::json;

use crate::daemon::{socket_path, DaemonClient};
use crate::work::router::{self, RouteResult};
use crate::work::{self, Attachment, Workspace};

use super::common::{print_json, resolve_cwd_arg};

#[derive(Debug, Args)]
pub struct WorkspaceArgs {
    #[command(subcommand)]
    pub action: Option<WorkspaceAction>,
    /// Output as JSON
    ///
    /// Global, like `--home` and `--repo` elsewhere in the CLI, so it is
    /// accepted on either side of the subcommand rather than only after it.
    #[arg(long, global = true)]
    pub json: bool,
}

#[derive(Debug, Subcommand)]
pub enum WorkspaceAction {
    /// List your workspaces in priority order
    List,
    /// Add a workspace to the end of the queue
    Add(AddArgs),
    /// Remove a workspace
    Remove(IdArgs),
    /// Retitle a workspace (omit the title to go back to a derived one)
    Rename(RenameArgs),
    /// Move a workspace to a new position in the queue (1-based)
    Reorder(ReorderArgs),
    /// Show a repository in a workspace
    Attach(AttachArgs),
    /// Stop showing a repository in a workspace
    Detach(DetachArgs),
    /// Show which workspace a directory routes to (without creating anything)
    Resolve(ResolveArgs),
}

#[derive(Debug, Args)]
pub struct AddArgs {
    /// What you intend to do (omit for an untitled workspace)
    pub title: Option<String>,
}

#[derive(Debug, Args)]
pub struct IdArgs {
    /// Workspace id (a unique prefix is accepted)
    pub id: String,
}

#[derive(Debug, Args)]
pub struct RenameArgs {
    /// Workspace id (a unique prefix is accepted)
    pub id: String,
    /// The new title (omit or pass an empty string to derive one instead)
    pub title: Option<String>,
}

#[derive(Debug, Args)]
pub struct ReorderArgs {
    /// Workspace id (a unique prefix is accepted)
    pub id: String,
    /// New position, 1-based (1 is the top of the queue)
    pub position: usize,
}

#[derive(Debug, Args)]
pub struct AttachArgs {
    /// Workspace id (a unique prefix is accepted)
    pub id: String,
    /// Repository (or directory) to show (defaults to the current directory)
    pub path: Option<String>,
    /// Branch or comparison being looked at — a display hint, not identity
    #[arg(long = "ref", value_name = "REF")]
    pub ref_name: Option<String>,
}

#[derive(Debug, Args)]
pub struct DetachArgs {
    /// Workspace id (a unique prefix is accepted)
    pub id: String,
    /// Repository (or directory) to stop showing (defaults to the current directory)
    pub path: Option<String>,
}

#[derive(Debug, Args)]
pub struct ResolveArgs {
    /// Directory to route (defaults to the current directory)
    pub cwd: Option<String>,
}

/// Dispatch a `review workspace ...` invocation. No subcommand lists the queue.
pub fn run_workspace(args: WorkspaceArgs) -> Result<(), String> {
    let json = args.json;
    match args.action {
        None | Some(WorkspaceAction::List) => run_list(json),
        Some(WorkspaceAction::Add(a)) => run_add(a, json),
        Some(WorkspaceAction::Remove(a)) => run_remove(a, json),
        Some(WorkspaceAction::Rename(a)) => run_rename(a, json),
        Some(WorkspaceAction::Reorder(a)) => run_reorder(a, json),
        Some(WorkspaceAction::Attach(a)) => run_attach(a, json),
        Some(WorkspaceAction::Detach(a)) => run_detach(a, json),
        Some(WorkspaceAction::Resolve(a)) => run_resolve(a, json),
    }
}

/// Resolve an optional path argument: what was given, else here.
///
/// Deliberately not `get_repo_path`, which refuses a directory outside any
/// repository — an attachment is happy with one, and [`Attachment::new`]
/// normalizes either kind to the same identity the router uses.
fn target_path(path: Option<String>) -> Result<PathBuf, String> {
    resolve_cwd_arg(path)
}

/// A runtime to run one daemon round trip on, mirroring `review terminal`'s
/// bridge from the synchronous CLI.
fn daemon_runtime() -> Option<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()
}

/// What the daemon can say about the queue, or `None` when it is not running.
///
/// The distinction is the whole point: `None` means "unknown", and cleanup on
/// unknown liveness would reap every workspace the app is using. The queue is
/// a plain file, so `review workspace` keeps working either way.
fn live_workspaces() -> Option<HashSet<String>> {
    let runtime = daemon_runtime()?;
    runtime.block_on(async {
        let client = DaemonClient::connect(&socket_path().ok()?).await.ok()?;
        client.live_workspaces().await.ok()
    })
}

fn run_list(json: bool) -> Result<(), String> {
    // Cleanup is lazy, and this is one of the two reads that can do it — the
    // other is the app's `work_list`. Both need the daemon's answer first.
    //
    // Unlike the app's, this read cannot spare the workspace the human is
    // *looking at*: which one that is belongs to a window this process has no
    // handle on. So a `review workspace list` from a shell can reap a workspace the
    // app has open on the stage — an accepted race. It costs a peek that could
    // be re-made in one keystroke, and closing it would mean the queue file
    // carrying per-window UI state.
    let live = live_workspaces();
    let state = work::list_with_liveness(live.as_ref()).map_err(|e| e.to_string())?;
    let views = work::views(state.workspaces);
    if json {
        print_json(&views);
        return Ok(());
    }
    if views.is_empty() {
        println!("No workspaces. Add one with `review workspace add \"...\"`.");
        return Ok(());
    }
    for (i, view) in views.iter().enumerate() {
        println!("{}. {}  {}", i + 1, view.display_title, view.workspace.id);
        for attachment in &view.workspace.attachments {
            println!("     {}", attachment.label());
        }
    }
    Ok(())
}

/// Print a workspace after a mutation: the JSON workspace, or a one-line
/// confirmation.
fn report(json: bool, workspace: Workspace, message: &str) {
    if json {
        print_json(&work::WorkspaceView::from(workspace));
    } else {
        println!("{message}");
    }
}

fn run_add(args: AddArgs, json: bool) -> Result<(), String> {
    let (state, ws) = work::add(args.title.as_deref(), vec![]).map_err(|e| e.to_string())?;
    let message = format!(
        "Added \"{}\" at position {} ({}).",
        ws.display_title(),
        state.workspaces.len(),
        ws.id
    );
    report(json, ws, &message);
    Ok(())
}

fn run_remove(args: IdArgs, json: bool) -> Result<(), String> {
    let (_state, ws) = work::remove(&args.id).map_err(|e| e.to_string())?;
    let message = format!("Removed \"{}\" ({}).", ws.display_title(), ws.id);
    report(json, ws, &message);
    Ok(())
}

fn run_rename(args: RenameArgs, json: bool) -> Result<(), String> {
    let (_state, ws) = work::rename(&args.id, args.title.as_deref()).map_err(|e| e.to_string())?;
    let message = match ws.title {
        Some(_) => format!("Renamed {} to \"{}\".", ws.id, ws.display_title()),
        // Cleared: what it is called now is whatever it is showing.
        None => format!(
            "Cleared the title of {}; it reads \"{}\".",
            ws.id,
            ws.display_title()
        ),
    };
    report(json, ws, &message);
    Ok(())
}

fn run_reorder(args: ReorderArgs, json: bool) -> Result<(), String> {
    // 1-based on the way in, to match the printed list; 0 and 1 both mean "top"
    // rather than erroring on an off-by-one.
    let to_index = args.position.saturating_sub(1);
    let (state, ws) = work::move_workspace(&args.id, to_index).map_err(|e| e.to_string())?;
    // Report where it actually landed, which differs from what was asked for
    // when the position was past the end.
    let position = to_index.min(state.workspaces.len().saturating_sub(1)) + 1;
    let message = format!("Moved \"{}\" to position {position}.", ws.display_title());
    report(json, ws, &message);
    Ok(())
}

fn run_attach(args: AttachArgs, json: bool) -> Result<(), String> {
    let attachment = Attachment::new(target_path(args.path)?, args.ref_name);
    let label = attachment.label();
    let (_state, ws) = work::attach(&args.id, attachment).map_err(|e| e.to_string())?;
    let message = format!("Attached {label} to \"{}\".", ws.display_title());
    report(json, ws, &message);
    Ok(())
}

fn run_detach(args: DetachArgs, json: bool) -> Result<(), String> {
    let path = target_path(args.path)?;
    let (_state, ws) = work::detach(&args.id, &path).map_err(|e| e.to_string())?;
    let message = format!(
        "Detached {} from \"{}\".",
        path.display(),
        ws.display_title()
    );
    report(json, ws, &message);
    Ok(())
}

fn run_resolve(args: ResolveArgs, json: bool) -> Result<(), String> {
    let cwd = resolve_cwd_arg(args.cwd)?;
    let (payload, line) = match router::preview(&cwd).map_err(|e| e.to_string())? {
        RouteResult::Existing(ws) => {
            let line = format!("Joins \"{}\" ({}).", ws.display_title(), ws.id);
            (
                json!({ "action": "join", "workspace": work::WorkspaceView::from(ws) }),
                line,
            )
        }
        RouteResult::WouldCreate(attachment) => {
            let line = format!("Starts a new workspace \"{}\".", attachment.label());
            (
                json!({ "action": "create", "attachment": attachment }),
                line,
            )
        }
    };
    if json {
        print_json(&payload);
    } else {
        println!("{line}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parse an argv into the workspace action it names.
    fn action(argv: &[&str]) -> Option<WorkspaceAction> {
        use clap::Parser;
        let cli = crate::cli::Cli::try_parse_from(argv).unwrap();
        let Some(crate::cli::Commands::Workspace(w)) = cli.command else {
            panic!("expected the workspace subcommand");
        };
        w.action
    }

    #[test]
    fn work_still_names_the_workspace_command() {
        // The rename is a rename of the word, not of the surface: every
        // `review work ...` in a shell history, a script, or an older skill
        // keeps landing on the same subcommand.
        assert!(matches!(
            action(&["review", "work", "add", "a title"]),
            Some(WorkspaceAction::Add(_))
        ));
        assert!(matches!(
            action(&["review", "workspace", "add", "a title"]),
            Some(WorkspaceAction::Add(_))
        ));
        // Bare, under either name, is the listing.
        assert!(action(&["review", "work"]).is_none());
        assert!(action(&["review", "workspace"]).is_none());
    }
}
