//! "Serve on my tailnet" — hosting the app's own web front end from inside the
//! desktop app, and pointing Tailscale at it.
//!
//! Two halves, deliberately independent:
//!
//! - **The HTTP server** runs in this process, for as long as the app does. It
//!   serves the same Axum API web mode serves, plus the frontend already
//!   compiled into this binary (Tauri's asset resolver — see
//!   [`spur::server::AssetSource`]). It is ours to start and stop.
//! - **The `tailscale serve` config** is not ours. It lives in tailscaled's
//!   persistent state, survives reboots, and outlives this app. The toggle
//!   writes it once and clears it once.
//!
//! That asymmetry is the whole design. Turning the toggle on has to do both,
//! because either alone is useless; turning it *off* clears the Tailscale
//! config too, since a proxy left pointing at a port nothing answers is a
//! machine that looks broken from a phone. But **quitting the app only stops
//! the server** — a config the user asked for is not something to silently
//! revoke because they closed a window, and it is restored on next launch by
//! the setting, not by the proxy.

use std::sync::Arc;

use serde::Serialize;
use spur::server::{AssetSource, StaticAsset, DEFAULT_PORT};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use tokio::sync::Mutex;

use super::commands::read_setting;

/// The settings key remembering whether the user wants this on. Read at launch
/// so an app that was serving before a restart is serving after one.
///
/// **Read here, written by the frontend.** `settings.json` is owned by the UI's
/// storage service, which holds the whole document in memory and rewrites it
/// wholesale on any preference change. A value written behind that cache
/// survives only until the next theme tweak or sidebar drag, and the symptom is
/// nasty: the flag vanishes, so the server never starts again, while the
/// `tailscale serve` config — which deliberately outlives the app — still points
/// at the port. The phone gets a 502 and nothing on screen explains it.
pub const SETTING_KEY: &str = "tailnetServeEnabled";

/// What the settings panel draws.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessState {
    /// The user's choice, as persisted — not the same question as whether the
    /// server is up, which is why both are reported. They differ exactly when
    /// something failed, and that gap is the panel's most useful signal.
    pub enabled: bool,
    /// The HTTP server is bound and answering.
    pub serving: bool,
    /// The port it is on.
    pub port: u16,
    /// The URL to open on a phone, once Tailscale agrees.
    pub url: Option<String>,
    /// Everything known about the local Tailscale node.
    pub tailnet: spur::tailnet::TailnetStatus,
    /// The admin page for the one setting the app cannot change itself.
    pub https_admin_url: &'static str,
}

/// The running server, if any. One per app.
#[derive(Default)]
pub struct RemoteServer {
    stop: Mutex<Option<oneshot::Sender<()>>>,
}

impl RemoteServer {
    /// Whether the server is currently up.
    ///
    /// The sender being present *is* the answer: it is taken when stopping and
    /// dropped when the task exits, so there is no separate flag to fall out of
    /// step with the socket.
    pub async fn is_serving(&self) -> bool {
        self.stop.lock().await.is_some()
    }

    /// Start the server, unless it is already running.
    pub async fn start(&self, app: &AppHandle, port: u16) -> Result<(), String> {
        let mut slot = self.stop.lock().await;
        if slot.is_some() {
            return Ok(());
        }

        // Bind here, not inside the spawned task, so the common failure — the
        // port is already held by a leftover `spur-server` or a second copy
        // of the app — is this function's error rather than a log line arriving
        // after the toggle has drawn itself on.
        let listener = spur::server::bind(port)
            .await
            .map_err(|err| format!("Couldn't start the server on port {port}: {err}"))?;

        let (tx, rx) = oneshot::channel();
        let assets = asset_source(app.clone());
        tauri::async_runtime::spawn(async move {
            let served = spur::server::serve_on(listener, assets, async {
                let _ = rx.await;
            })
            .await;
            match served {
                Ok(()) => log::info!("[remote] server on :{port} stopped"),
                Err(err) => log::error!("[remote] server on :{port} failed: {err}"),
            }
        });

        *slot = Some(tx);
        Ok(())
    }

