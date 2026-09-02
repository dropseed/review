//! Desktop application module for Tauri.
//!
//! This module contains all Tauri-specific code including:
//! - Command handlers (commands.rs)
//! - File system watchers (watchers.rs)
//! - Terminal daemon lifecycle (daemon.rs)

pub mod commands;
pub mod daemon;
pub mod notifications;
pub mod remote;
pub mod terminal_commands;
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
/// The menu items whose enabled state the frontend drives.
///
/// Keyed by menu id rather than named fields: the frontend decides
/// availability by resolving the command registry, and sends back a map, so
/// this side does not need to know which items exist or why one is off.
pub struct MenuItems(pub std::collections::HashMap<String, MenuItem<tauri::Wry>>);

/// Managed state that controls whether Sentry events are actually sent.
/// Both the `before_send` callback and the `set_sentry_consent` command
/// share this flag via `Arc`.
pub struct SentryConsent(pub Arc<AtomicBool>);

/// The CLI↔app signal file's payload, format and staleness rule all live in
/// core, beside the path they are written to — this app is one of its two ends,
/// not its owner.
#[cfg(desktop)]
pub use spur::home::{read_open_request, OpenRequest};

/// The app's one window, as declared in `tauri.conf.json`.
///
/// Spur is single-window on purpose — a second thing to work on is a second
/// *workspace*, not a second copy of the app — so anything that used to pick a
/// window out of an unordered map names this instead.
#[cfg(desktop)]
const MAIN_WINDOW: &str = "main";

