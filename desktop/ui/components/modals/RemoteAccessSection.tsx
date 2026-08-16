import { type ReactNode, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../api";
import { getPlatformServices } from "../../platform";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";

/**
 * Where the user's choice is persisted.
 *
 * Written from here rather than from the Rust command that acts on it, because
 * `settings.json` belongs to the storage service below: it holds the whole
 * document in memory and rewrites it wholesale on any preference change, so a
 * value written behind its back survives only until the next theme tweak. The
 * backend reads this key at launch and never writes it.
 */
const SETTING_KEY = "tailnetServeEnabled";

/** The shape `remote_access_status` returns. Mirrors `RemoteAccessState`. */
interface RemoteAccess {
  enabled: boolean;
  serving: boolean;
  port: number;
  url: string | null;
  httpsAdminUrl: string;
  tailnet: {
    cliFound: boolean;
    online: boolean;
    dnsName: string | null;
    httpsEnabled: boolean;
    serving: string | null;
    problem: string | null;
  };
}

/**
 * Remote access: put this app on the tailnet, so a phone can open it.
 *
 * One switch over two things that are useless apart — an HTTP server in this
 * process, and a `tailscale serve` config in front of it. The panel reports
 * them separately anyway, because the only interesting states are the ones
 * where they disagree, and "it isn't working" is not a useful thing for a
 * settings panel to say when it knows which half.
 *
 * Everything a person might have to go fix lives outside this app — signing
 * in to Tailscale, enabling HTTPS certificates for the tailnet — so the panel's
 * job when it can't proceed is to name that thing precisely and, where there is
 * a page for it, offer the link. It never tries to do those itself.
 *
 * Desktop only, and not for lack of porting: in web mode this *is* the served
 * app, so the switch would be offering to start the server the page is already
 * being delivered by.
 */
export function RemoteAccessSection(): ReactNode {
  const [state, setState] = useState<RemoteAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    // Guarded rather than relying on the early return below: an effect is
    // registered even by a render that returns null, so in web mode this would
    // otherwise `invoke` into a bridge that isn't there on every mount.
    if (!isTauriEnvironment()) return;
    try {
      setState(await invoke<RemoteAccess>("remote_access_status"));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isTauriEnvironment()) return null;

  async function toggle(on: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<RemoteAccess>(
        on ? "remote_access_enable" : "remote_access_disable",
      );
      // Only after the command succeeded: the flag means "restore this at
      // launch", and there is nothing to restore if turning it on just failed.
      await getPlatformServices().storage.set(SETTING_KEY, on);
      setState({ ...next, enabled: on });
    } catch (e) {
      setError(String(e));
      // The command reports the state it *reached*, not the one it was asked
      // for — a failed enable leaves the server stopped — so re-read rather
      // than assume the switch stayed where the click put it.
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const tailnet = state?.tailnet;
  const blocked = blockedReason(tailnet);

  const on = state?.enabled ?? false;

  return (
    <div className="px-5 py-4">
      <SectionHeader />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-xs text-fg-secondary">Serve on my tailnet</span>
          <p className="mt-1.5 text-xxs text-fg-faint leading-relaxed">
            Runs Review's web server on this Mac and puts Tailscale in front of
            it, so you can open it — or install it as an app — on any device
            signed in to your tailnet. Nothing is exposed to the internet.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {busy && (
            <Spinner className="h-3 w-3 border-[1.5px] border-edge-default border-t-fg-muted" />
          )}
          <Switch
            checked={on}
            // `state === null` disables it too: with no answer yet there is
            // nothing to say the flip would work, and `blocked` is deliberately
            // silent during the probe rather than guessing a reason.
            disabled={busy || state === null || (blocked !== null && !on)}
            onCheckedChange={(next) => void toggle(next)}
            aria-label="Serve on my tailnet"
          />
        </div>
      </div>

      {blocked && !on && (
        <div className="mt-3 rounded-lg bg-surface-raised/30 px-3 py-2.5">
          <p className="text-xxs text-fg-muted leading-relaxed">{blocked}</p>
          {tailnet?.cliFound && tailnet.online && !tailnet.httpsEnabled && (
            <button
              type="button"
              onClick={() =>
                getPlatformServices().opener.openUrl(
                  state?.httpsAdminUrl ??
                    "https://login.tailscale.com/admin/dns",
                )
              }
              className="mt-1.5 text-xxs text-guide hover:underline"
            >
              Open the Tailscale admin console
            </button>
          )}
        </div>
      )}

      {on && state && (
        <div className="mt-3 rounded-lg bg-surface-raised/30 px-3 py-2.5">
          {state.url ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(state.url!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="block w-full truncate text-left text-xs text-fg-secondary hover:text-fg"
              title="Copy"
            >
              {state.url}
            </button>
          ) : (
            <span className="text-xs text-fg-muted">
              Waiting for a tailnet name…
            </span>
          )}
          <p className="mt-0.5 text-xxs text-fg-faint">
            {copied
              ? "Copied"
              : "Open this on your phone, then Add to Home Screen."}
          </p>

          <div className="mt-2 space-y-1 border-t border-t-edge/40 pt-2">
            <StatusLine
              ok={state.serving}
              label={
                state.serving
                  ? `Web server running on port ${state.port}`
                  : "Web server is not running"
              }
            />
            <StatusLine
              ok={tailnet?.serving != null}
              label={
                tailnet?.serving != null
                  ? "Tailscale Serve configured"
                  : "Tailscale Serve is not configured"
              }
            />
          </div>

          {/* The one thing about this switch that isn't obvious: the Tailscale
              half outlives the app, so quitting doesn't take the URL down —
              only turning this off does. Said here rather than left to be
              discovered when a phone hits a 502 after a reboot. */}
          <p className="mt-2 text-xxs text-fg-faint leading-relaxed">
            The Tailscale setting persists across restarts. Review's server
            starts again with the app; turn this off to remove both.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xxs text-status-rejected leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Why the switch can't be flipped, or null when it can.
 *
 * Guard clauses in priority order rather than a nested ternary: the order is
 * the only interesting thing here — a signed-out node has no useful answer
 * about certificates — and nesting buried it.
 *
 * `undefined` is not a reason. It is the first probe still running, and the
 * first condition below would read it as "Tailscale isn't installed"; nothing
 * is asserted until there is an answer.
 */
function blockedReason(
  tailnet: RemoteAccess["tailnet"] | undefined,
): string | null {
  if (!tailnet) return null;
  if (!tailnet.cliFound) return "Tailscale isn't installed on this Mac.";
  if (tailnet.problem) return tailnet.problem;
  if (!tailnet.online) {
    return "Tailscale isn't connected. Sign in to Tailscale and reopen this panel.";
  }
  if (!tailnet.httpsEnabled) {
    return "This tailnet doesn't have HTTPS certificates enabled, which is what lets a phone install Review as an app.";
  }
  return null;
}

function StatusLine({ ok, label }: { ok: boolean; label: string }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          ok ? "bg-status-approved" : "bg-fg-faint"
        }`}
      />
      <span className="text-xxs text-fg-muted">{label}</span>
    </div>
  );
}

/** Antenna: the section is about this machine being reachable. */
function SectionHeader(): ReactNode {
  return (
    <div className="mb-3 flex items-center gap-2">
      <svg
        className="h-4 w-4 text-fg-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 13a9 9 0 0 1 14 0" />
        <path d="M8.5 16.5a5 5 0 0 1 7 0" />
        <circle cx="12" cy="20" r="1" />
      </svg>
      <span className="text-xs font-medium text-fg-secondary">
        Remote access
      </span>
    </div>
  );
}
