/**
 * Review's service worker — the minimum a PWA install needs, and nothing more.
 *
 * There is deliberately NO asset caching. The app is a window onto a local
 * `review-server` (git state, terminals, the work queue); with the server gone
 * it has nothing to show, so a cache would only buy the chance to serve stale
 * JS against a newer backend. Everything but a failed navigation goes to the
 * network untouched.
 */

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review is offline</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0c0a09; color: #d6d3d1;
        font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { display: flex; flex-direction: column; align-items: center;
        justify-content: center; height: 100%; padding: 0 2rem; text-align: center; }
      h1 { font-size: 1.125rem; font-weight: 600; color: #fafaf9; margin: 0 0 0.5rem; }
      p { margin: 0; color: #a8a29e; max-width: 26rem; }
      button { margin-top: 1.5rem; padding: 0.5rem 1rem; border-radius: 0.375rem;
        border: 1px solid #44403c; background: #1c1917; color: #fafaf9; font: inherit; }
    </style>
  </head>
  <body>
    <main>
      <h1>Review needs its server</h1>
      <p>This app talks to a <code>review-server</code> on your machine. Reconnect to
        the network it is served on, then try again.</p>
      <button onclick="location.reload()">Retry</button>
    </main>
  </body>
</html>
`;

self.addEventListener("install", () => {
  // No precache to wait on — take over as soon as the new worker lands.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Only navigations are handled; every other request keeps the browser's own
  // default network path (returning without calling respondWith).
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }),
    ),
  );
});