    /// Stop the server if it is running. Safe to call when it isn't.
    pub async fn stop(&self) {
        if let Some(tx) = self.stop.lock().await.take() {
            let _ = tx.send(());
        }
    }
}

/// The frontend compiled into this binary, as something the server can read.
///
/// Tauri's resolver wants the in-bundle path; the server hands it a URL path,
/// and the two agree apart from `/` meaning `index.html`. Nothing is cached
/// here — the resolver already holds the bytes.
fn asset_source(app: AppHandle) -> AssetSource {
    Arc::new(move |path: &str| {
        let path = if path == "/" { "/index.html" } else { path };
        app.asset_resolver()
            .get(path.to_owned())
            .map(|asset| StaticAsset {
                bytes: asset.bytes.to_vec(),
                mime: asset_mime(path, &asset.mime_type),
            })
    })
}

/// An asset's content type, taken from its extension.
///
/// Tauri's resolver falls back to `text/html` for any extension it doesn't
/// recognize, which is silent and wrong in a way that matters: `.webmanifest`
/// served as HTML is ignored by the browser, so the phone offers a bookmark
/// instead of an installed app with nothing on the page to say why.
///
/// Fixed by asking the extension rather than by naming that one file. A table
/// with `.webmanifest` in it would be correct today and wrong again the first
/// time the bundle gains a font, a source map, or a `.wasm` — the failure is
/// the *fallback*, not that one entry. `mime_guess` is already in the tree via
/// tauri, so this costs a line of manifest and no build time.
fn asset_mime(path: &str, resolver_guess: &str) -> String {
    mime_guess::from_path(path)
        .first_raw()
        .map(str::to_owned)
        // An extension `mime_guess` doesn't know either: the resolver's answer
        // is no worse, and for the extensionless SPA fallback it is right.
        .unwrap_or_else(|| resolver_guess.to_owned())
}

