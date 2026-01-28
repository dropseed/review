//! System tray (menu bar) icon for sync server status.
//!
//! Displays a menu bar icon showing sync server state with quick actions.

use super::server;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

/// Menu item IDs
const MENU_STATUS: &str = "tray-status";
const MENU_TOGGLE: &str = "tray-toggle";
const MENU_COPY_URL: &str = "tray-copy-url";
const MENU_SHOW: &str = "tray-show";
const MENU_SETTINGS: &str = "tray-settings";

/// Set up the system tray icon.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let is_running = server::is_running();
    let client_count = get_client_count();

    // Build the menu
    let menu = build_menu(app, is_running, client_count)?;

    // Load the appropriate icon
    let icon = load_tray_icon(is_running)?;

    // Create the tray icon
    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(&get_tooltip(is_running, client_count))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id.as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            // Handle click events
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // Left click shows the menu (already handled by menu_on_left_click)
                let _ = tray;
            }
        })
        .build(app)?;

    log::info!("[tray] System tray initialized");
    Ok(())
}

/// Build the tray menu based on current state.
fn build_menu(
    app: &AppHandle,
    is_running: bool,
    client_count: usize,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    // Status line (disabled, informational)
    let status_text = if is_running {
        if client_count == 1 {
            "Sync Server: Running (1 client)".to_string()
        } else {
            format!("Sync Server: Running ({} clients)", client_count)
        }
    } else {
        "Sync Server: Stopped".to_string()
    };

    let status = MenuItemBuilder::new(status_text)
        .id(MENU_STATUS)
        .enabled(false)
        .build(app)?;

    // Toggle button
    let toggle_text = if is_running {
        "Stop Server"
    } else {
        "Start Server"
    };
    let toggle = MenuItemBuilder::new(toggle_text)
        .id(MENU_TOGGLE)
        .build(app)?;

    // Copy URL (only enabled when running)
    let url_text = if is_running {
        if let Some(ip) = get_tailscale_ip() {
            format!("URL: http://{}:{}", ip, server::DEFAULT_PORT)
        } else {
            format!("URL: http://localhost:{}", server::DEFAULT_PORT)
        }
    } else {
        "URL: Not running".to_string()
    };
    let copy_url = MenuItemBuilder::new(url_text)
        .id(MENU_COPY_URL)
        .enabled(is_running)
        .build(app)?;

    // Show window
    let show_text = if cfg!(debug_assertions) {
        "Show Compare (Dev)"
    } else {
        "Show Compare"
    };
    let show = MenuItemBuilder::new(show_text).id(MENU_SHOW).build(app)?;

    // Settings
    let settings = MenuItemBuilder::new("Settings...")
        .id(MENU_SETTINGS)
        .build(app)?;

    // Build the menu
    let menu = MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&toggle)
        .separator()
        .item(&copy_url)
        .separator()
        .item(&show)
        .item(&settings)
        .build()?;

    Ok(menu)
}

/// Handle menu item clicks.
fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        MENU_TOGGLE => {
            let is_running = server::is_running();
            if is_running {
                // Emit event to frontend to stop server
                let _ = app.emit("tray:stop-server", ());
                log::info!("[tray] Emitted tray:stop-server");
            } else {
                // Emit event to frontend to start server
                let _ = app.emit("tray:start-server", ());
                log::info!("[tray] Emitted tray:start-server");
            }
        }
        MENU_COPY_URL => {
            // Copy URL to clipboard
            if let Some(ip) = get_tailscale_ip() {
                let url = format!("http://{}:{}", ip, server::DEFAULT_PORT);
                copy_to_clipboard(app, &url);
            } else {
                let url = format!("http://localhost:{}", server::DEFAULT_PORT);
                copy_to_clipboard(app, &url);
            }
        }
        MENU_SHOW => {
            // Show/focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            } else {
                // Try to find any window
                for (_, window) in app.webview_windows() {
                    let _ = window.show();
                    let _ = window.set_focus();
                    break;
                }
            }
        }
        MENU_SETTINGS => {
            // Emit event to open settings
            let _ = app.emit("menu:open-settings", ());
            // Also show the window
            for (_, window) in app.webview_windows() {
                let _ = window.show();
                let _ = window.set_focus();
                break;
            }
        }
        _ => {}
    }
}

/// Load the appropriate tray icon based on server state and build type.
fn load_tray_icon(is_running: bool) -> Result<Image<'static>, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    let icon_bytes = if is_running {
        include_bytes!("../../icons/tray-active-dev.png").as_slice()
    } else {
        include_bytes!("../../icons/tray-idle-dev.png").as_slice()
    };

    #[cfg(not(debug_assertions))]
    let icon_bytes = if is_running {
        include_bytes!("../../icons/tray-active.png").as_slice()
    } else {
        include_bytes!("../../icons/tray-idle.png").as_slice()
    };

    Image::from_bytes(icon_bytes).map_err(|e| e.into())
}

/// Get tooltip text based on server state.
fn get_tooltip(is_running: bool, client_count: usize) -> String {
    let prefix = if cfg!(debug_assertions) {
        "Compare (Dev)"
    } else {
        "Compare"
    };

    if is_running {
        if client_count == 0 {
            format!("{} Sync: Running", prefix)
        } else if client_count == 1 {
            format!("{} Sync: Running (1 client)", prefix)
        } else {
            format!("{} Sync: Running ({} clients)", prefix, client_count)
        }
    } else {
        format!("{} Sync: Stopped", prefix)
    }
}

/// Update the tray icon and menu to reflect current state.
/// Call this when server state changes.
pub fn update_tray_state(app: &AppHandle) {
    let is_running = server::is_running();
    let client_count = get_client_count();

    // Update the tray icon
    if let Some(tray) = app.tray_by_id("main") {
        // Update icon
        if let Ok(icon) = load_tray_icon(is_running) {
            let _ = tray.set_icon(Some(icon));
        }

        // Update tooltip
        let _ = tray.set_tooltip(Some(&get_tooltip(is_running, client_count)));

        // Rebuild and update menu
        if let Ok(menu) = build_menu(app, is_running, client_count) {
            let _ = tray.set_menu(Some(menu));
        }

        log::debug!(
            "[tray] Updated state: running={}, clients={}",
            is_running,
            client_count
        );
    }
}

/// Get the current connected client count from the server.
pub fn get_client_count() -> usize {
    server::get_client_count()
}

/// Copy text to clipboard using Tauri's clipboard plugin.
fn copy_to_clipboard(app: &AppHandle, text: &str) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    if let Err(e) = app.clipboard().write_text(text) {
        log::error!("[tray] Failed to copy to clipboard: {}", e);
    } else {
        log::info!("[tray] Copied to clipboard: {}", text);
    }
}

/// Get Tailscale IP (duplicated from commands.rs for convenience).
fn get_tailscale_ip() -> Option<String> {
    use std::process::Command;

    let output = Command::new("tailscale").args(["ip", "-4"]).output().ok()?;

    if output.status.success() {
        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if ip.starts_with("100.") {
            return Some(ip);
        }
    }

    None
}
