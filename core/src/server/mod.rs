//! Axum HTTP server — web-mode backend for the Review app.
//!
//! Feature-gated behind `server`. Serves the same business logic as the
//! Tauri desktop shell, but over HTTP + SSE instead of IPC.
//!
//! Terminals work here too: [`terminal`] bridges `/api/terminal/*` (POST for
//! control, one WebSocket per session for live PTY bytes) onto the
//! `review-daemon` process, which owns the PTYs. This server is a thin client
//! of that daemon — it attaches to one that is already running and never spawns
//! one, so a browser tab and the desktop app drive the same sessions.
//!
//! With `REVIEW_WEB_DIST` set, [`serve`] also serves a built Vite bundle, so one
//! port carries the whole app (handy behind `tailscale serve`).

mod handlers;
mod terminal;

use std::net::{IpAddr, SocketAddr};

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::Router;
use tower::Layer as _;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

/// Environment variable naming a built Vite `dist/` to serve alongside the API.
const WEB_DIST_ENV: &str = "REVIEW_WEB_DIST";

/// The port everything defaults to: `spur` on a phone keypad.
///
/// One constant rather than a literal per entry point, because the desktop
/// app's tailnet toggle hands this number to `tailscale serve` — a default that
/// disagreed with the one the server binds would produce a proxy pointing at
/// nothing, which looks exactly like the app being broken.
pub const DEFAULT_PORT: u16 = 7787;

/// Comma-separated origins allowed on top of the ones [`origin_allowed`]
/// derives — the escape hatch for a reverse proxy on a name this process never
/// sees itself.
const ALLOWED_ORIGINS_ENV: &str = "REVIEW_ALLOWED_ORIGINS";

/// Review state on a large repo is a big JSON document, and axum's 2MB default
/// turns saving one into a silent 413. 64MB is far above anything a review has
/// ever produced and still bounded.
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// One file the embedded UI can answer with, for a server that has no `dist/`
/// on disk to point at.
pub struct StaticAsset {
    pub bytes: Vec<u8>,
    pub mime: String,
}

/// Where a request for `index.html` or `/assets/x.js` is answered from.
///
/// The desktop app has no bundle directory: its frontend is compiled into the
/// binary, and Tauri hands it out through an asset resolver. Rather than teach
/// the app to unpack a `dist/` somewhere so `ServeDir` can find it — a copy on
/// disk to keep in step with the binary, for no gain — the server takes the
/// lookup itself. `review-server` still uses `$REVIEW_WEB_DIST` and touches
/// none of this.
pub type AssetSource = std::sync::Arc<dyn Fn(&str) -> Option<StaticAsset> + Send + Sync>;

/// Build the full router with all API routes.
fn build_router() -> Router {
    build_router_with(None)
}

fn build_router_with(assets: Option<AssetSource>) -> Router {
    // Origin is the gate, not the method or the header list: this server hands
    // out a machine's terminals and working tree, so a page on some other site
    // must not be able to drive it just because the user has a tab open. See
    // `origin_allowed` for what counts as "this server's own front end".
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, parts| {
            origin_allowed(Some(origin), &parts.headers)
        }))
        .allow_methods(Any)
        .allow_headers(Any);

    let api = handlers::build_api_router()
        .merge(terminal::router(terminal::TerminalBridge::new()))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES));

    // An unknown `/api/...` is a typo or a stale client, and answering it with
    // the SPA's HTML (200!) hides that behind a JSON parse error somewhere
    // else. Static routes still win: axum matches the wildcard last. Added
    // under either bundle source, since both put an HTML fallback behind it.
    let api_404 = |router: Router| {
        router.route(
            "/api/{*rest}",
            axum::routing::any(|| async { StatusCode::NOT_FOUND }),
        )
    };

    // An embedded bundle takes precedence over the environment variable: the
    // app that compiled its own frontend in is not looking for one on disk, and
    // a stale `$REVIEW_WEB_DIST` left in a shell must not be able to serve a
    // different build of the UI to the desktop app's own port.
    if let Some(assets) = assets {
        log::info!("[server] serving the web bundle embedded in this binary");
        return api_404(api)
            .fallback(move |uri: axum::http::Uri| {
                let assets = std::sync::Arc::clone(&assets);
                async move { embedded_asset(&assets, uri.path()) }
            })
            .layer(cors);
    }

    // The bundle is a *fallback*, so every `/api` route still wins; anything
    // else that isn't a real file falls through to `index.html`, which is what
    // client-side routing needs.
    let app = match std::env::var(WEB_DIST_ENV) {
        Ok(dist) if !dist.is_empty() => {
            log::info!("[server] serving the web bundle from {dist}");
            let index = std::path::Path::new(&dist).join("index.html");
            // `index.html` names this build's hashed assets, so a cached copy
            // pins the whole app to an old deploy. `no-cache` still allows a
            // revalidated 304 — it is "ask first", not "never store". Files
            // under the bundle keep the default, since their names change.
            let index = SetResponseHeaderLayer::overriding(
                axum::http::header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache"),
            )
            .layer(ServeFile::new(index));
            api_404(api).fallback_service(ServeDir::new(&dist).fallback(index))
        }
        _ => api,
    };

    app.layer(cors)
}