/// The port to serve on: `$SPUR_PORT`, else the shared default.
///
/// Honouring the environment variable matters more here than it looks: a dev
/// build and an installed app on one machine would otherwise fight over the
/// same port, and the loser is a toggle that won't switch on.
pub fn port() -> u16 {
    std::env::var("SPUR_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Whether the user has this switched on, as persisted.
pub fn enabled_setting() -> bool {
    matches!(
        read_setting(SETTING_KEY),
        Some(serde_json::Value::Bool(true))
    )
}

// ----- Commands -----

/// Everything the Remote access panel draws, in one round trip.
///
/// Probes Tailscale on every call rather than caching: the answers change
/// underneath the app (the user signs in, an admin enables certificates) and
/// the panel is opened rarely enough that three subprocesses is nothing.
#[tauri::command]
pub async fn remote_access_status(app: AppHandle) -> Result<RemoteAccessState, String> {
    let port = port();
    // Two `tailscale` subprocesses, polled with `std::thread::sleep` and each
    // allowed 10 seconds — so up to 20 seconds of a tokio worker thread if
    // `tailscaled` is wedged. Off the runtime, like the enable/disable paths.
    let tailnet = tauri::async_runtime::spawn_blocking(move || spur::tailnet::status(port))
        .await
        .map_err(|e| e.to_string())?;
    let server: tauri::State<'_, RemoteServer> = app.state();

    Ok(RemoteAccessState {
        enabled: enabled_setting(),
        serving: server.is_serving().await,
        port,
        url: tailnet.dns_name.as_deref().map(spur::tailnet::public_url),
        tailnet,
        https_admin_url: spur::tailnet::HTTPS_ADMIN_URL,
    })
}

/// Turn it on: start the server, then configure Tailscale to front it.
///
/// In that order, and the order is the point — `tailscale serve` is a proxy to
/// a port, so configuring it first would publish a URL that 502s for as long as
/// it took the server to bind. If Tailscale then refuses (signed out, no
/// certificates), the server is stopped again rather than left running behind a
/// toggle the user will see as off: the two halves are useless apart.
#[tauri::command]
pub async fn remote_access_enable(app: AppHandle) -> Result<RemoteAccessState, String> {
    let port = port();
    let server: tauri::State<'_, RemoteServer> = app.state();
    server.start(&app, port).await?;

    // The subprocess is blocking and this is an async command, so it runs off
    // the runtime's worker threads.
    let configured = tauri::async_runtime::spawn_blocking(move || spur::tailnet::enable(port))
        .await
        .map_err(|e| e.to_string())?;

    if let Err(err) = configured {
        server.stop().await;
        return Err(err.to_string());
    }

    remote_access_status(app).await
}

/// Turn it off: clear the Tailscale config, then stop the server.
///
/// The mirror of enabling, for the mirrored reason — the proxy goes first so
/// there is never a window where a phone can reach a name that no longer
/// answers. A Tailscale that fails to clear does not block stopping the server:
/// the user asked for this off, and leaving the server up because a subprocess
/// failed would be the opposite of what they asked.
#[tauri::command]
pub async fn remote_access_disable(app: AppHandle) -> Result<RemoteAccessState, String> {
    let cleared = tauri::async_runtime::spawn_blocking(spur::tailnet::disable)
        .await
        .map_err(|e| e.to_string())?;

    let server: tauri::State<'_, RemoteServer> = app.state();
    server.stop().await;

    if let Err(err) = cleared {
        log::warn!("[remote] serve config could not be cleared: {err}");
    }

    remote_access_status(app).await
}

/// Bring the server up at launch if the setting says so.
///
/// Only the server: the Tailscale config is already in tailscaled's state from
/// whenever the toggle was flipped, so re-running `serve` on every launch would
/// be a redundant subprocess and — if the tailnet had changed underneath — a
/// new source of launch-time errors nobody asked about.
pub async fn restore(app: &AppHandle) {
    if !enabled_setting() {
        return;
    }
    let server: tauri::State<'_, RemoteServer> = app.state();
    if let Err(err) = server.start(app, port()).await {
        log::warn!("[remote] could not restore the tailnet server: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The type Tauri's resolver gets wrong, and the one that decides whether a
    /// phone offers "Add to Home Screen" as an app or as a bookmark.
    #[test]
    fn a_webmanifest_beats_the_resolvers_html_fallback() {
        assert_eq!(
            asset_mime("/manifest.webmanifest", "text/html"),
            "application/manifest+json"
        );
    }

    /// The point of asking the extension rather than listing one file: types
    /// the bundle does not have today are already right.
    #[test]
    fn types_the_bundle_does_not_ship_yet_are_right_anyway() {
        assert_eq!(asset_mime("/f.woff2", "text/html"), "font/woff2");
        assert_eq!(asset_mime("/m.wasm", "text/html"), "application/wasm");
        assert_eq!(asset_mime("/d.json", "text/html"), "application/json");
        assert_eq!(asset_mime("/i.svg", "text/html"), "image/svg+xml");
    }

    #[test]
    fn the_ordinary_types_are_unchanged() {
        assert_eq!(asset_mime("/sw.js", "text/javascript"), "text/javascript");
        assert_eq!(asset_mime("/icons/icon-512.png", "image/png"), "image/png");
        assert_eq!(asset_mime("/index.html", "text/html"), "text/html");
    }

    /// A client-side route has no extension, and the bytes it is answered with
    /// are the index — so the resolver's own answer is the right one.
    #[test]
    fn an_extensionless_route_keeps_the_resolvers_answer() {
        assert_eq!(
            asset_mime("/dropseed/spur/master", "text/html"),
            "text/html"
        );
    }
}
