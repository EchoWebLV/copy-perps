# Hyperliquid Copyable Whales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hyperliquid whales to the social whale feed and allow users to copy their supported open positions through Pacifica.

**Architecture:** Hyperliquid remains a read-side signal venue, while Pacifica remains the execution venue. A new Hyperliquid mapper and refresh function write `WhaleRecord` and `WhalePositionRecord` rows into the same live snapshot shape as Pacifica, then the whale copy route accepts either source as long as the market exists on Pacifica. Auto-close uses the cached live snapshot first and falls back to source-specific live position polling.

**Tech Stack:** Next.js route handlers, TypeScript, Drizzle repository helpers, Hyperliquid public info API, Pacifica order APIs, Vitest.

---

### Task 1: Hyperliquid Position Mapping

**Files:**
- Create: `lib/whales/hyperliquid-source.ts`
- Test: `lib/whales/hyperliquid-source.test.ts`

- [ ] **Step 1: Write failing tests**

Cover long and short mapping from Hyperliquid `assetPositions`, including position id, side, leverage, notional, entry, current mark, and ROE-derived source P/L.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/whales/hyperliquid-source.test.ts`
Expected: FAIL because `mapHyperliquidPosition` does not exist.

- [ ] **Step 3: Implement mapper**

Create `mapHyperliquidPosition(args)` that accepts `sourceAccount`, `assetPosition`, optional `currentMark`, and `now`, then returns a `WhalePositionRecord` with `source: "hyperliquid"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/whales/hyperliquid-source.test.ts`
Expected: PASS.

### Task 2: Hyperliquid Refresh and Merged Snapshot

**Files:**
- Modify: `lib/hyperliquid/client.ts`
- Create: `lib/whales/refresh-hyperliquid.ts`
- Modify: `lib/whales/live-cache.ts`
- Modify: `lib/whales/ticker.ts`
- Test: `lib/whales/refresh-hyperliquid.test.ts`
- Test: `lib/whales/live-cache.test.ts`

- [ ] **Step 1: Write failing tests**

Assert Hyperliquid refresh upserts active whales, maps open positions, and writes a live cache that can contain both Pacifica and Hyperliquid positions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/whales/refresh-hyperliquid.test.ts lib/whales/live-cache.test.ts`
Expected: FAIL because the refresh function and merged cache support are missing.

- [ ] **Step 3: Implement refresh**

Add `getPortfolio(user)` to the Hyperliquid client, implement `refreshHyperliquidWhales()`, and update the ticker to run a merged `refreshWhales()` coordinator that calls Pacifica and Hyperliquid refreshers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/whales/refresh-hyperliquid.test.ts lib/whales/live-cache.test.ts`
Expected: PASS.

### Task 3: Whale Signals for Hyperliquid Stats

**Files:**
- Modify: `lib/signals/whale-signals.ts`
- Test: `lib/signals/whale-signals.test.ts`

- [ ] **Step 1: Write failing tests**

Assert `buildWhaleTraderSignals()` keeps Hyperliquid whales, includes their open positions, and uses Hyperliquid portfolio stats when available.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/signals/whale-signals.test.ts`
Expected: FAIL because stats still come from Pacifica leaderboard only.

- [ ] **Step 3: Implement stats**

Read Hyperliquid portfolio data for Hyperliquid whales and map day, week, month, and all-time P/L into the existing stats shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/signals/whale-signals.test.ts`
Expected: PASS.

### Task 4: Copy Route and Auto-Close

**Files:**
- Modify: `app/api/bet/whale/route.ts`
- Modify: `lib/bets/mirror-close.ts`
- Test: `lib/bets/whale-route.test.ts`
- Test: `lib/bets/mirror-close.test.ts`

- [ ] **Step 1: Write failing tests**

Assert the whale copy route accepts Hyperliquid source positions when their market exists on Pacifica, rejects unsupported markets with a venue-specific error, and stores `source: "hyperliquid"` in whale copy metadata. Assert mirror-close closes a follower when the copied Hyperliquid source position disappears.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/bets/whale-route.test.ts lib/bets/mirror-close.test.ts`
Expected: FAIL because the route rejects non-Pacifica whale sources and auto-close filters them out.

- [ ] **Step 3: Implement route and close sweep**

Remove the Pacifica-only source rejection from the route, keep Pacifica market validation before opening, and teach `closeWhaleFollowers()` to handle Hyperliquid metadata via cached live positions and `getClearinghouseState()` fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/bets/whale-route.test.ts lib/bets/mirror-close.test.ts`
Expected: PASS.

### Task 5: Verification

**Files:**
- No new production files.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- lib/whales/hyperliquid-source.test.ts lib/whales/refresh-hyperliquid.test.ts lib/signals/whale-signals.test.ts lib/bets/whale-route.test.ts lib/bets/mirror-close.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
Expected: all pass.

- [ ] **Step 3: Browser verify**

Open `/feed` and `/live`, confirm Hyperliquid whales can appear with `SRC HYPERLIQUID`, and verify supported positions open the tail modal.
