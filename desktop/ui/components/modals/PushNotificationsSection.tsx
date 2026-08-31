import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import {
  getCurrentSubscription,
  isPushReady,
  isPushSupported,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "../../utils/push-subscription";

/**
 * Push notifications, for the device reading this over the tailnet.
 *
 * The other half of "Terminal notifications" one section up: that switch tells
 * you on the machine the terminals are running on, this one tells you on the
 * machine you are carrying. The desktop app is the sender either way — this
 * page only hands it an endpoint to reach — which is why nothing here appears
 * in the desktop app itself.
 *
 * Permission is a state to report, never an error to raise: a denied prompt is
 * a decision the user made, and the only useful response is to say where it can
 * be undone.
 */
export function PushNotificationsSection(): ReactNode {
  const [ready, setReady] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) return;
    setReady(await isPushReady());
    setSubscribed((await getCurrentSubscription()) !== null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isPushSupported()) return null;

  async function toggle(on: boolean): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      if (!on) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else if (await subscribeToPush()) {
        setSubscribed(true);
      } else {
        setNote(
          Notification.permission === "denied"
            ? "This browser is blocking notifications for Spur. Allow them in its site settings, then try again."
            : "Notifications weren't allowed, so nothing is subscribed.",
        );
      }
    } catch (e) {
      setNote(String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    setNote(null);
    try {
      const report = await sendTestPush();
      // The report, not a cheerful constant: a push service refusing every
      // endpoint looks exactly like success from here otherwise.
      if (report.sent === 0) {
        setNote(
          report.pruned > 0
            ? "Nothing sent — the push service reports every subscription here is dead. Toggle off and on to resubscribe."
            : `Nothing sent${report.failed > 0 ? ` (${report.failed} failed)` : ""}. Check the Mac's network and try again.`,
        );
      } else {
        const failures = report.failed > 0 ? `, ${report.failed} failed` : "";
        setNote(
          `Sent to ${report.sent} device${report.sent === 1 ? "" : "s"}${failures}.`,
        );
      }
    } catch (e) {
      setNote(String(e));
    }
  }

  return (
    <div className="px-5 py-4">
      <SectionHeader />

      {ready === false ? (
        <p className="text-xxs text-fg-faint leading-relaxed">
          {import.meta.env.DEV
            ? "Not available in dev mode — the service worker that receives pushes is only registered in production builds."
            : "This browser hasn't registered Spur's service worker. Reload the page and reopen this panel."}
        </p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs text-fg-secondary">
                Push notifications on this device
              </span>
              <p className="mt-1.5 text-xxs text-fg-faint leading-relaxed">
                When a terminal stops and waits and nobody answers on the Mac
                running it, that Mac pushes here. Tapping the notification opens
                the workspace it came from.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {busy && (
                <Spinner className="h-3 w-3 border-[1.5px] border-edge-default border-t-fg-muted" />
              )}
              <Switch
                checked={subscribed}
                disabled={busy || ready === null}
                onCheckedChange={(next) => void toggle(next)}
                aria-label="Push notifications on this device"
              />
            </div>
          </div>

          {subscribed && (
            <button
              type="button"
              onClick={() => void test()}
              className="mt-2 text-xxs text-guide hover:underline"
            >
              Send a test notification
            </button>
          )}
        </>
      )}

      {note && (
        <p className="mt-2 text-xxs text-fg-muted leading-relaxed">{note}</p>
      )}
    </div>
  );
}

/** Bell: the section is about being told something, elsewhere. */
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
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <span className="text-xs font-medium text-fg-secondary">
        Notifications
      </span>
    </div>
  );
}
