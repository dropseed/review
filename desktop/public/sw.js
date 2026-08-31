/**
 * Spur's service worker — the app shell, and web push.
 *
 * The shell is cached; the data never is. This app is a window onto a local
 * `spur-server` (git state, terminals, the work queue), so caching an API
 * answer would only buy the chance to show a stale one. What it does cache is
 * the part that is identical no matter what the server says: `index.html` and
 * this build's hashed JS/CSS. A Home-Screen launch over a tailnet that is slow,
 * asleep, or gone then paints the app immediately and shows its own "can't
 * reach the server" states, instead of holding a white screen for as long as
 * the navigation takes to fail.
 *
 * Staleness is bounded by the two rules that matter:
 *
 * - Hashed assets are immutable, so cache-first can never serve the wrong
 *   bytes for a name.
 * - `index.html` is what names them, so it is network-*first*: a build deployed
 *   while the app was closed wins on any launch that reaches the server. The
 *   cache answers only when the network doesn't, within `NAVIGATION_TIMEOUT_MS`
 *   — the case this exists for.
 *
 * `BUILD_ID` and `PRECACHE` below are rewritten at build time (see the
 * `precache manifest` plugin in `vite.config.ts`); the values here are what a
 * dev server would use, where this worker is never registered at all.
 *
 * The other half of the file is web push, which has nowhere else to live: a
 * push arrives with no page open, so the worker is the only thing around to
 * show the notification and to decide what a tap on it opens.
 */

const BUILD_ID = "dev";
const PRECACHE = [];

/** One cache per build — `activate` deletes every other one. */
const CACHE = `spur-shell-${BUILD_ID}`;

/** The navigation the cache stands in for. */
const SHELL = "/index.html";

/**
 * How long a cold navigation waits for the server before the cached shell
 * answers instead.
 *
 * Long enough that a reachable server on a healthy tailnet always wins (a
 * same-machine or LAN round trip is tens of milliseconds), short enough that a
 * sleeping one is not a white screen. The network response is still taken when
 * it arrives — it refreshes the cache for next launch.
 */
const NAVIGATION_TIMEOUT_MS = 1500;

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Spur is offline</title>
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
      <h1>Spur needs its server</h1>
      <p>This app talks to a <code>spur-server</code> on your machine. Reconnect to
        the network it is served on, then try again.</p>
      <button onclick="location.reload()">Retry</button>
    </main>
  </body>
</html>
`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually rather than `addAll`, which rejects the whole install if
      // any one entry 404s — a shell that is one stale filename short is still
      // worth having, and the missing piece just falls through to the network.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      );
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("spur-shell-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Whether this is one of the immutable, content-hashed files Vite emits.
 *
 * The name carries the hash, so the bytes behind it can never change: serving
 * them from the cache without asking is correct, not a staleness trade. Fonts
 * and lazily-imported chunks land here too, which is why runtime caching is
 * worth having on top of the precache — the second launch has them all.
 */
function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Another origin's business, and the API's answers are never ours to keep.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigateWithShellFallback(event));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else — the manifest, icons, the worker itself — keeps the
  // browser's own network path.
});

/**
 * A navigation: the server if it answers promptly, otherwise this build's
 * cached shell.
 *
 * The network request is never abandoned — losing the race only decides who
 * answers *this* navigation. Whatever it returns still refreshes the cache, so
 * a launch that fell back is followed by one that doesn't.
 */
async function navigateWithShellFallback(event) {
  const cache = await caches.open(CACHE);

  const network = fetch(event.request)
    .then((response) => {
      if (response.ok) void cache.put(SHELL, response.clone());
      return response;
    })
    .catch(() => null);

  const cached = await cache.match(SHELL);
  if (!cached) {
    const response = await network;
    return response ?? offlineResponse();
  }

  // `event.waitUntil`, not a dangling promise: the cache write above has to
  // outlive a navigation the cache answered.
  event.waitUntil(network);

  const raced = await Promise.race([network, timeout(NAVIGATION_TIMEOUT_MS)]);
  return raced ?? cached;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

/** Resolves to `null` after `ms`, so `Promise.race` can read it as "no answer". */
function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

function offlineResponse() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

self.addEventListener("push", (event) => {
  // A push with no readable JSON body still gets shown: `userVisibleOnly`
  // subscriptions owe the browser a notification for every message, and a
  // silent drop is what gets a subscription revoked.
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  const { title, body, url, tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "Spur", {
      body: body || "Something needs your attention.",
      tag,
      icon: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      // `includeUncontrolled`: a tab loaded before this worker took over is
      // still the window the user meant, and opening a second one beside it is
      // the failure mode worth avoiding.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clients[0];
      if (!existing) return self.clients.openWindow(url);

      await existing.focus();
      // The page routes itself, rather than the worker navigating it: a
      // navigation would cold-start the app over a session already running.
      existing.postMessage({ type: "open-workspace", url });
    })(),
  );
});
