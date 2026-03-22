//! LSP server discovery and registration.
//!
//! Maintains a registry of known language servers and discovers which ones
//! are available for a given repository.

use log::{debug, info};
use std::path::Path;

/// Configuration for a known language server.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Human-readable name (e.g. "ty").
    pub name: &'static str,
    /// Command to launch the server.
    pub command: &'static str,
    /// Arguments to pass to the command.
    pub args: &'static [&'static str],
    /// Short language key used for the server map (e.g. "py").
    pub language: &'static str,
    /// LSP language IDs for didOpen, keyed by file extension (e.g. [("py", "python")]).
    pub language_ids: &'static [(&'static str, &'static str)],
    /// File extensions this server handles (without dot, e.g. "py").
    pub extensions: &'static [&'static str],
    /// Root marker files that indicate this language is relevant.
    pub root_markers: &'static [&'static str],
}

/// The built-in registry of known language servers.
const KNOWN_SERVERS: &[ServerConfig] = &[
    ServerConfig {
        name: "ty",
        command: "ty",
        args: &["server"],
        language: "py",
        language_ids: &[("py", "python")],
        extensions: &["py"],
        root_markers: &["pyproject.toml", "setup.py", "setup.cfg", ".venv", "venv"],
    },
    ServerConfig {
        name: "rust-analyzer",
        command: "rust-analyzer",
        args: &[],
        language: "rs",
        language_ids: &[("rs", "rust")],
        extensions: &["rs"],
        root_markers: &["Cargo.toml"],
    },
    ServerConfig {
        name: "typescript-language-server",
        command: "typescript-language-server",
        args: &["--stdio"],
        language: "ts",
        language_ids: &[
            ("ts", "typescript"),
            ("tsx", "typescriptreact"),
            ("js", "javascript"),
            ("jsx", "javascriptreact"),
        ],
        extensions: &["ts", "tsx", "js", "jsx"],
        root_markers: &["tsconfig.json", "package.json"],
    },
    ServerConfig {
        name: "gopls",
        command: "gopls",
        args: &["serve"],
        language: "go",
        language_ids: &[("go", "go")],
        extensions: &["go"],
        root_markers: &["go.mod"],
    },
];

/// Map a file extension to the registry's language key.
/// Returns `None` if no known LSP server handles this extension.
pub fn language_for_extension(ext: &str) -> Option<&'static str> {
    KNOWN_SERVERS
        .iter()
        .find(|s| s.extensions.contains(&ext))
        .map(|s| s.language)
}

/// Map a file extension to the LSP language ID (for didOpen).
/// Returns `"plaintext"` if unknown.
pub fn language_id_for_extension(ext: &str) -> &'static str {
    for server in KNOWN_SERVERS {
        for &(e, lang_id) in server.language_ids {
            if e == ext {
                return lang_id;
            }
        }
    }
    "plaintext"
}

/// A server that was discovered and can be started.
#[derive(Debug, Clone)]
pub struct DiscoveredServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub language: String,
}

/// Discover which language servers are available for a repository.
///
/// Checks:
/// 1. Whether the server command exists on PATH
/// 2. Whether the repo has files matching the server's language
pub fn discover_servers(repo_path: &Path) -> Vec<DiscoveredServer> {
    let mut result = Vec::new();

    for config in KNOWN_SERVERS {
        // Check if command exists on PATH
        if !command_exists(config.command) {
            debug!(
                "[lsp registry] {} not found on PATH, skipping",
                config.command
            );
            continue;
        }

        // Check if repo has relevant files (root markers or file extensions)
        if !has_relevant_files(repo_path, config) {
            debug!(
                "[lsp registry] no {} files found in {}, skipping",
                config.name,
                repo_path.display()
            );
            continue;
        }

        info!(
            "[lsp registry] discovered {} for {} in {}",
            config.name,
            config.language,
            repo_path.display()
        );

        result.push(DiscoveredServer {
            name: config.name.to_owned(),
            command: config.command.to_owned(),
            args: config.args.iter().map(|s| (*s).to_owned()).collect(),
            language: config.language.to_owned(),
        });
    }

    result
}

/// Check if a command exists on PATH.
fn command_exists(command: &str) -> bool {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    std::process::Command::new(which_cmd)
        .arg(command)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Check if a repository has files relevant to this server config.
fn has_relevant_files(repo_path: &Path, config: &ServerConfig) -> bool {
    // Check root markers first (fast)
    for marker in config.root_markers {
        if repo_path.join(marker).exists() {
            return true;
        }
    }

    // Check for files with matching extensions using git ls-files (fast, respects .gitignore)
    for ext in config.extensions {
        let pattern = format!("*.{ext}");
        let output = std::process::Command::new("git")
            .args(["ls-files", "--", &pattern])
            .current_dir(repo_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.lines().next().is_some() {
                    return true;
                }
            }
        }
    }

    false
}
