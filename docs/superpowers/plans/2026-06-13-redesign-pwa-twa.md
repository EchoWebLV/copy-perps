# Redesign Port + PWA Hardening + Seeker TWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the approved v9 redesign (one Copy verb, AI-bot treatment, LIVE event tape in the center slot, Traders search, in-app + push notifications) into the production app, harden it as an installable PWA, and package it as a TWA ready for Solana Seeker dApp Store submission.

**Architecture:** Pure UI/language refactor first (no route moves), then IA consolidation on the existing routes, then an additive notification-event pipeline that web push and (later) native push both consume, then PWA service worker, then a Bubblewrap TWA wrapper published via the Solana dApp Store CLI. One web codebase throughout; the TWA loads the hosted app at gwak.gg.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Drizzle + Neon, Privy, `web-push` (VAPID), Bubblewrap CLI, `@solana-mobile/dapp-publishing` CLI.

**Design artifact (source of truth for look/copy/behavior):** [docs/mockups/redesign-mock.html](../../mockups/redesign-mock.html) — open in a browser; <900px = mobile app, ≥900px = desktop. Every label, badge, sheet, and interaction in this plan exists in the mock.

---

## Read these first

- `docs/architecture.md` — current system map (root CLAUDE.md is stale; trust this).
- The mock (path above) — at minimum: Traders tab, the Copy-now sheet, LIVE tape, My copies.
- Repo hard rules: **NEVER run `scripts/reset-*.ts`** (wipes the live paper-bot experiment, no recovery). **DB changes must be additive only** (no ALTER/DROP on existing tables). There is **no lint script** — the gate everywhere is `npm run typecheck && npm test`. `git add` exact paths only, never `-A`. Deploy is **manual `railway up --service perps-arena`** — never assume auto-deploy; `NEXT_PUBLIC_*` vars bake at build time.
- Locked product decisions (do not relitigate): LIVE owns the elevated center nav slot ("TikTok for perps"); no "paper" wording anywhere — bots are styled as AI (purple) instead; copy-sheet stakes are $1/$5/$10/$20/custom; live tape cards carry exactly one primary verb (Copy now), Auto-copy lives on trader cards/profiles.

**Branch setup:** `git checkout -b feat/redesign-pwa` off `main` (main = `49a6c4a` or later).

---

## Phase 1 — Language & honesty pass (labels only, zero structure change)

### Task 1: Nav labels

**Files:**
- Modify: `components/shell/nav-items.ts`
- Modify: `components/shell/BottomNav.tsx` (mobile labels + Pulse center button label)
- Modify: `components/shell/nav-items.test.ts`, `components/shell/mobile-route-contract.test.ts`, `components/shell/route-title-contract.test.ts` (label expectations)

Routes do **not** move (`/feed`, `/trade`, `/chatter`, `/portfolio`, `/deposit` keep their URLs — no redirects, no broken share links). Only labels change:

| href | old label | new label |
|---|---|---|
| `/feed` | Feed | **Traders** |
| `/trade` | Scalp | **Trade** |
| `/chatter` | Pulse | **Live** |
| `/portfolio` | Folio | **Portfolio** |
| `/deposit` | Wallet | Wallet (unchanged) |

- [ ] **Step 1:** Update the label strings in `DESKTOP_NAV_ITEMS` in `components/shell/nav-items.ts` per the table. Keep icons as-is except `/chatter`: keep `Zap`.
- [ ] **Step 2:** Update `BottomNav.tsx` mobile labels to match (search for the literal strings `"Feed"`, `"Scalp"`, `"Pulse"`, `"Folio"`). The elevated center button keeps its mascot/styling; its label becomes `LIVE`.
- [ ] **Step 3:** Run `npm test -- shell` — the three contract tests will fail on old labels. Update their expectations to the new labels. Re-run until green.
- [ ] **Step 4:** Update the page-level titles that echo nav names: `app/(app)/trade/page.tsx` ("Scalp" → "Trade"), `app/(app)/deposit/page.tsx` `railTitle` ("Settings" → "Wallet").
- [ ] **Step 5:** Gate: `npm run typecheck && npm test`. Expected: pass.
- [ ] **Step 6:** Commit: `git commit -m "feat(shell): nav renamed — Traders / Trade / Live / Portfolio (routes unchanged)"`

