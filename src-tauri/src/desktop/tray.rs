//! System tray (menu bar) icon for companion server status.
//!
//! Shows a menu bar icon when the companion server is running,
//! hidden when the server is stopped.

use super::companion_server;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "companion";

/// Show the tray icon (called when the companion server starts).
pub fn show(app: &AppHandle) {
    // Already visible — just update the menu
    if app.tray_by_id(TRAY_ID).is_some() {
        update_menu(app);
        return;
    }

    let icon = match load_icon() {
        Ok(i) => i,
        Err(e) => {
            log::error!("[tray] Failed to load icon: {e}");
            return;
        }
    };

    let menu = match build_menu(app) {
        Ok(m) => m,
        Err(e) => {
            log::error!("[tray] Failed to build menu: {e}");
            return;
        }
    };

    let app_name = if cfg!(debug_assertions) {
        "Review (Dev)"
    } else {
        "Review"
    };

    match TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip(&format!("{app_name} — Companion server running"))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id.as_ref());
        })
        .build(app)
    {
        Ok(_) => log::info!("[tray] Shown"),
        Err(e) => log::error!("[tray] Failed to create tray icon: {e}"),
    }
}

/// Hide the tray icon (called when the companion server stops).
pub fn hide(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(e) = tray.set_visible(false) {
            log::error!("[tray] Failed to hide: {e}");
        }
        // Remove entirely so `show()` recreates it fresh
        let _ = app.remove_tray_by_id(TRAY_ID);
        log::info!("[tray] Hidden");
    }
}

fn build_menu(
    app: &AppHandle,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let status = MenuItemBuilder::new("Companion Server: Running")
        .id("tray-status")
        .enabled(false)
        .build(app)?;

    let show = MenuItemBuilder::new(if cfg!(debug_assertions) {
        "Show Review (Dev)"
    } else {
        "Show Review"
    })
    .id("tray-show")
    .build(app)?;

    let settings = MenuItemBuilder::new("Settings...")
        .id("tray-settings")
        .build(app)?;

    let stop = MenuItemBuilder::new("Stop Server")
        .id("tray-stop")
        .build(app)?;

    MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&show)
        .item(&settings)
        .separator()
        .item(&stop)
        .build()
        .map_err(Into::into)
}

fn update_menu(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "tray-show" => {
            for (_, window) in app.webview_windows() {
                let _ = window.show();
                let _ = window.set_focus();
                break;
            }
        }
        "tray-settings" => {
            let _ = app.emit("menu:open-settings", ());
            for (_, window) in app.webview_windows() {
                let _ = window.show();
                let _ = window.set_focus();
                break;
            }
        }
        "tray-stop" => {
            companion_server::stop();
            companion_server::set_auth_token(None);
            hide(app);
            // Notify frontend so the toggle updates
            let _ = app.emit("companion-server:stopped", ());
        }
        _ => {}
    }
}

fn load_icon() -> Result<Image<'static>, Box<dyn std::error::Error>> {
    let bytes: &[u8] = include_bytes!("../../icons/tray-icon@2x.png");
    Image::from_bytes(bytes).map_err(|e| e.to_string().into())
}
