//! Running subprocesses that are not allowed to hang forever.
//!
//! [`Command::output`] waits as long as the child feels like taking. That is
//! fine for `git`, which is local and fails fast, but not for anything that
//! talks to a network: a `gh` stuck on an unreachable host would otherwise wedge
//! the caller for good. Everything here is std-only — no runtime, no new crate.

use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// How often the deadline is checked while the child runs. Small enough that a
/// fast command isn't noticeably delayed, large enough not to spin a core.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Run `cmd` to completion, or kill it once `timeout` elapses.
///
/// `Ok(None)` means the child overran its deadline and was killed. Errors are
/// only the ones spawning can produce (a missing binary, most often).
///
/// The pipes are drained on their own threads: a child that fills its stdout
/// buffer blocks until someone reads it, so polling for exit without reading
/// would deadlock exactly on the large responses worth having a timeout for.
pub fn output_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
) -> std::io::Result<Option<Output>> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || drain(stdout_pipe.as_mut()));
    let stderr_reader = std::thread::spawn(move || drain(stderr_pipe.as_mut()));

    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(Output {
                status,
                stdout: stdout_reader.join().unwrap_or_default(),
                stderr: stderr_reader.join().unwrap_or_default(),
            }));
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            // Killing closes the pipes, so the readers finish on their own.
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Ok(None);
        }

        std::thread::sleep(POLL_INTERVAL);
    }
}

fn drain(pipe: Option<&mut impl Read>) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(pipe) = pipe {
        let _ = pipe.read_to_end(&mut buf);
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_that_finishes_in_time_returns_its_output() {
        let mut cmd = Command::new("echo");
        cmd.arg("hello");
        let output = output_with_timeout(&mut cmd, Duration::from_secs(10))
            .unwrap()
            .expect("echo should not time out");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
    }

    #[test]
    fn a_command_that_overruns_its_deadline_is_killed() {
        let mut cmd = Command::new("sleep");
        cmd.arg("30");
        let started = Instant::now();
        let result = output_with_timeout(&mut cmd, Duration::from_millis(200)).unwrap();
        assert!(
            result.is_none(),
            "a 30s sleep must not report an exit status"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the call should return at its deadline, not at the child's"
        );
    }

    /// Enough output to fill the pipe buffer several times over: this is the
    /// case that deadlocks if the poll loop doesn't drain as it goes.
    #[test]
    fn output_larger_than_the_pipe_buffer_does_not_deadlock() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "yes abcdefghijklmnopqrstuvwxyz | head -n 200000"]);
        let output = output_with_timeout(&mut cmd, Duration::from_secs(30))
            .unwrap()
            .expect("bulk output should not time out");
        assert_eq!(output.stdout.len(), 200_000 * 27);
    }

    #[test]
    fn a_missing_binary_is_an_error_not_a_timeout() {
        let mut cmd = Command::new("review-no-such-binary-anywhere");
        assert!(output_with_timeout(&mut cmd, Duration::from_secs(1)).is_err());
    }
}
