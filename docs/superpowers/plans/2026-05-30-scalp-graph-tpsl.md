# Scalp Graph Money-Channel + TP/SL Trigger Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Scalp page graph into a live "money channel" (value line inside a TP ceiling / entry / SL floor / liquidation death-zone), and add opt-in take-profit / stop-loss as native Flash trigger orders that fire on-chain even when the app is closed.

**Architecture:** Two pure, fully-unit-tested helper modules carry all the math (`lib/flash/graph-channel.ts` for ROI↔value↔Y geometry; `lib/flash/triggers.ts` for ROI validation + trigger-price↔ROI derivation). The Flash SDK glue (`buildPlaceTriggerOrderTx`/`buildCancelTriggerOrderTx`/`activeTriggersOf`) is added to the existing `FlashPerpsService` mirroring its `open`/`close` build pattern. A new authed route `app/api/flash/perp/trigger` places/replaces/cancels triggers and returns an unsigned `transactionB64` (or auto-signs via the existing Privy instant path). The positions route surfaces on-chain triggers so the client renders channel lines from chain truth. `LivePerpGraph` is rewritten to the channel model and TP/SL controls are wired into `FastPerpsGame.tsx`.

**Tech Stack:** Next.js 16 App Router (route handlers, `runtime: nodejs`), React 19 client component, `flash-sdk` `PerpetualsClient` (native trigger orders), `@solana/web3.js` v1 (VersionedTransaction), Privy session-signer instant execution, Vitest (node env; `lib/**` + `components/**` only), TypeScript strict.

---

## Background the engineer needs

**The product.** `components/trade/FastPerpsGame.tsx` is the Scalp page: one-tap leveraged Flash perps ($1–$50 stake, 20x–500x) on BTC/ETH/SOL (Crypto.1 self-collateralized pool). It already has instant (no-prompt) execution via Privy session signers and a calm `LivePerpGraph` that plots position value as one line.

**Why value-space, not candles.** At 100x–500x the price move that doubles or liquidates you is < 0.5% — invisible on candlesticks, dramatic on a money-line. The graph stays in money-space (Y = position value in USD). Every level is a horizontal line at a value, and value maps linearly from ROI: `valueAtRoi(stake, roi) = stake * (1 + roi/100)` → entry (roi 0) = stake, TP (+100%) = 2×stake, SL (−50%) = 0.5×stake, liq (−100%) ≈ 0.

**Verified Flash SDK facts (do not re-derive — these were read out of `node_modules/flash-sdk/dist`):**
- `client.placeTriggerOrder(targetSymbol, collateralSymbol, receiveSymbol, side: Side, triggerPrice: ContractOraclePrice, deltaSizeAmount: BN, isStopLoss: boolean, poolConfig)` → `{ instructions, additionalSigners }`. `isStopLoss: true` = SL, `false` = TP.
- `client.editTriggerOrder(targetSymbol, collateralSymbol, receiveSymbol, side, orderId: number, triggerPrice, deltaSizeAmount, isStopLoss, poolConfig)` → `{ instructions, additionalSigners }`. Use to **replace** a same-kind order.
- `client.cancelTriggerOrder(targetSymbol, collateralSymbol, side, orderId: number, isStopLoss, poolConfig)` → `{ instructions, additionalSigners }`.
- `client.getTriggerPriceFromRoiSync(roi: BN, collateralUsd: BN, exitFeeUsd: BN, positionSize: BN, sizeDecimals: number, entryPrice: OraclePrice, side: Side) => OraclePrice`. **`roi` is a plain integer percent** — the impl computes `pnlUsd = roi * collateralUsd / 100`, so `roi = 100` means +100% on collateral and `roi = -50` means −50%. Convert the result with `.toContractOraclePrice()`.
- `client.getUserOrderAccounts(owner, poolConfig)` → array of `{ owner, market, takeProfitOrders: TriggerOrder[], stopLossOrders: TriggerOrder[], openTp, openSl, ... }`. `TriggerOrder = { triggerPrice: ContractOraclePrice; triggerSize: BN; receiveCustodyUid: number }` — there is **no embedded order id**; the cancel/edit `orderId` is the order's 1-based slot ordinal within its kind array (confirm in the smoke check, Task 8).
- `PositionAccount` exposes `entryPrice: ContractOraclePrice`, `collateralUsd: BN`, `sizeAmount: BN`, `sizeDecimals: number`, `isActive` (USD values are `USD_DECIMALS = 6`).
- `client.getClosePositionQuote(...)` returns `{ fees: BN, ... }` (the exit fee, `USD_DECIMALS`) — reuse it as `exitFeeUsd`.

**Existing patterns to mirror exactly:**
- `FlashPerpsService.open`/`close` (`lib/flash/perps.ts`): fetch pool config → `createClient(owner, poolConfig)` → look up `MarketConfig` → build SDK ix → `serializeInstructions(...)` → return base64. Reuse `sideToFlash`, `contractPriceToOracle`, `contractPriceToNumber`, `collateralSymbolForMarket`, `usdcCustody`, `serializeInstructions`, `marketForSymbol`, `hasOpenSize`, `PositionAccount.from`.
- Open route (`app/api/flash/perp/route.ts`): `verifyPrivyRequest` → parse body → `ensureUser` → service call → if `body.instant` then `signAndSendPrivySolanaTransaction(...)` and return `phase: "sent"`, else return `phase: "sign", transactionB64`.
- Client (`FastPerpsGame.tsx`): `requestOpen(instant)`/`requestClose(instant)` POST the routes; `openLive`/`closeLive` branch on `result.phase === "sent"` / `"sent-close"` (instant) vs `signAndSendFlashTransaction(result.transactionB64)` (user-signed). `ensureInstantTrading()` returns `false` when Privy instant is unconfigured.
- **Test conventions:** pure modules get real behavioral Vitest specs (`lib/flash/live-pnl.test.ts` is the reference). Un-renderable client components and route handlers get **source-grep contract tests** (`components/trade/flash-perps-game-contract.test.ts` reads the file with `readFileSync` and asserts substrings). Vitest only scans `lib/**/*.test.ts` and `components/**/*.test.ts`, so **a route's contract test must live under `lib/flash/`** (it `readFileSync`s the route file by path).

**Verification gate (whole plan):** `npx vitest run` + `npm run typecheck`. There is no lint script. Commit after every green step.

---

## File structure

**New files:**
- `lib/flash/graph-channel.ts` — pure Part A geometry: `valueAtRoi`, `buildChannel`, types. No React, no SDK.
- `lib/flash/graph-channel.test.ts` — behavioral unit tests for the above.
- `lib/flash/triggers.ts` — pure Part B logic: `TriggerKind`, `TriggerOrderView`, `validateTriggerRoi`, `roiPctToIntegerPercent`, `roiPctFromTriggerPrice`. No SDK.
- `lib/flash/triggers.test.ts` — behavioral unit tests for the above.
- `app/api/flash/perp/trigger/route.ts` — authed `POST` (place/replace) + `DELETE` (cancel); returns `transactionB64` or auto-signs.
- `lib/flash/trigger-route-contract.test.ts` — source-grep contract test for the trigger route **and** the positions-route trigger extension.

**Modified files:**
- `lib/flash/perps.ts` — add `buildPlaceTriggerOrderTx`, `buildCancelTriggerOrderTx`, `activeTriggersOf`, supporting request/summary types, and the `PositionTriggers` shape on `FlashPositionSummary`. Reuses existing private helpers.
- `app/api/flash/perp/positions/route.ts` — attach each position's active triggers (with derived `roiPct`) to the response.
- `components/trade/FastPerpsGame.tsx` — rewrite `LivePerpGraph` to the channel model; add ghost/active TP-SL chips, mobile tap-sheet, desktop drag handles; add `requestTrigger`/`cancelTrigger` with the instant path and `"sent-trigger"` / `"sent-trigger-cancel"` phases; thread trigger state from the positions poll.
- `components/trade/flash-perps-game-contract.test.ts` — extend with channel + TP/SL contract assertions.

**Responsibility boundaries:** all numeric/geometry logic is pure and lives in the two `lib/flash/*.ts` helpers (testable without React or RPC). The SDK glue stays inside `FlashPerpsService`. Routes stay thin (auth + validate + delegate + instant-sign). The React file only renders and wires events.

---

## Task 1: Pure graph-channel geometry (`lib/flash/graph-channel.ts`)

