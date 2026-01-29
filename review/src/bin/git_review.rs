//! git-review binary - enables `git review` as a git subcommand
//!
//! Git automatically finds binaries named `git-*` in PATH and makes them
//! available as subcommands. This binary shares the same implementation
//! as the `review` CLI.

use clap::Parser;
use review::cli::{run, Cli};

fn main() {
    let cli = Cli::parse();

    if let Err(e) = run(cli) {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}