### Task 2: One copy verb everywhere

**Files:**
- Modify: `components/tail/TailModal.tsx` (whale one-tap flow)
- Modify: `components/copy/CopyModal.tsx` (standing subscription flow)
- Modify: `components/feed/UnifiedFeed.tsx` (card button labels)
- Modify: `components/whales/WhalePulseFeed.tsx` (tape button labels)

Label map (UI strings only; component/file names, API routes, and DB fields keep their names):

| context | old | new |
|---|---|---|
| one-tap mirror button (cards + tape) | `TAIL` / `Tail whale (N)` | `Copy now` |
| standing subscription button | `Copy trader` / `Copy` | `Auto-copy` |
| TailModal heading/CTA | `Tail whale with $X each` / `Copy this position with $X` | `Copy with $X` (single) / `Copy N positions · $X each` (bundle) |
| CopyModal CTA | `Copy` | `Start auto-copy · $X/trade` |
| auto-close checkbox (both modals) | `Auto-close when Source closes` / `Close when Target closes` | `Close when {sourceName} closes` with subtext `We watch the source and exit when they do.` |
| CopyModal success copy | `Copy armed — …next position` | `Auto-copy active: {name}'s every new trade is mirrored with $X until you stop.` |

- [ ] **Step 1:** Apply the label map. Grep guard afterward: `git grep -niE '\btail\b' components/ app/ --untracked | grep -viE 'tailwind|TailModal|tailSource|detail'` — remaining hits must be code identifiers, not rendered strings.
- [ ] **Step 2:** Stake ladder: in both modals the presets must be `$1 / $5 / $10 / $20` + a custom-amount input (see the mock's sheet). If a modal lacks `$1` or custom, add them; custom input clears chip selection and updates the CTA label live.
- [ ] **Step 3:** Entry-gap line in TailModal (binding honesty rule from the arena spec): above the auto-close toggle render `Entry gap: their entry $X → your est. fill $Y (+Z%). You enter at today's price, not theirs.` computed from the position's entry vs current mark (both already in the modal's props — see how the position grid renders entry/mark).
- [ ] **Step 4:** Gate: `npm run typecheck && npm test`. Update any snapshot/contract tests that asserted old strings.
- [ ] **Step 5:** Commit: `git commit -m "feat(copy): one verb — Copy now / Auto-copy, unified auto-close wording, $1–$20+custom ladder, entry-gap disclosure"`

### Task 3: AI-bot visual treatment (purple)

**Files:**
- Modify: `app/globals.css` (tokens)
- Modify: `components/feed/UnifiedFeed.tsx` (bot cards)
- Modify: `components/arena/BotCard.tsx`, `components/arena/ArenaRoster.tsx`, `components/arena/BotProfile.tsx`
- Modify: `components/portfolio/CopyRow.tsx` (source badge — see also Task 7)

- [ ] **Step 1:** Add tokens to the Tailwind v4 `@theme` block in `app/globals.css`:

```css
--color-ai: #b79bff;
--color-ai-dim: #251b40;
```

  > **Decision (shipped):** The CSS `@theme` tokens exist but the codebase convention is JS token constants from `components/v2/ui.tsx` — JS constants are the source of truth. The shared `AiBotBadge` and `RealWalletBadge` components are defined there and consumed across all badge sites.