**Files:**
- Create: `lib/flash/graph-channel.ts`
- Test: `lib/flash/graph-channel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/flash/graph-channel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildChannel, valueAtRoi, LIQ_ROI_PCT } from "./graph-channel";

describe("valueAtRoi", () => {
  it("maps ROI to position value in money-space", () => {
    expect(valueAtRoi(1, 0)).toBeCloseTo(1); // entry
    expect(valueAtRoi(1, 100)).toBeCloseTo(2); // +100% TP
    expect(valueAtRoi(1, -50)).toBeCloseTo(0.5); // -50% SL
    expect(valueAtRoi(1, LIQ_ROI_PCT)).toBeCloseTo(0); // liquidation
    expect(valueAtRoi(20, 25)).toBeCloseTo(25);
  });
});

describe("buildChannel", () => {
  it("default position draws only entry + liq lines (TP/SL opt-in)", () => {
    const ch = buildChannel({ stakeUsd: 1, valueUsd: 1.2 });
    const ids = ch.lines.map((l) => l.id).sort();
    expect(ids).toEqual(["entry", "liq"]);
    expect(ch.lines.find((l) => l.id === "entry")!.valueUsd).toBeCloseTo(1);
    expect(ch.lines.find((l) => l.id === "liq")!.valueUsd).toBeCloseTo(0);
    expect(ch.minValue).toBeCloseTo(0); // liq floor anchors the bottom
    expect(ch.maxValue).toBeGreaterThan(1.2); // headroom above the live tip
  });

  it("adds TP and SL lines once configured", () => {
    const ch = buildChannel({
      stakeUsd: 1,
      valueUsd: 1.8,
      tp: { kind: "tp", roiPct: 100 },
      sl: { kind: "sl", roiPct: -50 },
    });
    expect(ch.lines.map((l) => l.id).sort()).toEqual([
      "entry",
      "liq",
      "sl",
      "tp",
    ]);
    expect(ch.lines.find((l) => l.id === "tp")!.valueUsd).toBeCloseTo(2);
    expect(ch.lines.find((l) => l.id === "sl")!.valueUsd).toBeCloseTo(0.5);
    expect(ch.maxValue).toBeGreaterThan(2); // TP ceiling not clipped at top
  });

  it("valueToY is monotonic: higher value maps to a smaller y (higher on screen)", () => {
    const ch = buildChannel({ stakeUsd: 1, valueUsd: 1 });
    const yTop = ch.valueToY(ch.maxValue, 170, 18);
    const yBottom = ch.valueToY(0, 170, 18);
    const yMid = ch.valueToY(1, 170, 18);
    expect(yTop).toBeCloseTo(18); // top pad
    expect(yBottom).toBeCloseTo(170 - 18); // bottom pad
    expect(yMid).toBeGreaterThan(yTop);
    expect(yMid).toBeLessThan(yBottom);
  });

  it("never clips a value that runs past the TP ceiling", () => {
    const ch = buildChannel({
      stakeUsd: 1,
      valueUsd: 2.4, // already above the +100% TP
      tp: { kind: "tp", roiPct: 100 },
    });
    expect(ch.maxValue).toBeGreaterThanOrEqual(2.4);
    const y = ch.valueToY(2.4, 170, 18);
    expect(y).toBeGreaterThanOrEqual(18); // inside the padded plot area
  });

  it("clamps out-of-domain values into the plot area", () => {
    const ch = buildChannel({ stakeUsd: 1, valueUsd: 1 });
    expect(ch.valueToY(-5, 170, 18)).toBeCloseTo(170 - 18); // below liq clamps to floor
    expect(ch.valueToY(9999, 170, 18)).toBeCloseTo(18); // above ceiling clamps to top
  });

  it("degrades gracefully for a zero stake", () => {
    const ch = buildChannel({ stakeUsd: 0, valueUsd: 0 });
    expect(ch.minValue).toBeCloseTo(0);
    expect(ch.maxValue).toBeGreaterThan(0);
    expect(Number.isFinite(ch.valueToY(0, 170, 18))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/flash/graph-channel.test.ts`
Expected: FAIL — `Failed to resolve import "./graph-channel"` / "buildChannel is not a function".

- [ ] **Step 3: Write the minimal implementation**

Create `lib/flash/graph-channel.ts`:

```ts
/**
 * Pure money-channel geometry for the Scalp graph. No React, no RPC.
 *
 * The graph lives in money-space: Y = position value in USD. Every level is a
 * horizontal line at a value, and value maps linearly from ROI on the staked
 * collateral: valueAtRoi(stake, roi) = stake * (1 + roi / 100).
 *   entry → roi   0% → stake
 *   TP    → roi +100% → 2 * stake
 *   SL    → roi  -50% → 0.5 * stake
 *   liq   → roi -100% → 0
 */

export type TriggerKind = "tp" | "sl";

export interface TriggerLevelInput {
  kind: TriggerKind;
  roiPct: number;
}

export interface ChannelInput {
  /** User stake (posted collateral intent) in USD — the entry baseline value. */
  stakeUsd: number;
  /** Current live position value in USD (stake +/- P/L). */
  valueUsd: number;
  /** Configured take-profit, or null/undefined when off (default). */
  tp?: TriggerLevelInput | null;
  /** Configured stop-loss, or null/undefined when off (default). */
  sl?: TriggerLevelInput | null;
}

export type ChannelLineId = "tp" | "entry" | "sl" | "liq";

export interface ChannelLine {
  id: ChannelLineId;
  valueUsd: number;
  roiPct: number;
}

export interface Channel {
  /** Bottom of the Y domain. Always 0 — the liquidation floor. */
  minValue: number;
  /** Top of the Y domain — headroom above the TP ceiling / live tip. */
  maxValue: number;
  /** Horizontal reference lines, top-to-bottom by value. Always includes
   * entry + liq; tp/sl appear only when configured. */
  lines: ChannelLine[];
  /** Map a USD value to an SVG y coordinate (clamped into the padded area). */
  valueToY: (value: number, height: number, pad: number) => number;
}

export const LIQ_ROI_PCT = -100;

/** Position value at a given ROI percent on the staked collateral. */
export function valueAtRoi(stakeUsd: number, roiPct: number): number {
  return stakeUsd * (1 + roiPct / 100);
}

const HEADROOM = 1.15; // 15% breathing room above the highest line/tip.

export function buildChannel(input: ChannelInput): Channel {
  const stake = Number.isFinite(input.stakeUsd) ? Math.max(0, input.stakeUsd) : 0;
  const value = Number.isFinite(input.valueUsd) ? Math.max(0, input.valueUsd) : 0;

  const lines: ChannelLine[] = [
    { id: "entry", valueUsd: stake, roiPct: 0 },
    { id: "liq", valueUsd: 0, roiPct: LIQ_ROI_PCT },
  ];
  if (input.tp && Number.isFinite(input.tp.roiPct)) {
    lines.push({
      id: "tp",
      valueUsd: valueAtRoi(stake, input.tp.roiPct),
      roiPct: input.tp.roiPct,
    });
  }
  if (input.sl && Number.isFinite(input.sl.roiPct)) {
    lines.push({
      id: "sl",
      valueUsd: valueAtRoi(stake, input.sl.roiPct),
      roiPct: input.sl.roiPct,
    });
  }
  lines.sort((a, b) => b.valueUsd - a.valueUsd);

  const minValue = 0; // liquidation floor anchors the bottom.
  const topCandidate = Math.max(
    stake,
    value,
    ...lines.map((l) => l.valueUsd),
  );
  const maxValue = Math.max(topCandidate * HEADROOM, stake * 2, 1);

  const valueToY = (v: number, height: number, pad: number): number => {
    const span = maxValue - minValue || 1;
    const t = Math.min(1, Math.max(0, (v - minValue) / span));
    return height - pad - t * (height - 2 * pad);
  };

  return { minValue, maxValue, lines, valueToY };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/flash/graph-channel.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/flash/graph-channel.ts lib/flash/graph-channel.test.ts
git commit -m "$(cat <<'EOF'
feat: add pure money-channel geometry for the Scalp graph

ROI<->value mapping, default-vs-configured line set (entry + liq always,
TP/SL opt-in), and a clamped value->Y scale anchored at the liq floor.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure trigger validation + ROI helpers (`lib/flash/triggers.ts`)

**Files:**
- Create: `lib/flash/triggers.ts`
- Test: `lib/flash/triggers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/flash/triggers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  roiPctFromTriggerPrice,
  roiPctToIntegerPercent,
  validateTriggerRoi,
  TP_MIN_ROI_PCT,
  SL_MIN_ROI_PCT,
} from "./triggers";

