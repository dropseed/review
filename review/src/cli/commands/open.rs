use std::path::PathBuf;
use std::process::{Command, Stdio};

pub fn run(repo_path: &str, _spec: Option<String>) -> Result<(), String> {
    // Try to open the Review app
    // On macOS, invoke the binary inside the app bundle directly
    // On other platforms, try to find the binary

    #[cfg(target_os = "macos")]
    {
        // Common locations for the app bundle
        let home_apps = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Applications/Review.app"))
            .unwrap_or_default();
        let app_locations = [PathBuf::from("/Applications/Review.app"), home_apps];

        // Find the binary inside the app bundle
        for app_path in &app_locations {
            let binary_path = app_path.join("Contents/MacOS/Review");
            if binary_path.exists() {
                // Spawn the binary directly with the repo path as argument
                // Redirect stdout/stderr to null so logs don't stream to terminal
                let result = Command::new(&binary_path)
                    .arg(repo_path)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();

                match result {
                    Ok(_) => {
                        println!("Opened Review app for {}", repo_path);
                        return Ok(());
                    }
                    Err(e) => {
                        eprintln!("Failed to launch {}: {}", binary_path.display(), e);
                    }
                }
            }
        }

        // Fallback: Try the development binary location
        if let Ok(exe_path) = std::env::current_exe() {
            let dev_app = exe_path
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("bundle/macos/Review.app/Contents/MacOS/Review"));

            if let Some(binary_path) = dev_app {
                if binary_path.exists() {
                    let result = Command::new(&binary_path)
                        .arg(repo_path)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn();

                    if result.is_ok() {
                        println!("Opened Review app for {}", repo_path);
                        return Ok(());
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

    Err("Could not open Review app. Make sure it is installed and in your PATH.".to_string())
}