/// Answer one request out of the embedded bundle, with the SPA fallback.
///
/// A path that names no asset is a client-side route, not a 404 — the router in
/// the page has to be given `index.html` and left to resolve it, which is the
/// same rule `ServeDir::fallback` applies to a directory. A missing index is
/// the one genuine 404 here: it means this binary was built without a frontend.
fn embedded_asset(assets: &AssetSource, path: &str) -> axum::response::Response {
    use axum::response::IntoResponse as _;

    // Hashed asset names change every build, so only `index.html` — which names
    // them — needs holding back from the cache. See the `$REVIEW_WEB_DIST` arm.
    let (asset, cacheable) = match assets(path) {
        Some(asset) => {
            let cacheable = path != "/" && path != "/index.html";
            (Some(asset), cacheable)
        }
        None => (assets("/index.html"), false),
    };

    let Some(asset) = asset else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };

    let mut headers = HeaderMap::new();
    if let Ok(mime) = HeaderValue::from_str(&asset.mime) {
        headers.insert(axum::http::header::CONTENT_TYPE, mime);
    }
    if !cacheable {
        headers.insert(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        );
    }
    (headers, asset.bytes).into_response()
}

/// Whether a request carrying this `Origin` may talk to this server.
///
/// The browser is the only thing that sets `Origin`, and it sets it on every
/// cross-origin request and every WebSocket handshake — so "no Origin" is a CLI,
/// a curl, or a same-origin navigation, all of which are allowed. Everything
/// else has to look like this server's own front end:
///
/// - a loopback origin (the dev server, the app on this machine, any port);
/// - an origin whose host is the `Host` the request was sent to — which covers
///   `tailscale serve`, a LAN bind, and any reverse proxy in front, without
///   this process needing to know its own public name (ports are ignored on
///   both sides, since a proxy routinely rewrites them);
/// - anything explicitly listed in `$REVIEW_ALLOWED_ORIGINS`.
fn origin_allowed(origin: Option<&HeaderValue>, headers: &HeaderMap) -> bool {
    origin_allowed_with(origin, headers, &env_allowed_origins())
}

/// The allow-list as configured. Read through a parameter below so tests never
/// touch the process-global environment.
fn env_allowed_origins() -> String {
    std::env::var(ALLOWED_ORIGINS_ENV).unwrap_or_default()
}

