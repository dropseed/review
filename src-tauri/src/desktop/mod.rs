//! Desktop application module for Tauri.
//!
//! This module contains all Tauri-specific code including:
//! - Command handlers (commands.rs)
//! - File system watchers (watchers.rs)
//! - Companion HTTP server (companion_server.rs)

pub mod commands;
pub mod companion_server;
pub mod tray;
pub mod watchers;

// Re-export commands for convenient access
pub use commands::*;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(desktop)]
use tauri::Emitter;
#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_opener::OpenerExt;

/// Managed state holding references to menu items whose enabled state
/// changes dynamically based on the current app view.
#[cfg(desktop)]
pub struct MenuItems {
    pub refresh: MenuItem<tauri::Wry>,
    pub find_file: MenuItem<tauri::Wry>,
    pub find_symbols: MenuItem<tauri::Wry>,
    pub search_in_files: MenuItem<tauri::Wry>,
    pub toggle_sidebar: MenuItem<tauri::Wry>,
}

/// Managed state that controls whether Sentry events are actually sent.
/// Both the `before_send` callback and the `set_sentry_consent` command
/// share this flag via `Arc`.
pub struct SentryConsent(pub Arc<AtomicBool>);

/// Path to the signal file used by the CLI to request opening a repo.
/// Matches the path written by `review/src/cli/commands/open.rs`.
#[cfg(desktop)]
fn open_request_path() -> std::path::PathBuf {
    let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    std::path::PathBuf::from(tmp).join("review-open-request")
}

/// Read and delete the signal file. Returns `(repo_path, optional_comparison_key)`
/// if the file exists and was written recently (within 30 seconds).
#[cfg(desktop)]
fn read_open_request() -> Option<(String, Option<String>)> {
    let path = open_request_path();
    let content = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);

    let mut lines = content.lines();
    let timestamp: u64 = lines.next()?.parse().ok()?;
    let repo_path = lines.next()?.trim().to_owned();
    let comparison_key = lines
        .next()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());

    // Ignore stale requests (e.g. from a crashed CLI run)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if now.saturating_sub(timestamp) > 30 {
        return None;
    }

    if repo_path.is_empty() {
        None
    } else {
        Some((repo_path, comparison_key))
    }
}

