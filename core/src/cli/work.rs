//! Work subcommands: `work [list] | add | remove | rename | move | bind | unbind`.
//!
//! The work queue is the global, user-ordered list of what you intend to work
//! on next (see [`crate::work`]). It is cross-repo, so nothing here resolves a
//! comparison — `--repo` only qualifies a branch name into a [`WorkRef`],
//! defaulting to the repo the command was run in.
//!
//! Positions are **1-based here** and 0-based in the core module, matching how
//! the list prints. Ids accept unique prefixes, like `review terminal`.

use std::path::PathBuf;

use clap::{Args, Subcommand};

use crate::work::{self, WorkItem, WorkRef};

use super::common::print_json;
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct WorkArgs {
    #[command(subcommand)]
    pub action: Option<WorkAction>,
    /// Output as JSON
    ///
    /// Global, like `--home` and `--repo` elsewhere in the CLI, so it is
    /// accepted on either side of the subcommand rather than only after it.
    #[arg(long, global = true)]
    pub json: bool,
}

#[derive(Debug, Subcommand)]
pub enum WorkAction {
    /// List the work queue in priority order
    List,
    /// Add an item to the end of the queue
    Add(AddArgs),
    /// Remove an item
    Remove(IdArgs),
    /// Retitle an item
    Rename(RenameArgs),
    /// Move an item to a new position (1-based)
    Move(MoveArgs),
    /// Bind a branch to an item
    Bind(BindArgs),
    /// Unbind a branch from an item
    Unbind(BindArgs),
}

#[derive(Debug, Args)]
pub struct AddArgs {
    /// What you intend to do (may be empty when `--ref` is given)
    pub title: String,
    /// Branch to bind to the new item
    #[arg(long = "ref", value_name = "BRANCH")]
    pub ref_name: Option<String>,
    /// Repository the branch lives in (defaults to the current directory's repo)
    #[arg(short, long)]
    pub repo: Option<String>,
}

#[derive(Debug, Args)]
pub struct IdArgs {
    /// Work item id (a unique prefix is accepted)
    pub id: String,
}

#[derive(Debug, Args)]
pub struct RenameArgs {
    /// Work item id (a unique prefix is accepted)
    pub id: String,
    /// The new title
    pub title: String,
}

#[derive(Debug, Args)]
pub struct MoveArgs {
    /// Work item id (a unique prefix is accepted)
    pub id: String,
    /// New position, 1-based (1 is the top of the queue)
    pub position: usize,
}

#[derive(Debug, Args)]
pub struct BindArgs {
    /// Work item id (a unique prefix is accepted)
    pub id: String,
    /// Branch name
    #[arg(value_name = "BRANCH")]
    pub ref_name: String,
    /// Repository the branch lives in (defaults to the current directory's repo)
    #[arg(short, long)]
    pub repo: Option<String>,
}

/// Dispatch a `review work ...` invocation. No subcommand lists the queue.
pub fn run_work(args: WorkArgs) -> Result<(), String> {
    let json = args.json;
    match args.action {
        None | Some(WorkAction::List) => run_list(json),
        Some(WorkAction::Add(a)) => run_add(a, json),
        Some(WorkAction::Remove(a)) => run_remove(a, json),
        Some(WorkAction::Rename(a)) => run_rename(a, json),
        Some(WorkAction::Move(a)) => run_move(a, json),
        Some(WorkAction::Bind(a)) => run_bind(a, false, json),
        Some(WorkAction::Unbind(a)) => run_bind(a, true, json),
    }
}

/// Build a [`WorkRef`] from a branch name and an optional `--repo`, resolving
/// the repo the same way every other command does when the flag is absent.
fn build_ref(repo: &Option<String>, ref_name: &str) -> Result<WorkRef, String> {
    let repo_path = PathBuf::from(get_repo_path(repo)?);
    Ok(WorkRef::new(repo_path, ref_name))
}

fn run_list(json: bool) -> Result<(), String> {
    let state = work::list().map_err(|e| e.to_string())?;
    if json {
        print_json(&state.items);
        return Ok(());
    }
    if state.items.is_empty() {
        println!("Nothing in the work queue. Add one with `review work add \"...\"`.");
        return Ok(());
    }
    for (i, item) in state.items.iter().enumerate() {
        println!("{}. {}  {}", i + 1, item.display_title(), item.id);
        for work_ref in &item.refs {
            println!("     {}  {}", work_ref.repo_name(), work_ref.ref_name);
        }
    }
    Ok(())
}

/// Print an item after a mutation: the JSON item, or a one-line confirmation.
fn report(json: bool, item: &WorkItem, message: &str) {
    if json {
        print_json(item);
    } else {
        println!("{message}");
    }
}

fn run_add(args: AddArgs, json: bool) -> Result<(), String> {
    let refs = match &args.ref_name {
        Some(name) => vec![build_ref(&args.repo, name)?],
        None => vec![],
    };
    let (state, item) = work::add(&args.title, refs).map_err(|e| e.to_string())?;
    report(
        json,
        &item,
        &format!(
            "Added \"{}\" at position {} ({}).",
            item.display_title(),
            state.items.len(),
            item.id
        ),
    );
    Ok(())
}

fn run_remove(args: IdArgs, json: bool) -> Result<(), String> {
    let (_state, item) = work::remove(&args.id).map_err(|e| e.to_string())?;
    report(
        json,
        &item,
        &format!("Removed \"{}\" ({}).", item.display_title(), item.id),
    );
    Ok(())
}

fn run_rename(args: RenameArgs, json: bool) -> Result<(), String> {
    let (_state, item) = work::rename(&args.id, &args.title).map_err(|e| e.to_string())?;
    report(
        json,
        &item,
        &format!("Renamed {} to \"{}\".", item.id, item.display_title()),
    );
    Ok(())
}

fn run_move(args: MoveArgs, json: bool) -> Result<(), String> {
    // 1-based on the way in, to match the printed list; 0 and 1 both mean "top"
    // rather than erroring on an off-by-one.
    let to_index = args.position.saturating_sub(1);
    let (state, item) = work::move_item(&args.id, to_index).map_err(|e| e.to_string())?;
    // Report where it actually landed, which differs from what was asked for
    // when the position was past the end.
    let position = to_index.min(state.items.len().saturating_sub(1)) + 1;
    report(
        json,
        &item,
        &format!("Moved \"{}\" to position {position}.", item.display_title()),
    );
    Ok(())
}

fn run_bind(args: BindArgs, unbind: bool, json: bool) -> Result<(), String> {
    let work_ref = build_ref(&args.repo, &args.ref_name)?;
    let (_state, item) = if unbind {
        work::unbind(&args.id, &work_ref)
    } else {
        work::bind(&args.id, work_ref.clone())
    }
    .map_err(|e| e.to_string())?;
    let (verb, preposition) = if unbind {
        ("Unbound", "from")
    } else {
        ("Bound", "to")
    };
    report(
        json,
        &item,
        &format!(
            "{verb} {} {} {preposition} \"{}\".",
            work_ref.repo_name(),
            work_ref.ref_name,
            item.display_title()
        ),
    );
    Ok(())
}
