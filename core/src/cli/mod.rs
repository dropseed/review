use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Parser)]
#[command(name = "review")]
#[command(author, version, about = "Review diffs more efficiently", long_about = None)]
pub struct Cli {
    /// Override the data directory (default: ~/.review/, env: REVIEW_HOME)
    #[arg(long, global = true)]
    pub home: Option<String>,

    #[command(subcommand)]
    pub command: Option<Commands>,

    /// Path to open (file or directory, defaults to current directory)
    pub path: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Start a review: resolve a comparison, create review state, and open the app
    Start {
        /// Repository path (defaults to current directory)
        #[arg(short, long)]
        repo: Option<String>,

        /// Comparison spec: "base..head" or a single ref (compared against default branch).
        /// Auto-detects from branches if not specified.
        spec: Option<String>,

        /// The old side of the diff (defaults to default branch)
        #[arg(long)]
        old: Option<String>,

        /// The new side of the diff (defaults to current branch)
        #[arg(long)]
        new: Option<String>,
    },
}

/// Walk up from `start` to find a directory containing `.git/`.
fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if current.join(".git").exists() {
            return Some(current.to_path_buf());
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return None,
        }
    }
}

/// Get the repository path from an explicit `--repo` flag, or walk up from cwd.
fn get_repo_path(repo: &Option<String>) -> Result<String, String> {
    if let Some(ref repo) = repo {
        return Ok(repo.clone());
    }

    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    find_repo_root(&cwd)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Not a git repository. Use --repo to specify a repository path.".to_owned())
}

/// Resolve a potentially relative path to an absolute one.
fn resolve_absolute(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    Ok(cwd.join(path))
}

/// Resolve the path given to `review [path]`. Returns `(repo_or_path, Option<relative_file_path>)`.
/// When the target is a file inside a git repo, the relative path from the repo root is returned.
/// When no git repo is found, returns `(target_path, None)`.
fn resolve_open_path(path: Option<String>) -> Result<(String, Option<String>), String> {
    let target = match path {
        Some(p) => {
            let abs = resolve_absolute(Path::new(&p))?;
            abs.canonicalize().unwrap_or(abs)
        }
        None => std::env::current_dir().map_err(|e| e.to_string())?,
    };

    // If it's a file, start searching from the parent directory
    let search_start = if target.is_file() {
        target.parent().unwrap_or(&target).to_path_buf()
    } else {
        target.clone()
    };

    // Try to find a git repo root
    match find_repo_root(&search_start) {
        Some(repo_root) => {
            // If the target is a file (or at least different from the repo root),
            // compute the relative path from the repo root.
            let focused_file = if target.is_file() {
                target
                    .strip_prefix(&repo_root)
                    .ok()
                    .map(|rel| rel.to_string_lossy().to_string())
            } else {
                None
            };
            Ok((repo_root.to_string_lossy().to_string(), focused_file))
        }
        None => Ok((target.to_string_lossy().to_string(), None)),
    }
}

/// Run the CLI: dispatch to the appropriate subcommand.
pub fn run(cli: Cli) -> Result<(), String> {
    let has_home_override = cli.home.is_some();

    // Set REVIEW_HOME early so all storage calls use the override
    if let Some(home) = &cli.home {
        let absolute = resolve_absolute(Path::new(home))?;
        std::env::set_var("REVIEW_HOME", &absolute);
    }

    match cli.command {
        Some(Commands::Start {
            repo,
            spec,
            old,
            new,
        }) => run_start(repo, spec, old, new, has_home_override),
        None => run_open(cli.path, has_home_override),
    }
}

fn warn_home_override(has_home_override: bool) {
    if has_home_override {
        eprintln!(
            "Note: --home only takes effect on a fresh launch. If Review is already running, quit it first."
        );
    }
}

/// `review [path]` — open a path in the app without creating a review.
fn run_open(path: Option<String>, has_home_override: bool) -> Result<(), String> {
    let (repo_path, focused_file) = resolve_open_path(path)?;
    open_app(&repo_path, None, focused_file.as_deref())?;
    warn_home_override(has_home_override);
    Ok(())
}

/// `review start [spec]` — resolve a comparison, persist review state, open the app.
fn run_start(
    repo: Option<String>,
    spec: Option<String>,
    old: Option<String>,
    new: Option<String>,
    has_home_override: bool,
) -> Result<(), String> {
    let repo_path = get_repo_path(&repo)?;
    let path = PathBuf::from(&repo_path);

    let comparison = if let Some(spec) = spec {
        parse_comparison_spec(&path, &spec)?
    } else {
        resolve_comparison(&path, old, new)?
    };

    storage::ensure_review_exists(&path, &comparison, None).map_err(|e| e.to_string())?;
    open_app(&repo_path, Some(&comparison.key), None)?;
    warn_home_override(has_home_override);
    Ok(())
}