/// Run the Tauri desktop application.
///
/// This sets up all plugins, menus, and command handlers, then starts
/// the Tauri event loop.
pub fn run() {
    // Initialize Sentry early so it captures any panics during setup.
    // Events are silently dropped until the user opts in via preferences.
    let consent = Arc::new(AtomicBool::new(false));

    // Only initialize Sentry in release builds
    let _sentry_guard = if cfg!(debug_assertions) {
        None
    } else {
        let consent_for_hook = consent.clone();
        Some(sentry::init(sentry::ClientOptions {
            dsn: "https://4c45659990b56ebdb601e459f324d2a7@o77283.ingest.us.sentry.io/4510829448462336"
                .parse()
                .ok(),
            release: sentry::release_name!(),
            environment: Some("production".into()),
            before_send: Some(Arc::new(move |mut event| {
                if !consent_for_hook.load(Ordering::Relaxed) {
                    return None;
                }
                // Strip PII fields
                event.user = None;
                event.server_name = None;
                Some(event)
            })),
            ..Default::default()
        }))
    };

    let builder = tauri::Builder::default()
        .manage(SentryConsent(consent.clone()))
        .plugin(tauri_plugin_single_instance::init(
            |app: &tauri::AppHandle, argv, _cwd| {
                // Clean up signal file — the CLI may have written one before this
                // second process was intercepted by the single-instance plugin.
                let _ = std::fs::remove_file(open_request_path());

                // When a second instance is launched, its CLI args are forwarded here.
                // Find non-flag args after the binary name: first is repo path,
                // optional second is comparison key.
                let non_flag_args: Vec<String> = argv
                    .iter()
                    .skip(1)
                    .filter(|a| !a.starts_with('-'))
                    .cloned()
                    .collect();
                if let Some(repo) = non_flag_args.first().cloned() {
                    let app_clone = app.clone();
                    let comparison_key = non_flag_args.get(1).cloned();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) =
                            commands::open_repo_window(app_clone, repo, comparison_key).await
                        {
                            log::error!("Failed to open repo window from CLI: {e}");
                        }
                    });
                }
            },
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("notify", log::LevelFilter::Warn)
                .level_for("notify_debouncer_mini", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Desktop-only plugins and setup
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            // Restore Sentry consent from persisted settings
            if let Some(serde_json::Value::Bool(true)) = commands::read_setting("sentryEnabled") {
                consent.store(true, Ordering::Relaxed);
            }

            let close = MenuItemBuilder::new("Close")
                .id("close")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;

            let open_repo = MenuItemBuilder::new("Open Repository...")
                .id("open_repo")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let new_tab = MenuItemBuilder::new("New Tab")
                .id("new_tab")
                .accelerator("CmdOrCtrl+T")
                .build(app)?;

            let new_window = MenuItemBuilder::new("New Window")
                .id("new_window")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;

            let refresh = MenuItemBuilder::new("Refresh")
                .id("refresh")
                .accelerator("CmdOrCtrl+Shift+R")
                .enabled(false)
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

            let check_for_updates = MenuItemBuilder::new("Check for Updates...")
                .id("check_for_updates")
                .build(app)?;

            let settings = MenuItemBuilder::new("Settings...")
                .id("settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let review_help = MenuItemBuilder::new("Review Help")
                .id("review_help")
                .build(app)?;

            let report_issue = MenuItemBuilder::new("Report Issue...")
                .id("report_issue")
                .build(app)?;

            let find_file = MenuItemBuilder::new("Find File")
                .id("find_file")
                .accelerator("CmdOrCtrl+P")
                .enabled(false)
                .build(app)?;

            let find_symbols = MenuItemBuilder::new("Find Symbols")
                .id("find_symbols")
                .accelerator("CmdOrCtrl+R")
                .enabled(false)
                .build(app)?;

            let search_in_files = MenuItemBuilder::new("Search in Files")
                .id("search_in_files")
                .accelerator("CmdOrCtrl+Shift+F")
                .enabled(false)
                .build(app)?;

            let toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar")
                .id("toggle_sidebar")
                .accelerator("CmdOrCtrl+B")
                .enabled(false)
                .build(app)?;

            let new_review = MenuItemBuilder::new("New Review")
                .id("new_review")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, &app.package_info().name)
                .about(None)
                .item(&check_for_updates)
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

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_tab)
                .item(&new_window)
                .item(&open_repo)
                .separator()
                .item(&new_review)
                .separator()
                .item(&close)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&refresh)
                .separator()
                .item(&find_file)
                .item(&find_symbols)
                .item(&search_in_files)
                .separator()
                .item(&toggle_sidebar)
                .separator()
                .item(&actual_size)
                .item(&zoom_in)
                .item(&zoom_out)
                .separator()
                .item(&show_debug)
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .fullscreen()
                .build()?;

            #[allow(unused_mut)]
            let mut help_menu_builder = SubmenuBuilder::new(app, "Help");

            #[cfg(not(debug_assertions))]
            {
                let install_cli = MenuItemBuilder::new("Install 'review' Command in PATH...")
                    .id("install_cli")
                    .build(app)?;
                help_menu_builder = help_menu_builder.item(&install_cli).separator();
            }

            let help_menu = help_menu_builder
                .item(&review_help)
                .item(&report_issue)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            app.manage(MenuItems {
                refresh,
                find_file,
                find_symbols,
                search_in_files,
                toggle_sidebar,
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "close" => {
                    let _: Result<(), _> = app.emit("menu:close", ());
                }
                "new_tab" => {
                    let _: Result<(), _> = app.emit("menu:new-tab", ());
                }
                "new_window" => {
                    let _: Result<(), _> = app.emit("menu:new-window", ());
                }
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
                "check_for_updates" => {
                    let _: Result<(), _> = app.emit("menu:check-for-updates", ());
                }
                "install_cli" => match commands::install_cli(app.clone()) {
                    Ok(_) => {
                        let _: Result<(), _> = app.emit("cli:installed", ());
                    }
                    Err(e) => {
                        let _: Result<(), _> = app.emit("cli:install-error", e);
                    }
                },
                "review_help" => {
                    let _ = app
                        .opener()
                        .open_url("https://github.com/dropseed/review", None::<&str>);
                }
                "report_issue" => {
                    let _ = app
                        .opener()
                        .open_url("https://github.com/dropseed/review/issues", None::<&str>);
                }
                "find_file" => {
                    let _: Result<(), _> = app.emit("menu:find-file", ());
                }
                "find_symbols" => {
                    let _: Result<(), _> = app.emit("menu:find-symbols", ());
                }
                "search_in_files" => {
                    let _: Result<(), _> = app.emit("menu:search-in-files", ());
                }
                "toggle_sidebar" => {
                    let _: Result<(), _> = app.emit("menu:toggle-sidebar", ());
                }
                "new_review" => {
                    let _: Result<(), _> = app.emit("menu:new-review", ());
                }
                _ => {}
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    });

    let app = builder
        .invoke_handler(tauri::generate_handler![
            commands::get_current_repo,
            commands::check_github_available,
            commands::list_pull_requests,
            commands::get_current_branch,
            commands::get_remote_info,
            commands::get_default_branch,
            commands::list_branches,
            commands::get_git_status,
            commands::get_git_status_raw,
            commands::stage_file,
            commands::unstage_file,
            commands::stage_all,
            commands::unstage_all,
            commands::stage_hunks,
            commands::unstage_hunks,
            commands::get_working_tree_file_content,
            commands::list_commits,
            commands::get_commit_detail,
            commands::list_files,
            commands::list_all_files,
            commands::list_directory_contents,
            commands::get_file_content,
            commands::get_all_hunks,
            commands::get_diff,
            commands::get_diff_shortstat,
            commands::get_expanded_context,
            commands::load_review_state,
            commands::save_review_state,
            commands::list_saved_reviews,
            commands::delete_review,
            commands::review_exists,
            commands::ensure_review_exists,
            commands::list_all_reviews_global,
            commands::get_review_storage_path,
            commands::open_repo_window,
            commands::check_claude_available,
            commands::classify_hunks_with_claude,
            commands::classify_hunks_static,
            commands::detect_hunks_move_pairs,
            commands::write_text_file,
            commands::append_to_file,
            commands::start_file_watcher,
            commands::stop_file_watcher,
            commands::match_trust_pattern,
            commands::get_trust_taxonomy,
            commands::get_trust_taxonomy_with_custom,
            commands::should_skip_file,
            commands::search_file_contents,
            commands::get_file_symbol_diffs,
            commands::get_dependency_graph,
            commands::get_file_symbols,
            commands::get_repo_symbols,
            commands::find_symbol_definitions,
            commands::generate_hunk_grouping,
            commands::generate_review_summary,
            commands::generate_review_diagram,
            commands::is_dev_mode,
            commands::is_git_repo,
            commands::get_cli_install_status,
            commands::install_cli,
            commands::uninstall_cli,
            commands::set_sentry_consent,
            commands::update_menu_state,
            commands::check_reviews_freshness,
            commands::generate_companion_token,
            commands::start_companion_server,
            commands::stop_companion_server,
            commands::get_companion_server_status,
            commands::get_companion_fingerprint,
            commands::regenerate_companion_certificate,
            commands::generate_companion_qr,
            commands::get_tailscale_ip,
            commands::detect_vscode_theme,
            commands::set_window_background_color,
            commands::read_settings,
            commands::write_settings,
            commands::open_settings_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(desktop)]
        match event {
            tauri::RunEvent::Reopen { .. } => {
                // Show all hidden windows and focus them
                for (_, window) in app_handle.webview_windows() {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                // Check for a pending open request from the CLI
                if let Some((repo_path, comparison_key)) = read_open_request() {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) =
                            commands::open_repo_window(handle, repo_path, comparison_key).await
                        {
                            log::error!("Failed to open repo from CLI signal: {e}");
                        }
                    });
                }
            }
            tauri::RunEvent::Exit => {
                if companion_server::is_running() {
                    log::info!("Stopping companion server before exit");
                    companion_server::stop();
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
            _ => {}
        }
    });
}
