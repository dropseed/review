// Telling the desktop app that a workspace is waiting on a person, so it can
// escalate to a phone when nobody answers here.

import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../api/client";

/**
 * A terminal in `workspaceId` stopped and is waiting.
 *
 * Desktop only, and not for lack of porting: the escalation this opens ends in
 * a web push sent *by* this machine, so a browser tab reporting it would be
 * asking the app to notify the device already looking at it. The signal is
 * pending until acknowledged — see `ackAttention` — and the backend decides how
 * long "nobody answered" takes.
 *
 * Fire-and-forget: an attention signal that fails to send must not take a
 * status update down with it.
 */
export function signalAttention(
  workspaceId: string,
  title: string,
  body: string,
): void {
  if (!isTauriEnvironment()) return;
  invoke("notify_attention", { workspaceId, title, body }).catch((err) => {
    console.warn("[attention] Failed to signal:", err);
  });
}

/** Someone looked. Cancels whatever `signalAttention` left pending. */
export function ackAttention(workspaceId: string): void {
  if (!isTauriEnvironment()) return;
  invoke("notify_ack", { workspaceId }).catch((err) => {
    console.warn("[attention] Failed to acknowledge:", err);
  });
}

/**
 * Publish the unanswered-workspace count to the OS — the dock badge, or the
 * PWA's own app badge on a phone.
 *
 * Both halves are best-effort and neither is supported everywhere: `setAppBadge`
 * needs an installed PWA on most browsers, and a badge nobody can draw is not
 * worth reporting as an error.
 */
export function publishBadgeCount(count: number): void {
  if (isTauriEnvironment()) {
    invoke("set_dock_badge", { count }).catch((err) => {
      console.warn("[attention] Failed to set the dock badge:", err);
    });
    return;
  }
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
  const badge = navigator as Navigator & {
    setAppBadge: (count?: number) => Promise<void>;
    clearAppBadge: () => Promise<void>;
  };
  const done = count > 0 ? badge.setAppBadge(count) : badge.clearAppBadge();
  done.catch(() => {});
}
