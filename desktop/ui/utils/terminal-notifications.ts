// OS notifications for terminals that need you.
// Singleton module -- driven from the status stream, so no React hooks.

import { getPlatformServices } from "../platform";
import type { TerminalStatus } from "../types";

let enabled = true;
let permission: "unknown" | "granted" | "denied" = "unknown";

export function setTerminalNotificationsEnabled(value: boolean): void {
  enabled = value;
}

/** Ask once. A denial is remembered so a busy repo can't re-prompt per event. */
async function permitted(): Promise<boolean> {
  if (permission !== "unknown") return permission === "granted";
  const { notifications } = getPlatformServices();
  const granted =
    (await notifications.isEnabled()) ||
    (await notifications.requestPermission());
  permission = granted ? "granted" : "denied";
  return granted;
}

const CLAIM_KEY = "review:terminal-attention";
const CLAIM_LIMIT = 64;

/**
 * Every window runs this module against the same unfiltered status stream, so
 * two open repo windows would each fire for the same session. A spell is the
 * session plus the moment it started, and a window that finds it already
 * recorded stays quiet. Storage is shared per origin, which is what makes this
 * work at all.
 *
 * Best-effort: the read and the write are separate, so two windows that reach
 * this at the same moment can both see an unclaimed spell and both notify. A
 * duplicate notification is the failure mode worth accepting here — the
 * alternative is a lock, for a banner.
 */
function claimSpell(status: TerminalStatus): boolean {
  // The message is part of the spell: a session that asks a *different*
  // question mid-spell is a second interruption, not a republish of the first.
  const spell = `${status.id}:${status.enteredStateAt}:${status.attentionMessage ?? ""}`;
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    const claimed = raw ? (JSON.parse(raw) as string[]) : [];
    if (claimed.includes(spell)) return false;
    const next = [...claimed, spell].slice(-CLAIM_LIMIT);
    localStorage.setItem(CLAIM_KEY, JSON.stringify(next));
    return true;
  } catch {
    // No storage, or an entry we didn't write -- notifying twice beats not at
    // all, since the whole point is that nobody is looking at the window.
    return true;
  }
}

/**
 * Fire a notification when a session crosses *into* needs_attention while the
 * app is in the background.
 *
 * `prev` is the status the store held before this one. Its absence means the
 * session arrived already needing attention -- a hydration snapshot rather than
 * something that happened while you were away -- and is deliberately silent.
 * Testing the edge rather than the state is also the dedupe: a session
 * sitting in needs_attention re-publishes its status as its command and cwd
 * change, and none of those are a second thing to interrupt you for. The one
 * mid-spell republish that IS a second thing is a changed attention message
 * -- "task finished" arriving after "approve this edit?" -- so that passes.
 */
export function notifyTerminalAttention(
  prev: TerminalStatus | undefined,
  next: TerminalStatus,
): void {
  if (!enabled) return;
  if (next.phase !== "needs_attention") return;
  if (!prev) return;
  const crossed = prev.phase !== "needs_attention";
  const messageChanged =
    !crossed &&
    next.attentionMessage != null &&
    prev.attentionMessage !== next.attentionMessage;
  if (!crossed && !messageChanged) return;
  if (document.hasFocus()) return;
  if (!claimSpell(next)) return;

  const title = next.title || next.runningCommand || "Terminal";
  const body = next.attentionMessage ?? "Needs your attention";
  void permitted()
    .then((ok) => {
      if (ok) return getPlatformServices().notifications.show(title, body);
    })
    .catch((err) => {
      console.warn("[terminal] Notification failed:", err);
    });
}
