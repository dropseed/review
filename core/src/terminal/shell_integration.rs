//! zsh shell-integration injection via `ZDOTDIR`.
//!
//! To make OSC 133 marks appear, we point a spawned zsh at a Review-owned
//! `ZDOTDIR` under `~/.review/terminal/zdotdir/`. zsh reads our `.zshenv` and
//! `.zshrc` from there; our `.zshrc` sources the user's real config, installs
//! precmd/preexec hooks that emit OSC 133, then restores `ZDOTDIR` to the user's
//! directory so nested shells load the user's config rather than ours.
//!
//! Only zsh is supported; other shells fall back to the poller
//! ([`super::poll`]). [`injection_env`] returns the environment additions for a
//! zsh shell (and `None` otherwise); [`super::session`] applies them at spawn.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::review::central::get_central_root;

/// The auto-generated `.zshrc` that runs at shell startup. It sources the user's
/// real config and installs the OSC 133 hooks. See the module docs for why the
/// `ZDOTDIR` restore happens here and not in `.zshenv`.
const ZSHRC: &str = r#"# review terminal shell integration — auto-generated, do not edit.
#
# Review points ZDOTDIR at this directory so this file runs at shell startup.
# We load the user's real interactive config, install OSC 133 hooks so Review can
# track command start/end and exit codes, then restore ZDOTDIR to the user's
# directory so any nested shells load the user's config instead of this one.

# Where the user's real zsh config lives (Review passes this through; default HOME).
REVIEW_ZDOTDIR="${REVIEW_ZDOTDIR:-$HOME}"

# Point ZDOTDIR back at the user's config dir. Safe to change now: this .zshrc is
# already being read, so it won't cause zsh to re-resolve the startup files.
export ZDOTDIR="$REVIEW_ZDOTDIR"

# Load the user's real interactive config.
if [[ -f "$REVIEW_ZDOTDIR/.zshrc" ]]; then
  source "$REVIEW_ZDOTDIR/.zshrc"
fi

# Install the OSC 133 hooks exactly once (idempotent even if .zshrc is re-sourced).
if [[ "$REVIEW_TERMINAL_INTEGRATION" == "1" && -z "$__REVIEW_HOOKS_INSTALLED" ]]; then
  __REVIEW_HOOKS_INSTALLED=1
  autoload -Uz add-zsh-hook

  __review_precmd() {
    local __review_exit=$?
    # D: the previous command finished (report its exit code) — must come first.
    printf '\033]133;D;%s\a' "$__review_exit"
    # A: a new prompt begins.
    printf '\033]133;A\a'
    # OSC 7: report the working directory as file://<host><path>.
    printf '\033]7;file://%s%s\a' "${HOST}" "${PWD}"
  }
  __review_preexec() {
    # C: a command is about to run.
    printf '\033]133;C\a'
  }

  add-zsh-hook precmd __review_precmd
  add-zsh-hook preexec __review_preexec
fi
"#;

/// The auto-generated `.zshenv`. zsh reads this first for EVERY zsh process. It
/// must NOT change `ZDOTDIR` (that would make zsh look for the top-level `.zshrc`
/// in the wrong place and skip our integration); it only forwards to the user's
/// real `.zshenv`. `ZDOTDIR` is restored at the end of our `.zshrc`.
const ZSHENV: &str = r#"# review terminal shell integration — auto-generated, do not edit.
#
# .zshenv runs for EVERY zsh process (including nested, non-interactive shells).
# Do NOT change ZDOTDIR here: zsh resolves the top-level .zshrc from ZDOTDIR
# after this file, so changing it now would skip Review's integration .zshrc.
# We only source the user's real .zshenv so their environment is set up normally.
# Review's .zshrc restores ZDOTDIR to the user's directory at the end of startup.
REVIEW_ZDOTDIR="${REVIEW_ZDOTDIR:-$HOME}"
if [[ -f "$REVIEW_ZDOTDIR/.zshenv" ]]; then
  source "$REVIEW_ZDOTDIR/.zshenv"
