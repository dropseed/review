use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;
use clap::Parser;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Parser)]
#[command(name = "review")]
#[command(author, version, about = "Review diffs more efficiently", long_about = None)]
pub struct Cli {
    /// Repository path (defaults to current directory)
    #[arg(short, long, global = true)]
    pub repo: Option<String>,

    /// Comparison spec (optional, auto-detects from branches if not specified)
    pub spec: Option<String>,
}

impl Cli {
    /// Get the repository path, using current directory as default
    fn get_repo_path(&self) -> Result<String, String> {
        if let Some(ref repo) = self.repo {
            return Ok(repo.clone());
        }

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

/// Run the CLI: resolve the comparison, persist state, and open the desktop app.
pub fn run(cli: Cli) -> Result<(), String> {
    let repo_path = cli.get_repo_path()?;
    let path = PathBuf::from(&repo_path);

    // Resolve comparison: from spec or auto-detect
    let comparison = match cli.spec {
        Some(spec) => parse_comparison_spec(&path, &spec, false)?,
        None => get_or_detect_comparison(&path)?,
    };

    // Persist review state so the GUI finds it on launch
    storage::ensure_review_exists(&path, &comparison).map_err(|e| e.to_string())?;

    open_app(&repo_path, &comparison.key)
}

/// Auto-detect the comparison from the repo's default and current branches.
///
/// Returns `<default_branch>..<current_branch>` with working tree auto-included.
fn get_or_detect_comparison(repo_path: &Path) -> Result<Comparison, String> {
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
fn parse_comparison_spec(
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

/// Path to the signal file used to communicate a repo path to the running app.
/// On macOS, `open -a` silently drops `--args` when the app is already running.
/// The CLI writes the requested repo path here, and the app reads it on reactivation.
fn open_request_path() -> PathBuf {
    let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    PathBuf::from(tmp).join("review-open-request")
}

/// Launch the Review desktop app for the given repo and comparison.
fn open_app(repo_path: &str, comparison_key: &str) -> Result<(), String> {
    // Write a signal file with a timestamp, repo path, and comparison key.
    // This is the reliable channel for the already-running case where
    // `open -a` activates the app but drops `--args`.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let _ = std::fs::write(
        open_request_path(),
        format!("{now}\n{repo_path}\n{comparison_key}"),
    );

    #[cfg(target_os = "macos")]
    {
        // Try to launch the app at the given path via `open -a`.
        // --args works for fresh launches; the signal file handles the rest.
        let try_open = |app_path: &Path| -> Option<()> {
            if !app_path.exists() {
                return None;
            }
            let result = Command::new("open")
                .arg("-a")
                .arg(app_path)
                .arg("--args")
                .arg(repo_path)
                .arg(comparison_key)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();

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
