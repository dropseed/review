#[tokio::main]
async fn main() {
    env_logger::init();
    let port = std::env::var("REVIEW_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3421);
    // `$REVIEW_BIND` (default loopback) is what makes one process serveable on a
    // tailnet or a LAN without a code change; print what it actually resolved to
    // so the printed URL is the one that works.
    let host = review::server::bind_host();
    println!("review-server listening on http://{host}:{port}");
    review::server::serve(port).await;
}
