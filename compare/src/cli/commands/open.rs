use std::process::Command;

pub fn run(repo_path: &str, _spec: Option<String>) -> Result<(), String> {
    // Try to open the Compare app
    // On macOS, use 'open' command with the app
    // On other platforms, try to find the binary

    #[cfg(target_os = "macos")]
    {
        // Try to open Compare.app
        let result = Command::new("open")
            .arg("-a")
            .arg("Compare")
            .arg("--args")
            .arg(repo_path)
            .status();

        match result {
            Ok(status) if status.success() => {
                println!("Opened Compare app for {}", repo_path);
                return Ok(());
            }
            _ => {
                // Try the development binary
                if let Ok(exe_path) = std::env::current_exe() {
                    let dev_app = exe_path
                        .parent()
                        .and_then(|p| p.parent())
                        .map(|p| p.join("bundle/macos/Compare.app"));

                    if let Some(app_path) = dev_app {
                        if app_path.exists() {
                            let result = Command::new("open")
                                .arg(app_path)
                                .arg("--args")
                                .arg(repo_path)
                                .status();

                            if let Ok(status) = result {
                                if status.success() {
                                    println!("Opened Compare app for {}", repo_path);
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Try to find compare in PATH or common locations
        let binary_names = ["compare", "Compare"];
        for name in &binary_names {
            if let Ok(status) = Command::new(name).arg(repo_path).status() {
                if status.success() {
                    println!("Opened Compare for {}", repo_path);
                    return Ok(());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Try to find Compare.exe
        if let Ok(status) = Command::new("Compare.exe").arg(repo_path).status() {
            if status.success() {
                println!("Opened Compare for {}", repo_path);
                return Ok(());
            }
        }
    }

    Err("Could not open Compare app. Make sure it is installed and in your PATH.".to_string())
}
