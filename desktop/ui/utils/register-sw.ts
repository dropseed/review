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
 * The worker precaches this build's app shell so a Home-Screen launch paints
 * without waiting on the network — see `public/sw.js`, and the
 * `review-precache-manifest` plugin in `vite.config.ts` that fills its list in.
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
    // Unregistering leaves the caches behind, and a precached `index.html`
    // outlives the worker that put it there — on the same origin as the dev
    // server, that is a production shell waiting to be served to a hot reload.
    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((names) =>
          names
            .filter((name) => name.startsWith("spur-shell-"))
            .forEach((name) => void caches.delete(name)),
        )
        .catch(() => {});
    }
    return;
  }

  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("[sw] Service worker registration failed:", err);
  });
}
