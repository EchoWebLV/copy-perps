// public/sw.js — gwak.gg service worker
//
// Task 12: push notification handlers (minimal — no offline caching yet).
// Task 13 will extend this file with full offline caching / precache logic.
// DO NOT REMOVE these push handlers when extending in Task 13.

self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : {};
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