/// Resolve a comparison from optional `--old`/`--new` overrides, falling back
/// to the repo's default and current branches for whichever side is `None`.
fn resolve_comparison(
    repo_path: &Path,
    old: Option<String>,
    new: Option<String>,
) -> Result<Comparison, String> {
    let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
    let base = old.unwrap_or_else(|| {
        source
            .get_default_branch()
            .unwrap_or_else(|_| "main".to_owned())
    });
    let head = new.unwrap_or_else(|| {
        source
            .get_current_branch()
            .unwrap_or_else(|_| "HEAD".to_owned())
    });
    Ok(Comparison::new(base, head))
}

/// Parse a comparison spec (e.g. "main..feature") into a `Comparison`.
/// A single ref is compared against the default branch.
fn parse_comparison_spec(repo_path: &Path, spec: &str) -> Result<Comparison, String> {
    if let Some((base, head)) = spec.split_once("..") {
        Ok(Comparison::new(base.to_owned(), head.to_owned()))
    } else {
        // Single ref: compare default branch against the given ref
        resolve_comparison(repo_path, None, Some(spec.to_owned()))
    }
}

/// Path to the signal file used to communicate a repo path to the running app.
/// On macOS, `open -a` silently drops `--args` when the app is already running.
/// The CLI writes the requested repo path here, and the app reads it on reactivation.
fn open_request_path() -> PathBuf {
    let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    PathBuf::from(tmp).join("review-open-request")
}

/// Launch the Review desktop app for the given repo, optionally with a comparison and/or focused file.
fn open_app(
    repo_path: &str,
    comparison_key: Option<&str>,
    focused_file: Option<&str>,
) -> Result<(), String> {
    // Write a signal file with a timestamp, repo path, optional comparison key, and optional focused file.
    // Always write all 4 lines, using empty strings for missing optional values.
    // This is the reliable channel for the already-running case where
    // `open -a` activates the app but drops `--args`.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let signal_content = format!(
        "{now}\n{repo_path}\n{}\n{}",
        comparison_key.unwrap_or(""),
        focused_file.unwrap_or("")
    );
    let _ = std::fs::write(open_request_path(), signal_content);

    #[cfg(target_os = "macos")]
    {
        // Try to launch the app at the given path via `open -a`.
        // --args works for fresh launches; the signal file handles the rest.
        let try_open = |app_path: &Path| -> Option<()> {
            if !app_path.exists() {
                return None;
            }
            // Clean environment so the app doesn't inherit unwanted
            // variables from the caller (e.g. CLAUDECODE inside Claude Code).
            let mut cmd = Command::new("open");
            cmd.env_clear()
                .env("HOME", std::env::var("HOME").unwrap_or_default())
                .env("USER", std::env::var("USER").unwrap_or_default())
                .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");

            // Forward REVIEW_HOME so the app uses the same data directory
            if let Ok(review_home) = std::env::var("REVIEW_HOME") {
                cmd.env("REVIEW_HOME", review_home);
            }

            cmd.arg("-a").arg(app_path).arg("--args").arg(repo_path);

            // Only pass comparison key as an arg if present
            if let Some(key) = comparison_key {
                cmd.arg(key);
            }

            // Only pass focused file as an arg if present
            if let Some(file) = focused_file {
                cmd.arg(file);
            }

            let result = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();

            match result {
                Ok(status) if status.success() => Some(()),
                Ok(_) => {
                    eprintln!("open -a failed for {}", app_path.display());
                    None
                }
                Err(e) => {
                    eprintln!("Failed to run open -a {}: {}", app_path.display(), e);
                    None
                }
            }
        };

        // Common locations for the app bundle
        let home_apps = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Applications/Review.app"))
            .unwrap_or_default();
        let app_locations = [PathBuf::from("/Applications/Review.app"), home_apps];

        for app_path in &app_locations {
            if try_open(app_path).is_some() {
                println!("Opened Review app for {repo_path}");
                return Ok(());
            }
        }

        // Fallback: Try the development binary location
        let dev_app = std::env::current_exe().ok().and_then(|p| {
            p.parent()?
                .parent()
                .map(|p| p.join("bundle/macos/Review.app"))
        });
        if let Some(ref app_path) = dev_app {
            if try_open(app_path).is_some() {
                println!("Opened Review app for {repo_path}");
                return Ok(());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Try to find review in PATH or common locations
        let binary_names = ["review", "Review"];
        for name in &binary_names {
            if let Ok(status) = Command::new(name).arg(repo_path).status() {
                if status.success() {
                    println!("Opened Review for {}", repo_path);
                    return Ok(());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Try to find Review.exe
        if let Ok(status) = Command::new("Review.exe").arg(repo_path).status() {
            if status.success() {
                println!("Opened Review for {}", repo_path);
                return Ok(());
            }
        }
    }

    Err("Could not open Review app. Make sure it is installed and in your PATH.".to_owned())
}
