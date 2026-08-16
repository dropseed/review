//! Talking to the local Tailscale node, so the app can put itself on the
//! tailnet without the user driving a terminal.
//!
//! Everything here shells out to the `tailscale` CLI, which is the only stable
//! interface to a running `tailscaled` — the Go client package is not something
//! a Rust process can link, and the local API socket is explicitly not a public
//! contract. Three questions get asked: what is this node called, can it serve
//! HTTPS, and what is it serving right now.
//!
//! **The serve config is not ours and not this process's.** `tailscale serve`
//! writes into tailscaled's own persistent state, which survives reboots and
//! outlives the app entirely. That is exactly why the toggle is worth having —
//! it is configured once, not started on every launch — and also why disabling
//! it has to be a deliberate act rather than something that happens when the
//! app quits.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use serde::Serialize;

/// Where the CLI lives when `PATH` can't be trusted.
///
/// A GUI app launched from Finder or the Dock inherits `launchd`'s environment,
/// not a login shell's — so `PATH` is roughly `/usr/bin:/bin:/usr/sbin:/sbin`
/// and every one of these is invisible to a bare `Command::new("tailscale")`.
/// The app-bundle path is last because it is the fallback that always exists on
/// macOS; the shims ahead of it are what a terminal would have found.
const CANDIDATE_PATHS: &[&str] = &[
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

/// What the app can tell the user about this machine's place on the tailnet.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TailnetStatus {
    /// A `tailscale` CLI this process can actually run.
    pub cli_found: bool,
    /// `tailscaled` is running and this node is logged in.
    pub online: bool,
    /// This node's MagicDNS name, trailing dot stripped — the host a phone
    /// types. Absent when logged out, since the name is issued by the tailnet.
    pub dns_name: Option<String>,
    /// The tailnet has HTTPS certificates enabled, without which `serve`
    /// cannot terminate TLS and the phone cannot install a PWA. This is a
    /// tailnet-wide admin setting, so the app can report it but never fix it.
    pub https_enabled: bool,
    /// The local URL `tailscale serve` is currently proxying to, if any — the
    /// one fact that says whether this machine is already set up.
    pub serving: Option<String>,
    /// Why the above is all false, in a sentence, when something went wrong
    /// rather than merely being switched off.
    pub problem: Option<String>,
}

/// The admin page carrying the HTTPS-certificates switch.
pub const HTTPS_ADMIN_URL: &str = "https://login.tailscale.com/admin/dns";

/// The `tailscale` binary, or `None` if this machine has no reachable one.
///
/// `PATH` is consulted first so an unusual install still wins; the known
/// locations are the fallback for the launchd environment described above.
pub fn cli_path() -> Option<PathBuf> {
    if let Ok(found) = which_on_path("tailscale") {
        return Some(found);
    }
    CANDIDATE_PATHS
        .iter()
        .map(Path::new)
        .find(|path| path.is_file())
        .map(Path::to_path_buf)
}

/// A bare `which`, without taking a dependency for it.
fn which_on_path(name: &str) -> Result<PathBuf> {
    let path = std::env::var_os("PATH").ok_or_else(|| anyhow!("no PATH"))?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| anyhow!("{name} not found on PATH"))
}

/// Everything the settings panel needs, in one probe.
///
/// Never fails: every question here has "no" as a legitimate answer, and a
/// panel that renders an error instead of a switched-off toggle is worse at
/// saying "this machine isn't set up" than the toggle itself is.
pub fn status(port: u16) -> TailnetStatus {
    let Some(cli) = cli_path() else {
        return TailnetStatus::default();
    };

    let mut status = TailnetStatus {
        cli_found: true,
        ..TailnetStatus::default()
    };

    match node_status(&cli) {
        Ok(node) => {
            status.online = node.online;
            status.dns_name = node.dns_name;
            status.https_enabled = node.https_enabled;
        }
        Err(err) => {
            status.problem = Some(err.to_string());
            return status;
        }
    }

    // A serve config that points somewhere else is not ours to report as on:
    // the user may be fronting a different service on this node, and claiming
    // it would make the toggle lie about what turning it off would do.
    status.serving = serve_target(&cli).ok().flatten();
    if status
        .serving
        .as_deref()
        .is_some_and(|target| !targets_port(target, port))
    {
        status.serving = None;
    }

    status
}

/// The https URL a phone would open, once serving is on.
pub fn public_url(dns_name: &str) -> String {
    format!("https://{dns_name}")
}

/// Point `tailscale serve` at this machine's local server, in the background.
///
/// Idempotent by nature — the CLI overwrites the config for the port rather
/// than stacking entries — which is what lets the toggle be re-run without the
/// caller having to reason about what is already there.
pub fn enable(port: u16) -> Result<String> {
    let cli = cli_path().ok_or_else(|| anyhow!("The tailscale command could not be found."))?;
    let node = node_status(&cli)?;

    if !node.online {
        bail!("Tailscale is not connected. Sign in to Tailscale and try again.");
    }
    let dns_name = node
        .dns_name
        .ok_or_else(|| anyhow!("This machine has no tailnet name yet."))?;
    // Checked before running rather than after failing, because the CLI's own
    // error for this is about certificates and the fix is an admin-console
    // setting the user has to be told about by name.
    if !node.https_enabled {
        bail!(
            "This tailnet does not have HTTPS certificates enabled, which Tailscale Serve needs. \
             Turn on HTTPS Certificates in the admin console, then try again."
        );
    }

    let out = run(
        &cli,
        &[
            "serve",
            "--bg",
            "--https=443",
            &format!("http://127.0.0.1:{port}"),
        ],
    )?;
    log::info!("[tailnet] serve configured for :{port} ({})", out.trim());

    Ok(public_url(&dns_name))
}

