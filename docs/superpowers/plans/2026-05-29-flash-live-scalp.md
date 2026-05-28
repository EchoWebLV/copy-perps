# Flash Live Scalp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flash Scalp feel live by updating visible marks, PnL, and graph values at 10fps from streamed marks while exact Flash positions reconcile more slowly.

**Architecture:** Keep Flash open/close transaction routes unchanged. Add a small client-side valuation layer that takes a Flash position plus a live mark and returns estimated PnL, value, ROI, and liquidation movement. Use the existing global live mark provider first, with Flash/Pyth-friendly interfaces so the mark source can be swapped later without changing Scalp rendering.

**Tech Stack:** Next.js App Router, React client components, Vitest, Flash SDK position summaries, existing Pacifica WebSocket live mark provider.

---

### Task 1: Live Flash Valuation Unit

**Files:**
- Create: `lib/flash/live-pnl.ts`
- Test: `lib/flash/live-pnl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { computeFlashLivePositionView } from "./live-pnl";

describe("computeFlashLivePositionView", () => {
  it("computes long PnL from live mark without waiting for Flash quote refresh", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "SOL",
        side: "long",
        entryPriceUsd: 100,
        markPriceUsd: 100,
        sizeUsd: 500,
        collateralUsd: 0.95,
        pnlUsd: -0.05,
      },
      liveMarkUsd: 101,
    });

    expect(view.markPriceUsd).toBe(101);
    expect(view.pnlUsd).toBeCloseTo(5);
    expect(view.valueUsd).toBeCloseTo(5.95);
    expect(view.roiPct).toBeCloseTo(526.3158);
    expect(view.isEstimated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/flash/live-pnl.test.ts`
Expected: FAIL because `lib/flash/live-pnl.ts` does not exist.

- [ ] **Step 3: Implement valuation helper**

Add `computeFlashLivePositionView` with long/short price PnL, fallback to exact Flash quote values when there is no live mark, and stake-based ROI.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/flash/live-pnl.test.ts`
Expected: PASS.

### Task 2: Scalp Contract

**Files:**
- Modify: `components/trade/flash-perps-game-contract.test.ts`
- Modify: `components/trade/FastPerpsGame.tsx`

- [ ] **Step 1: Write failing contract expectations**

Assert that Scalp imports `useLiveMarks`, imports the Flash live PnL helper, polls `/api/flash/perp/positions` every `FLASH_POSITION_RECONCILE_MS = 10_000`, and passes a live estimated value into `LivePerpGraph`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/trade/flash-perps-game-contract.test.ts`
Expected: FAIL on missing import/helper/reconcile interval.

- [ ] **Step 3: Wire Scalp to live marks**

Use `useLiveMarks()` once at component scope, derive position views with `computeFlashLivePositionView`, and update all visible selected/position-chip values from those views.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/trade/flash-perps-game-contract.test.ts`
Expected: PASS.

### Task 3: Verification

**Files:**
- No new files unless implementation requires a tiny supporting helper.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- lib/flash/live-pnl.test.ts components/trade/flash-perps-game-contract.test.ts`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Browser verify**

Open `/trade` in the in-app browser, confirm BTC/ETH/SOL buttons still render, graph panel still renders for an open position, and no category buttons return.

- [ ] **Step 4: Commit**

Run: `git add docs/superpowers/plans/2026-05-29-flash-live-scalp.md lib/flash/live-pnl.ts lib/flash/live-pnl.test.ts components/trade/FastPerpsGame.tsx components/trade/flash-perps-game-contract.test.ts && git commit -m "Add live Scalp PnL estimates"`.
