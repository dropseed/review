import { isTauriEnvironment } from "../api/client";

/**
 * Register the PWA service worker (web mode only).
 *
 * Three environments must NOT get one:
 * - Tauri, where the app is already installed and a worker only adds a second
 *   cache layer between the webview and its local assets;
 * - the Vite dev server, where a worker outlives the page and can serve a
 *   stale answer against hot-reloaded code;
 * - browsers without `serviceWorker` (the app still works, just isn't installable).
 *
 * The worker itself caches nothing — see `public/sw.js`.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  if (isTauriEnvironment()) return;

  if (!import.meta.env.PROD) {
    // A worker registered by a production build on the same origin (localhost
    // is one origin across ports for storage, but not for SW scope — still,
    // a previous `vite preview` on this port leaves one behind) would keep
    // answering in dev. Clear it rather than debug it later.
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => registrations.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }

  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("[sw] Service worker registration failed:", err);
  });
}
