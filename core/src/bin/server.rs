#[tokio::main]
async fn main() {
    env_logger::init();
    spur::home::migrate_legacy_home();
    let port = std::env::var("SPUR_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(spur::server::DEFAULT_PORT);
    // `$SPUR_BIND` (default loopback) is what makes one process serveable on a
    // tailnet or a LAN without a code change; print what it actually resolved to
    // so the printed URL is the one that works — `bind_target` is the same
    // formatting the listener binds, brackets on an IPv6 literal included.
    let target = spur::server::bind_target(&spur::server::bind_host(), port);
    println!("spur-server listening on http://{target}");
    spur::server::serve(port).await;
}