/// Emit a `cli:open-review` event to the window so the frontend navigates to
/// the requested review in place.
#[cfg(desktop)]
fn emit_cli_open_review(
    app: &tauri::AppHandle,
    repo_path: &str,
    ref_name: Option<&str>,
    focused_file: Option<&str>,
    focused_hunk_hash: Option<&str>,
) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.emit(
            "cli:open-review",
            serde_json::json!({
                "repoPath": repo_path,
                "ref": ref_name,
                "focusedFile": focused_file,
                "focusedHunkHash": focused_hunk_hash,
            }),
        );
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Everything that happens once the app exists: consent restore, the menu bar,
/// and the two watchers that are global rather than per-repo.
///
/// Split out of `run` so that function reads as the builder chain it is. The
/// `consent` flag comes in by reference because `init_sentry` already holds a
/// clone of it in its `before_send` hook.
#[cfg(desktop)]
fn setup_app(
    app: &mut tauri::App,
    consent: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Restore Sentry consent from persisted settings
    if let Some(serde_json::Value::Bool(true)) = commands::read_setting("sentryEnabled") {
        consent.store(true, Ordering::Relaxed);
    }

    let close = MenuItemBuilder::new("Close")
        .id("close")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let open_repo = MenuItemBuilder::new("Open Repository…")
        .id("open_repo")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let new_terminal = MenuItemBuilder::new("New Terminal")
        .id("new_terminal")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;

    let reopen_terminal = MenuItemBuilder::new("Reopen Closed Terminal")
        .id("reopen_terminal")
        .accelerator("CmdOrCtrl+Shift+T")
        .build(app)?;

    let new_workspace = MenuItemBuilder::new("New Workspace")
        .id("new_workspace")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let refresh = MenuItemBuilder::new("Refresh Review")
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
        .build(app)?;

    let restart_lsp = MenuItemBuilder::new("Restart Language Servers")
        .id("restart_lsp")
        .build(app)?;

    let check_for_updates = MenuItemBuilder::new("Check for Updates...")
        .id("check_for_updates")
        .build(app)?;

    let settings = MenuItemBuilder::new("Settings…")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let review_help = MenuItemBuilder::new("Spur Help")
        .id("review_help")
        .build(app)?;

    let report_issue = MenuItemBuilder::new("Report Issue...")
        .id("report_issue")
        .build(app)?;

    let find_file = MenuItemBuilder::new("Go to File…")
        .id("find_file")
        .accelerator("CmdOrCtrl+P")
        .enabled(false)
        .build(app)?;

    let find_symbols = MenuItemBuilder::new("Go to Symbol…")
        .id("find_symbols")
        .accelerator("CmdOrCtrl+R")
        .enabled(false)
        .build(app)?;

    let search_in_files = MenuItemBuilder::new("Search in Files…")
        .id("search_in_files")
        .accelerator("CmdOrCtrl+Shift+F")
        .enabled(false)
        .build(app)?;

    let toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar")
        .id("toggle_sidebar")
        .accelerator("CmdOrCtrl+B")
        .enabled(false)
        .build(app)?;

    let toggle_files_panel = MenuItemBuilder::new("Toggle Files Panel")
        .id("toggle_files_panel")
        .accelerator("CmdOrCtrl+Alt+B")
        .enabled(false)
        .build(app)?;

    let reveal_in_browse = MenuItemBuilder::new("Reveal in Browse")
        .id("reveal_in_browse")
        .accelerator("CmdOrCtrl+Alt+\\")
        .enabled(false)
        .build(app)?;

    let new_review = MenuItemBuilder::new("New Review…")
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
        .item(&new_workspace)
        .item(&new_terminal)
        .item(&reopen_terminal)
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
        .item(&toggle_files_panel)
        .item(&reveal_in_browse)
        .separator()
        .item(&actual_size)
        .item(&zoom_in)
        .item(&zoom_out)
        .separator()
        .item(&show_debug)
        .item(&restart_lsp)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    #[allow(
        unused_mut,
        reason = "only the release build adds items to this submenu"
    )]
    let mut help_menu_builder = SubmenuBuilder::new(app, "Help");

    #[cfg(not(debug_assertions))]
    {
        let install_cli = MenuItemBuilder::new("Install 'spur' Command in PATH...")
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

    app.manage(MenuItems(std::collections::HashMap::from([
        ("refresh".to_owned(), refresh),
        ("find_file".to_owned(), find_file),
        ("find_symbols".to_owned(), find_symbols),
        ("search_in_files".to_owned(), search_in_files),
        ("toggle_sidebar".to_owned(), toggle_sidebar),
        ("toggle_files_panel".to_owned(), toggle_files_panel),
        ("reveal_in_browse".to_owned(), reveal_in_browse),
    ])));

    // Terminals live in a separate `spur-daemon` process so they
    // survive quitting — or crashing — this app. Nothing is spawned or
    // connected here: the daemon is attached to (or started) on the
    // first terminal command, which keeps a respawn after an app update
    // — seconds of quit-and-spawn — off the path the window waits on,
    // and leaves a failed first attempt retryable. See
    // `TerminalState::client`.
    app.manage(terminal_commands::TerminalState::new());

    // The tailnet server, and its restart if the user left it on. Off
    // the startup path deliberately: binding a port is fast, but the
    // window must not wait on it, and a failure here is a settings
    // toggle to look at rather than a launch to abort.
    app.manage(remote::RemoteServer::default());
    let remote_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        remote::restore(&remote_handle).await;
    });

    // Start lightweight watchers for local activity on registered repos
    let app_handle = app.handle().clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::desktop::watchers::start_local_activity_watchers(app_handle) {
            log::error!("[setup] Failed to start local activity watchers: {e}");
        }
    });

    // The workspace queue is global, so its watcher is started once here
    // rather than alongside any repo's — off the startup path for the
    // same reason as the one above: `new_debouncer` blocks on the
    // platform watcher's handshake.
    let workspaces_app_handle = app.handle().clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::desktop::watchers::start_work_watcher(workspaces_app_handle) {
            log::error!("[setup] Failed to start workspace queue watcher: {e}");
        }
    });

    Ok(())
}

/// A second launch of the app, forwarded here by the single-instance plugin.
///
/// The CLI reaches the running app this way: it launches the binary with the
/// repo path (or a `spur://` URL) and the plugin hands the argv over rather
/// than starting a second process.
fn handle_second_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    // Clean up signal file — the CLI may have written one before this
    // second process was intercepted by the single-instance plugin.
    let _ = std::fs::remove_file(spur::home::open_request_path());

    // If the second instance was launched with a spur:// URL
    // (e.g. clicking a link in another app), the deep-link plugin
    // forwards it via argv. Handle it before the positional-arg
    // path below.
    if let Some(deep_link) = argv.iter().skip(1).find(|a| a.starts_with("spur://")) {
        handle_deep_link(app, deep_link);
        return;
    }

    // When a second instance is launched, its CLI args are forwarded here.
    // Find non-flag args after the binary name: first is repo path,
    // optional second is the review ref.
    let non_flag_args: Vec<String> = argv
        .iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .cloned()
        .collect();
    if let Some(repo) = non_flag_args.first().cloned() {
        let ref_name = non_flag_args.get(1).cloned();
        let focused_file = non_flag_args.get(2).cloned();
        emit_cli_open_review(
            app,
            &repo,
            ref_name.as_deref(),
            focused_file.as_deref(),
            None,
        );
    }
}