fn origin_allowed_with(origin: Option<&HeaderValue>, headers: &HeaderMap, allowed: &str) -> bool {
    let Some(origin) = origin else {
        return true; // not a browser, or same-origin
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    // An explicit listing wins outright, and is compared as the whole origin
    // string (scheme and port included) — this is the one place a human said
    // "this exact site".
    if allowed
        .split(',')
        .map(str::trim)
        .any(|entry| !entry.is_empty() && entry.eq_ignore_ascii_case(origin))
    {
        return true;
    }

    let Some(host) = origin_host(origin) else {
        return false; // `null`, or something that is not an origin at all
    };

    if is_loopback(&host) {
        return true;
    }

    headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .and_then(authority_host)
        .is_some_and(|target| target == host)
}

/// The host of an origin (`http://example.com:8080` → `example.com`), lowercased
/// and with any IPv6 brackets stripped. `None` for anything that is not
/// `scheme://authority`.
fn origin_host(origin: &str) -> Option<String> {
    let (_scheme, rest) = origin.split_once("://")?;
    // An origin has no path, but a stray one must not smuggle a host past this.
    let authority = rest.split(['/', '?', '#']).next()?;
    authority_host(authority)
}

/// The host part of an authority: `host`, `host:port`, `[v6]`, or `[v6]:port`.
fn authority_host(authority: &str) -> Option<String> {
    let authority = authority.trim();
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split_once(']').map(|(host, _port)| host)?
    } else {
        authority.split(':').next()?
    };
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// Loopback by name or by address — `localhost`, `127.0.0.0/8`, `::1`.
fn is_loopback(host: &str) -> bool {
    host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Start the HTTP server on the given port.
///
/// The bind address is `$REVIEW_BIND` (default `127.0.0.1`), so serving a
/// tailnet or a LAN needs an environment variable rather than a code change.
pub async fn serve(port: u16) {
    let app = build_router();

    let target = bind_target(&bind_host(), port);
    let listener = tokio::net::TcpListener::bind(&target)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {target}: {e}"));
    axum::serve(listener, app)
        .with_graceful_shutdown(crate::signal::shutdown_signal())
        .await
        .expect("Server error");
}

/// Take the port, so a host process can fail *before* it claims to be serving.
///
/// Split from [`serve_on`] because "is this port free" is the one question a
/// settings toggle actually has to answer synchronously: a port already held —
/// by a `review-server` left over from a dev session, or a second copy of the
/// app — must switch the toggle back off with the reason on it. Bundled into
/// the serving future, that error would surface some indeterminate time after
/// the UI had already drawn itself as on.
///
/// **Loopback only, deliberately.** `tailscale serve` proxies *from* the tailnet
/// *to* a local address, and tailscaled runs on this machine — so `127.0.0.1`
/// is everything it needs, and every other interface is pure exposure. This
/// server hands out a machine's terminals and working tree; on `0.0.0.0` anyone
/// on the coffee-shop wifi could take them, and the origin gate would not stop
/// them, because that gate answers a *browser* question and a plain HTTP client
/// simply sends no `Origin` at all.
///
/// `$REVIEW_BIND` is not read here either. It is `review-server`'s escape hatch
/// for someone deliberately running a server; reaching the app from a phone is
/// what the toggle is for, and it grants exactly that and nothing wider.
pub async fn bind(port: u16) -> std::io::Result<tokio::net::TcpListener> {
    tokio::net::TcpListener::bind(bind_target("127.0.0.1", port)).await
}

/// Serve the app on an already-bound listener, until told to stop.
///
/// What `review-server`'s [`serve`] does, minus the two things that only make
/// sense for a process whose whole job this is: it returns its error instead of
/// panicking, and it stops on the caller's signal rather than on SIGINT — a
/// host process gets its own Ctrl-C.
pub async fn serve_on(
    listener: tokio::net::TcpListener,
    assets: AssetSource,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    if let Ok(local) = listener.local_addr() {
        log::info!("[server] hosting the app on http://{local}");
    }
    axum::serve(listener, build_router_with(Some(assets)))
        .with_graceful_shutdown(shutdown)
        .await
}

/// The address to bind: `$REVIEW_BIND`, or loopback.
pub fn bind_host() -> String {
    match std::env::var("REVIEW_BIND") {
        Ok(host) if !host.trim().is_empty() => host.trim().to_owned(),
        _ => "127.0.0.1".to_owned(),
    }
}

/// `host` and `port` as one address to bind — and, since the two agree, as the
/// URL to print.
///
/// A bare IPv6 literal needs brackets before a port can be appended to it, so
/// anything that parses as an address is formatted by [`SocketAddr`] rather than
/// by hand; a name (or a bracketed literal already) is passed through for the
/// resolver to deal with.
pub fn bind_target(host: &str, port: u16) -> String {
    match host.parse::<IpAddr>() {
        Ok(ip) => SocketAddr::new(ip, port).to_string(),
        Err(_) => format!("{host}:{port}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(value: &str) -> HeaderValue {
        HeaderValue::from_str(value).unwrap()
    }

    fn hosted(host: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(axum::http::header::HOST, origin(host));
        headers
    }

    // ----- The embedded bundle -----

    /// A bundle holding exactly an index and one hashed asset.
    fn bundle() -> AssetSource {
        std::sync::Arc::new(|path: &str| match path {
            "/index.html" => Some(StaticAsset {
                bytes: b"<!doctype html>".to_vec(),
                mime: "text/html".to_owned(),
            }),
            "/assets/app-abc123.js" => Some(StaticAsset {
                bytes: b"console.log(1)".to_vec(),
                mime: "text/javascript".to_owned(),
            }),
            _ => None,
        })
    }

    fn header(response: &axum::response::Response, name: axum::http::HeaderName) -> Option<String> {
        Some(response.headers().get(name)?.to_str().ok()?.to_owned())
    }

    #[test]
    fn a_real_asset_is_served_with_its_own_type() {
        let response = embedded_asset(&bundle(), "/assets/app-abc123.js");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header(&response, axum::http::header::CONTENT_TYPE).as_deref(),
            Some("text/javascript")
        );
    }

    /// The whole point of the fallback: `/dropseed/review/review/master` is a
    /// route in the page, not a missing file, and answering 404 would break
    /// every deep link and every cold start of the installed app.
    #[test]
    fn an_unknown_path_falls_back_to_the_index() {
        let response = embedded_asset(&bundle(), "/dropseed/review/review/master");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header(&response, axum::http::header::CONTENT_TYPE).as_deref(),
            Some("text/html")
        );
    }

    /// `index.html` names this build's hashed assets, so a cached copy pins the
    /// whole app to an old build — including when it was reached as a fallback.
    #[test]
    fn the_index_is_never_cached_however_it_was_reached() {
        for path in ["/", "/index.html", "/some/client/route"] {
            assert_eq!(
                header(
                    &embedded_asset(&bundle(), path),
                    axum::http::header::CACHE_CONTROL
                )
                .as_deref(),
                Some("no-cache"),
                "{path} should not be cached"
            );
        }
    }

    /// Hashed names are new files rather than new versions, so they may be kept.
    #[test]
    fn a_hashed_asset_keeps_the_default_caching() {
        let response = embedded_asset(&bundle(), "/assets/app-abc123.js");
        assert_eq!(
            header(&response, axum::http::header::CACHE_CONTROL),
            None,
            "a content-hashed asset should not be marked no-cache"
        );
    }

    /// A binary built with no frontend has nothing to fall back *to*, and must
    /// say so rather than loop.
    #[test]
    fn a_bundle_with_no_index_is_a_genuine_404() {
        let empty: AssetSource = std::sync::Arc::new(|_| None);
        assert_eq!(
            embedded_asset(&empty, "/anything").status(),
            StatusCode::NOT_FOUND
        );
    }

    /// The CLI, curl, and a same-origin navigation send no `Origin` at all.
    /// Denying those would break every non-browser caller to stop an attack no
    /// browser can mount without setting the header.
    #[test]
    fn a_missing_origin_is_allowed() {
        assert!(origin_allowed_with(None, &HeaderMap::new(), ""));
    }

    /// The dev server, the packaged app, and any port either picks.
    #[test]
    fn loopback_origins_are_allowed_on_any_port() {
        for value in [
            "http://localhost:1420",
            "http://localhost",
            "http://127.0.0.1:3421",
            "http://127.0.0.1:9999",
            "https://[::1]:8443",
            "http://[::1]",
        ] {
            assert!(
                origin_allowed_with(Some(&origin(value)), &hosted("example.test"), ""),
                "{value} should be allowed"
            );
        }
    }

    /// `tailscale serve` terminates TLS on 443 and forwards to some other port,
    /// so the origin's port and the `Host`'s routinely differ. The host is what
    /// has to match.
    #[test]
    fn an_origin_matching_the_host_header_is_allowed_whatever_the_ports() {
        assert!(origin_allowed_with(
            Some(&origin("https://box.tailnet.ts.net")),
            &hosted("box.tailnet.ts.net:3421"),
            ""
        ));
        assert!(origin_allowed_with(
            Some(&origin("http://192.168.1.20:3421")),
            &hosted("192.168.1.20"),
            ""
        ));
        // Case is not part of a host's identity.
        assert!(origin_allowed_with(
            Some(&origin("https://Box.Tailnet.TS.net")),
            &hosted("box.tailnet.ts.net"),
            ""
        ));
    }

    /// The whole point: a page on some other site gets nothing, even though the
    /// user's browser will happily send the request.
    #[test]
    fn a_foreign_origin_is_denied() {
        for value in [
            "https://evil.example",
            "http://evil.example:3421",
            // Not this server, however much of its name it borrows.
            "https://localhost.evil.example",
            "https://box.tailnet.ts.net.evil.example",
            // A sandboxed iframe or a `file://` page.
            "null",
        ] {
            assert!(
                !origin_allowed_with(Some(&origin(value)), &hosted("box.tailnet.ts.net"), ""),
                "{value} should be denied"
            );
        }
    }

    /// The escape hatch, matched as a whole origin rather than by host — the
    /// human named a site, not a name to accept over any scheme.
    #[test]
    fn a_listed_origin_is_allowed() {
        let allowed = "https://review.example.com, http://other.example:8080";
        assert!(origin_allowed_with(
            Some(&origin("https://review.example.com")),
            &hosted("127.0.0.1:3421"),
            allowed
        ));
        assert!(origin_allowed_with(
            Some(&origin("http://other.example:8080")),
            &hosted("127.0.0.1:3421"),
            allowed
        ));
        // A different port is a different origin.
        assert!(!origin_allowed_with(
            Some(&origin("http://other.example:9090")),
            &hosted("127.0.0.1:3421"),
            allowed
        ));
        // An empty setting must not become "allow everything".
        assert!(!origin_allowed_with(
            Some(&origin("https://evil.example")),
            &hosted("127.0.0.1:3421"),
            ",, ,"
        ));
    }

    /// A bare IPv6 literal cannot have `:port` appended to it — that was a
    /// panic on `REVIEW_BIND=::` before this was formatted through `SocketAddr`.
    #[test]
    fn bind_targets_bracket_ipv6_literals() {
        assert_eq!(bind_target("127.0.0.1", 3421), "127.0.0.1:3421");
        assert_eq!(bind_target("::1", 3421), "[::1]:3421");
        assert_eq!(bind_target("::", 3421), "[::]:3421");
        // Names are the resolver's problem, not this function's.
        assert_eq!(bind_target("localhost", 3421), "localhost:3421");
    }
}

#[cfg(test)]
mod router_tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt as _;

    use super::*;

    /// With the bundle mounted, an unknown `/api` path is a 404 — while a real
    /// one still routes, and a client-side route still gets `index.html`.
    #[tokio::test]
    async fn unknown_api_paths_404_without_shadowing_real_routes() {
        let dist = tempfile::TempDir::new().unwrap();
        std::fs::write(dist.path().join("index.html"), "<!doctype html>spa").unwrap();
        std::env::set_var(WEB_DIST_ENV, dist.path());
        let app = build_router();
        std::env::remove_var(WEB_DIST_ENV);

        let get = |path: &str| {
            let app = app.clone();
            let request = Request::builder()
                .uri(path.to_owned())
                .body(Body::empty())
                .unwrap();
            async move { app.oneshot(request).await.unwrap() }
        };

        assert_eq!(get("/api/nope").await.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            get("/api/terminal/does-not-exist").await.status(),
            StatusCode::NOT_FOUND
        );

        // A real API route is a POST; the wildcard must not have eaten it.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/terminal/available")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Client-side routing still lands on the SPA, and that HTML is not
        // cached by heuristic.
        let response = get("/some/deep/link").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(axum::http::header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-cache")
        );
    }
}
