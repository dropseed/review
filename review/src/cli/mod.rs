pub mod commands;

use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;
use clap::{Parser, Subcommand};
use std::path::Path;

#[derive(Debug, Parser)]
#[command(name = "review")]
#[command(author, version, about = "Review diffs more efficiently", long_about = None)]
pub struct Cli {
    /// Repository path (defaults to current directory)
    #[arg(short, long, global = true)]
    pub repo: Option<String>,

    /// Output format
    #[arg(long, global = true, default_value = "text")]
    pub format: OutputFormat,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Start a review (set or auto-detect comparison)
    Start {
        /// Comparison spec (e.g., main..HEAD, main..feature-branch)
        spec: Option<String>,

        /// Include working tree changes
        #[arg(short, long)]
        working_tree: bool,
    },

    /// Show current comparison and review progress
    Status,

    /// List saved reviews
    List {
        /// Show reviews from all repositories
        #[arg(short, long)]
        all: bool,
    },

    /// Delete a saved review
    Delete {
        /// Comparison key to delete (e.g., main..HEAD)
        key: String,
    },

    /// Show diff with trust labels
    Diff {
        /// Show labels inline with hunks
        #[arg(long)]
        labeled: bool,

        /// Specific file to show
        file: Option<String>,
    },

    /// List changed files
    Files {
        /// Include unchanged files
        #[arg(long)]
        all: bool,
    },

    /// Run Claude classification on unclassified hunks
    Classify {
        /// Model to use (e.g., sonnet, haiku, opus)
        #[arg(short, long, default_value = "sonnet")]
        model: String,

        /// Maximum concurrent batches
        #[arg(long, default_value = "2")]
        concurrency: usize,

        /// Batch size for classification
        #[arg(long, default_value = "5")]
        batch_size: usize,
    },

    /// Clear review state
    Reset {
        /// Also clear trust list
        #[arg(long)]
        hard: bool,
    },

    /// View or set review notes
    Notes {
        /// Note text to set (omit to view current notes)
        text: Option<String>,

        /// Append to existing notes instead of replacing
        #[arg(short, long)]
        append: bool,
    },

    /// Review a GitHub pull request
    Pr {
        /// PR number (omit to list open PRs)
        number: Option<u32>,
    },

    /// Open the GUI for the current comparison
    Open {
        /// Comparison spec (optional, uses current if not specified)
        spec: Option<String>,
    },
}

impl Cli {
    /// Get the repository path, using current directory as default
    pub fn get_repo_path(&self) -> Result<String, String> {
        if let Some(ref repo) = self.repo {
            return Ok(repo.clone());
        }

        // Check current working directory and walk up to find .git
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

        let mut current = cwd.as_path();
        loop {
            if current.join(".git").exists() {
                return Ok(current.to_string_lossy().to_string());
            }
            match current.parent() {
                Some(parent) => current = parent,
                None => break,
            }
        }

        Err("Not a git repository. Use --repo to specify a repository path.".to_owned())
    }
}

/// Get the current comparison, or auto-detect one from the repo's default and current branches.
///
/// Falls back to `<default_branch>..<current_branch>` with working tree auto-included.
pub fn get_or_detect_comparison(repo_path: &Path) -> Result<Comparison, String> {
    // Try saved comparison first
    if let Some(comparison) =
        storage::get_current_comparison(repo_path).map_err(|e| e.to_string())?
    {
        return Ok(comparison);
    }

    // Auto-detect: default branch vs current branch with working tree
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    let default_branch = source
        .get_default_branch()
        .unwrap_or_else(|_| "main".to_owned());
    let current_branch = source.get_current_branch().map_err(|e| e.to_string())?;

    let key = format!("{default_branch}..{current_branch}");
    Ok(Comparison {
        old: default_branch,
        new: current_branch,
        working_tree: true,
        key,
        github_pr: None,
    })
}

/// Parse a comparison spec (e.g. "main..feature") into a `Comparison`.
///
/// Used by both `start` and `open` commands.
pub fn parse_comparison_spec(
    repo_path: &Path,
    spec: &str,
    working_tree: bool,
) -> Result<Comparison, String> {
    let (base, head) = if spec.contains("..") {
        let parts: Vec<&str> = spec.splitn(2, "..").collect();
        (parts[0].to_owned(), parts[1].to_owned())
    } else {
        // Single ref means compare against it with working tree
        let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
        let default_branch = source
            .get_default_branch()
            .unwrap_or_else(|_| "main".to_owned());

        if working_tree {
            (spec.to_owned(), "HEAD".to_owned())
        } else {
            (default_branch, spec.to_owned())
        }
    };

    let key = format!("{base}..{head}");

    Ok(Comparison {
        old: base,
        new: head,
        working_tree,
        key,
        github_pr: None,
    })
}

/// Run the CLI with parsed arguments
pub fn run(cli: Cli) -> Result<(), String> {
    // List doesn't always require a git repo
    if let Some(Commands::List { all }) = cli.command {
        let repo_path = cli.get_repo_path().ok();
        return commands::list::run(repo_path.as_deref(), all, cli.format);
    }

    let repo_path = cli.get_repo_path()?;

    match cli.command {
        None => commands::open::run(&repo_path, None),
        Some(Commands::Start { spec, working_tree }) => {
            commands::start::run(&repo_path, spec, working_tree, cli.format)
        }
        Some(Commands::Status) => commands::status::run(&repo_path, cli.format),
        Some(Commands::Delete { key }) => commands::delete::run(&repo_path, &key, cli.format),
        Some(Commands::Diff { labeled, file }) => {
            commands::diff::run(&repo_path, labeled, file, cli.format)
        }
        Some(Commands::Files { all }) => commands::files::run(&repo_path, all, cli.format),
        Some(Commands::Classify {
            model,
            concurrency,
            batch_size,
        }) => commands::classify::run(&repo_path, &model, concurrency, batch_size, cli.format),
        Some(Commands::Reset { hard }) => commands::reset::run(&repo_path, hard, cli.format),
        Some(Commands::Notes { text, append }) => {
            commands::notes::run(&repo_path, text, append, cli.format)
        }
        Some(Commands::Pr { number }) => commands::pr::run(&repo_path, number, cli.format),
        Some(Commands::Open { spec }) => commands::open::run(&repo_path, spec),
        Some(Commands::List { .. }) => unreachable!("handled above"),
    }
}
