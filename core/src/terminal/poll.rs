//! Foreground-process poller — the status fallback when a session has no OSC 133
//! shell integration, and the source of `running_command` for every session.
//!
//! One shared thread ticks every 500ms. For each live session it reads the PTY's
//! foreground process group and compares it to the shell's own process group:
//! equal means the shell is at a prompt ([`Phase::WaitingForInput`]), otherwise a
//! command is running ([`Phase::Working`]). The command names for all running
//! foreground groups are resolved with a **single** `ps` per tick and reported
//! as `running_command` regardless of whether shell integration is active. A
//! session only publishes when something actually changed (see
//! [`super::status::StatusScanner::on_poll`]).
//!
//! No `unsafe`: portable-pty's [`MasterPty::process_group_leader`] performs the
//! `tcgetpgrp` internally, so we never touch a raw fd here.
//!
//! [`Phase::WaitingForInput`]: super::Phase::WaitingForInput
//! [`Phase::Working`]: super::Phase::Working
//! [`MasterPty::process_group_leader`]: portable_pty::MasterPty::process_group_leader

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use super::session::Session;
use super::TerminalId;

/// How often the poller samples every session's foreground process group.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Granularity of the interruptible sleep between ticks, so shutdown is prompt.
const SLEEP_SLICE: Duration = Duration::from_millis(50);

/// The shared foreground-process poller thread.
pub struct Poller {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Poller {
    /// Start the poller over the manager's live session map.
    pub fn start(sessions: Arc<Mutex<HashMap<TerminalId, Arc<Session>>>>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let handle = std::thread::Builder::new()
            .name("terminal-poller".to_owned())
            .spawn(move || run(&sessions, &thread_stop))
            .expect("failed to spawn terminal poller thread");
        Self {
            stop,
            handle: Some(handle),
        }
    }

    /// Signal the poller to stop and join its thread.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// The poller loop: sleep a tick, then sample every live session.
fn run(sessions: &Mutex<HashMap<TerminalId, Arc<Session>>>, stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        sleep_interruptible(POLL_INTERVAL, stop);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        // Under one lock pass: pull exited sessions OUT of the map to reap, and
        // snapshot the live ones to poll (so we don't hold the lock while polling
        // or tearing down). Reaping here is what frees a naturally-exited
        // session's threads and buffers — `kill()` handles the explicit path.
        let (reaped, live): (Vec<Arc<Session>>, Vec<Arc<Session>>) = {
            let mut map = sessions.lock().unwrap();
            let mut reaped = Vec::new();
            let mut live = Vec::new();
            map.retain(|_, session| {
                if session.has_exited() {
                    reaped.push(Arc::clone(session));
                    false
                } else {
                    live.push(Arc::clone(session));
                    true
                }
            });
            (reaped, live)
        };
        // Join each reaped session's (already-finished) reader thread and shut
        // down its VT thread. `kill()` is idempotent, so racing an explicit kill
        // is harmless.
        for session in reaped {
            let _ = session.kill();
        }

        // Read each session's foreground pgid and whether it's at a prompt. A
        // missing pgid means the master is gone (killed) — skip; the poller
        // drops it next tick via `has_exited`.
        let observations: Vec<(Arc<Session>, i32, bool)> = live
            .into_iter()
            .filter_map(|session| {
                let foreground = session.foreground_pgid()?;
                let at_prompt = session.shell_pid() == Some(foreground);
                Some((session, foreground, at_prompt))
            })
            .collect();

        // Resolve command names for every running (not-at-prompt) group in one
        // `ps`, then fold each observation into its session's status.
        let running_pgids: Vec<i32> = observations
            .iter()
            .filter(|(_, _, at_prompt)| !at_prompt)
            .map(|(_, foreground, _)| *foreground)
            .collect();
        let names = command_names(&running_pgids);

        for (session, foreground, at_prompt) in observations {
            // At a prompt there is no running command; otherwise use the resolved
            // name, falling back to `None` when `ps` didn't report it.
            let command = if at_prompt {
                None
            } else {
                names.get(&foreground).cloned()
            };
            session.apply_poll(at_prompt, command);
        }
    }
}

/// Sleep for `total`, waking early (within [`SLEEP_SLICE`]) if `stop` is set.
fn sleep_interruptible(total: Duration, stop: &AtomicBool) {
    let mut elapsed = Duration::ZERO;
    while elapsed < total {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let slice = SLEEP_SLICE.min(total.saturating_sub(elapsed));
        std::thread::sleep(slice);
        elapsed += slice;
    }
}

/// Resolve command names for a batch of process group leaders in a single `ps`,
/// mapping each pgid to its executable basename (e.g. `/usr/bin/sleep` →
/// `sleep`). Pgids `ps` doesn't report are simply absent from the map, so the
/// caller falls back to `None` for them.
#[cfg(unix)]
fn command_names(pgids: &[i32]) -> HashMap<i32, String> {
    let mut names = HashMap::new();
    if pgids.is_empty() {
        return names;
    }
    let list = pgids
        .iter()
        .map(i32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let output = match std::process::Command::new("ps")
        .args(["-o", "pid=,comm=", "-p", &list])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return names,
    };
    // Each line is `<pid> <comm>`; split off the pid, then basename the rest.
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let line = line.trim();
        let Some((pid, comm)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let Ok(pid) = pid.trim().parse::<i32>() else {
            continue;
        };
        let comm = comm.trim();
        if comm.is_empty() {
            continue;
        }
        let name = std::path::Path::new(comm)
            .file_name()
            .map_or_else(|| comm.to_owned(), |n| n.to_string_lossy().into_owned());
        names.insert(pid, name);
    }
    names
}

/// Non-Unix fallback: no foreground-process resolution.
#[cfg(not(unix))]
fn command_names(_pgids: &[i32]) -> HashMap<i32, String> {
    HashMap::new()
}
