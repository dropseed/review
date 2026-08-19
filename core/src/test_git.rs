//! Shared git fixture for this crate's tests.
//!
//! Five test modules used to define their own `fn git(dir, args)`. Three
//! carried the environment block below and two did not, so a developer with
//! `commit.gpgsign` or a forced signing key in their global config saw two of
//! the five suites fail while the rest passed. CI never noticed, because CI's
//! git config is empty.

use std::path::Path;
use std::process::Command;

/// Run git in `dir`, isolated from the developer's global and system config,
/// and assert it succeeded.
///
/// The identity is pinned because a machine without `user.email` set cannot
/// commit at all, and the config files are pointed at `/dev/null` because a
/// machine *with* opinions — signed commits, a default branch name, a
/// `core.hooksPath` — would otherwise leak them into the fixture.
pub fn git(dir: &Path, args: &[&str]) {
    let out = command(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Like [`git`], but returns trimmed stdout — for `rev-parse` and friends.
pub fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = command(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

fn command(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("running git")
}