/// Menu items are addressed by string id, so this is the one place the ids the
/// menu builder writes have to agree with the events the frontend listens for.
///
/// The `_ => {}` fallthrough means a renamed id fails silently rather than
/// failing to compile; keep the two halves in view of each other.
fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "close" => emit_menu_event(app, "menu:close", ()),
        "new_terminal" => emit_menu_event(app, "menu:new-terminal", ()),
        "reopen_terminal" => emit_menu_event(app, "menu:reopen-terminal", ()),
        "new_workspace" => emit_menu_event(app, "menu:new-workspace", ()),
        "open_repo" => emit_menu_event(app, "menu:open-repo", ()),
        "refresh" => emit_menu_event(app, "menu:refresh", ()),
        "actual_size" => emit_menu_event(app, "menu:zoom-reset", ()),
        "zoom_in" => emit_menu_event(app, "menu:zoom-in", ()),
        "zoom_out" => emit_menu_event(app, "menu:zoom-out", ()),
        "show_debug" => emit_menu_event(app, "menu:show-debug", ()),
        "restart_lsp" => emit_menu_event(app, "menu:restart-lsp", ()),
        "settings" => emit_menu_event(app, "menu:open-settings", ()),
        "check_for_updates" => emit_menu_event(app, "menu:check-for-updates", ()),
        "install_cli" => match commands::install_cli(app.clone()) {
            Ok(_) => emit_menu_event(app, "cli:installed", ()),
            Err(e) => emit_menu_event(app, "cli:install-error", e),
        },
        "review_help" => {
            let _ = app
                .opener()
                .open_url("https://github.com/dropseed/spur", None::<&str>);
        }
        "report_issue" => {
            let _ = app
                .opener()
                .open_url("https://github.com/dropseed/spur/issues", None::<&str>);
        }
        "find_file" => emit_menu_event(app, "menu:find-file", ()),
        "find_symbols" => emit_menu_event(app, "menu:find-symbols", ()),
        "search_in_files" => emit_menu_event(app, "menu:search-in-files", ()),
        "toggle_sidebar" => emit_menu_event(app, "menu:toggle-sidebar", ()),
        "toggle_files_panel" => emit_menu_event(app, "menu:toggle-files-panel", ()),
        "reveal_in_browse" => emit_menu_event(app, "menu:reveal-in-browse", ()),
        "new_review" => emit_menu_event(app, "menu:new-review", ()),
        _ => {}
    }
}

/// Sentry, reporting nothing until the user opts in.
///
/// Release builds only — a debug build returns `None` and never initializes the
/// client at all. The `before_send` hook is the consent gate: it drops every
/// event while the flag is false, and strips the user and hostname fields from
/// the ones it does let through.
fn init_sentry(consent: &Arc<AtomicBool>) -> Option<sentry::ClientInitGuard> {
    if cfg!(debug_assertions) {
        return None;
    }
    let consent_for_hook = Arc::clone(consent);
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
}

/// Emit a menu event to the app's window.
///
/// A broadcast, because there is exactly one window to broadcast to. This used
/// to hunt for the focused window: with several open, the app-global macOS menu
/// bar fires `on_menu_event` once and every window would have reacted to it.
fn emit_menu_event<P: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: P) {
    let _ = app.emit(event, payload);
}

/// Where a `spur://` link points: the repo it resolved to, plus whatever of
/// the ref, file and hunk the URL named.
#[cfg(desktop)]
struct DeepLinkTarget {
    repo_path: String,
    review_ref: Option<String>,
    file: Option<String>,
    hunk: Option<String>,
}

