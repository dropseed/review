//! The `review-daemon` binary: owns terminal PTYs so they survive the app.

use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    env_logger::init();

    let socket = match review::daemon::socket_path() {
        Ok(socket) => socket,
        Err(e) => {
            eprintln!("review-daemon: could not resolve the review home: {e}");
            return ExitCode::FAILURE;
        }
    };

    println!("review-daemon listening on {}", socket.display());
    if let Err(e) = review::daemon::serve(socket).await {
        eprintln!("review-daemon: {e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
