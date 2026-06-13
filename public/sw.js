// public/sw.js — gwak.gg service worker
//
// Task 12: push notification handlers.
// Task 13: offline fallback (navigation-only, no asset caching).
//
// Caching philosophy: DO NOT cache Next.js build assets, JS, CSS, or HTML pages.
// Only /offline.html is precached. Everything else hits the network directly.

const CACHE_NAME = "gwak-v1";
const OFFLINE_URL = "/offline.html";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Fetch — navigation-only offline fallback
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (e) => {
  // Only intercept full-page navigations. Let all other requests
  // (JS, CSS, images, API calls) pass through to the network untouched.
  if (e.request.mode !== "navigate") return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(OFFLINE_URL)),
  );
});

// ---------------------------------------------------------------------------
// Push notifications (Task 12 — preserved verbatim)
// ---------------------------------------------------------------------------

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (_) {
    // Malformed or empty push body — fall back to defaults.
  }
  e.waitUntil(
    self.registration.showNotification(data.title ?? "gwak.gg", {
      body: data.body ?? "",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url ?? "/portfolio" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data?.url ?? "/portfolio"),
  );
});
