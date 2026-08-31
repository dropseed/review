//! The `spur-daemon` binary: owns terminal PTYs so they survive the app.

use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    env_logger::init();

    spur::home::migrate_legacy_home();

    let socket = match spur::daemon::socket_path() {
        Ok(socket) => socket,
        Err(e) => {
            eprintln!("spur-daemon: could not resolve the review home: {e}");
            return ExitCode::FAILURE;
        }
    };

    println!("spur-daemon listening on {}", socket.display());
    if let Err(e) = spur::daemon::serve(socket).await {
        eprintln!("spur-daemon: {e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
