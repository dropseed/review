#[tokio::main]
async fn main() {
    env_logger::init();
    let port = std::env::var("REVIEW_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(review::server::DEFAULT_PORT);
    // `$REVIEW_BIND` (default loopback) is what makes one process serveable on a
    // tailnet or a LAN without a code change; print what it actually resolved to
    // so the printed URL is the one that works — `bind_target` is the same
    // formatting the listener binds, brackets on an IPv6 literal included.
    let target = review::server::bind_target(&review::server::bind_host(), port);
    println!("review-server listening on http://{target}");
    review::server::serve(port).await;
}
