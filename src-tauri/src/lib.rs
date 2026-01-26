mod classify;
mod commands;
mod diff;
pub mod error;
mod review;
mod sources;
mod trust;
mod watchers;

use commands::*;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
fn start_file_watcher(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    watchers::start_watching(&repo_path, app)
}

#[tauri::command]
fn stop_file_watcher(repo_path: String) {
    watchers::stop_watching(&repo_path);
}

/// Comparison struct for multi-window support
#[derive(Debug, Clone, serde::Deserialize)]
struct ComparisonParam {
    old: String,
    new: String,
    #[serde(rename = "workingTree")]
    working_tree: bool,
    key: String,
}

#[tauri::command]
async fn open_repo_window(
    app: tauri::AppHandle,
    repo_path: String,
    comparison: Option<ComparisonParam>,
) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    // Build a unique key for the window: repo_path + comparison_key (if provided)
    let comparison_key = comparison
        .as_ref()
        .map(|c| c.key.clone())
        .unwrap_or_else(|| "default".to_string());

    // Use hash of repo path + comparison key for unique window labels per comparison
    let mut hasher = DefaultHasher::new();
    format!("{}:{}", repo_path, comparison_key).hash(&mut hasher);
    let label = format!("repo-{:x}", hasher.finish());

    // Check if window already exists - if so, focus it instead
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Extract repo name from path for the window title
    let repo_name = std::path::Path::new(&repo_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Repository".to_string());

    // Build window title: "repo-name — comparison" or just "repo-name"
    let window_title = if let Some(ref c) = comparison {
        let compare_display = if c.working_tree && c.new == "HEAD" {
            "Working Tree".to_string()
        } else {
            c.new.clone()
        };
        format!("{} — {}..{}", repo_name, c.old, compare_display)
    } else {
        repo_name
    };

    // Create new window with repo path and optional comparison in the URL query
    let url = if let Some(ref c) = comparison {
        WebviewUrl::App(
            format!(
                "index.html?repo={}&comparison={}",
                urlencoding::encode(&repo_path),
                urlencoding::encode(&c.key)
            )
            .into(),
        )
    } else {
        WebviewUrl::App(format!("index.html?repo={}", urlencoding::encode(&repo_path)).into())
    };

    WebviewWindowBuilder::new(&app, label, url)
        .title(window_title)
        .inner_size(1100.0, 750.0)
        .min_inner_size(800.0, 600.0)
        .tabbing_identifier("compare-main")
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("notify", log::LevelFilter::Warn)
                .level_for("notify_debouncer_mini", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Create menu items
            let open_repo = MenuItemBuilder::new("Open Repository...")
                .id("open_repo")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let refresh = MenuItemBuilder::new("Refresh")
                .id("refresh")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;

            let actual_size = MenuItemBuilder::new("Actual Size")
                .id("actual_size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;

            let zoom_in = MenuItemBuilder::new("Zoom In")
                .id("zoom_in")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;

            let zoom_out = MenuItemBuilder::new("Zoom Out")
                .id("zoom_out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;

            let show_debug = MenuItemBuilder::new("Show Debug Data")
                .id("show_debug")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            let settings = MenuItemBuilder::new("Settings...")
                .id("settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let compare_help = MenuItemBuilder::new("Compare Help")
                .id("compare_help")
                .build(app)?;

            let report_issue = MenuItemBuilder::new("Report Issue...")
                .id("report_issue")
                .build(app)?;

            // App submenu (standard macOS app menu)
            let app_menu = SubmenuBuilder::new(app, &app.package_info().name)
                .about(None)
                .separator()
                .item(&settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            // File submenu
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_repo)
                .separator()
                .close_window()
                .build()?;

            // Edit submenu (standard)
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            // View submenu
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&refresh)
                .separator()
                .item(&actual_size)
                .item(&zoom_in)
                .item(&zoom_out)
                .separator()
                .item(&show_debug)
                .build()?;

            // Window submenu (standard)
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .fullscreen()
                .build()?;

            // Help submenu
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&compare_help)
                .item(&report_issue)
                .build()?;

            // Create the menu with all submenus
            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()?;

            // Set as app menu
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open_repo" => {
                    let _: Result<(), _> = app.emit("menu:open-repo", ());
                }
                "refresh" => {
                    let _: Result<(), _> = app.emit("menu:refresh", ());
                }
                "actual_size" => {
                    let _: Result<(), _> = app.emit("menu:zoom-reset", ());
                }
                "zoom_in" => {
                    let _: Result<(), _> = app.emit("menu:zoom-in", ());
                }
                "zoom_out" => {
                    let _: Result<(), _> = app.emit("menu:zoom-out", ());
                }
                "show_debug" => {
                    let _: Result<(), _> = app.emit("menu:show-debug", ());
                }
                "settings" => {
                    let _: Result<(), _> = app.emit("menu:open-settings", ());
                }
                "compare_help" => {
                    let _ = app
                        .opener()
                        .open_url("https://github.com/dropseed/compare", None::<&str>);
                }
                "report_issue" => {
                    let _ = app
                        .opener()
                        .open_url("https://github.com/dropseed/compare/issues", None::<&str>);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_current_repo,
            get_current_branch,
            get_default_branch,
            list_branches,
            get_git_status,
            get_git_status_raw,
            list_files,
            list_all_files,
            get_file_content,
            get_diff,
            get_expanded_context,
            load_review_state,
            save_review_state,
            list_saved_reviews,
            delete_review,
            get_current_comparison,
            set_current_comparison,
            open_repo_window,
            check_claude_available,
            classify_hunks_with_claude,
            detect_hunks_move_pairs,
            write_text_file,
            append_to_file,
            start_file_watcher,
            stop_file_watcher,
            match_trust_pattern,
            get_trust_taxonomy,
            get_trust_taxonomy_with_custom,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
