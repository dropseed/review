//! zsh shell-integration injection via `ZDOTDIR`.
//!
//! To make OSC 133 marks appear, we point a spawned zsh at a Review-owned
//! `ZDOTDIR` under `~/.spur/terminal/zdotdir/`. zsh reads our `.zshenv` and
//! `.zshrc` from there; our `.zshrc` sources the user's real config, installs
//! precmd/preexec hooks that emit OSC 133, then restores `ZDOTDIR` to the user's
//! directory so nested shells load the user's config rather than ours.
//!
//! Only zsh is supported; other shells fall back to the poller
//! ([`super::poll`]). [`injection_env`] returns the environment additions for a
//! zsh shell (and `None` otherwise); [`super::session`] applies them at spawn.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::home::get_central_root;

/// The auto-generated `.zshrc` that runs at shell startup. It sources the user's
/// real config and installs the OSC 133 hooks. See the module docs for why the
/// `ZDOTDIR` restore happens here and not in `.zshenv`.
const ZSHRC: &str = r#"# Spur terminal shell integration — auto-generated, do not edit.
#
# Review points ZDOTDIR at this directory so this file runs at shell startup.
# We load the user's real interactive config, install OSC 133 hooks so Review can
# track command start/end and exit codes, then restore ZDOTDIR to the user's
# directory so any nested shells load the user's config instead of this one.

# Where the user's real zsh config lives (Review passes this through; default HOME).
SPUR_ZDOTDIR="${SPUR_ZDOTDIR:-$HOME}"

# Point ZDOTDIR back at the user's config dir. Safe to change now: this .zshrc is
# already being read, so it won't cause zsh to re-resolve the startup files.
export ZDOTDIR="$SPUR_ZDOTDIR"

# Load the user's real interactive config.
if [[ -f "$SPUR_ZDOTDIR/.zshrc" ]]; then
  source "$SPUR_ZDOTDIR/.zshrc"
fi

