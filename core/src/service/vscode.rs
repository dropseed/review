//! VS Code theme detection — reads settings + extension theme files.

use log::{debug, info};
use std::collections::HashMap;
use std::path::Path;

use super::util::strip_jsonc_comments;
use super::VscodeThemeDetection;

/// Detect the active VS Code theme by reading VS Code settings and extension files.
pub fn detect_vscode_theme() -> anyhow::Result<VscodeThemeDetection> {
    let home =
        dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Could not determine home directory"))?;

    // Try VS Code, then VS Code Insiders
    let settings_path = [
        home.join("Library/Application Support/Code/User/settings.json"),
        home.join("Library/Application Support/Code - Insiders/User/settings.json"),
    ]
    .into_iter()
    .find(|p| p.exists())
    .ok_or_else(|| anyhow::anyhow!("VS Code settings.json not found"))?;

    let settings_str = std::fs::read_to_string(&settings_path)
        .map_err(|e| anyhow::anyhow!("Failed to read settings: {e}"))?;

    let stripped = strip_jsonc_comments(&settings_str);

    let settings: serde_json::Value = serde_json::from_str(&stripped)
        .map_err(|e| anyhow::anyhow!("Failed to parse settings: {e}"))?;

    let theme_name = settings
        .get("workbench.colorTheme")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("workbench.colorTheme not set in VS Code settings"))?
        .to_owned();

    debug!("[detect_vscode_theme] Active theme: {theme_name}");

    // Search user-installed extensions first, then built-in themes in the app bundle
    let search_dirs = [
        home.join(".vscode/extensions"),
        home.join(".vscode-insiders/extensions"),
        std::path::PathBuf::from(
            "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions",
        ),
        std::path::PathBuf::from(
            "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions",
        ),
    ];

    for dir in &search_dirs {
        if let Some(detection) = search_extensions_for_theme(dir, &theme_name) {
            return Ok(detection);
        }
    }

    Err(anyhow::anyhow!(
        "Theme '{theme_name}' not found in VS Code extensions"
    ))
}

/// Search an extensions directory for a theme matching `theme_name`.
fn search_extensions_for_theme(ext_dir: &Path, theme_name: &str) -> Option<VscodeThemeDetection> {
    let entries = std::fs::read_dir(ext_dir).ok()?;

    for entry in entries.flatten() {
        let ext_path = entry.path();
        let pkg_path = ext_path.join("package.json");
        let Ok(pkg_str) = std::fs::read_to_string(&pkg_path) else {
            continue;
        };
        let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&pkg_str) else {
            continue;
        };

        let Some(themes) = pkg
            .get("contributes")
            .and_then(|c| c.get("themes"))
            .and_then(|t| t.as_array())
        else {
            continue;
        };

        for theme in themes {
            let label = theme.get("label").and_then(|v| v.as_str()).unwrap_or("");
            let id = theme.get("id").and_then(|v| v.as_str()).unwrap_or("");

            let matched = label == theme_name
                || id == theme_name
                || (label.starts_with('%') && matches_localized_theme(&ext_path, id, theme_name));

            if !matched {
                continue;
            }

            let Some(rel_path) = theme.get("path").and_then(|v| v.as_str()) else {
                continue;
            };
            let theme_path = ext_path.join(rel_path);
            let Ok(theme_str) = std::fs::read_to_string(&theme_path) else {
                continue;
            };

            let theme_stripped = strip_jsonc_comments(&theme_str);
            let Ok(theme_json) = serde_json::from_str::<serde_json::Value>(&theme_stripped) else {
                continue;
            };

            let theme_type = resolve_theme_type(theme, &theme_json);

            let colors: HashMap<String, String> = theme_json
                .get("colors")
                .and_then(|c| c.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                        .collect()
                })
                .unwrap_or_default();

            let token_colors = theme_json
                .get("tokenColors")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            info!(
                "[detect_vscode_theme] Found theme '{}' ({}) with {} colors, {} tokenColors",
                theme_name,
                theme_type,
                colors.len(),
                token_colors.len()
            );

            return Some(VscodeThemeDetection {
                name: theme_name.to_owned(),
                theme_type,
                colors,
                token_colors,
            });
        }
    }

    None
}

/// Resolve the theme type (light/dark/hc) from the package.json `uiTheme` field,
/// falling back to the theme JSON's `type` field, defaulting to "dark".
fn resolve_theme_type(package_theme: &serde_json::Value, theme_json: &serde_json::Value) -> String {
    package_theme
        .get("uiTheme")
        .and_then(|v| v.as_str())
        .map(|ui| match ui {
            "vs" => "light",
            "hc-black" | "hc-light" => "hc",
            _ => "dark",
        })
        .or_else(|| theme_json.get("type").and_then(|v| v.as_str()))
        .unwrap_or("dark")
        .to_owned()
}

/// For built-in themes with localized labels (e.g., "%colorTheme.label%"),
/// match by theme id (case-insensitive) or extension directory name.
fn matches_localized_theme(ext_path: &Path, id: &str, theme_name: &str) -> bool {
    if id.eq_ignore_ascii_case(theme_name) {
        return true;
    }

    // Fall back to matching the extension directory name
    let Some(ext_name) = ext_path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let normalized = theme_name.to_lowercase().replace(' ', "-");
    ext_name.to_lowercase().contains(&normalized)
}