/// Take this machine's serve config down.
///
/// `serve reset` clears the node's whole serve configuration, not just ours —
/// which is honest for a toggle that set it with one flag, and the reason
/// [`status`] refuses to claim a config pointing at some other port.
pub fn disable() -> Result<()> {
    let cli = cli_path().ok_or_else(|| anyhow!("The tailscale command could not be found."))?;
    run(&cli, &["serve", "reset"])?;
    log::info!("[tailnet] serve config cleared");
    Ok(())
}

/// What this node currently proxies to, read out of `serve status --json`.
///
/// The document is keyed by `host:port` under `Web`, and each entry maps a path
/// to a handler; the only field wanted here is the `Proxy` target, and the
/// first one found is the answer — a node serving several paths is still one
/// answer to "is this machine serving anything of ours".
fn serve_target(cli: &Path) -> Result<Option<String>> {
    let out = run(cli, &["serve", "status", "--json"])?;
    let doc: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::Value::Null);
    let Some(web) = doc.get("Web").and_then(|w| w.as_object()) else {
        return Ok(None); // `{}` — nothing configured
    };
    Ok(web
        .values()
        .filter_map(|entry| entry.get("Handlers")?.as_object())
        .flat_map(|handlers| handlers.values())
        .find_map(|handler| Some(handler.get("Proxy")?.as_str()?.to_owned())))
}

/// Whether a serve target names this port, however it spells the host.
///
/// The CLI normalizes what it was given (`3421` becomes `http://127.0.0.1:3421`),
/// but a config written by hand may say `localhost` or carry a path, so this
/// compares the one component that identifies it.
fn targets_port(target: &str, port: u16) -> bool {
    let suffix = format!(":{port}");
    let authority = target
        .split_once("://")
        .map_or(target, |(_scheme, rest)| rest);
    let authority = authority.split('/').next().unwrap_or(authority);
    authority.ends_with(&suffix)
}

/// The subset of `tailscale status --json` this module reads.
struct NodeStatus {
    online: bool,
    dns_name: Option<String>,
    https_enabled: bool,
}

fn node_status(cli: &Path) -> Result<NodeStatus> {
    let out = run(cli, &["status", "--json"])?;
    let doc: serde_json::Value = serde_json::from_str(&out)?;

    // `BackendState` is the daemon's own word for it. "Running" is the only
    // state in which a name is issued and serve can be configured; "Stopped",
    // "NeedsLogin" and "NoState" all mean the same thing to this app.
    let online = doc.get("BackendState").and_then(|s| s.as_str()) == Some("Running");

    // MagicDNS names are fully qualified with a trailing dot. Everything that
    // consumes this — a URL, an Origin comparison — wants it without.
    let dns_name = doc
        .get("Self")
        .and_then(|s| s.get("DNSName"))
        .and_then(|n| n.as_str())
        .map(|name| name.trim_end_matches('.').to_owned())
        .filter(|name| !name.is_empty());

    // Null until an admin enables HTTPS certificates for the tailnet, and a
    // list of this node's cert names afterwards.
    let https_enabled = doc
        .get("CertDomains")
        .and_then(|d| d.as_array())
        .is_some_and(|domains| !domains.is_empty());

    Ok(NodeStatus {
        online,
        dns_name,
        https_enabled,
    })
}

/// How long any one `tailscale` call gets. `status` answers off a local socket
/// and `serve` contacts the control plane, so this is sized for the slow one —
/// and exists at all because these run inside a Tauri command, where a wedged
/// subprocess is a settings panel that never answers.
const CLI_TIMEOUT: Duration = Duration::from_secs(10);

/// Run the CLI and return stdout, turning a non-zero exit into an error
/// carrying whatever the CLI said — its messages name the fix (sign in, enable
/// certificates) far better than anything invented here would.
fn run(cli: &Path, args: &[&str]) -> Result<String> {
    // `output_with_timeout` rather than `Command::output`, for exactly the
    // reason that helper exists: this talks to a daemon and, for `serve`, to
    // Tailscale's control plane, and a plain `output()` would wait on either of
    // them forever.
    let out = crate::process::output_with_timeout(Command::new(cli).args(args), CLI_TIMEOUT)
        .map_err(|e| anyhow!("Could not run {}: {e}", cli.display()))?
        .ok_or_else(|| anyhow!("tailscale {} timed out", args.join(" ")))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let message = [stderr.trim(), stdout.trim()]
            .into_iter()
            .find(|part| !part.is_empty())
            .unwrap_or("no output")
            .to_owned();
        bail!("tailscale {}: {message}", args.join(" "));
    }

    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_target_is_matched_by_its_port_however_the_host_is_spelled() {
        assert!(targets_port("http://127.0.0.1:7787", 7787));
        assert!(targets_port("http://localhost:7787", 7787));
        assert!(targets_port("127.0.0.1:7787", 7787));
        // A path after the authority must not be read as part of it.
        assert!(targets_port("http://127.0.0.1:7787/", 7787));
    }

    /// The prefix-vs-suffix trap: `:17787` ends with `7787` as text.
    #[test]
    fn a_longer_port_ending_in_the_same_digits_is_not_a_match() {
        assert!(!targets_port("http://127.0.0.1:17787", 7787));
        assert!(!targets_port("http://127.0.0.1:3421", 7787));
    }

    #[test]
    fn a_target_with_no_port_matches_nothing() {
        assert!(!targets_port("http://127.0.0.1", 7787));
    }

    #[test]
    fn the_public_url_is_the_name_as_https() {
        assert_eq!(
            public_url("box.tail1f7517.ts.net"),
            "https://box.tail1f7517.ts.net"
        );
    }
}
