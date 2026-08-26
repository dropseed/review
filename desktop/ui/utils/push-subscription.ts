// Web push, from this browser's side: subscribe with the server's VAPID key,
// and hand the resulting endpoint back so the desktop app can reach it.

import { isTauriEnvironment } from "../api/client";

/**
 * Whether this browser can be pushed to at all.
 *
 * Tauri is excluded first, and not for lack of support: the desktop app *is*
 * the sender, and a machine subscribing to its own pushes would be told about
 * terminals it is already showing.
 */
export function isPushSupported(): boolean {
  return (
    !isTauriEnvironment() &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * The worker, or null when there isn't one.
 *
 * `navigator.serviceWorker.ready` never rejects — it waits forever for a
 * registration that a dev build deliberately never makes (see
 * `register-sw.ts`) — so the registration is asked for first and the wait is
 * only entered once something is known to be registering.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) return null;
  return navigator.serviceWorker.ready;
}

/** This device's subscription, if it already has one. */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Whether a service worker is registered — false in dev, where none is. */
export async function isPushReady(): Promise<boolean> {
  return (await registration()) !== null;
}

/**
 * Subscribe this device and register the endpoint with the server.
 *
 * Must be called from a user gesture: Safari grants notification permission
 * only inside one, and a prompt raised from a mount would be denied before the
 * user knew what was asking.
 *
 * Resolves to whether it worked; a denied permission is a normal answer here,
 * not an error, because the caller's job is to explain it rather than throw it.
 */
export async function subscribeToPush(): Promise<boolean> {
  const reg = await registration();
  if (!reg) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const { publicKey } = await post<{ publicKey: string }>(
    "/api/push/public-key",
    {},
  );
  const options = {
    // Required by Chrome, and the honest description of what this is used for:
    // every push here ends in a visible notification.
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(publicKey),
  };
  let subscription: PushSubscription;
  try {
    subscription = await reg.pushManager.subscribe(options);
  } catch (err) {
    // InvalidStateError means a subscription under a *different* server key
    // already exists — the server's VAPID state was reset since this device
    // subscribed. The old subscription is unreachable by the new key, so
    // replacing it is the only way back.
    if (!(err instanceof DOMException && err.name === "InvalidStateError"))
      throw err;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    subscription = await reg.pushManager.subscribe(options);
  }

  const json = subscription.toJSON();
  try {
    await post("/api/push/subscribe", {
      subscription: {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      },
      userAgent: navigator.userAgent,
    });
  } catch (err) {
    // The server never heard about this endpoint, so a subscription kept
    // locally would show the toggle on while nothing ever arrives. Roll it
    // back and let the error reach the caller.
    await subscription.unsubscribe().catch(() => {});
    throw err;
  }
  return true;
}

/**
 * Unsubscribe this device.
 *
 * The server is told first: an endpoint dropped locally but left on the server
 * keeps being pushed to until the push service rejects it, whereas a server
 * entry removed for a subscription that then fails to cancel is merely inert.
 */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  await post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/** What a test push actually did, so the UI can say so instead of "Sent." */
export interface SendReport {
  subscriptions: number;
  sent: number;
  failed: number;
  pruned: number;
}

/** Ask the server to push to every subscribed device, this one included. */
export async function sendTestPush(): Promise<SendReport> {
  return post<SendReport>("/api/push/test", {});
}

/**
 * Base64url (as VAPID keys are published) to the bytes `subscribe` wants.
 *
 * Built on an explicit `ArrayBuffer` rather than `Uint8Array.from`: the latter
 * is typed over `ArrayBufferLike`, which `BufferSource` does not accept.
 */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
