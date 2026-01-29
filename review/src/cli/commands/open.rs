use std::path::PathBuf;
use std::process::{Command, Stdio};

pub fn run(repo_path: &str, _spec: Option<String>) -> Result<(), String> {
    // Try to open the Review app
    // On macOS, use `open -a` to activate an existing instance or launch a new one.
    // The single-instance plugin handles arg forwarding to the running app.
    // On other platforms, try to find the binary.

    #[cfg(target_os = "macos")]
    {
        // Common locations for the app bundle
        let home_apps = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Applications/Review.app"))
            .unwrap_or_default();
        let app_locations = [PathBuf::from("/Applications/Review.app"), home_apps];

        // Try `open -a` with the app bundle — this reuses the running instance
        for app_path in &app_locations {
            if app_path.exists() {
                let result = Command::new("open")
                    .arg("-a")
                    .arg(app_path)
                    .arg("--args")
                    .arg(repo_path)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();

                match result {
                    Ok(status) if status.success() => {
                        println!("Opened Review app for {repo_path}");
                        return Ok(());
                    }
                    Ok(_) => {
                        eprintln!("open -a failed for {}", app_path.display());
                    }
                    Err(e) => {
                        eprintln!("Failed to run open -a {}: {}", app_path.display(), e);
                    }
                }
            }
        }

        // Fallback: Try the development binary location (direct spawn for dev builds)
        if let Ok(exe_path) = std::env::current_exe() {
            let dev_app = exe_path
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("bundle/macos/Review.app"));

            if let Some(app_path) = dev_app {
                if app_path.exists() {
                    let result = Command::new("open")
                        .arg("-a")
                        .arg(&app_path)
                        .arg("--args")
                        .arg(repo_path)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();

                    if let Ok(status) = result {
                        if status.success() {
                            println!("Opened Review app for {repo_path}");
                            return Ok(());
                        }
                    }
                }
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