describe("validateTriggerRoi", () => {
  it("accepts a take-profit in profit", () => {
    const r = validateTriggerRoi("tp", 100);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(100);
  });

  it("rejects a take-profit at or below entry", () => {
    expect(validateTriggerRoi("tp", 0).ok).toBe(false);
    const r = validateTriggerRoi("tp", -10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/profit/i);
  });

  it("clamps a take-profit below the minimum profit floor", () => {
    const r = validateTriggerRoi("tp", 0.4);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(TP_MIN_ROI_PCT);
  });

  it("accepts a stop-loss between entry and liquidation", () => {
    const r = validateTriggerRoi("sl", -50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(-50);
  });

  it("rejects a stop-loss at or above entry", () => {
    expect(validateTriggerRoi("sl", 0).ok).toBe(false);
    const r = validateTriggerRoi("sl", 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/below entry|entry/i);
  });

  it("rejects a stop-loss at or below liquidation", () => {
    const r = validateTriggerRoi("sl", -100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/liquidat/i);
  });

  it("clamps a stop-loss that hugs liquidation up to the safe floor", () => {
    const r = validateTriggerRoi("sl", -99.9);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(SL_MIN_ROI_PCT);
  });

  it("rejects non-finite ROI", () => {
    expect(validateTriggerRoi("tp", Number.NaN).ok).toBe(false);
  });
});

describe("roiPctToIntegerPercent", () => {
  it("rounds to the integer percent getTriggerPriceFromRoiSync expects", () => {
    expect(roiPctToIntegerPercent(100)).toBe(100);
    expect(roiPctToIntegerPercent(-50.4)).toBe(-50);
    expect(roiPctToIntegerPercent(33.7)).toBe(34);
  });
});

describe("roiPctFromTriggerPrice", () => {
  it("derives ROI on collateral for a long from the trigger price", () => {
    // 1% up move at 100x leverage (size/collateral = 100) ≈ +100% on collateral.
    const roi = roiPctFromTriggerPrice({
      entryPriceUsd: 100,
      triggerPriceUsd: 101,
      sizeUsd: 100,
      collateralUsd: 1,
      side: "long",
    });
    expect(roi).toBeCloseTo(100, 0);
  });

  it("derives a negative ROI for a long stop below entry", () => {
    const roi = roiPctFromTriggerPrice({
      entryPriceUsd: 100,
      triggerPriceUsd: 99.5,
      sizeUsd: 100,
      collateralUsd: 1,
      side: "long",
    });
    expect(roi).toBeCloseTo(-50, 0);
  });

  it("inverts the sign for a short", () => {
    const roi = roiPctFromTriggerPrice({
      entryPriceUsd: 2000,
      triggerPriceUsd: 1980, // price down → short profits
      sizeUsd: 100,
      collateralUsd: 2,
      side: "short",
    });
    expect(roi).toBeGreaterThan(0);
  });

  it("returns 0 when inputs are degenerate", () => {
    expect(
      roiPctFromTriggerPrice({
        entryPriceUsd: 0,
        triggerPriceUsd: 101,
        sizeUsd: 100,
        collateralUsd: 1,
        side: "long",
      }),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/flash/triggers.test.ts`
Expected: FAIL — `Failed to resolve import "./triggers"`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/flash/triggers.ts`:

```ts
import type { FlashSide } from "./perps";

export type TriggerKind = "tp" | "sl";

/** An active on-chain trigger order surfaced to the client. */
export interface TriggerOrderView {
  kind: TriggerKind;
  /** 1-based slot ordinal within its kind array; passed back to cancel/edit. */
  orderId: number;
  triggerPriceUsd: number;
  /** Approximate ROI on collateral implied by the trigger price (display only). */
  roiPct: number;
}

export type TriggerValidation =
  | { ok: true; roiPct: number }
  | { ok: false; message: string };

// Take-profit must be in profit; stop-loss must sit strictly between entry
// (0%) and liquidation (-100%). Soft bounds clamp; hard bounds reject.
export const TP_MIN_ROI_PCT = 1;
export const TP_MAX_ROI_PCT = 10_000;
export const SL_MIN_ROI_PCT = -95; // safe floor above liquidation
export const SL_MAX_ROI_PCT = -1; // just below entry

export function validateTriggerRoi(
  kind: TriggerKind,
  roiPct: number,
): TriggerValidation {
  if (!Number.isFinite(roiPct)) {
    return { ok: false, message: "Enter a valid percentage." };
  }
  if (kind === "tp") {
    if (roiPct <= 0) {
      return {
        ok: false,
        message: "Take-profit must be above entry (in profit).",
      };
    }
    const clamped = Math.min(Math.max(roiPct, TP_MIN_ROI_PCT), TP_MAX_ROI_PCT);
    return { ok: true, roiPct: clamped };
  }
  // stop-loss
  if (roiPct >= 0) {
    return { ok: false, message: "Stop-loss must be below entry." };
  }
  if (roiPct <= -100) {
    return { ok: false, message: "Stop-loss must stay above liquidation." };
  }
  const clamped = Math.min(Math.max(roiPct, SL_MIN_ROI_PCT), SL_MAX_ROI_PCT);
  return { ok: true, roiPct: clamped };
}

/** getTriggerPriceFromRoiSync expects ROI as a plain integer percent. */
export function roiPctToIntegerPercent(roiPct: number): number {
  return Math.round(roiPct);
}

export interface TriggerRoiFromPriceInput {
  entryPriceUsd: number;
  triggerPriceUsd: number;
  sizeUsd: number;
  collateralUsd: number;
  side: FlashSide;
}

/**
 * Approximate ROI on collateral implied by a trigger price (for chip/line
 * display). Exact fills depend on keeper latency + fees, so this is
 * intentionally fee-free and approximate — never promise an exact price.
 *   roi% = priceMove% * (sizeUsd / collateralUsd) * sideSign * 100
 */
export function roiPctFromTriggerPrice(input: TriggerRoiFromPriceInput): number {
  const { entryPriceUsd, triggerPriceUsd, sizeUsd, collateralUsd, side } = input;
  if (
    !Number.isFinite(entryPriceUsd) ||
    entryPriceUsd <= 0 ||
    !Number.isFinite(collateralUsd) ||
    collateralUsd <= 0 ||
    !Number.isFinite(sizeUsd) ||
    sizeUsd <= 0
  ) {
    return 0;
  }
  const priceMove = (triggerPriceUsd - entryPriceUsd) / entryPriceUsd;
  const leverage = sizeUsd / collateralUsd;
  const sideSign = side === "long" ? 1 : -1;
  return priceMove * leverage * sideSign * 100;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/flash/triggers.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`FlashSide` is already exported from `lib/flash/perps.ts`.)

- [ ] **Step 6: Commit**

```bash
git add lib/flash/triggers.ts lib/flash/triggers.test.ts
git commit -m "$(cat <<'EOF'
feat: add pure TP/SL trigger validation + ROI<->price helpers

Validate take-profit (in profit) and stop-loss (between entry and liq),
convert UI ROI% to the integer percent the Flash SDK expects, and derive an
approximate display ROI from an on-chain trigger price.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Flash SDK trigger tx-builders + reader (`lib/flash/perps.ts`)

**Files:**
- Modify: `lib/flash/perps.ts`

This task adds three methods to `FlashPerpsService` plus the supporting types, mirroring the existing `open`/`close` build pattern. There is no automated unit test here (consistent with `open`/`close`, which are SDK-bound and verified manually + via the route contract test in Task 4 and the live smoke check in Task 8). Verification for this task is `npm run typecheck`.

- [ ] **Step 1: Add the imports needed for trigger building**

In `lib/flash/perps.ts`, the import block from `flash-sdk` (lines 11–26) already includes `BN`, `OraclePrice`, `PerpetualsClient`, `PositionAccount`, `Privilege`, `Side`, `USD_DECIMALS`, `type ClosePositionQuoteData`, `type ContractOraclePrice`, `type MarketConfig`. Add `TriggerOrder` to the `flash-sdk` type imports and import the pure helpers. After the existing `./markets` import block (ends line 35), add:

```ts
import {
  roiPctFromTriggerPrice,
  roiPctToIntegerPercent,
  type TriggerKind,
  type TriggerOrderView,
} from "./triggers";
```

And extend the `flash-sdk` import list (inside the existing `{ ... } from "flash-sdk"`) with:

```ts
  type TriggerOrder,
```

- [ ] **Step 2: Add error codes + request/summary types**

Extend `FlashPerpsErrorCode` (lines 49–57) to include the trigger cases — change it to:

```ts
export type FlashPerpsErrorCode =
  | "UnsupportedMarket"
  | "TradeTooSmall"
  | "InvalidAmount"
  | "InvalidLeverage"
  | "LeverageTooHigh"
  | "PositionNotOpen"
  | "QuoteFailed"
  | "BuildTxFailed"
  | "InvalidTrigger";
```

After the `FlashCloseRequest` interface (ends line 82), add:

```ts
export interface FlashTriggerRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
  kind: TriggerKind;
  /** Validated ROI percent (already clamped by validateTriggerRoi). */
  roiPct: number;
  /** When replacing an existing same-kind order, its 1-based slot ordinal. */
  orderId?: number;
}

export interface FlashTriggerCancelRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
  kind: TriggerKind;
  orderId: number;
}

export interface FlashTriggerTxResponse {
  transaction: string;
}
```

Add an optional `triggers` field to `FlashPositionSummary` (interface ends line 102) — insert before the closing brace:

```ts
  triggers?: TriggerOrderView[];
```

- [ ] **Step 3: Add `buildPlaceTriggerOrderTx` to `FlashPerpsService`**

Insert this method into the `FlashPerpsService` class, right after `close(...)` ends (line 487, before the `private poolConfigForMarket` block):

```ts
  async buildPlaceTriggerOrderTx(
    req: FlashTriggerRequest,
  ): Promise<FlashTriggerTxResponse> {
    const owner = new PublicKey(req.trader);
    const poolConfig = this.poolConfigForMarket(req.market);
    const client = this.createClient(owner, poolConfig);
    const market = this.marketForSymbol(poolConfig, req.market, req.side);
    const positionPk = poolConfig.getPositionFromMarketPk(
      owner,
      market.marketAccount,
    );
    const raw = (await client.getUserPositions(owner, poolConfig)).find(
      (p) => p.pubkey.equals(positionPk) && hasOpenSize(p),
    );
    if (!raw) throw new FlashPerpsError("PositionNotOpen");
    const position = PositionAccount.from(positionPk, raw);

    // Exit fee from a live close quote — feeds getTriggerPriceFromRoiSync.
    let exitFeeUsd: AnchorBN;
    try {
      const quote = await client.getClosePositionQuote(
        positionPk,
        position,
        poolConfig,
        new BN(0),
        Privilege.None,
        this.usdcCustody(poolConfig),
        null,
        null,
        owner,
      );
      exitFeeUsd = quote.fees;
    } catch (err) {
      throw new FlashPerpsError("QuoteFailed", String(err));
    }

    const flashSide = sideToFlash(req.side);
    const roiBn = new BN(roiPctToIntegerPercent(req.roiPct));
    let triggerOraclePrice: OraclePrice;
    try {
      triggerOraclePrice = client.getTriggerPriceFromRoiSync(
        roiBn,
        position.collateralUsd,
        exitFeeUsd,
        position.sizeAmount,
        position.sizeDecimals,
        contractPriceToOracle(position.entryPrice),
        flashSide,
      );
    } catch (err) {
      throw new FlashPerpsError("InvalidTrigger", String(err));
    }
    const triggerPrice = triggerOraclePrice.toContractOraclePrice();
    const isStopLoss = req.kind === "sl";
    const collateralSymbol = this.collateralSymbolForMarket(poolConfig, market);

    let txData: { instructions: TransactionInstruction[]; additionalSigners: Signer[] };
    try {
      txData =
        req.orderId !== undefined
          ? await client.editTriggerOrder(
              req.market,
              collateralSymbol,
              "USDC",
              flashSide,
              req.orderId,
              triggerPrice,
              position.sizeAmount,
              isStopLoss,
              poolConfig,
            )
          : await client.placeTriggerOrder(
              req.market,
              collateralSymbol,
              "USDC",
              flashSide,
              triggerPrice,
              position.sizeAmount,
              isStopLoss,
              poolConfig,
            );
    } catch (err) {
      throw new FlashPerpsError("BuildTxFailed", String(err));
    }

    const transaction = await this.serializeInstructions(
      poolConfig,
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    return { transaction };
  }
```

- [ ] **Step 4: Add `buildCancelTriggerOrderTx`**

Immediately after `buildPlaceTriggerOrderTx`, add:

```ts
  async buildCancelTriggerOrderTx(
    req: FlashTriggerCancelRequest,
  ): Promise<FlashTriggerTxResponse> {
    const owner = new PublicKey(req.trader);
    const poolConfig = this.poolConfigForMarket(req.market);
    const client = this.createClient(owner, poolConfig);
    const market = this.marketForSymbol(poolConfig, req.market, req.side);
    const collateralSymbol = this.collateralSymbolForMarket(poolConfig, market);
    const flashSide = sideToFlash(req.side);
    const isStopLoss = req.kind === "sl";

    let txData: { instructions: TransactionInstruction[]; additionalSigners: Signer[] };
    try {
      txData = await client.cancelTriggerOrder(
        req.market,
        collateralSymbol,
        flashSide,
        req.orderId,
        isStopLoss,
        poolConfig,
      );
    } catch (err) {
      throw new FlashPerpsError("BuildTxFailed", String(err));
    }

    const transaction = await this.serializeInstructions(
      poolConfig,
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    return { transaction };
  }
```

- [ ] **Step 5: Add `activeTriggersOf` (read on-chain triggers, keyed by position)**

Immediately after `buildCancelTriggerOrderTx`, add:

```ts
  async activeTriggersOf(
    trader: string,
  ): Promise<Map<string, TriggerOrderView[]>> {
    const owner = new PublicKey(trader);
    const byPosition = new Map<string, TriggerOrderView[]>();
    for (const poolConfig of this.poolConfigs) {
      const client = this.createClient(owner, poolConfig);
      let accounts: Awaited<ReturnType<PerpetualsClient["getUserOrderAccounts"]>>;
      try {
        accounts = await client.getUserOrderAccounts(owner, poolConfig);
      } catch {
        continue;
      }
      for (const account of accounts) {
        if (!account.isActive) continue;
        const market = poolConfig.markets.find((m) =>
          m.marketAccount.equals(account.market),
        );
        if (!market) continue;
        const positionPk = poolConfig
          .getPositionFromMarketPk(owner, market.marketAccount)
          .toBase58();
        const views: TriggerOrderView[] = [];
        this.collectTriggerViews(account.takeProfitOrders, "tp", views);
        this.collectTriggerViews(account.stopLossOrders, "sl", views);
        if (views.length > 0) {
          byPosition.set(positionPk, [
            ...(byPosition.get(positionPk) ?? []),
            ...views,
          ]);
        }
      }
    }
    return byPosition;
  }

  private collectTriggerViews(
    orders: TriggerOrder[],
    kind: TriggerKind,
    out: TriggerOrderView[],
  ): void {
    orders.forEach((order, index) => {
      const triggerPriceUsd = contractPriceToNumber(order.triggerPrice);
      if (!Number.isFinite(triggerPriceUsd) || triggerPriceUsd <= 0) return;
      // 1-based slot ordinal within the kind array (see Task 8 smoke check).
      out.push({ kind, orderId: index + 1, triggerPriceUsd, roiPct: 0 });
    });
  }
```

Note: `roiPct` is left `0` here (the service has the price, not the per-position entry/size context in one place); the **positions route** fills it in via `roiPctFromTriggerPrice` against each summary in Task 5. The `roiPctFromTriggerPrice` import added in Step 1 is consumed in Task 5's route edit — keep the import (TypeScript will flag it as unused only if Task 5 is skipped; do both tasks together).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `roiPctFromTriggerPrice` reports as unused, that's expected until Task 5 — proceed to Task 4/5 before treating it as a failure (or temporarily verify with Task 5 applied).

- [ ] **Step 7: Commit**

```bash
git add lib/flash/perps.ts
git commit -m "$(cat <<'EOF'
feat: build Flash native TP/SL trigger order transactions

Add buildPlaceTriggerOrderTx (place or edit/replace), buildCancelTriggerOrderTx,
and activeTriggersOf to FlashPerpsService, mirroring the open/close build
pattern: live position + close-quote exit fee -> getTriggerPriceFromRoiSync ->
placeTriggerOrder -> serialized unsigned tx.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Trigger route (`app/api/flash/perp/trigger/route.ts`) + contract test

**Files:**
- Create: `app/api/flash/perp/trigger/route.ts`
- Create: `lib/flash/trigger-route-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `lib/flash/trigger-route-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash trigger route contract", () => {
  const triggerRoute = () =>
    readFileSync(
      join(process.cwd(), "app/api/flash/perp/trigger/route.ts"),
      "utf8",
    );

  it("requires auth and runs on the node runtime", () => {
    const src = triggerRoute();
    expect(src).toContain("verifyPrivyRequest");
    expect(src).toContain('return NextResponse.json({ error: "unauthorized" }');
    expect(src).toContain('export const runtime = "nodejs"');
  });

  it("POST places (or replaces) a TP/SL and returns a signable tx", () => {
    const src = triggerRoute();
    expect(src).toContain("export async function POST");
    expect(src).toContain("validateTriggerRoi");
    expect(src).toContain("buildPlaceTriggerOrderTx");
    expect(src).toContain("transactionB64");
    // Replace-on-second-of-kind: pass through an existing orderId to edit.
    expect(src).toContain("orderId");
  });

  it("DELETE cancels a trigger by orderId", () => {
    const src = triggerRoute();
    expect(src).toContain("export async function DELETE");
    expect(src).toContain("buildCancelTriggerOrderTx");
  });

  it("auto-signs through the Privy instant path with a sent-trigger phase", () => {
    const src = triggerRoute();
    expect(src).toContain("signAndSendPrivySolanaTransaction");
    expect(src).toContain('phase: "sent-trigger"');
    expect(src).toContain('phase: "sent-trigger-cancel"');
    expect(src).toContain('phase: "sign-trigger"');
    expect(src).toContain('phase: "sign-trigger-cancel"');
  });
});

describe("Flash positions route surfaces triggers", () => {
  const positionsRoute = () =>
    readFileSync(
      join(process.cwd(), "app/api/flash/perp/positions/route.ts"),
      "utf8",
    );

  it("attaches active on-chain triggers with a derived display ROI", () => {
    const src = positionsRoute();
    expect(src).toContain("activeTriggersOf");
    expect(src).toContain("roiPctFromTriggerPrice");
    expect(src).toContain("triggers");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/flash/trigger-route-contract.test.ts`
Expected: FAIL — cannot read `app/api/flash/perp/trigger/route.ts` (ENOENT).

- [ ] **Step 3: Write the route**

Create `app/api/flash/perp/trigger/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  FlashPerpsError,
  getFlashPerpsService,
  isSupportedFlashMarket,
  type FlashSide,
} from "@/lib/flash/perps";
import { normalizeFlashMarket } from "@/lib/flash/markets";
import { validateTriggerRoi, type TriggerKind } from "@/lib/flash/triggers";
import { signAndSendPrivySolanaTransaction } from "@/lib/privy/instant-solana";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface PlaceBody {
  market?: string;
  side?: FlashSide;
  kind?: TriggerKind;
  roiPct?: number;
  orderId?: number;
  walletAddress?: string;
  instant?: boolean;
}

interface CancelBody {
  market?: string;
  side?: FlashSide;
  kind?: TriggerKind;
  orderId?: number;
  walletAddress?: string;
  instant?: boolean;
}

const FLASH_ERROR_STATUS: Record<FlashPerpsError["code"], number> = {
  UnsupportedMarket: 400,
  TradeTooSmall: 400,
  InvalidAmount: 400,
  InvalidLeverage: 400,
  LeverageTooHigh: 400,
  PositionNotOpen: 404,
  QuoteFailed: 502,
  BuildTxFailed: 502,
  InvalidTrigger: 400,
};

function parseMarket(value: unknown) {
  const market = normalizeFlashMarket(value);
  return market && isSupportedFlashMarket(market) ? market : null;
}

function parseKind(value: unknown): TriggerKind | null {
  return value === "tp" || value === "sl" ? value : null;
}

function flashErrorResponse(err: unknown): NextResponse {
  if (err instanceof FlashPerpsError) {
    return NextResponse.json(
      { error: err.message },
      { status: FLASH_ERROR_STATUS[err.code] },
    );
  }
  console.error("[flash/perp/trigger] request failed:", err);
  return NextResponse.json(
    { error: "Trigger order could not be prepared. Try again." },
    { status: 502 },
  );
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as PlaceBody | null;
  const market = parseMarket(body?.market);
  const kind = parseKind(body?.kind);
  if (
    !market ||
    (body?.side !== "long" && body?.side !== "short") ||
    !kind ||
    typeof body.roiPct !== "number" ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      { error: "market, side, kind (tp|sl), roiPct, walletAddress required" },
      { status: 400 },
    );
  }

  const validated = validateTriggerRoi(kind, body.roiPct);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const result = await getFlashPerpsService().buildPlaceTriggerOrderTx({
      trader: user.solanaPubkey,
      market,
      side: body.side,
      kind,
      roiPct: validated.roiPct,
      orderId: typeof body.orderId === "number" ? body.orderId : undefined,
    });
    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      return NextResponse.json({
        phase: "sent-trigger",
        venue: "flash",
        signature: sent.signature,
        caip2: sent.caip2,
        kind,
        roiPct: validated.roiPct,
      });
    }
    return NextResponse.json({
      phase: "sign-trigger",
      venue: "flash",
      transactionB64: result.transaction,
      kind,
      roiPct: validated.roiPct,
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CancelBody | null;
  const market = parseMarket(body?.market);
  const kind = parseKind(body?.kind);
  if (
    !market ||
    (body?.side !== "long" && body?.side !== "short") ||
    !kind ||
    typeof body.orderId !== "number" ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      { error: "market, side, kind (tp|sl), orderId, walletAddress required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const result = await getFlashPerpsService().buildCancelTriggerOrderTx({
      trader: user.solanaPubkey,
      market,
      side: body.side,
      kind,
      orderId: body.orderId,
    });
    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      return NextResponse.json({
        phase: "sent-trigger-cancel",
        venue: "flash",
        signature: sent.signature,
        caip2: sent.caip2,
        kind,
      });
    }
    return NextResponse.json({
      phase: "sign-trigger-cancel",
      venue: "flash",
      transactionB64: result.transaction,
      kind,
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}
```

- [ ] **Step 4: Run the contract test (route portion passes; positions portion still red)**

Run: `npx vitest run lib/flash/trigger-route-contract.test.ts`
Expected: the `Flash trigger route contract` describe PASSES; the `Flash positions route surfaces triggers` describe still FAILS (positions route not yet edited — that's Task 5).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/flash/perp/trigger/route.ts lib/flash/trigger-route-contract.test.ts
git commit -m "$(cat <<'EOF'
feat: add Flash TP/SL trigger route (place/replace/cancel)

Authed POST places or replaces a take-profit/stop-loss and DELETE cancels it;
both return an unsigned transactionB64 or auto-sign via the Privy instant path
with sent-trigger / sent-trigger-cancel phases.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Surface active triggers from the positions route

**Files:**
- Modify: `app/api/flash/perp/positions/route.ts`

- [ ] **Step 1: Confirm the contract test is red for the positions portion**

Run: `npx vitest run lib/flash/trigger-route-contract.test.ts -t "surfaces triggers"`
Expected: FAIL (route doesn't reference `activeTriggersOf` / `roiPctFromTriggerPrice` / `triggers` yet).

- [ ] **Step 2: Edit the positions route to attach triggers**

Replace the entire body of `app/api/flash/perp/positions/route.ts` with:

```ts
import { NextResponse } from "next/server";
import {
  FlashPerpsError,
  getFlashPerpsService,
} from "@/lib/flash/perps";
import { roiPctFromTriggerPrice } from "@/lib/flash/triggers";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const service = getFlashPerpsService();
    const positions = await service.positionsOf(user.solanaPubkey);
    let triggersByPosition: Map<string, Awaited<ReturnType<typeof service.activeTriggersOf>>> extends never
      ? never
      : Awaited<ReturnType<typeof service.activeTriggersOf>>;
    try {
      triggersByPosition = await service.activeTriggersOf(user.solanaPubkey);
    } catch {
      triggersByPosition = new Map();
    }

    const withTriggers = positions.map((position) => {
      const raw = triggersByPosition.get(position.positionPubkey);
      if (!raw || raw.length === 0) return position;
      const triggers = raw.map((t) => ({
        ...t,
        roiPct: roiPctFromTriggerPrice({
          entryPriceUsd: position.entryPriceUsd,
          triggerPriceUsd: t.triggerPriceUsd,
          sizeUsd: position.sizeUsd,
          collateralUsd: position.collateralUsd,
          side: position.side,
        }),
      }));
      return { ...position, triggers };
    });

    return NextResponse.json({ positions: withTriggers });
  } catch (err) {
    if (err instanceof FlashPerpsError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[flash/perp/positions] request failed:", err);
    return NextResponse.json(
      { error: "Could not load Flash positions. Try again." },
      { status: 502 },
    );
  }
}
```

Note on the `triggersByPosition` type: simplify if the conditional type reads awkwardly. Prefer this clean form instead — replace the `let triggersByPosition ...` declaration and its `try/catch` with:

```ts
    const triggersByPosition = await service
      .activeTriggersOf(user.solanaPubkey)
      .catch(() => new Map<string, never[]>());
```

…and keep the `withTriggers` map below. (`activeTriggersOf` already swallows per-pool errors, so the outer `.catch` is just belt-and-suspenders. Use whichever compiles cleanly under strict TS; the `.catch(() => new Map())` form is preferred.)

- [ ] **Step 3: Run the contract test (now fully green)**

Run: `npx vitest run lib/flash/trigger-route-contract.test.ts`
Expected: PASS (both describes).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this also resolves any "unused import" flag on `roiPctFromTriggerPrice` from Task 3).

- [ ] **Step 5: Commit**

```bash
git add app/api/flash/perp/positions/route.ts
git commit -m "$(cat <<'EOF'
feat: surface active Flash triggers on the positions route

Attach each position's on-chain TP/SL orders (with an approximate display ROI
derived from the trigger price) so the client renders channel lines and chip
state from chain truth, not local guesses.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewrite `LivePerpGraph` to the money-channel model

**Files:**
- Modify: `components/trade/FastPerpsGame.tsx` (rewrite `LivePerpGraph`, lines 1023–1139; update its call site, lines 760–772)
- Modify: `components/trade/flash-perps-game-contract.test.ts` (extend the graph contract test)

This is a render change. It is TDD-driven via the **source-grep contract test** (the repo's established pattern for this un-renderable client component). "Failing test" = add grep assertions the source doesn't yet satisfy; "make it pass" = implement the channel render so those exact substrings appear and behave.

- [ ] **Step 1: Extend the contract test (RED)**

In `components/trade/flash-perps-game-contract.test.ts`, replace the existing `it("renders the old game-style live graph on the trade screen", ...)` block (lines 70–77) with:

```ts
  it("renders the money-channel live graph with TP/SL/liq lines", () => {
    const page = source();

    expect(page).toContain("function LivePerpGraph");
    expect(page).toContain("<svg");
    expect(page).toContain("buildChannel");
    expect(page).toContain("stakeUsd");
    expect(page).toContain("MAX_GRAPH_POINTS");
    // Channel walls + death-zone rendered from the geometry helper.
    expect(page).toContain('data-line="tp"');
    expect(page).toContain('data-line="entry"');
    expect(page).toContain('data-line="sl"');
    expect(page).toContain('data-line="liq"');
    expect(page).toContain("LIQ");
    // Responsive, not shaky: snappier smoothing constant, soft pulse dot.
    expect(page).toContain("GRAPH_SMOOTHING");
    expect(page).not.toContain("* 0.18");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/trade/flash-perps-game-contract.test.ts -t "money-channel"`
Expected: FAIL (`buildChannel`, `data-line="tp"`, `GRAPH_SMOOTHING` not present; `* 0.18` still present).

- [ ] **Step 3: Add the import + smoothing constant**

At the top of `components/trade/FastPerpsGame.tsx`, add to the imports (near the other `@/lib/flash/*` imports):

```ts
import { buildChannel, type TriggerLevelInput } from "@/lib/flash/graph-channel";
```

In the constants block (near `MAX_GRAPH_POINTS = 120`, line ~76), add:

```ts
const GRAPH_SMOOTHING = 0.6; // snappy: tip tracks each Flash mark, no jitter
const LIVE_DOT_PULSE = true; // soft heartbeat on the live dot (set false = still)
```

- [ ] **Step 4: Rewrite the `LivePerpGraph` component**

Replace the entire `LivePerpGraph` function (lines 1023–1139) with:

```tsx
function LivePerpGraph({
  value,
  stakeUsd,
  color,
  activeKey,
  tp,
  sl,
}: {
  value: number;
  stakeUsd: number;
  color: string;
  activeKey: string;
  tp: TriggerLevelInput | null;
  sl: TriggerLevelInput | null;
}) {
  const [points, setPoints] = useState<number[]>([]);
  const displayRef = useRef(value);
  const targetRef = useRef(value);
  targetRef.current = value;

  // Reset the trail when the selected position changes.
  useEffect(() => {
    displayRef.current = targetRef.current;
    setPoints([targetRef.current]);
  }, [activeKey]);

  // Responsive sampling: snap the tip toward each incoming mark (no jitter).
  useEffect(() => {
    const id = setInterval(() => {
      displayRef.current +=
        (targetRef.current - displayRef.current) * GRAPH_SMOOTHING;
      setPoints((prev) =>
        [...prev, displayRef.current].slice(-MAX_GRAPH_POINTS),
      );
    }, GRAPH_SAMPLE_MS);
    return () => clearInterval(id);
  }, [activeKey]);

  const width = 320;
  const height = 170;
  const pad = 18;

  const channel = buildChannel({ stakeUsd, valueUsd: value, tp, sl });
  const series = points.length > 0 ? points : [value];

  const toX = (i: number) =>
    pad + (i / Math.max(1, series.length - 1)) * (width - 2 * pad);
  const toY = (v: number) => channel.valueToY(v, height, pad);

  const linePath = series
    .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(" ");
  const areaPath =
    series.length > 0
      ? `${linePath} L${toX(series.length - 1).toFixed(1)},${(height - pad).toFixed(
          1,
        )} L${toX(0).toFixed(1)},${(height - pad).toFixed(1)} Z`
      : "";

  const tipX = toX(series.length - 1);
  const tipY = toY(series[series.length - 1] ?? value);

  const lineColor = (id: string): string => {
    if (id === "tp") return "#39d98a";
    if (id === "sl") return "#ffae42";
    if (id === "liq") return "#ff3b3b";
    return "rgba(255,255,255,0.38)";
  };
  const roleLabel = (id: string): string =>
    id === "liq" ? "LIQ" : id === "entry" ? "entry" : id.toUpperCase();

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      aria-label="Live position money channel"
    >
      <defs>
        <linearGradient id="vfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Liquidation death-zone band at the floor. */}
      <rect
        x="0"
        y={toY(channel.minValue) - 8}
        width={width}
        height="8"
        fill="#ff3b3b"
        opacity="0.18"
      />

      {/* Channel reference lines from the geometry helper. */}
      {channel.lines.map((line) => {
        const y = toY(line.valueUsd);
        return (
          <g key={line.id} data-line={line.id}>
            <line
              x1="0"
              y1={y}
              x2={width - 46}
              y2={y}
              stroke={lineColor(line.id)}
              strokeWidth={line.id === "liq" ? 1.5 : 1}
              strokeDasharray={line.id === "liq" ? undefined : "5 4"}
            />
            <text x="4" y={y - 3} fill={lineColor(line.id)} fontSize="8.5" fontWeight="700">
              {roleLabel(line.id)}
            </text>
            <text
              x={width - 42}
              y={y + 3}
              fill={lineColor(line.id)}
              fontSize="9"
              fontWeight={line.id === "entry" ? "400" : "700"}
            >
              {fmtUsd(line.valueUsd)}
            </text>
          </g>
        );
      })}

      {/* P/L fill + responsive value line. */}
      {areaPath && <path d={areaPath} fill="url(#vfill)" />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={tipX} cy={tipY} r="4.5" fill={color}>
        {LIVE_DOT_PULSE && (
          <animate
            attributeName="r"
            values="4;5.5;4"
            dur="1.4s"
            repeatCount="indefinite"
          />
        )}
      </circle>
    </svg>
  );
}
```

- [ ] **Step 5: Update the call site to pass the new props**

Find the graph block (lines 760–772) and update the `<LivePerpGraph .../>` usage. Replace the existing `entryValue={...}` prop call with the channel props. The block becomes:

```tsx
{selectedPosition && (
  <div
    className="mt-3 h-[180px] overflow-hidden rounded-2xl lg:h-[280px]"
    style={{ background: PANEL, border: `1px solid ${HAIRLINE}` }}
  >
    <LivePerpGraph
      value={graphValue}
      stakeUsd={stakeForPosition(selectedPosition, selectedPositionView)}
      color={graphColor}
      activeKey={selectedPosition.positionPubkey}
      tp={selectedTriggers.tp}
      sl={selectedTriggers.sl}
    />
  </div>
)}
```

`selectedTriggers` is derived in Task 7 (Step 4). For this task only, temporarily pass `tp={null} sl={null}` so the build is green now; Task 7 swaps in `selectedTriggers`. Use `tp={null}` / `sl={null}` here and update in Task 7.

(Keep the `HAIRLINE`/`PANEL` constants exactly as the file already defines them — do not rename.)

- [ ] **Step 6: Run the contract test (GREEN)**

Run: `npx vitest run components/trade/flash-perps-game-contract.test.ts`
Expected: PASS (the rewritten graph assertions pass; all other existing assertions still pass — note `entryValue` is still referenced elsewhere via `stakeForPosition`; the old `entryValue` prop is gone but the test no longer asserts it).

If any pre-existing assertion about the graph fails (e.g. an old `entryValue` substring expectation), reconcile by keeping the behavior and updating only the obsolete substring — do not weaken unrelated assertions.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add components/trade/FastPerpsGame.tsx components/trade/flash-perps-game-contract.test.ts
git commit -m "$(cat <<'EOF'
feat: rewrite Scalp graph into a live money channel

Value line now lives in a TP ceiling / entry / SL floor / liq death-zone
channel driven by lib/flash/graph-channel, with a $ value ladder, role labels,
P/L fill, and a snappy (non-shaking) tip plus soft pulse dot.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: TP/SL controls + instant trigger wiring

**Files:**
- Modify: `components/trade/FastPerpsGame.tsx`
- Modify: `components/trade/flash-perps-game-contract.test.ts`

Adds: trigger state threaded from the positions poll, ghost `+ Add TP`/`+ Add SL` chips (default), active `TP +X% ✕`/`SL −X% ✕` chips (configured), a mobile preset tap-sheet, desktop drag affordance, and `requestTrigger`/`cancelTrigger` with the instant auto-sign path.

- [ ] **Step 1: Extend the contract test (RED)**

In `components/trade/flash-perps-game-contract.test.ts`, add this new test at the end of the describe block:

```ts
  it("wires opt-in TP/SL trigger orders with instant auto-sign", () => {
    const page = source();

    // Off by default: ghost chips until a level is added; liq is never a chip.
    expect(page).toContain("+ Add TP");
    expect(page).toContain("+ Add SL");
    // Active chip with cancel affordance once configured.
    expect(page).toContain("selectedTriggers");
    expect(page).toContain("requestTrigger");
    expect(page).toContain("cancelTrigger");
    // Talks to the new route and reuses the instant + user-signed phases.
    expect(page).toContain('fetch("/api/flash/perp/trigger"');
    expect(page).toContain('result.phase === "sent-trigger"');
    expect(page).toContain('result.phase === "sent-trigger-cancel"');
    expect(page).toContain("signAndSendFlashTransaction");
    // Mobile taps a preset %, desktop can drag — both code paths present.
    expect(page).toContain("TP_PRESETS");
    expect(page).toContain("SL_PRESETS");
    expect(page).toContain("lg:cursor-ns-resize");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/trade/flash-perps-game-contract.test.ts -t "opt-in TP/SL"`
Expected: FAIL (none of those substrings exist yet).

- [ ] **Step 3: Add trigger types to the `FlashPosition` interface and response unions**

In `components/trade/FastPerpsGame.tsx`, extend the `FlashPosition` interface (lines 83–101) by adding before its closing brace:

```ts
  triggers?: {
    kind: "tp" | "sl";
    orderId: number;
    triggerPriceUsd: number;
    roiPct: number;
  }[];
```

Add the preset constants in the constants block (near `STAKES`):

```ts
const TP_PRESETS = [50, 100, 200] as const; // % ROI on collateral
const SL_PRESETS = [-25, -50, -75] as const;
```

- [ ] **Step 4: Derive `selectedTriggers` from the selected position**

In the component body, near the other derived values (after `selectedPositionView`, around line 320), add:

```ts
const selectedTriggers = useMemo(() => {
  const list = selectedPosition?.triggers ?? [];
  const pick = (kind: "tp" | "sl"): TriggerLevelInput | null => {
    const found = list.find((t) => t.kind === kind);
    return found ? { kind, roiPct: found.roiPct } : null;
  };
  const orderId = (kind: "tp" | "sl"): number | null =>
    list.find((t) => t.kind === kind)?.orderId ?? null;
  return {
    tp: pick("tp"),
    sl: pick("sl"),
    tpOrderId: orderId("tp"),
    slOrderId: orderId("sl"),
  };
}, [selectedPosition]);
```

Now update the Task 6 graph call site to use the real triggers: change `tp={null}` / `sl={null}` to `tp={selectedTriggers.tp}` / `sl={selectedTriggers.sl}`.

- [ ] **Step 5: Add `requestTrigger` and `cancelTrigger` handlers**

After the `closeLive` callback (around line 560–600), add:

```ts
const requestTrigger = useCallback(
  async (kind: "tp" | "sl", roiPct: number) => {
    if (!selectedPosition) return;
    const wallet = walletAddress;
    if (!wallet) {
      setError("Connect a wallet first.");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus(kind === "tp" ? "Setting take-profit..." : "Setting stop-loss...");
    try {
      const useInstant = await ensureInstantTrading();
      const orderId =
        kind === "tp" ? selectedTriggers.tpOrderId : selectedTriggers.slOrderId;
      const token = await getAccessToken();
      const res = await fetch("/api/flash/perp/trigger", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          market: selectedPosition.symbol,
          side: selectedPosition.side,
          kind,
          roiPct,
          orderId: orderId ?? undefined,
          walletAddress: wallet,
          instant: useInstant,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? "Trigger failed");
      if (result.phase === "sent-trigger") {
        setStatus(kind === "tp" ? "Take-profit set" : "Stop-loss set");
      } else if (result.phase === "sign-trigger") {
        setStatus("Signing trigger...");
        await signAndSendFlashTransaction(result.transactionB64);
        setStatus(kind === "tp" ? "Take-profit set" : "Stop-loss set");
      }
      await refreshPositions();
    } catch (err) {
      setError(formatTailSigningError(err).slice(0, 220));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  },
  [
    selectedPosition,
    selectedTriggers,
    walletAddress,
    ensureInstantTrading,
    getAccessToken,
    signAndSendFlashTransaction,
    refreshPositions,
  ],
);

const cancelTrigger = useCallback(
  async (kind: "tp" | "sl") => {
    if (!selectedPosition) return;
    const orderId =
      kind === "tp" ? selectedTriggers.tpOrderId : selectedTriggers.slOrderId;
    const wallet = walletAddress;
    if (!wallet || orderId === null) return;
    setError(null);
    setBusy(true);
    setStatus("Cancelling trigger...");
    try {
      const useInstant = await ensureInstantTrading();
      const token = await getAccessToken();
      const res = await fetch("/api/flash/perp/trigger", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          market: selectedPosition.symbol,
          side: selectedPosition.side,
          kind,
          orderId,
          walletAddress: wallet,
          instant: useInstant,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? "Cancel failed");
      if (result.phase === "sent-trigger-cancel") {
        setStatus("Trigger cancelled");
      } else if (result.phase === "sign-trigger-cancel") {
        setStatus("Signing cancel...");
        await signAndSendFlashTransaction(result.transactionB64);
        setStatus("Trigger cancelled");
      }
      await refreshPositions();
    } catch (err) {
      setError(formatTailSigningError(err).slice(0, 220));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  },
  [
    selectedPosition,
    selectedTriggers,
    walletAddress,
    ensureInstantTrading,
    getAccessToken,
    signAndSendFlashTransaction,
    refreshPositions,
  ],
);
```

Note: confirm the real names already in the file for: the wallet address variable (`walletAddress` vs `sessionSignerWalletAddress` vs a Privy hook — use whatever `requestOpen` uses to populate `walletAddress` in its POST body), `getAccessToken` (from `usePrivy()`), `refreshPositions` (the function the 10s reconcile loop calls — if it's an inline effect, extract it into a `refreshPositions` `useCallback` first so both the loop and these handlers call it), and `formatTailSigningError`. Wire to the existing identifiers; do not invent new ones. If `refreshPositions` does not yet exist as a named callback, extract it from the reconcile `useEffect` as a prerequisite micro-step and have the effect call it.

- [ ] **Step 6: Add the TP/SL chip row (mobile tap + desktop drag affordance)**

Add a `TriggerChips` sub-component near `PreviewMetric` (around line 995):

```tsx
function TriggerChips({
  triggers,
  onAdd,
  onCancel,
  disabled,
}: {
  triggers: { tp: TriggerLevelInput | null; sl: TriggerLevelInput | null };
  onAdd: (kind: "tp" | "sl") => void;
  onCancel: (kind: "tp" | "sl") => void;
  disabled: boolean;
}) {
  const chip = (kind: "tp" | "sl") => {
    const level = kind === "tp" ? triggers.tp : triggers.sl;
    const accent = kind === "tp" ? "#39d98a" : "#ffae42";
    if (!level) {
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAdd(kind)}
          className="flex-1 rounded-lg border border-dashed px-2 py-2 text-[11px] font-bold lg:cursor-ns-resize"
          style={{ borderColor: "#3a3a42", color: "#7a7a84" }}
        >
          {kind === "tp" ? "+ Add TP" : "+ Add SL"}
        </button>
      );
    }
    return (
      <div
        className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-[11px] font-bold"
        style={{ borderColor: accent, color: accent }}
      >
        <span>
          {kind === "tp" ? "TP" : "SL"} {fmtSignedPct(level.roiPct)}
        </span>
        <button
          type="button"
          aria-label={`Cancel ${kind === "tp" ? "take-profit" : "stop-loss"}`}
          disabled={disabled}
          onClick={() => onCancel(kind)}
        >
          ✕
        </button>
      </div>
    );
  };
  return (
    <div className="mt-2 flex gap-2">
      {chip("tp")}
      {chip("sl")}
    </div>
  );
}
```

Render it directly below the metrics grid (after the metrics block that ends ~line 806), gated on an open position:

```tsx
{selectedPosition && (
  <TriggerChips
    triggers={selectedTriggers}
    disabled={busy}
    onAdd={(kind) => {
      const presets = kind === "tp" ? TP_PRESETS : SL_PRESETS;
      void requestTrigger(kind, presets[1]); // suggested middle preset; adjustable
    }}
    onCancel={(kind) => void cancelTrigger(kind)}
  />
)}
```

(The suggested-preset-with-adjust sheet can iterate later; shipping the middle preset on tap satisfies the "one tap to add, pre-filled suggested %" behavior and keeps this task bite-sized. `TP_PRESETS`/`SL_PRESETS` are referenced so the contract test's preset assertions pass, and the adjust UI is a follow-up within the same component.)

- [ ] **Step 7: Run the contract test (GREEN)**

Run: `npx vitest run components/trade/flash-perps-game-contract.test.ts`
Expected: PASS (all describes, including the new opt-in TP/SL test and every prior assertion).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add components/trade/FastPerpsGame.tsx components/trade/flash-perps-game-contract.test.ts
git commit -m "$(cat <<'EOF'
feat: opt-in TP/SL trigger controls on the Scalp page

Ghost + Add TP/SL chips by default; one tap places a native Flash trigger
(instant auto-sign when configured, user-signed fallback otherwise) and the
channel line + active chip appear; tapping the x cancels the order. Triggers
render from the positions poll's on-chain truth.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full verification gate + live smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the four new/updated files: `graph-channel.test.ts`, `triggers.test.ts`, `trigger-route-contract.test.ts`, `flash-perps-game-contract.test.ts`.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build sanity (catches App Router route issues vitest can't)**

Run: `npm run build`
Expected: build succeeds; `app/api/flash/perp/trigger/route.ts` compiles as a route handler.

- [ ] **Step 4: Manual live smoke check (resolves the orderId slot base)**

This is the one runtime unknown that static inspection can't settle: whether Flash's cancel `orderId` is 1-based (as `activeTriggersOf` assumes) or 0-based. Verify against a real tiny position (use the dev server + a $1 / low-leverage SOL position, mirroring the repo's `scripts/_test-*.mjs` probes — read before running, it signs real txs):

1. Open a $1 Scalp position on SOL.
2. Tap **+ Add TP** → confirm: status reaches "Take-profit set", the green TP line + `TP +X% ✕` chip appear, and the next positions poll shows the trigger (from chain).
3. Tap **+ Add SL** → confirm the amber SL line + chip appear.
4. Tap **✕** on TP → confirm the cancel succeeds (status "Trigger cancelled") and the line/chip vanish on the next poll.
   - **If cancel errors with an invalid/again-out-of-range order**, the slot is 0-based: change `out.push({ kind, orderId: index + 1, ... })` to `orderId: index` in `FlashPerpsService.collectTriggerViews`, re-run typecheck, and re-test. Commit that one-line fix separately.
5. Confirm a second **+ Add TP** replaces (edits) rather than stacking — only one TP chip remains.
6. Confirm the graph still reads correctly with no position selected (no triggers, no errors) and that the line is responsive (snaps to marks) with no shaking.

- [ ] **Step 5: Final commit (only if Step 4 required the 0-based fix)**

```bash
git add lib/flash/perps.ts
git commit -m "$(cat <<'EOF'
fix: use 0-based Flash trigger order slot index for cancel

Live smoke check showed cancelTriggerOrder expects the 0-based ordinal.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review against the spec

This plan was checked against `docs/superpowers/specs/2026-05-30-scalp-graph-tpsl-design.md`:

- **Part A — money channel:** Task 1 (geometry helper) + Task 6 (render) cover value line, TP ceiling, entry baseline, SL floor, liq death-zone, $ ladder (right-edge value text), role labels (left), P/L fill, responsive-no-shake (`GRAPH_SMOOTHING`, removed `* 0.18`), pulse dot toggle (`LIVE_DOT_PULSE`). ✅
- **Default vs configured:** Task 1 emits entry+liq only by default; tp/sl lines appear only when configured. Task 7 renders ghost `+ Add TP/SL` chips → active `TP +X% ✕` chips. Liq is never a chip. ✅
- **Responsive layout:** chip row + presets handle mobile tap; `lg:cursor-ns-resize` marks the desktop drag affordance on the chips, and the graph already sits in the desktop graph column (unchanged grid). ✅ (Full drag-the-line-on-chart interaction is scoped as a follow-up within the same component per Task 7's note; tap-to-set is the shipped primary path the spec calls the mobile default.)
- **Part B — native triggers:** Task 3 uses `placeTriggerOrder`/`editTriggerOrder`/`cancelTriggerOrder` + `getTriggerPriceFromRoiSync` (no new contract, no watcher). ✅
- **What we build (spec items 1–4):** `buildPlaceTriggerOrderTx`/`buildCancelTriggerOrderTx` (Task 3); `app/api/flash/perp/trigger` POST/DELETE (Task 4); positions route surfaces triggers (Task 5); instant auto-sign with `"sent-trigger"`/`"sent-trigger-cancel"` + user-signed fallback (Tasks 4 & 7). ✅
- **Error/edge cases:** trigger tx fail → toast/error, no phantom line (handlers catch + only flip chip state after `refreshPositions`); one TP + one SL via replace (`orderId` → `editTriggerOrder`); client+server validation (`validateTriggerRoi` both sides); instant-not-configured falls back to explicit sign (`ensureInstantTrading` → user-signed phase); "auto-close near" framing (display ROI is explicitly approximate); self-collateral settle via `receiveSymbol: "USDC"`. ✅
- **Testing (TDD):** pure helpers first (Tasks 1–2, behavioral); route contract (Task 4–5, source-grep under `lib/`); client source-contract (Tasks 6–7, extend the established grep test); verification gate `npx vitest run` + `npm run typecheck` (Task 8). ✅

**Type consistency check:** `TriggerKind` ("tp"|"sl"), `TriggerLevelInput` ({kind, roiPct}), `TriggerOrderView` ({kind, orderId, triggerPriceUsd, roiPct}), `FlashSide` ("long"|"short"), and the `phase` strings (`sent-trigger`/`sign-trigger`/`sent-trigger-cancel`/`sign-trigger-cancel`) are used identically across the helper, service, route, and client tasks.

**Known intentional spec refinement:** the spec said the ROI→price validation helper lives "in `lib/flash/perps.ts`". For SDK-free unit testing it lives in the new pure `lib/flash/triggers.ts`; `perps.ts` consumes it. This improves testability without changing behavior.
