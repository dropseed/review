#[tokio::main]
async fn main() {
    env_logger::init();
    let port = std::env::var("REVIEW_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3421);
    println!("review-server listening on http://127.0.0.1:{port}");
    review::server::serve(port).await;
}