/// Parse a `spur://open?repo=&ref=&file=&hunk=` URL into the parts
/// `emit_cli_open_review` needs. Returns `None` for unrecognized URLs
/// (wrong scheme, missing or unknown repo id, etc.).
#[cfg(desktop)]
fn parse_spur_url(raw: &str) -> Option<DeepLinkTarget> {
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "review" {
        return None;
    }

    let mut repo_id: Option<String> = None;
    let mut review_ref: Option<String> = None;
    let mut file: Option<String> = None;
    let mut hunk: Option<String> = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "repo" => repo_id = Some(value.into_owned()),
            "ref" => review_ref = Some(value.into_owned()),
            "file" => file = Some(value.into_owned()),
            "hunk" => hunk = Some(value.into_owned()),
            _ => {}
        }
    }

    let repo_id = repo_id?;
    let entry = spur::home::get_registered_repo(&repo_id).ok().flatten()?;

    Some(DeepLinkTarget {
        repo_path: entry.path,
        review_ref,
        file,
        hunk,
    })
}

/// Handle a `spur://` URL: parse it, then either navigate the running
/// window or write a signal file for the next launch. `app_handle` is used
/// to emit into an existing window; the signal-file fallback is for the
/// cold-start case where no webview exists yet.
#[cfg(desktop)]
fn handle_deep_link(app: &tauri::AppHandle, raw: &str) {
    let Some(DeepLinkTarget {
        repo_path,
        review_ref,
        file,
        hunk,
    }) = parse_spur_url(raw)
    else {
        log::warn!("Ignoring unrecognized deep link: {}", raw);
        return;
    };
    log::info!("Deep link opened: {}", raw);

    if app.get_webview_window(MAIN_WINDOW).is_none() {
        // Cold start — frontend not ready yet. Drop a signal file the
        // startup code reads (matches the CLI's existing channel).
        write_open_request(
            &repo_path,
            review_ref.as_deref(),
            file.as_deref(),
            hunk.as_deref(),
        );
        return;
    }

    emit_cli_open_review(
        app,
        &repo_path,
        review_ref.as_deref(),
        file.as_deref(),
        hunk.as_deref(),
    );
}

/// Leave a request for the app's own next activation to pick up — the deep-link
/// path, where the window may not be ready to be told directly yet.
///
/// Unlike the CLI's write, a failure here has nowhere to be reported: nobody is
/// waiting on a return value, and the same payload is emitted directly straight
/// afterwards. Logged rather than surfaced.
#[cfg(desktop)]
fn write_open_request(
    repo_path: &str,
    ref_name: Option<&str>,
    focused_file: Option<&str>,
    focused_hunk_hash: Option<&str>,
) {
    let request = spur::home::OpenRequest {
        repo_path: repo_path.to_owned(),
        ref_name: ref_name.map(ToOwned::to_owned),
        focused_file: focused_file.map(ToOwned::to_owned),
        focused_hunk_hash: focused_hunk_hash.map(ToOwned::to_owned),
    };
    if let Err(e) = spur::home::write_open_request(&request) {
        log::warn!("[desktop] could not write the open request: {e}");
    }
}

/// Hold a key down and have it repeat, the way it does in a terminal.
///
/// macOS press-and-hold turns a held key into the accent picker instead of a
/// repeat, and WKWebView honors it — so holding `j` in `less`, or `k` in vim,
/// sent exactly one keystroke and the app looked like it was dropping input.
/// Every editor and terminal in a web view turns this off (VS Code, Zed); the
/// app is one, so it does too.
///
/// `registerDefaults` writes nothing to disk and is scoped to this process's
/// defaults search list, at the end of it — so anyone who explicitly wants the
/// accent picker back still outranks this:
///
/// ```sh
/// defaults write com.dropseed.spur ApplePressAndHoldEnabled -bool true
/// ```
///
/// The one `unsafe` in the workspace, which otherwise denies it: `objc2` marks
/// `registerDefaults` unsafe because it cannot check the dictionary's generic
/// against the selector, and the dictionary is built two lines above it. There
/// is no safe route to the registration domain, and the alternative — a
/// `defaults write` at every launch — would stamp on the user's own preference
/// rather than sit behind it.
#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "objc2 cannot check registerDefaults's generic against the selector; there is no safe route to the registration domain"
)]
fn let_keys_repeat() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let key = NSString::from_str("ApplePressAndHoldEnabled");
    let off = NSNumber::new_bool(false);
    let registration: objc2::rc::Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[&*off as &AnyObject]);
    // SAFETY: the dictionary is exactly the `NSString` -> object shape the
    // method's generic asks for.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&registration) };
}