# Install the OSC 133 hooks exactly once (idempotent even if .zshrc is re-sourced).
if [[ "$SPUR_TERMINAL_INTEGRATION" == "1" && -z "$__SPUR_HOOKS_INSTALLED" ]]; then
  __SPUR_HOOKS_INSTALLED=1
  autoload -Uz add-zsh-hook

  # A dedicated write descriptor on the tty, close-on-exec so children never
  # inherit it. Marks go here rather than to stdout: `cmd > file` would
  # otherwise capture them into the file and Spur would see no marks at all.
  # If anything here fails we fall back to fd 1, which is merely the old
  # behaviour rather than a broken shell.
  zmodload -F zsh/system b:sysopen 2>/dev/null
  if ! { [[ -n "$TTY" ]] && sysopen -o cloexec -wu __spur_fd -- "$TTY" 2>/dev/null }; then
    __spur_fd=1
  fi

  # Every hook runs under `emulate -L zsh -o no_aliases` and prefixes builtins
  # with `builtin`, so a user alias or function named `print`/`local` cannot
  # break the marks. The options are function-local and restored on return.
  __spur_emit() {
    builtin emulate -L zsh -o no_aliases
    builtin print -nu $__spur_fd -- "$1"
  }

  # OSC 7: the working directory, as file://<host><path>.
  __spur_report_cwd() {
    __spur_emit $'\e]7;file://'"${HOST}${PWD}"$'\a'
  }

  # C: a command is about to run.
  __spur_preexec() {
    __spur_emit $'\e]133;C\a'
  }

  __spur_precmd() {
    # $? first — anything else clobbers it.
    builtin local __spur_exit=$?
    builtin emulate -L zsh -o no_aliases

    # D: the previous command finished, with its exit code.
    __spur_emit $'\e]133;D;'"$__spur_exit"$'\a'
    __spur_report_cwd

    # The A/B marks live inside PS1 rather than being printed here, because a
    # printed mark is a one-time event while the prompt is redisplayed many
    # times — on reset-prompt, on SIGCHLD, and above all on SIGWINCH. Review
    # resizes panes constantly (split drags, sidebar collapse), and a printed
    # mark would leave the prompt on screen with its marks scrolled away, so
    # the session would look like it was still running a command forever.
    #
    # This needs prompt_percent for %{...%} to be understood; without it we
    # print the marks once and accept the staleness.
    if [[ ! -o prompt_percent ]]; then
      __spur_emit $'\e]133;A\a'
      return
    fi

    # Marks only survive if we are the last precmd hook — a later hook that
    # rebuilds PS1 would drop them. If we are not last, move ourselves there
    # and try again on the next prompt.
    if [[ ${precmd_functions[-1]} != __spur_precmd ]]; then
      precmd_functions=(${precmd_functions:#__spur_precmd} __spur_precmd)
      __spur_emit $'\e]133;A\a'
      return
    fi

    # Start from a clean PS1. If PS1 still matches what we last marked, strip
    # back to the saved original; if a theme has since rewritten it, keep the
    # theme's version and re-mark that. Handing a marked PS1 back to other
    # hooks breaks themes (Pure, and anything that pattern-matches its own
    # prompt to rebuild it).
    if [[ -n ${__spur_saved_ps1+x} && $PS1 == $__spur_marked_ps1 ]]; then
      PS1=$__spur_saved_ps1
      PS2=$__spur_saved_ps2
    fi
    __spur_saved_ps1=$PS1
    __spur_saved_ps2=$PS2

    # A trailing bare '%' would pair with the '{' of the mark we append and be
    # read as the '%{' prompt escape, swallowing the mark and printing a stray
    # '{'. Doubling it makes it the literal '%' it was meant to be.
    [[ $PS1 == % || $PS1 == *[^%]% ]] && PS1=$PS1%
    [[ $PS2 == % || $PS2 == *[^%]% ]] && PS2=$PS2%

    # A opens the prompt, B closes it: the span between them is what the user
    # is typing, which is how "prompt is up, idle" is told apart from "a
    # command is running". k=s marks continuation lines as secondary prompts,
    # so multi-line and PS2 prompts aren't mistaken for command output.
    PS1=$'%{\e]133;A\a%}'"${PS1}"$'%{\e]133;B\a%}'
    PS1=${PS1//$'\n'/$'\n'$'%{\e]133;P;k=s\a%}'}
    PS2=$'%{\e]133;P;k=s\a%}'"${PS2}"$'%{\e]133;B\a%}'

    __spur_marked_ps1=$PS1
  }

  add-zsh-hook precmd __spur_precmd
  add-zsh-hook preexec __spur_preexec
  # `cd foo && slow-thing` changes directory before the command runs, so
  # without this the reported cwd stays stale for that command's whole life.
  add-zsh-hook chpwd __spur_report_cwd
fi
"#;

/// The auto-generated `.zshenv`. zsh reads this first for EVERY zsh process. It
/// must NOT change `ZDOTDIR` (that would make zsh look for the top-level `.zshrc`
/// in the wrong place and skip our integration); it only forwards to the user's
/// real `.zshenv`. `ZDOTDIR` is restored at the end of our `.zshrc`.
const ZSHENV: &str = r#"# Spur terminal shell integration — auto-generated, do not edit.
#
# .zshenv runs for EVERY zsh process (including nested, non-interactive shells).
# Do NOT change ZDOTDIR here: zsh resolves the top-level .zshrc from ZDOTDIR
# after this file, so changing it now would skip Spur's integration .zshrc.
# We only source the user's real .zshenv so their environment is set up normally.
# Spur's .zshrc restores ZDOTDIR to the user's directory at the end of startup.
SPUR_ZDOTDIR="${SPUR_ZDOTDIR:-$HOME}"
if [[ -f "$SPUR_ZDOTDIR/.zshenv" ]]; then
  source "$SPUR_ZDOTDIR/.zshenv"
fi
"#;

/// The Spur-owned `ZDOTDIR` directory (`~/.spur/terminal/zdotdir/`).
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
/// - `ZDOTDIR` → Spur's integration directory (so our `.zshrc` runs)
/// - `SPUR_ZDOTDIR` → the user's original `ZDOTDIR` (or `$HOME`), so our config
///   can source theirs and restore it for nested shells
/// - `SPUR_TERMINAL_INTEGRATION=1` → the guard our `.zshrc` checks
pub fn injection_env(shell: &Path) -> Option<Vec<(String, String)>> {
    if !is_zsh(shell) {
        return None;
    }
    let zdotdir = materialize_zdotdir().ok()?;

    let mut env = vec![
        ("ZDOTDIR".to_owned(), zdotdir.to_string_lossy().into_owned()),
        ("SPUR_TERMINAL_INTEGRATION".to_owned(), "1".to_owned()),
    ];

    // Preserve the user's original config dir so our .zshrc can source it and
    // restore ZDOTDIR for nested shells. Fall back to $HOME.
    let original = std::env::var("ZDOTDIR")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOME").ok());
    if let Some(original) = original {
        env.push(("SPUR_ZDOTDIR".to_owned(), original));
    }

    Some(env)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::home::tests::ENV_LOCK;
    use tempfile::TempDir;

    #[test]
    fn injection_env_is_some_for_zsh_and_none_otherwise() {
        let _lock = ENV_LOCK.lock().unwrap();
        let spur_home = TempDir::new().unwrap();
        std::env::set_var("SPUR_HOME", spur_home.path());

        let zsh = injection_env(Path::new("/bin/zsh")).expect("zsh should inject");
        let keys: Vec<&str> = zsh.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"ZDOTDIR"));
        assert!(zsh
            .iter()
            .any(|(k, v)| k == "SPUR_TERMINAL_INTEGRATION" && v == "1"));

        assert!(injection_env(Path::new("/bin/bash")).is_none());
        assert!(injection_env(Path::new("/usr/bin/fish")).is_none());

        std::env::remove_var("SPUR_HOME");
    }

    /// Prompt marks must survive a redraw — see the rationale in `ZSHRC`. This
    /// is the only test that can tell a printed mark from a `PS1`-carried one.
    ///
    /// Skips itself when there is no zsh to drive.
    #[test]
    fn prompt_marks_survive_a_resize() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;
        use std::sync::{Arc, Mutex};
        use std::time::{Duration, Instant};

        let shell = Path::new("/bin/zsh");
        if !shell.exists() {
            return;
        }

        let env = {
            let _lock = ENV_LOCK.lock().unwrap();
            let spur_home = TempDir::new().unwrap();
            std::env::set_var("SPUR_HOME", spur_home.path());
            let env = injection_env(shell).expect("zsh should inject");
            std::env::remove_var("SPUR_HOME");
            // Keep the temp dir alive past the lock: the shell reads the
            // generated .zshrc out of it after we spawn.
            std::mem::forget(spur_home);
            env
        };

        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-i");
        for (key, value) in env {
            cmd.env(key, value);
        }
        // Point the integration at a config dir that does not exist, so the
        // test exercises our marks rather than whatever is in the developer's
        // own zshrc.
        cmd.env("SPUR_ZDOTDIR", "/nonexistent-review-test");
        cmd.env("TERM", "xterm-256color");
        cmd.env("PS1", "prompt> ");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn zsh");

        let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
        let mut reader = pair.master.try_clone_reader().expect("reader");
        {
            let seen = Arc::clone(&seen);
            std::thread::spawn(move || {
                let mut chunk = [0u8; 4096];
                while let Ok(n) = reader.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    seen.lock().unwrap().extend_from_slice(&chunk[..n]);
                }
            });
        }

        let wait_for = |needle: &[u8], budget: Duration| -> bool {
            let deadline = Instant::now() + budget;
            while Instant::now() < deadline {
                if seen
                    .lock()
                    .unwrap()
                    .windows(needle.len())
                    .any(|w| w == needle)
                {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        };

        assert!(
            wait_for(b"\x1b]133;A", Duration::from_secs(10)),
            "no prompt-start mark at startup; shell integration never ran"
        );

        // Forget everything seen so far, so the assertion below can only be
        // satisfied by marks emitted *after* the resize.
        seen.lock().unwrap().clear();

        pair.master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize");

        let redrawn = wait_for(b"\x1b]133;A", Duration::from_secs(5))
            && wait_for(b"\x1b]133;B", Duration::from_secs(5));

        let _ = child.kill();
        let _ = child.wait();

        assert!(
            redrawn,
            "the prompt marks did not come back after a resize — they are \
             being printed once instead of carried in PS1, so every pane \
             resize leaves the session's phase stuck"
        );
    }

    #[test]
    fn generated_zshrc_has_osc133_marks_and_guard() {
        let _lock = ENV_LOCK.lock().unwrap();
        let spur_home = TempDir::new().unwrap();
        std::env::set_var("SPUR_HOME", spur_home.path());

        let dir = materialize_zdotdir().unwrap();
        let zshrc = std::fs::read_to_string(dir.join(".zshrc")).unwrap();
        assert!(zshrc.contains("133;D"), "missing command-end mark");
        assert!(zshrc.contains("133;A"), "missing prompt-start mark");
        assert!(zshrc.contains("133;B"), "missing prompt-end mark");
        assert!(zshrc.contains("133;C"), "missing command-start mark");
        assert!(
            zshrc.contains("chpwd"),
            "cwd is only reported from precmd, so `cd x && slow` reports the \
             old directory for that command's whole life"
        );
        assert!(
            zshrc.contains("cloexec"),
            "marks go to stdout, so a command redirecting stdout swallows them"
        );
        assert!(
            zshrc.contains("SPUR_TERMINAL_INTEGRATION"),
            "missing idempotency guard"
        );

        assert!(dir.join(".zshenv").exists(), ".zshenv should be written");

        std::env::remove_var("SPUR_HOME");
    }
}
