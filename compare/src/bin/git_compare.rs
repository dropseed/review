//! git-compare binary - enables `git compare` as a git subcommand
//!
//! Git automatically finds binaries named `git-*` in PATH and makes them
//! available as subcommands. This binary shares the same implementation
//! as `compare-cli`.

use clap::Parser;
use compare::cli::{run, Cli};

fn main() {
    let cli = Cli::parse();

    if let Err(e) = run(cli) {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}