/// Run the Tauri desktop application.
///
/// This sets up all plugins, menus, and command handlers, then starts
/// the Tauri event loop.
pub fn run() {
    // Fix PATH when launched from Finder/Dock (macOS gives GUI apps a minimal environment).
    // This is a no-op when launched from a terminal.
    let _ = fix_path_env::fix();

    // Before anything resolves a storage path: move a pre-rename `~/.review`
    // into place as `~/.spur`. No-ops unless this is the default home and only
    // the old one exists.
    spur::home::migrate_legacy_home();

    // Before any web view exists — it reads the pref when it is created.
    #[cfg(target_os = "macos")]
    let_keys_repeat();

    // Initialize Sentry early so it captures any panics during setup.
    // Events are silently dropped until the user opts in via preferences.
    let consent = Arc::new(AtomicBool::new(false));
    let _sentry_guard = init_sentry(&consent);

    let builder = tauri::Builder::default()
        .manage(SentryConsent(Arc::clone(&consent)))
        .manage(commands::LspServers(tokio::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .manage(notifications::NotificationHub::default())
        .plugin(tauri_plugin_single_instance::init(
            |app: &tauri::AppHandle, argv, _cwd| handle_second_instance(app, argv),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin({
            let mut builder = tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("notify", log::LevelFilter::Warn)
                .level_for("notify_debouncer_mini", log::LevelFilter::Warn);

            // In dev mode, also write logs to the review home's app.log so we
            // can read traces for debugging (same file the frontend logger
            // uses). Through get_central_root so a `$SPUR_HOME` dev instance
            // doesn't interleave its logs with the released app's.
            if cfg!(debug_assertions) {
                if let Ok(review_dir) = spur::home::get_central_root() {
                    let _ = std::fs::create_dir_all(&review_dir);
                    builder = builder
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Folder {
                                path: review_dir,
                                file_name: Some("app.log".into()),
                            },
                        ))
                        .max_file_size(10_000_000) // 10 MB
                        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne);
                }
            }

            builder.build()
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_deep_link::init());

    // Desktop-only plugins and setup
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| setup_app(app, &consent))
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()));

    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    });

    let app = builder
        .invoke_handler(tauri::generate_handler![
            remote::remote_access_status,
            remote::remote_access_enable,
            remote::remote_access_disable,
            notifications::notify_attention,
            notifications::notify_ack,
            notifications::set_dock_badge,
            commands::get_current_repo,
            commands::check_github_available,
            commands::list_pull_requests,
            commands::get_viewer_prs,
            commands::get_review_tier,
            commands::get_agent_usage,
            commands::fetch_pull_request,
            commands::materialize_review,
            commands::release_review_worktree,
            commands::reclaim_closed_prs,
            commands::get_current_branch,
            commands::get_git_user,
            commands::get_remote_info,
            commands::fetch_origin,
            commands::get_default_branch,
            commands::list_branches,
            commands::list_worktree_status,
            commands::create_worktree,
            commands::remove_worktree,
            commands::create_review_worktree,
            commands::remove_review_worktree,
            commands::resolve_ref,
            commands::update_worktree_head,
            commands::list_all_local_activity,
            commands::register_repo,
            commands::unregister_repo,
            commands::get_git_status,
            commands::get_git_status_raw,
            commands::stage_file,
            commands::unstage_file,
            commands::unstage_all,
            commands::stage_hunks,
            commands::unstage_hunks,
            commands::git_commit,
            commands::get_working_tree_file_content,
            commands::list_commits,
            commands::get_commit_detail,
            commands::commit_comparison,
            commands::get_hunk_attribution,
            commands::list_files,
            commands::list_all_files,
            commands::list_repo_files,
            commands::list_files_at_ref,
            commands::list_directory_contents,
            commands::get_file_content,
            commands::get_all_hunks,
            commands::get_files_delta,
            commands::get_diff_shortstat,
            commands::get_expanded_context,
            commands::resolve_review,
            commands::load_review_state,
            commands::reconcile_review_state,
            commands::save_review_state,
            commands::list_saved_reviews,
            commands::set_base_override,
            commands::delete_review,
            commands::review_exists,
            commands::ensure_review_exists,
            commands::list_all_reviews_global,
            commands::get_review_root,
            commands::get_review_storage_path,
            commands::workspace_list,
            commands::workspace_add,
            commands::workspace_remove,
            commands::workspace_nest,
            commands::workspace_rename,
            commands::workspace_move,
            commands::workspace_attach,
            commands::workspace_detach,
            commands::workspace_route,
            commands::consume_cli_request,
            commands::classify_hunks_static,
            commands::get_comparison_move_pairs,
            commands::write_text_file,
            commands::append_to_file,
            commands::start_file_watcher,
            commands::stop_file_watcher,
            commands::match_trust_pattern,
            commands::get_trust_taxonomy,
            commands::should_skip_file,
            commands::search_file_contents,
            commands::get_file_symbol_diffs,
            commands::get_file_symbols,
            commands::get_repo_symbols,
            commands::find_symbol_definitions,
            commands::generate_commit_message,
            commands::is_dev_mode,
            commands::is_git_repo,
            commands::get_cli_install_status,
            commands::install_cli,
            commands::uninstall_cli,
            commands::set_sentry_consent,
            commands::set_menu_enabled,
            commands::check_reviews_freshness,
            commands::detect_vscode_theme,
            commands::set_window_background_color,
            commands::read_settings,
            commands::write_settings,
            commands::open_settings_file,
            commands::path_is_file,
            commands::read_raw_file,
            commands::get_file_content_at_ref,
            commands::list_directory_plain,
            commands::init_lsp_servers,
            commands::stop_all_lsp_servers,
            commands::restart_lsp_server,
            commands::discover_lsp_servers,
            commands::lsp_goto_definition,
            commands::lsp_hover,
            commands::lsp_find_references,
            terminal_commands::terminals_available,
            terminal_commands::terminal_start,
            terminal_commands::terminal_assign_workspace,
            terminal_commands::terminal_write,
            terminal_commands::terminal_resize,
            terminal_commands::terminal_kill,
            terminal_commands::terminal_list,
            terminal_commands::terminal_replay,
            terminal_commands::terminal_peek_many,
            terminal_commands::terminal_shutdown_all_background,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(desktop)]
        match event {
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                // Clicking the dock icon of an app that is already on screen
                // means "come to the front", and AppKit has already done that
                // by the time this fires — so there is nothing left to do.
                if !has_visible_windows {
                    // Nothing on screen: minimized, or hidden with ⌘H. AppKit
                    // skips its own restore when the delegate reports no visible
                    // windows, so bringing the window back is ours to do.
                    if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW) {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                // Check for a pending open request from the CLI or a cold-start deep link
                if let Some(req) = read_open_request() {
                    emit_cli_open_review(
                        app_handle,
                        &req.repo_path,
                        req.ref_name.as_deref(),
                        req.focused_file.as_deref(),
                        req.focused_hunk_hash.as_deref(),
                    );
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                // Handle files opened via "Open with Review" in Finder, and
                // spur:// deep links delivered to a running app.
                for url in urls {
                    match url.scheme() {
                        "file" => {
                            if let Ok(path) = url.to_file_path() {
                                let (repo_path, focused_file) =
                                    spur::service::util::resolve_open_target(&path);
                                log::info!(
                                    "Opened file via file association: {} (repo: {}, file: {:?})",
                                    path.to_string_lossy(),
                                    repo_path,
                                    focused_file
                                );
                                if app_handle.get_webview_window(MAIN_WINDOW).is_none() {
                                    write_open_request(
                                        &repo_path,
                                        None,
                                        focused_file.as_deref(),
                                        None,
                                    );
                                } else {
                                    emit_cli_open_review(
                                        app_handle,
                                        &repo_path,
                                        None,
                                        focused_file.as_deref(),
                                        None,
                                    );
                                }
                            }
                        }
                        "review" => {
                            handle_deep_link(app_handle, url.as_str());
                        }
                        _ => {}
                    }
                }
            }
            // `RunEvent::Exit` deliberately does nothing about terminals: the
            // sessions belong to the `spur-daemon` process and are meant to
            // outlive the GUI. They end only through an explicit kill (or the
            // "shut down all sessions" governance action), or when a version
            // mismatch makes the app respawn the daemon on next launch.
            _ => {}
        }
    });
}
