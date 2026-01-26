mod classify;
mod commands;
mod diff;
mod review;
mod sources;
mod trust;
mod watchers;

use commands::*;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

// Counter for generating unique window labels
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

#[tauri::command]
fn start_file_watcher(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    watchers::start_watching(&repo_path, app)
}

#[tauri::command]
fn stop_file_watcher(repo_path: String) {
    watchers::stop_watching(&repo_path);
}

#[tauri::command]
async fn open_repo_window(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let window_id = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("repo-{}", window_id);

    // Extract repo name from path for the window title
    let repo_name = std::path::Path::new(&repo_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Repository".to_string());

    // Create new window with repo path in the URL query
    let url =
        WebviewUrl::App(format!("index.html?repo={}", urlencoding::encode(&repo_path)).into());

    WebviewWindowBuilder::new(&app, label, url)
        .title(format!("{} - PullApprove Review", repo_name))
        .inner_size(1100.0, 750.0)
        .min_inner_size(800.0, 600.0)
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
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Create menu items
            let open_repo = MenuItemBuilder::new("Open Repository...")
                .id("open_repo")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let sidebar_left = MenuItemBuilder::new("Sidebar on Left")
                .id("sidebar_left")
                .build(app)?;

            let sidebar_right = MenuItemBuilder::new("Sidebar on Right")
                .id("sidebar_right")
                .build(app)?;

            let show_debug = MenuItemBuilder::new("Show Debug Data")
                .id("show_debug")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            // App submenu (standard macOS app menu)
            let app_menu = SubmenuBuilder::new(app, &app.package_info().name)
                .about(None)
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

            // View submenu
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&sidebar_left)
                .item(&sidebar_right)
                .build()?;

            // Debug submenu
            let debug_menu = SubmenuBuilder::new(app, "Debug")
                .item(&show_debug)
                .build()?;

            // Create the menu with all submenus
            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&view_menu)
                .item(&debug_menu)
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
                "sidebar_left" => {
                    let _: Result<(), _> = app.emit("menu:sidebar-position", "left");
                }
                "sidebar_right" => {
                    let _: Result<(), _> = app.emit("menu:sidebar-position", "right");
                }
                "show_debug" => {
                    let _: Result<(), _> = app.emit("menu:show-debug", ());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_current_repo,
            get_current_branch,
            get_default_branch,
            list_branches,
            list_files,
            list_all_files,
            get_file_content,
            get_diff,
            load_review_state,
            save_review_state,
            get_current_comparison,
            set_current_comparison,
            open_repo_window,
            check_claude_available,
            classify_hunks_with_claude,
            detect_hunks_move_pairs,
            write_text_file,
            start_file_watcher,
            stop_file_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
