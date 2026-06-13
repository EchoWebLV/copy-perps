import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const swSource = readFileSync(join(root, "public/sw.js"), "utf8");
const offlinePath = join(root, "public/offline.html");

// ---------------------------------------------------------------------------
// public/offline.html
// ---------------------------------------------------------------------------

describe("public/offline.html", () => {
  it("exists", () => {
    expect(existsSync(offlinePath)).toBe(true);
  });

  it("contains the offline copy", () => {
    const html = readFileSync(offlinePath, "utf8");
    expect(html).toContain("You're offline");
    expect(html).toContain("Your positions are safe on-chain");
    expect(html).toContain("reconnect to manage them");
  });

  it("contains the gwak wordmark", () => {
    const html = readFileSync(offlinePath, "utf8");
    expect(html).toContain("gwak");
  });

  it("has a Retry button that calls location.reload()", () => {
    const html = readFileSync(offlinePath, "utf8");
    expect(html).toContain("location.reload()");
    expect(html).toMatch(/<button/);
  });

  it("is self-contained (no external stylesheet or script src)", () => {
    const html = readFileSync(offlinePath, "utf8");
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});

// ---------------------------------------------------------------------------
// public/sw.js — Task 12 handlers preserved
// ---------------------------------------------------------------------------

describe("sw.js — push + notificationclick preserved", () => {
  it("still has the push event listener", () => {
    expect(swSource).toContain('addEventListener("push"');
  });

  it("still has the notificationclick event listener", () => {
    expect(swSource).toContain('addEventListener("notificationclick"');
  });

  it("push handler shows a notification via showNotification", () => {
    expect(swSource).toContain("showNotification");
  });

  it("notificationclick handler closes the notification and opens a window", () => {
    expect(swSource).toContain("e.notification.close()");
    expect(swSource).toContain("clients.openWindow");
  });
});

// ---------------------------------------------------------------------------
// public/sw.js — Task 13: push parse hardened
// ---------------------------------------------------------------------------

describe("sw.js — push parse is try/catch-guarded", () => {
  it("wraps e.data.json() in a try/catch", () => {
    // The try block must surround the json() call
    expect(swSource).toMatch(/try\s*\{[^}]*e\.data[^}]*\.json\(\)/s);
  });

  it("has a catch block to fall back gracefully", () => {
    expect(swSource).toMatch(/catch\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// public/sw.js — Task 13: install precaches ONLY /offline.html
// ---------------------------------------------------------------------------

describe("sw.js — install event", () => {
  it("has an install event listener", () => {
    expect(swSource).toContain('addEventListener("install"');
  });

  it("precaches /offline.html", () => {
    expect(swSource).toContain('"/offline.html"');
  });

  it("calls self.skipWaiting()", () => {
    expect(swSource).toContain("self.skipWaiting()");
  });

  it("does NOT cache any Next.js build assets (/_next/)", () => {
    expect(swSource).not.toContain("/_next/");
  });

  it("does NOT call addAll with multiple assets", () => {
    // addAll would indicate bulk caching of build assets
    expect(swSource).not.toContain(".addAll(");
  });

  it("only adds a single path (/offline.html) in the install handler", () => {
    // Every .add( call in the file must reference /offline.html
    const addCalls = [...swSource.matchAll(/\.add\s*\(/g)];
    expect(addCalls.length).toBeGreaterThan(0);
    // None of the add calls should reference JS/CSS/build assets
    expect(swSource).not.toMatch(/\.add\s*\(\s*["'](?!\/?offline\.html)/);
  });
});

// ---------------------------------------------------------------------------
// public/sw.js — Task 13: activate cleans old caches
// ---------------------------------------------------------------------------

describe("sw.js — activate event", () => {
  it("has an activate event listener", () => {
    expect(swSource).toContain('addEventListener("activate"');
  });

  it("calls self.clients.claim()", () => {
    expect(swSource).toContain("self.clients.claim()");
  });

  it("deletes caches whose key !== CACHE_NAME to clean up old versions", () => {
    expect(swSource).toContain("caches.delete(");
    expect(swSource).toContain("caches.keys()");
  });
});

// ---------------------------------------------------------------------------
// public/sw.js — Task 13: fetch is navigation-only
// ---------------------------------------------------------------------------

describe("sw.js — fetch event is navigation-only", () => {
  it("has a fetch event listener", () => {
    expect(swSource).toContain('addEventListener("fetch"');
  });

  it("gates on request.mode === 'navigate'", () => {
    expect(swSource).toMatch(/request\.mode\s*!==\s*["']navigate["']/);
  });

  it("early-returns (does NOT call respondWith) for non-navigation requests", () => {
    // The early-return guard must come BEFORE respondWith
    const earlyReturnIdx = swSource.indexOf('request.mode !== "navigate"');
    const respondWithIdx = swSource.indexOf("e.respondWith(");
    expect(earlyReturnIdx).toBeGreaterThanOrEqual(0);
    expect(respondWithIdx).toBeGreaterThan(earlyReturnIdx);
  });

  it("falls back to /offline.html on fetch failure", () => {
    expect(swSource).toContain('caches.match(OFFLINE_URL)');
  });

  it("does NOT have a cache-first handler for scripts or styles", () => {
    // No pattern like checking for .js or .css extensions in fetch
    expect(swSource).not.toMatch(/request\.url.*\.(js|css)/);
    // No cache.match before fetch (cache-first pattern)
    const cacheMatchIdx = swSource.indexOf("caches.match(OFFLINE_URL)");
    const fetchIdx = swSource.indexOf("fetch(e.request)");
    // fetch must come before caches.match in the fetch handler
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(cacheMatchIdx).toBeGreaterThan(fetchIdx);
  });
});
