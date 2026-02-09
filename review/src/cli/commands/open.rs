use crate::review::storage;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Path to the signal file used to communicate a repo path to the running app.
/// On macOS, `open -a` silently drops `--args` when the app is already running.
/// The CLI writes the requested repo path here, and the app reads it on reactivation.
fn open_request_path() -> PathBuf {
    let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    PathBuf::from(tmp).join("review-open-request")
}

pub fn run(repo_path: &str, spec: Option<String>) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Resolve comparison: from spec or auto-detect
    let comparison = match spec {
        Some(spec) => crate::cli::parse_comparison_spec(&path, &spec, false)?,
        None => crate::cli::get_or_detect_comparison(&path)?,
    };

    // Persist review state so the GUI finds it on launch
    storage::set_current_comparison(&path, &comparison).map_err(|e| e.to_string())?;
    storage::ensure_review_exists(&path, &comparison).map_err(|e| e.to_string())?;

    let comparison_key = &comparison.key;

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
        let try_open = |app_path: &std::path::Path| -> Option<()> {
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