- [ ] **Step 2:** Bot cards in `UnifiedFeed.tsx` and `BotCard.tsx`: replace the `ON-CHAIN STRATEGY` badge with an `AI BOT` badge (`bg-ai-dim text-ai`), add a subtle purple card border (`border-[#3b2f66]`) and slightly purple-shifted card background, and a 2px purple ring on the bot avatar. Whale cards get a `REAL WALLET` badge (`text-teal` family) — whales otherwise unchanged. Match the mock exactly.
- [ ] **Step 3:** Keep the trust line on bot surfaces: `Strategy runs as an on-chain program — record can't be backfilled.` with the Solscan verify link where it exists today. The word "paper" must not appear anywhere user-visible: `git grep -ni "paper" components/ app/ | grep -v paper_positions` → only code identifiers allowed.
- [ ] **Step 4:** P&L chart parity: whale cards already render a P&L history sparkline (find its data source in `UnifiedFeed.tsx` / the whale card component). Bot cards must render the same chart anatomy under the badges row (the mock's `P&L · 30D` area chart). If no bot equity-history series exists yet (the ER `Bot` account stores stats, not a series), render the chart from the bot's closed-trade history in `fills`/arena projections; if neither exists, ship the card without the chart and add a `bot equity history series` follow-up task to this plan — do not fake a curve.
- [ ] **Step 5:** Gate + commit: `git commit -m "feat(ui): AI-bot purple treatment — badge, card tint, avatar ring; REAL WALLET badge on whales"`

### Task 3b (follow-up): bot equity history series

- [ ] The ER `Bot` account has no equity curve (64-entry tape only); derive a persisted per-bot equity series (e.g., projection from arena fills/closes) so bot cards can render the same P&L chart as whales. Not started.

### Task 4: Trade page safe defaults

**Files:**
- Modify: `components/trade/FastPerpsGame.tsx`

- [ ] **Step 1:** Find the initial state for trade mode/leverage (grep `tradeMode` / `degen` / `500`). Change the default to standard mode, 20x. Degen tiers (125/250/500) stay one explicit tap away behind the existing Degen toggle — never the landing state.
- [ ] **Step 2:** When a degen leverage is selected, render the liquidation warning line (the mock's red warnrow): `At {lev}x a {(100/lev).toFixed(2)}% move against you liquidates.`
- [ ] **Step 3:** Gate + commit: `git commit -m "fix(trade): default to standard 20x — degen leverage is opt-in, with liquidation warning"`

---

## Phase 2 — IA consolidation (still on existing routes)

### Task 5: Portfolio → "My copies" with source badges and Wins tab

**Files:**
- Modify: `app/(app)/portfolio/page.tsx`
- Modify: `components/portfolio/CopyRow.tsx`
- Modify: `components/copy/CopyTradingPanel.tsx`
- Reference: `app/(app)/leaderboard/page.tsx` (content moves in as a tab; route can stay)

- [ ] **Step 1:** Page heading: `My copies` with subtitle `Everything you're copying, in one place.` Tab order: **Subscriptions** (the CopyTradingPanel content, promoted out of the Open tab), **Open**, **History**, **Wins** (renders the leaderboard feed component inline).
- [ ] **Step 2:** Source badge on every `CopyRow`: derive from the row's source kind (already in data per the June audit — whale / bot / autopilot) → `WHALE COPY` (teal), `AI COPY` (purple), `AUTOPILOT` (yellow). One badge component, reused.
- [ ] **Step 3:** Unify terminology: `Stake` everywhere (PositionRow's `Cost` → `Stake`).
- [ ] **Step 4:** Keep `/leaderboard` route alive (it now also lives as the Wins tab); add a `Share win` button on positive-PnL history rows if not present.
- [ ] **Step 5:** Gate + commit: `git commit -m "feat(portfolio): My copies — subscriptions first, source badges, Wins tab"`

### Task 6: Traders page — ranked roster + search

**Files:**
- Modify: `components/feed/UnifiedFeed.tsx`
- Create: `lib/search/traders.ts`
- Test: `lib/search/traders.test.ts`

- [ ] **Step 1: Write the failing test** for the pure search filter:

```ts
import { describe, expect, it } from "vitest";
import { filterTraders, classifyQuery } from "./traders";

const ROSTER = [
  { id: "w1", kind: "whale", name: "Iron Wolf", markets: ["ETH"] },
  { id: "b1", kind: "bot", name: "Scalper", markets: ["SOL"], desc: "15s momentum" },
];

describe("classifyQuery", () => {
  it("detects a solana address", () => {
    expect(classifyQuery("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("wallet");
  });
  it("treats words as text", () => {
    expect(classifyQuery("iron")).toBe("text");
  });
});

describe("filterTraders", () => {
  it("matches by name, case-insensitive", () => {
    expect(filterTraders(ROSTER, "iron").map(t => t.id)).toEqual(["w1"]);
  });
  it("matches by market symbol", () => {
    expect(filterTraders(ROSTER, "sol").map(t => t.id)).toEqual(["b1"]);
  });
  it("returns everything for empty query", () => {
    expect(filterTraders(ROSTER, " ").length).toBe(2);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run lib/search` — expect FAIL (module not found).
- [ ] **Step 3:** Implement `lib/search/traders.ts`:

```ts
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type SearchableTrader = {
  id: string; kind: string; name: string;
  markets?: string[]; desc?: string;
};

export function classifyQuery(q: string): "wallet" | "text" {
  return SOL_ADDR.test(q.trim()) ? "wallet" : "text";
}

export function filterTraders<T extends SearchableTrader>(list: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(t =>
    t.name.toLowerCase().includes(needle) ||
    (t.markets ?? []).some(m => m.toLowerCase().includes(needle)) ||
    (t.desc ?? "").toLowerCase().includes(needle),
  );
}
```

- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Wire into `UnifiedFeed.tsx`: a search input above the All/Whales/Bots chips, placeholder `Search traders, assets, or paste a wallet`. Text queries call `filterTraders` over the already-fetched roster + bot list (client-side, no new endpoint). Wallet queries render a wallet result card that links into the **existing** manual-wallet copy flow (`CopyTradingPanel`'s wallet-source path — `lib/copy/sources.ts` already supports arbitrary Flash wallets); reuse its subscription POST rather than building a new endpoint.
- [ ] **Step 6:** Sentiment aggregate on trader cards (whales AND bots): a row between the badges and the P&L chart — `{pct}% bullish · {N} votes` (green if ≥50%, red below) plus a thin green-on-red ratio bar. Source: the existing pulse reactions aggregates (grep `components/whales/WhalePulseFeed.tsx` for its reactions fetch/aggregation and reuse that endpoint, aggregated per whale/bot rather than per position). See the mock's `tcsent` row for exact anatomy.
- [ ] **Step 7:** Gate + commit: `git commit -m "feat(traders): search + paste-a-wallet + sentiment aggregates on cards"`

### Task 7: LIVE event tape (the centerpiece)

**Files:**
- Modify: `app/(app)/chatter/page.tsx`
- Modify: `components/whales/WhalePulseFeed.tsx` (this becomes the tape)
- Reference: the mock's `liveCard()` + `pushTapeEvent()` + new-pill mechanics

The pulse feed already classifies signals (`Fresh open`, `Pain trade`, `Holding`, …) — this task changes the *presentation contract*, not the data pipeline:

- [ ] **Step 1:** Mobile: one card per viewport (`h-full`, `snap-y snap-mandatory` on the scroll container, `snap-start` per card) — the app already uses this pattern in the legacy swipe feed; reuse it. Desktop (≥900px): centered, side-bordered "theater" column (max-w ~580px), same snap behavior.
- [ ] **Step 2:** Card anatomy per the mock: eyebrow signal chip + relative time, identity row (tap → that trader on `/feed` with search prefilled), big headline (`{MKT} {LEV}x {SIDE} is already {up/down} {X}%` with the highlighted span), one-line note, sparkline, notional/entry/now stats, **single full-width `Copy now`** + quiet `View trader → Auto-copy` link. No Auto-copy button on tape cards.
- [ ] **Step 3:** Demote stale: cards whose mark is delayed render dimmed with the copy CTA disabled and the existing `watch only` affordance, labeled plainly: `Stale data — copying disabled until fresh.` Drop `Holding` cards older than 6h from the tape entirely (they're roster material, not live).
- [ ] **Step 4:** Close events: when the feed includes a position-closed signal, the card headline becomes `{MKT} {LEV}x {SIDE} closed {±X}%` and the CTA becomes `Auto-copy {name}` (opens CopyModal) with subtext `Missed it? Auto-copy mirrors their next trade automatically.`
- [ ] **Step 5:** Arrival mechanics: the feed already polls; on a poll that yields new items while the user is scrolled below the first card, do **not** re-anchor — show a floating `↑ N new signals` pill (fixed below the header) that, on tap, prepends and scrolls to top. If the user is at the top, prepend directly.
- [ ] **Step 6:** Reactions carry into the tape — the social layer is a locked product requirement, do NOT drop it: each card renders a sentiment row between the stats and the CTA — `▲ Bullish {n}` / `▼ Bearish {n}` toggle chips + thin ratio bar (mock's `sentRow`). Tap = optimistic toggle (vote / switch / unvote, counts reconcile) POSTing to the **existing** pulse reactions endpoint with its one-reaction-per-user semantics; update the row's DOM in place so the snap scroll position never resets.
- [ ] **Step 7:** Gate + commit: `git commit -m "feat(live): event tape — snap cards, one verb, close→Auto-copy, new-signal pill, bullish/bearish reactions"`

### Task 8: Orphan cleanup

**Files:**
- Delete: `app/(app)/live/` (obsolete heat/swipe surface; shell tests already forbid it from nav)
- Modify: `components/whales/WhaleRoster.tsx` (remove interior links to `/live`)

- [ ] **Step 1:** Delete the route directory, remove links, run the full suite — fix any imports/tests that referenced it.
- [ ] **Step 2:** Leave `/u/[handle]` and `/arena` routes untouched (decisions deferred; no links added or removed).
- [ ] **Step 3:** Gate + commit: `git commit -m "chore: remove obsolete /live surface"`

---

## Phase 3 — Notifications (event pipeline → bell → web push)

### Task 9: Schema (additive only)

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `scripts/apply-notifications-ddl.ts` (drizzle-kit push hangs without a TTY — apply DDL via tsx + postgres-js, same pattern as the June 11 handoff)

- [ ] **Step 1:** Add two tables to `lib/db/schema.ts`:

```ts
export const notificationEvents = pgTable("notification_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // 'copy-opened' | 'copy-closed' | 'auto-close' | 'source-closed' | 'autopilot-ended' | 'subscription-paused'
  title: text("title").notNull(),
  body: text("body").notNull(),
  meta: jsonb("meta"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("notification_events_user_created_idx").on(t.userId, t.createdAt),
]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("push_subscriptions_user_idx").on(t.userId),
]);
```

- [ ] **Step 2:** Write `scripts/apply-notifications-ddl.ts` mirroring the existing additive-DDL script pattern (raw `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, postgres-js client from `DATABASE_URL`). The ONLY acceptable statements are the two CREATE TABLEs + their indexes — anything touching another table = abort.
- [ ] **Step 3:** Run `npx tsx --env-file=.env.local scripts/apply-notifications-ddl.ts`, then verify via `npm run db:studio` that both tables exist and `paper_positions` row count is unchanged.
- [ ] **Step 4:** Gate + commit: `git commit -m "feat(db): notification_events + push_subscriptions (additive)"`

### Task 10: Emitter + wire-in

**Files:**
- Create: `lib/notifications/emit.ts`
- Test: `lib/notifications/emit.test.ts`
- Modify: `lib/copy/engine.ts` (after confirmOpen / confirmClose), `lib/bets/flash-reconcile.ts` (closed-external), `lib/autopilot/sessions.ts` (session end/exhaust)

- [ ] **Step 1: Failing test** (vitest, db mocked the way `lib/copy/engine` tests mock their deps):

```ts
import { describe, expect, it, vi } from "vitest";
import { buildEvent } from "./emit";

describe("buildEvent", () => {
  it("formats a copy-opened event", () => {
    const e = buildEvent("copy-opened", {
      userId: "u1", source: "Iron Wolf", market: "ETH", side: "long",
      leverage: 20, stakeUsd: 10,
    });
    expect(e.userId).toBe("u1");
    expect(e.title).toBe("Copied Iron Wolf — ETH 20x long with $10");
    expect(e.kind).toBe("copy-opened");
  });
  it("formats an auto-close event with pnl", () => {
    const e = buildEvent("auto-close", {
      userId: "u1", source: "Iron Wolf", market: "ETH", pnlUsd: 1.92,
    });
    expect(e.title).toBe("Auto-close fired: +$1.92 on ETH");
    expect(e.body).toContain("Iron Wolf exited");
  });
});
```

- [ ] **Step 2:** Run — FAIL. Implement `buildEvent` (pure formatter returning `{userId, kind, title, body, meta}`) + `emitNotification` (inserts via drizzle, then fires push — Task 12 fills the push part; until then it only inserts). Run — PASS.
- [ ] **Step 3:** Wire emit calls at the three seams (each inside its existing success path, wrapped in try/catch so a notification failure can never break money paths — log and continue):
  - `lib/copy/engine.ts`: after a copy open confirms → `copy-opened`; after auto-close confirms → `auto-close`; when `detachedFromSource` is set → `source-closed`.
  - `lib/bets/flash-reconcile.ts`: when a row flips to `closed-external` → `copy-closed` with `final P/L pending` body.
  - `lib/autopilot/sessions.ts`: on status → `exhausted` / `target` / `stopped` → `autopilot-ended`.
- [ ] **Step 4:** Gate + commit: `git commit -m "feat(notifications): event emitter wired into copy engine, reconcile, autopilot"`

### Task 11: Bell + activity feed UI

**Files:**
- Create: `app/api/notifications/route.ts` (GET: latest 50 + unread count; POST: mark all read — both behind `verifyPrivyRequest`)
- Create: `components/shell/NotificationBell.tsx`
- Modify: `components/shell/AppShell.tsx` (mount bell in the header, next to BalancePill)

- [ ] **Step 1:** GET handler: `select … from notification_events where user_id = $me order by created_at desc limit 50` + `count(*) where read_at is null`. POST: `update … set read_at = now() where user_id = $me and read_at is null`.
- [ ] **Step 2:** Bell component: badge with unread count (poll the GET every 60s piggybacking the existing portfolio poll cadence), opens a sheet (mobile) / popover (desktop) listing events with relative times — anatomy per the mock's Activity sheet. Opening marks read.
- [ ] **Step 3:** Gate + commit: `git commit -m "feat(shell): notification bell + activity feed"`

### Task 12: Web push

**Files:**
- Create: `lib/notifications/push.ts`, `app/api/push/subscribe/route.ts`
- Modify: `lib/notifications/emit.ts` (send push after insert), `.env.example`
- Modify: `public/sw.js` (created in Task 13 — push handler lands there)

- [ ] **Step 1:** `npm install web-push`. Generate VAPID keys once: `npx web-push generate-vapid-keys` → set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:ops@gwak.gg` in `.env.local`, `.env.example`, and Railway (`railway variables --service perps-arena --skip-deploys --set …`).
- [ ] **Step 2:** Subscribe route: POST body = the browser `PushSubscription` JSON; upsert into `push_subscriptions` by `endpoint` for the authed user. Client: after first successful copy (and from a small toggle in Wallet), request `Notification.permission`, then `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and POST it.
- [ ] **Step 3:** `lib/notifications/push.ts`: `sendPushToUser(userId, {title, body})` → load subscriptions, `webpush.sendNotification` each, delete subscription rows on 404/410 ("gone"). Call it from `emitNotification` after the DB insert (try/catch, non-fatal).
- [ ] **Step 4:** Manual verification (needs Task 13's SW deployed or `npm run dev` + localhost SW): subscribe in the browser, run a $1 copy open, observe the OS notification. Gate + commit: `git commit -m "feat(notifications): web push via VAPID — subscribe API + send-on-emit"`

---

## Phase 4 — PWA hardening

### Task 13: Service worker + offline shell

**Files:**
- Create: `public/sw.js`
- Create: `public/offline.html`
- Create: `components/pwa/RegisterSW.tsx` (client component; mount in `app/layout.tsx`)

- [ ] **Step 1:** `public/sw.js` — deliberately minimal (do NOT cache Next.js hashed assets aggressively; deploys are manual and a stale shell fighting a new deploy is worse than no cache):

```js
const OFFLINE_URL = "/offline.html";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("gwak-v1").then((c) => c.add(OFFLINE_URL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE_URL)));
  }
});
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title ?? "gwak.gg", {
    body: data.body ?? "", icon: "/icon.png", badge: "/icon.png",
    data: { url: data.url ?? "/portfolio" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url ?? "/portfolio"));
});
```

- [ ] **Step 2:** `offline.html` — static dark page, logo, "You're offline. Your positions are safe on-chain — reconnect to manage them."
- [ ] **Step 3:** `RegisterSW.tsx`: `useEffect` → `navigator.serviceWorker.register("/sw.js")` guarded by `"serviceWorker" in navigator`. Mount in the root layout.
- [ ] **Step 4:** Verify locally: `npm run dev`, DevTools → Application → Service Workers shows active; kill network → navigation shows offline page. Gate + commit: `git commit -m "feat(pwa): service worker (offline fallback + push handlers) + registration"`

### Task 14: Manifest + install polish

**Files:**
- Modify: `public/manifest.json` (exists — extend, don't replace)
- Modify: `app/globals.css` (safe areas)
- Create: `components/pwa/InstallNudge.tsx`

- [ ] **Step 1:** Extend `manifest.json`: add `"id": "/feed"`, `"categories": ["finance"]`, a `"screenshots"` array (4 entries, capture from the deployed app at 393×830 — also reused for the dApp Store), and `"shortcuts"` for `Live` (`/chatter`) and `My copies` (`/portfolio`).
- [ ] **Step 2:** Safe areas: ensure the app shell uses `viewport-fit=cover` (check the viewport export in `app/layout.tsx`) and BottomNav pads with `env(safe-area-inset-bottom)`.
- [ ] **Step 3:** `InstallNudge.tsx`: listen for `beforeinstallprompt`, stash it, and show a dismissible card in `/deposit` ("Install gwak — full screen, push alerts when your copies move"). On iOS Safari (no event), show the share-sheet instructions variant instead.
- [ ] **Step 4:** Lighthouse PWA pass on the deployed preview: installable = yes. Gate + commit: `git commit -m "feat(pwa): manifest extensions, safe areas, install nudge"`

**Deploy checkpoint:** merge Phases 1–4 to `main`, `railway up --service perps-arena`, verify prod: nav labels, copy flows ($1 live copy!), bell, push, installability. The dApp Store wraps the *hosted* site — prod must be green before Phase 5.

---

## Phase 5 — TWA + Seeker dApp Store

### Task 15: Signing key + Digital Asset Links

**Files:**
- Create: `public/.well-known/assetlinks.json`
- Create (untracked, secure): TWA keystore

- [ ] **Step 1:** Generate the dedicated keystore — **never reuse a Play Store key; losing this file = losing dApp Store update rights. Back it up like a private key:**

```bash
keytool -genkeypair -alias gwak-dappstore -keyalg RSA -keysize 4096 \
  -validity 10000 -keystore gwak-dappstore.keystore
keytool -list -v -keystore gwak-dappstore.keystore -alias gwak-dappstore | grep SHA256
```

- [ ] **Step 2:** `public/.well-known/assetlinks.json` with the SHA256 fingerprint (this is what removes the browser URL bar inside the TWA):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "gg.gwak.app",
    "sha256_cert_fingerprints": ["<SHA256-FROM-STEP-1>"]
  }
}]
```

- [ ] **Step 3:** Deploy, verify `https://gwak.gg/.well-known/assetlinks.json` returns 200 with `content-type: application/json`. Commit the assetlinks file only: `git commit -m "feat(twa): digital asset links for gg.gwak.app"`

### Task 16: Bubblewrap build

**Files:**
- Create: `twa/twa-manifest.json` (committed; generated by init then tuned)

- [ ] **Step 1:** `npm i -g @bubblewrap/cli`, then `bubblewrap init --manifest https://gwak.gg/manifest.json --directory twa/`. Answer prompts: package `gg.gwak.app`, app name `gwak.gg`, display `standalone`, status bar `#0a0a0d`, signing = the Task 15 keystore.
- [ ] **Step 2:** `cd twa && bubblewrap build` → produces `app-release-signed.apk`. Install on any Android device/emulator (`adb install`), verify: full screen (no URL bar — proves assetlinks), nav works, Privy email login works inside the TWA, push permission prompt fires.
- [ ] **Step 3:** Commit `twa/twa-manifest.json` (NOT the keystore, NOT the apk; add both to `.gitignore`): `git commit -m "feat(twa): bubblewrap config for Seeker build"`

### Task 17: dApp Store submission

**Files:**
- Create: `dapp-store/config.yaml` + asset files (per CLI scaffold)

- [ ] **Step 1:** Read the current dApp Store publisher policy ONCE before anything (real-money trading is normal there, but attest honestly): https://docs.solanamobile.com/dapp-publishing/publisher-policy
- [ ] **Step 2:** Assets: 512×512 icon (have it — `public/icon.png`), create a 1200×600 banner, capture ≥4 screenshots (Traders, LIVE tape, copy sheet, My copies — reuse Task 14's manifest screenshots).
- [ ] **Step 3:** `npm i -D @solana-mobile/dapp-publishing` → `npx dapp-store init` → fill `dapp-store/config.yaml` (app name, android package `gg.gwak.app`, apk path, assets). Use a dedicated publisher keypair (small SOL balance for NFT mints; this keypair = publisher identity, store it with the keystore).
- [ ] **Step 4:** Mint + submit (mainnet RPC):

```bash
npx dapp-store create publisher -k publisher.json
npx dapp-store create app -k publisher.json
npx dapp-store create release -k publisher.json -b <path-to-android-build-tools>
npx dapp-store publish submit -k publisher.json \
  --requestor-is-authorized --complies-with-solana-dapp-store-policies
```

- [ ] **Step 5:** Track review via the publisher portal; on approval, smoke-test install from the dApp Store on a Seeker (or emulator). Commit config: `git commit -m "feat(seeker): dApp Store publishing config + assets"`

### Task 18 (stretch, post-listing): Seeker-native touches

- [ ] Mobile Wallet Adapter / Seed Vault as an optional connect path beside Privy (self-custody trust story) — own plan when prioritized.
- [ ] Seeker genesis-token holders skip the invite waitlist (gate check in `lib/invite/gate.ts` + token ownership lookup) — own plan when prioritized.

---

## Standing prerequisites (parallel track, not blocking UI work but blocking *real users*)

Carried from the June 11 handoff — still open: rotate `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY` (was pasted in chat), create the Flash-scoped Privy session-signer policy + set `NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS`, set the Privy instant vars in prod Railway, flip `COPY_DRY_RUN` off only after a $1 live copy verifies, delete orphaned `SCALP_*` Railway vars.

## Verification gates (every task)

`npm run typecheck && npm test` — there is no lint script. UI tasks additionally: exercise the changed flow in the browser (dev server via `.claude/launch.json` configs — note all tickers are disabled there by design). Money-path tasks (2, 10, 12): finish with a $1 real-money verification on prod before calling the phase done.
