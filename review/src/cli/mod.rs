pub mod commands;

use clap::{Parser, Subcommand};

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
    /// Show current comparison and review progress
    Status,

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

    /// Add a pattern to the trust list
    Trust {
        /// Pattern to trust (e.g., imports:added, formatting:*)
        pattern: String,
    },

    /// Remove a pattern from the trust list
    Untrust {
        /// Pattern to remove from trust list
        pattern: String,
    },

    /// Manually approve a specific hunk
    Approve {
        /// Hunk ID (filepath:hash format)
        hunk_id: String,
    },

    /// Manually reject a specific hunk
    Reject {
        /// Hunk ID (filepath:hash format)
        hunk_id: String,
    },

    /// Clear review state
    Reset {
        /// Also clear trust list
        #[arg(long)]
        hard: bool,
    },

    /// Set or show the current comparison
    Compare {
        /// Comparison spec (e.g., main..HEAD, main..feature-branch)
        spec: Option<String>,

        /// Include working tree changes
        #[arg(short, long)]
        working_tree: bool,

        /// Only show staged changes
        #[arg(long)]
        staged: bool,
    },

    /// Open the GUI for the current comparison
    Open {
        /// Comparison spec (optional, uses current if not specified)
        spec: Option<String>,
    },

    /// Show the trust pattern taxonomy
    Taxonomy {
        /// Show only a specific category
        #[arg(short, long)]
        category: Option<String>,
    },

    /// Run classification eval to measure accuracy
    Eval {
        /// Model to use (e.g., sonnet, haiku, opus)
        #[arg(short, long, default_value = "sonnet")]
        model: String,

        /// Number of runs per case (for consistency checks)
        #[arg(short = 'n', long, default_value = "1")]
        runs: usize,

        /// Filter by tag
        #[arg(long)]
        tag: Option<String>,

        /// Filter by case ID
        #[arg(long)]
        case: Option<String>,

        /// Path to custom fixtures file
        #[arg(long)]
        fixtures: Option<String>,

        /// Maximum concurrent classifications
        #[arg(long, default_value = "2")]
        concurrency: usize,

        /// Show every case result
        #[arg(short, long)]
        verbose: bool,
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

/// Run the CLI with parsed arguments
pub fn run(cli: Cli) -> Result<(), String> {
    // Eval doesn't require a git repo — handle it before resolving repo_path
    if let Some(Commands::Eval {
        model,
        runs,
        tag,
        case,
        fixtures,
        concurrency,
        verbose,
    }) = cli.command
    {
        return commands::eval::run(
            &model,
            runs,
            tag.as_deref(),
            case.as_deref(),
            fixtures.as_deref(),
            concurrency,
            verbose,
            cli.format,
        );
    }

    let repo_path = cli.get_repo_path()?;

    match cli.command {
        None => commands::open::run(&repo_path, None),
        Some(Commands::Status) => commands::status::run(&repo_path, cli.format),
        Some(Commands::Diff { labeled, file }) => {
            commands::diff::run(&repo_path, labeled, file, cli.format)
        }
        Some(Commands::Files { all }) => commands::files::run(&repo_path, all, cli.format),
        Some(Commands::Classify {
            model,
            concurrency,
            batch_size,
        }) => commands::classify::run(&repo_path, &model, concurrency, batch_size, cli.format),
        Some(Commands::Trust { pattern }) => commands::trust::run(&repo_path, &pattern, cli.format),
        Some(Commands::Untrust { pattern }) => {
            commands::untrust::run(&repo_path, &pattern, cli.format)
        }
        Some(Commands::Approve { hunk_id }) => {
            commands::approve::run(&repo_path, &hunk_id, true, cli.format)
        }
        Some(Commands::Reject { hunk_id }) => {
            commands::approve::run(&repo_path, &hunk_id, false, cli.format)
        }
        Some(Commands::Reset { hard }) => commands::reset::run(&repo_path, hard, cli.format),
        Some(Commands::Compare {
            spec,
            working_tree,
            staged,
        }) => commands::compare::run(&repo_path, spec, working_tree, staged, cli.format),
        Some(Commands::Open { spec }) => commands::open::run(&repo_path, spec),
        Some(Commands::Taxonomy { category }) => {
            commands::taxonomy::run(&repo_path, category, cli.format)
        }
        Some(Commands::Eval { .. }) => unreachable!("handled above"),
    }
}