fi
"#;

/// The Review-owned `ZDOTDIR` directory (`~/.review/terminal/zdotdir/`).
fn zdotdir_path() -> Result<PathBuf> {
    Ok(get_central_root()?.join("terminal").join("zdotdir"))
}

/// Materialize the integration `ZDOTDIR` on disk, returning its path.
///
/// Writes `.zshrc` and `.zshenv` (overwriting any prior copies so updates to the
/// embedded content propagate). Cheap enough to run on every spawn.
fn materialize_zdotdir() -> Result<PathBuf> {
    let dir = zdotdir_path()?;
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(".zshrc"), ZSHRC)?;
    std::fs::write(dir.join(".zshenv"), ZSHENV)?;
    Ok(dir)
}

/// Whether `shell`'s basename is zsh.
fn is_zsh(shell: &Path) -> bool {
    shell
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| name == "zsh")
}

/// Environment additions that enable OSC 133 shell integration for a zsh shell.
///
/// Returns `None` for non-zsh shells (they degrade to poller-only status).
/// The returned pairs are layered onto the child's environment at spawn:
/// - `ZDOTDIR` → Review's integration directory (so our `.zshrc` runs)
/// - `REVIEW_ZDOTDIR` → the user's original `ZDOTDIR` (or `$HOME`), so our config
///   can source theirs and restore it for nested shells
/// - `REVIEW_TERMINAL_INTEGRATION=1` → the guard our `.zshrc` checks
pub fn injection_env(shell: &Path) -> Option<Vec<(String, String)>> {
    if !is_zsh(shell) {
        return None;
    }
    let zdotdir = materialize_zdotdir().ok()?;

    let mut env = vec![
        ("ZDOTDIR".to_owned(), zdotdir.to_string_lossy().into_owned()),
        ("REVIEW_TERMINAL_INTEGRATION".to_owned(), "1".to_owned()),
    ];

    // Preserve the user's original config dir so our .zshrc can source it and
    // restore ZDOTDIR for nested shells. Fall back to $HOME.
    let original = std::env::var("ZDOTDIR")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOME").ok());
    if let Some(original) = original {
        env.push(("REVIEW_ZDOTDIR".to_owned(), original));
    }

    Some(env)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::ENV_LOCK;
    use tempfile::TempDir;

    #[test]
    fn injection_env_is_some_for_zsh_and_none_otherwise() {
        let _lock = ENV_LOCK.lock().unwrap();
        let review_home = TempDir::new().unwrap();
        std::env::set_var("REVIEW_HOME", review_home.path());

        let zsh = injection_env(Path::new("/bin/zsh")).expect("zsh should inject");
        let keys: Vec<&str> = zsh.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"ZDOTDIR"));
        assert!(zsh
            .iter()
            .any(|(k, v)| k == "REVIEW_TERMINAL_INTEGRATION" && v == "1"));

        assert!(injection_env(Path::new("/bin/bash")).is_none());
        assert!(injection_env(Path::new("/usr/bin/fish")).is_none());

        std::env::remove_var("REVIEW_HOME");
    }

    #[test]
    fn generated_zshrc_has_osc133_marks_and_guard() {
        let _lock = ENV_LOCK.lock().unwrap();
        let review_home = TempDir::new().unwrap();
        std::env::set_var("REVIEW_HOME", review_home.path());

        let dir = materialize_zdotdir().unwrap();
        let zshrc = std::fs::read_to_string(dir.join(".zshrc")).unwrap();
        assert!(zshrc.contains("133;D"), "missing command-end mark");
        assert!(zshrc.contains("133;A"), "missing prompt-start mark");
        assert!(zshrc.contains("133;C"), "missing command-start mark");
        assert!(
            zshrc.contains("REVIEW_TERMINAL_INTEGRATION"),
            "missing idempotency guard"
        );

        assert!(dir.join(".zshenv").exists(), ".zshenv should be written");

        std::env::remove_var("REVIEW_HOME");
    }
}
