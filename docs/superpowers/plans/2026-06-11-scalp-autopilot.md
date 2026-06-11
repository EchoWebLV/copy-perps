# Scalp Autopilot (Phase 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Autopilot mode for the Scalp game — the user allocates a $5–$200 session budget and a risk tier, and a lease-guarded server loop scalps BTC/ETH/SOL on Flash from the user's own wallet via Privy instant signing, with every trade persisted as a `flash-tail` bet row and the budget as an absolute loss bound.

**Architecture:** A new `autopilot_sessions` table plus five small `lib/autopilot/` modules (pure tiers → pure brain → pure shell → db sessions → injectable-deps engine) driven by a third lease-guarded in-process ticker copied from the whale ticker pattern. Trades reuse Phase 1's flash-tail persistence wholesale: opens/closes are `bets` rows of type `flash-tail` with `meta.sourceKind: 'autopilot'` and a new `meta.autopilotSessionId`, so the existing confirm/reconcile sweep and external-close liveness pass cover autopilot rows with zero new machinery. Execution calls lib functions in-process (`getFlashPerpsService()`, `signAndSendPrivySolanaTransaction`) — no HTTP self-calls.

**Tech Stack:** Next.js 16 App Router (route handler + instrumentation boot), Drizzle ORM on postgres.js, Flash Trade via `flash-sdk` (`lib/flash/perps.ts`), Privy server wallet API (`lib/privy/instant-solana.ts`), Hyperliquid/Pacifica market data (`lib/data/candles.ts`, `lib/data/marks.ts`), Vitest, React 19 client component for the panel.

**Prerequisites:** `feat/flash-tail-persistence` merged INCLUDING the in-flight follow-ups (closeReason `'external'` on `FlashTailMeta` + the closed-history rendering module `lib/positions/flash-tail-closed.ts` — both are already in the working tree; read files as they are). Privy instant trading configured in env (`NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID` / `NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS` client-side, `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY` server-side). Verification gate is `npm run typecheck && npm test` (there is NO lint script).

---

## Safety rules (binding for every task)

1. **NEVER run any `scripts/reset-*.ts` script.** They destroy the live paper-bot experiment irrecoverably. Nothing in this plan needs them.
2. **`npm run db:push` (Task 1 only):** before confirming, read the statement list drizzle-kit prints. The ONLY acceptable statements are `CREATE TABLE "autopilot_sessions" ...` and its two `CREATE INDEX` statements. If drizzle proposes an ALTER, DROP, or CREATE against ANY other table, answer **No / abort**, stop the task, and report — the schema file was touched beyond Task 1's diff or the DB has drifted.
3. The working tree may contain uncommitted changes from a parallel session. `git add` only the exact paths each task lists — never `git add -A` / `git add .`.
4. Verification for every task = `npm run typecheck && npm test` (plus the task's own test command). Do not claim a task done without running it.

## Spec divergences locked by design review (do not "fix" these)

- **Stop closes nothing (v1).** The spec says open positions close on stop; v1 ships DELETE = engine stops managing, open positions keep their on-chain TP/SL triggers. The API response message documents this to the user.
- **No LLM in the brain (v1).** The spec sketches a Grok catalyst layer; v1 ports the deterministic Blitz 15m momentum math, self-contained, no `ExternalSignals`. The shell/brain split keeps the LLM seam open for later.
- **In-process execution.** Entries/exits call `lib/flash/perps.ts` + `lib/privy/instant-solana.ts` directly instead of HTTP-ing our own `/api/flash/perp` routes — same code path the routes use, minus a network hop and auth dance.
- **Decision audit journal deferred.** v1 logs every decision (including skipped entries and why) to the server console via `TickResult`; a persisted per-session journal is a follow-up.

---

## Task 1 — `autopilot_sessions` table

Files: `lib/db/schema.ts`

- [ ] **1.1** Open `lib/db/schema.ts` and append the new table at the end of the file (after `pulseComments`):

```ts
// One row per Autopilot run. The budget is the ABSOLUTE loss bound for the
// session: the engine can never deploy more than what losses have left of
// it. realizedPnlUsd is an opportunistic cache — the source of truth is the
// session's bets rows (type 'flash-tail', meta.autopilotSessionId = id),
// recomputed by lib/autopilot/sessions.ts#sessionStats each tick.
export const autopilotSessions = pgTable(
  "autopilot_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    budgetUsd: doublePrecision("budget_usd").notNull(),
    tier: text("tier").notNull(), // 'cruise' | 'sweat' | 'degen'
    status: text("status").notNull().default("active"), // 'active' | 'stopped' | 'exhausted' | 'target'
    realizedPnlUsd: doublePrecision("realized_pnl_usd").notNull().default(0),
    // Reserved for per-session tier overrides; v1 always writes null.
    config: jsonb("config"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("autopilot_sessions_status_idx").on(t.status),
    userStartedIdx: index("autopilot_sessions_user_started_idx").on(
      t.userId,
      t.startedAt,
    ),
  }),
);
```

- [ ] **1.2** Typecheck:

```bash
npm run typecheck
```

Expected: exits 0, no output.

- [ ] **1.3** Push the schema (requires `DATABASE_URL` in `.env.local`):

```bash
npm run db:push
```

Expected output (verbose mode prints the statements): a `CREATE TABLE "autopilot_sessions" (...)` statement plus `CREATE INDEX "autopilot_sessions_status_idx" ...` and `CREATE INDEX "autopilot_sessions_user_started_idx" ...`, then an "applied" confirmation. **If ANY statement touches a table other than `autopilot_sessions`, abort (answer No), stop, and report per Safety rule 2.** Note: the `autopilot_ticker_lease` table (Task 9) is deliberately NOT in the Drizzle schema — it is created at runtime via `CREATE TABLE IF NOT EXISTS`, same as `whale_ticker_lease`.

- [ ] **1.4** Commit:

```bash
git add lib/db/schema.ts
git commit -m "feat(db): autopilot_sessions table" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2 — flash-tail meta extension (`'autopilot'` lineage + `autopilotSessionId`)

Files: `lib/bets/flash-tail-meta.ts`, `lib/bets/flash-tail-meta.test.ts`

The `sourceKind` unions on `TailLineage` and `FlashTailMeta` gain `'autopilot'` (whaleId/botId stay null, sourceName is `'Autopilot'`), and `FlashTailMeta` gains an **optional** `autopilotSessionId?: string | null`. Optional is load-bearing: `lib/bets/flash-reconcile.test.ts` and other tests build `FlashTailMeta` object literals without the field — a required field would break their typecheck. `buildFlashTailMeta`/`parseFlashTailMeta` always populate it (null default), so runtime values are never `undefined`.

- [ ] **2.1** (TDD: failing tests first) Append to `lib/bets/flash-tail-meta.test.ts`, inside the existing `describe("flash-tail meta", ...)` block (after the last `it`):

```ts
  it("round-trips an autopilot lineage with a session id", () => {
    const meta = buildFlashTailMeta({
      lineage: {
        sourceKind: "autopilot",
        whaleId: null,
        botId: null,
        sourceName: "Autopilot",
        sourcePositionId: null,
      },
      market: "BTC",
      side: "short",
      leverage: 500,
      mode: "degen",
      walletAddress: "wallet-1",
      entryPriceUsd: 110_000,
      notionalUsd: 500,
      openFeeUsd: 0.2,
      autopilotSessionId: "sess-1",
    });
    expect(meta.sourceKind).toBe("autopilot");
    expect(meta.autopilotSessionId).toBe("sess-1");
    expect(meta.whaleId).toBeNull();
    expect(meta.botId).toBeNull();
    expect(parseFlashTailMeta(meta)).toEqual(meta);
  });

  it("defaults autopilotSessionId to null when absent (legacy rows)", () => {
    const meta = buildFlashTailMeta({
      lineage,
      market: "SOL",
      side: "long",
      leverage: 20,
      mode: "standard",
      walletAddress: "wallet-1",
      entryPriceUsd: 160,
      notionalUsd: 20,
      openFeeUsd: 0.01,
    });
    expect(meta.autopilotSessionId).toBeNull();
    // A pre-Phase-3c row in the DB has no autopilotSessionId key at all.
    const legacy = { ...meta } as Record<string, unknown>;
    delete legacy.autopilotSessionId;
    expect(parseFlashTailMeta(legacy)?.autopilotSessionId).toBeNull();
  });

  it("rejects a corrupted autopilotSessionId", () => {
    const valid = buildFlashTailMeta({
      lineage,
      market: "SOL",
      side: "long",
      leverage: 20,
      mode: "standard",
      walletAddress: "wallet-1",
      entryPriceUsd: 160,
      notionalUsd: 20,
      openFeeUsd: 0.01,
    });
    expect(parseFlashTailMeta({ ...valid, autopilotSessionId: 5 })).toBeNull();
  });

  it("parseTailLineage accepts autopilot with no ids", () => {
    expect(
      parseTailLineage({ sourceKind: "autopilot", sourceName: "Autopilot" }),
    ).toEqual({
      sourceKind: "autopilot",
      whaleId: null,
      botId: null,
      sourceName: "Autopilot",
      sourcePositionId: null,
    });
    // whale/bot arms still require their ids
    expect(parseTailLineage({ sourceKind: "whale" })).toBeNull();
    expect(parseTailLineage({ sourceKind: "bot" })).toBeNull();
  });
```

- [ ] **2.2** Run the test file and watch it fail (the union doesn't accept `"autopilot"` yet — this is a compile failure, which counts):

```bash
npx vitest run lib/bets/flash-tail-meta.test.ts
```

Expected: FAIL (TS errors on `sourceKind: "autopilot"` / `autopilotSessionId`).

- [ ] **2.3** Apply the meta changes — five precise edits to `lib/bets/flash-tail-meta.ts`:

Edit 1 — `TailLineage` union:

```ts
export type TailLineage = {
  sourceKind: "whale" | "bot" | "autopilot";
  whaleId: string | null;
  botId: string | null;
  sourceName: string | null;
  sourcePositionId: string | null;
};
```

Edit 2 — `FlashTailMeta` union + new field (replace the `sourceKind` line and add `autopilotSessionId` right after `sourcePositionId`):

```ts
export type FlashTailMeta = {
  sourceType: "flash-tail";
  venue: "flash";
  sourceKind: "whale" | "bot" | "autopilot";
  whaleId: string | null;
  botId: string | null;
  sourceName: string | null;
  sourcePositionId: string | null;
  // Set when sourceKind === 'autopilot': the autopilot_sessions row that
  // opened this trade. Optional so pre-Phase-3c meta literals/rows still
  // typecheck; build/parse always normalize it to string | null.
  autopilotSessionId?: string | null;
  market: string;
  side: "long" | "short";
  leverage: number;
  mode: FlashTradeMode;
  walletAddress: string;
  entryPriceUsd: number | null; // quote-time estimate; reconcile upgrades
  notionalUsd: number | null;
  openFeeUsd: number | null;
  openSignature: string | null;
  closeSignature: string | null;
  // 'external' = position vanished on-chain without a close postback
  // (liquidation, TP/SL trigger, lost confirm) — stamped by the reconcile
  // sweep alongside status 'closed-external'; proceeds stay unknown.
  closeReason: "manual" | "external" | null;
  proceedsSource: "quote-estimate" | "chain" | null;
  reconciledAt: string | null; // ISO; set once the open fill is chain-verified
};
```

Edit 3 — `BuildArgs` gains the optional arg (add after `openFeeUsd`):

```ts
type BuildArgs = {
  lineage: TailLineage;
  market: string;
  side: "long" | "short";
  leverage: number;
  mode: FlashTradeMode;
  walletAddress: string;
  entryPriceUsd: number | null;
  notionalUsd: number | null;
  openFeeUsd: number | null;
  autopilotSessionId?: string | null;
};
```

Edit 4 — `buildFlashTailMeta` populates it (add the line after `sourcePositionId: args.lineage.sourcePositionId,`):

```ts
    sourcePositionId: args.lineage.sourcePositionId,
    autopilotSessionId: args.autopilotSessionId ?? null,
```

Edit 5 — `parseTailLineage` gets the autopilot arm and `parseFlashTailMeta` accepts/validates the new shape. Replace the two functions' guards:

In `parseTailLineage`, replace:

```ts
  if (value.sourceKind !== "whale" && value.sourceKind !== "bot") return null;
```

with:

```ts
  if (
    value.sourceKind !== "whale" &&
    value.sourceKind !== "bot" &&
    value.sourceKind !== "autopilot"
  ) {
    return null;
  }
```

(the existing `if (value.sourceKind === "whale" && !whaleId) return null;` / bot lines stay — autopilot needs no id, so no new requirement line).

In `parseFlashTailMeta`, replace:

```ts
  if (value.sourceKind !== "whale" && value.sourceKind !== "bot") return null;
```

with:

```ts
  if (
    value.sourceKind !== "whale" &&
    value.sourceKind !== "bot" &&
    value.sourceKind !== "autopilot"
  ) {
    return null;
  }
  if (!isStringOrNull(value.autopilotSessionId ?? null)) return null;
```

and in the returned object, add after the `sourcePositionId` property:

```ts
    autopilotSessionId: (value.autopilotSessionId as string | null) ?? null,
```

- [ ] **2.4** Verify:

```bash
npx vitest run lib/bets/flash-tail-meta.test.ts && npm run typecheck && npm test
```

Expected: meta test file passes (7 tests incl. the 4 new ones), typecheck clean, full suite green (existing flash-tail/reconcile/route tests unaffected — the field is optional).

- [ ] **2.5** Commit:

```bash
git add lib/bets/flash-tail-meta.ts lib/bets/flash-tail-meta.test.ts
git commit -m "feat(bets): autopilot lineage + autopilotSessionId on flash-tail meta" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3 — `lib/autopilot/tiers.ts` (pure tier definitions + stake clamps)

Files: `lib/autopilot/tiers.ts`, `lib/autopilot/tiers.test.ts`

- [ ] **3.1** (TDD) Create `lib/autopilot/tiers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeStake, getTier, isTierName, TIERS } from "./tiers";

describe("autopilot tiers", () => {
  it("defines the three locked tiers", () => {
    expect(TIERS.cruise).toMatchObject({
      mode: "standard",
      leverage: 50,
      maxLeverage: 100,
      stakePctOfBudget: 0.1,
      maxConcurrent: 2,
      slRoiPct: -50,
      tpRoiPct: 100,
      maxHoldMin: 90,
    });
    expect(TIERS.sweat).toMatchObject({
      mode: "degen",
      leverage: 150,
      maxLeverage: 250,
      stakePctOfBudget: 0.05,
      maxConcurrent: 1,
      slRoiPct: -50,
      tpRoiPct: 100,
      maxHoldMin: 45,
    });
    expect(TIERS.degen).toMatchObject({
      mode: "degen",
      leverage: 500,
      maxLeverage: 500,
      stakeUsdMin: 1,
      stakeUsdMax: 10,
      maxConcurrent: 1,
      slRoiPct: -50,
      tpRoiPct: 150,
      maxHoldMin: 15,
    });
  });

  it("trigger ROIs sit inside the Flash clamps (SL -95..-1, TP 1..10000)", () => {
    for (const tier of Object.values(TIERS)) {
      expect(tier.slRoiPct).toBeGreaterThanOrEqual(-95);
      expect(tier.slRoiPct).toBeLessThanOrEqual(-1);
      expect(tier.tpRoiPct).toBeGreaterThanOrEqual(1);
      expect(tier.tpRoiPct).toBeLessThanOrEqual(10_000);
    }
  });

  it("isTierName / getTier", () => {
    expect(isTierName("cruise")).toBe(true);
    expect(isTierName("yolo")).toBe(false);
    expect(getTier("sweat").leverage).toBe(150);
  });

  it("computeStake: pct of remaining budget, floored at $1", () => {
    expect(computeStake("cruise", 100)).toBe(10); // 10%
    expect(computeStake("sweat", 100)).toBe(5); // 5%
    expect(computeStake("cruise", 5)).toBe(1); // 0.5 -> $1 floor
  });

  it("computeStake: degen hard-caps at $10", () => {
    expect(computeStake("degen", 200)).toBe(10); // 10% = 20 -> cap 10
    expect(computeStake("degen", 50)).toBe(5);
    expect(computeStake("degen", 5)).toBe(1); // floor
  });

  it("computeStake: never exceeds the remaining budget", () => {
    expect(computeStake("cruise", 1)).toBe(1);
    expect(computeStake("cruise", 0.99)).toBeNull();
    expect(computeStake("cruise", 0)).toBeNull();
    expect(computeStake("cruise", Number.NaN)).toBeNull();
  });

  it("computeStake: respects the Flash $10 min notional at every tier", () => {
    for (const tier of Object.values(TIERS)) {
      const stake = computeStake(tier.name, 100);
      expect(stake).not.toBeNull();
      expect((stake as number) * tier.leverage).toBeGreaterThanOrEqual(10);
    }
  });
});
```

- [ ] **3.2** Watch it fail:

```bash
npx vitest run lib/autopilot/tiers.test.ts
```

Expected: FAIL (module not found).

- [ ] **3.3** Create `lib/autopilot/tiers.ts`:

```ts
// lib/autopilot/tiers.ts
//
// Pure tier definitions for Scalp Autopilot. The tier — never the brain —
// decides every money parameter: stake, leverage, mode, stops, hold time.
// Numbers are the Phase 3c locked values; clamps mirror the Flash bounds
// (lib/flash/markets.ts: BTC/ETH/SOL standardMax 100x, degen 125..500x;
// lib/flash/triggers.ts: TP 1..10000, SL -95..-1).

import type { FlashTradeMode } from "@/lib/flash/markets";

// Mirrors FLASH_MIN_NOTIONAL_USD in lib/flash/perps.ts. Re-declared so this
// module stays pure — importing perps.ts drags the whole flash-sdk in.
const FLASH_MIN_NOTIONAL_USD = 10;

export type TierName = "cruise" | "sweat" | "degen";

export interface Tier {
  name: TierName;
  /** Flash trade mode every trade in this tier uses. */
  mode: FlashTradeMode;
  /** Fixed leverage for every trade — the brain never picks it. */
  leverage: number;
  /** Sanity ceiling; anything above is a bug, clamped by the shell. */
  maxLeverage: number;
  /** Stake as a fraction of the REMAINING loss budget. */
  stakePctOfBudget: number;
  /** Absolute stake floor ($1 = the /api/flash/perp route minimum). */
  stakeUsdMin: number;
  /** Absolute stake cap; null = only the pct rule applies. */
  stakeUsdMax: number | null;
  maxConcurrent: number;
  /** Mandatory stop-loss trigger, ROI % on collateral. */
  slRoiPct: number;
  /** Take-profit trigger, ROI % on collateral. */
  tpRoiPct: number;
  /** Engine force-exits any position older than this. */
  maxHoldMin: number;
}

export const TIERS: Record<TierName, Tier> = {
  cruise: {
    name: "cruise",
    mode: "standard",
    leverage: 50,
    maxLeverage: 100,
    stakePctOfBudget: 0.1,
    stakeUsdMin: 1,
    stakeUsdMax: null,
    maxConcurrent: 2,
    slRoiPct: -50,
    tpRoiPct: 100,
    maxHoldMin: 90,
  },
  sweat: {
    name: "sweat",
    mode: "degen",
    leverage: 150,
    maxLeverage: 250,
    stakePctOfBudget: 0.05,
    stakeUsdMin: 1,
    stakeUsdMax: null,
    maxConcurrent: 1,
    slRoiPct: -50,
    tpRoiPct: 100,
    maxHoldMin: 45,
  },
  degen: {
    name: "degen",
    mode: "degen",
    leverage: 500,
    maxLeverage: 500,
    stakePctOfBudget: 0.1,
    stakeUsdMin: 1,
    stakeUsdMax: 10,
    maxConcurrent: 1,
    slRoiPct: -50,
    tpRoiPct: 150,
    maxHoldMin: 15,
  },
};

export function isTierName(value: unknown): value is TierName {
  return value === "cruise" || value === "sweat" || value === "degen";
}

export function getTier(name: TierName): Tier {
  return TIERS[name];
}

/**
 * Deterministic stake for the next trade given what's left of the loss
 * budget. Returns null when the remaining budget can no longer fund a
 * valid trade ($1 stake floor, $10 Flash min notional, never more than
 * what remains). Rounded down to cents.
 */
export function computeStake(
  tierName: TierName,
  remainingBudgetUsd: number,
): number | null {
  const tier = TIERS[tierName];
  if (
    !Number.isFinite(remainingBudgetUsd) ||
    remainingBudgetUsd < tier.stakeUsdMin
  ) {
    return null;
  }
  let stake = remainingBudgetUsd * tier.stakePctOfBudget;
  stake = Math.max(stake, tier.stakeUsdMin);
  if (tier.stakeUsdMax != null) stake = Math.min(stake, tier.stakeUsdMax);
  stake = Math.min(stake, remainingBudgetUsd);
  stake = Math.floor(stake * 100) / 100;
  if (stake < tier.stakeUsdMin) return null;
  if (stake * tier.leverage < FLASH_MIN_NOTIONAL_USD) return null;
  return stake;
}
```

- [ ] **3.4** Verify:

```bash
npx vitest run lib/autopilot/tiers.test.ts && npm run typecheck
```

Expected: 7 tests pass, typecheck clean.

- [ ] **3.5** Commit:

```bash
git add lib/autopilot/tiers.ts lib/autopilot/tiers.test.ts
git commit -m "feat(autopilot): risk tiers + deterministic stake sizing" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4 — `lib/autopilot/brain.ts` (pure Blitz momentum brain)

Files: `lib/autopilot/brain.ts`, `lib/autopilot/brain.test.ts`

Port of the recovered Blitz strategy's 15m momentum math (breakout ≥0.6% past the prior range, ≥1.4× average volume, trend agreement, exit on 1% favorable move or max hold), self-contained — no `ExternalSignals`, no LLM, no DB.

- [ ] **4.1** (TDD) Create `lib/autopilot/brain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/data/candles";
import { decide, shouldExit } from "./brain";

function flat(count: number, price = 100, volume = 10): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: i * 900_000,
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volume,
  }));
}

describe("autopilot brain — decide", () => {
  it("fires long on an upside breakout with volume confirm", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 30 },
    ];
    const decision = decide({ candles, markPrice: 101 });
    expect(decision?.side).toBe("long");
    expect(decision?.conviction).toBeGreaterThanOrEqual(0.3);
    expect(decision?.conviction).toBeLessThanOrEqual(1);
  });

  it("fires short on a downside breakout with volume confirm", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 100, low: 98.8, close: 99, volume: 30 },
    ];
    const decision = decide({ candles, markPrice: 99 });
    expect(decision?.side).toBe("short");
  });

  it("stays flat when there is no breakout", () => {
    expect(decide({ candles: flat(20), markPrice: 100 })).toBeNull();
  });

  it("stays flat when volume does not confirm", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 12 },
    ];
    expect(decide({ candles, markPrice: 101 })).toBeNull();
  });

  it("stays flat on too few candles or a bad mark", () => {
    expect(decide({ candles: flat(5), markPrice: 100 })).toBeNull();
    expect(decide({ candles: flat(20), markPrice: 0 })).toBeNull();
    expect(decide({ candles: flat(20), markPrice: Number.NaN })).toBeNull();
  });

  it("requires the net window move to agree with the breakout", () => {
    // Synthetic shape (close > high is fine for math, impossible IRL):
    // candle 0 closes at 108 while every prior HIGH stays ~100.2, so the
    // last candle at 101 clears the prior range (a valid "breakout") yet
    // the net window move is DOWN (108 -> 101). The trend filter must veto
    // the long.
    const base = flat(19);
    const candles = [
      { ...base[0], close: 108 },
      ...base.slice(1),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 30 },
    ];
    expect(decide({ candles, markPrice: 101 })).toBeNull();
  });
});

describe("autopilot brain — shouldExit", () => {
  it("banks a 1% favorable move", () => {
    expect(
      shouldExit({ entryPrice: 100, side: "long", markPrice: 101, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(true);
    expect(
      shouldExit({ entryPrice: 100, side: "short", markPrice: 99, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(true);
    expect(
      shouldExit({ entryPrice: 100, side: "long", markPrice: 100.5, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(false);
  });

  it("force-exits at max hold even without a price", () => {
    expect(
      shouldExit({ entryPrice: null, side: "long", markPrice: null, ageMin: 91, maxHoldMin: 90 }),
    ).toBe(true);
    expect(
      shouldExit({ entryPrice: null, side: "long", markPrice: null, ageMin: 10, maxHoldMin: 90 }),
    ).toBe(false);
  });

  it("an adverse move does not exit (the SL trigger owns the downside)", () => {
    expect(
      shouldExit({ entryPrice: 100, side: "long", markPrice: 95, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(false);
  });
});
```

(The `withLast` helper is intentionally unused in the final test set; delete it if typecheck flags unused locals — `tsc` strict in this repo does NOT enable `noUnusedLocals` for tests, but if it complains, remove the helper.)

- [ ] **4.2** Watch it fail:

```bash
npx vitest run lib/autopilot/brain.test.ts
```

Expected: FAIL (module not found).

- [ ] **4.3** Create `lib/autopilot/brain.ts`:

```ts
// lib/autopilot/brain.ts
//
// The Autopilot brain: the recovered Blitz 15m momentum/breakout strategy
// (commit dfac7ae) ported to a pure, self-contained function. The brain
// ONLY picks direction + conviction; stake/leverage/stops belong to the
// shell + tier (see shell.ts). No ExternalSignals, no DB, no LLM — v1 is
// deterministic on (candles, mark).
//
// Blitz numbers kept verbatim: 0.6% breakout past the prior range,
// >=1.4x average volume confirm, exit on a 1% favorable move; max hold
// comes from the tier (Blitz's 90 min == cruise).

import type { Candle } from "@/lib/data/candles";

export const AUTOPILOT_TIMEFRAME = "15m" as const;
export const AUTOPILOT_CANDLE_COUNT = 20;

const MIN_CANDLES = 12; // Blitz candleCount
const BREAKOUT_PCT = 0.006; // 0.6% clear of the prior range
const VOLUME_MULTIPLIER = 1.4; // >=1.4x average volume
const EXIT_FAVORABLE_PCT = 0.01; // bank a 1% favorable move
const CONVICTION_FLOOR = 0.3;

export interface BrainDecision {
  side: "long" | "short";
  /** Clamped [0.3, 1]. Journaled only — NEVER used for sizing (shell rule). */
  conviction: number;
  /** Human-readable reason for the decision log. */
  reason: string;
}

export function decide(input: {
  candles: Candle[];
  markPrice: number;
}): BrainDecision | null {
  const { candles, markPrice } = input;
  if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
  if (candles.length < MIN_CANDLES) return null;

  const last = candles[candles.length - 1];
  const prior = candles.slice(0, -1);
  const priorHigh = Math.max(...prior.map((c) => c.high));
  const priorLow = Math.min(...prior.map((c) => c.low));
  const avgVolume =
    prior.reduce((sum, c) => sum + c.volume, 0) / prior.length;
  if (
    !Number.isFinite(priorHigh) ||
    !Number.isFinite(priorLow) ||
    priorHigh <= 0 ||
    priorLow <= 0
  ) {
    return null;
  }

  // Breakout: the last close clears the prior N-bar range by >= 0.6%.
  let side: "long" | "short" | null = null;
  let breakoutExcess = 0;
  const upExcess = last.close / priorHigh - 1;
  const downExcess = 1 - last.close / priorLow;
  if (upExcess >= BREAKOUT_PCT) {
    side = "long";
    breakoutExcess = upExcess;
  } else if (downExcess >= BREAKOUT_PCT) {
    side = "short";
    breakoutExcess = downExcess;
  }
  if (!side) return null;

  // Volume confirm: breakout candle runs >= 1.4x the prior average.
  if (!(avgVolume > 0) || last.volume < VOLUME_MULTIPLIER * avgVolume) {
    return null;
  }

  // Trend filter: the net move across the window must agree with the
  // breakout direction — no longing a lower-high bounce in a downtrend.
  const first = candles[0].close;
  if (!Number.isFinite(first) || first <= 0) return null;
  const netMove = (last.close - first) / first;
  if (side === "long" && netMove <= 0) return null;
  if (side === "short" && netMove >= 0) return null;

  // Conviction: floor 0.3; scales with how far past the thresholds the
  // breakout and volume spike run. A 2x-threshold breakout on 2x-threshold
  // volume maps to 1.0.
  const breakoutScore = Math.min(1, breakoutExcess / (BREAKOUT_PCT * 2));
  const volumeScore = Math.min(
    1,
    last.volume / (VOLUME_MULTIPLIER * avgVolume * 2),
  );
  const conviction = Math.min(
    1,
    Math.max(
      CONVICTION_FLOOR,
      CONVICTION_FLOOR + 0.7 * (0.6 * breakoutScore + 0.4 * volumeScore),
    ),
  );

  return {
    side,
    conviction,
    reason: `15m breakout ${(breakoutExcess * 100).toFixed(2)}% on ${(
      last.volume / avgVolume
    ).toFixed(1)}x volume`,
  };
}

/**
 * Soft exit: bank a 1% favorable move, or force out at the tier's max
 * hold. The downside is deliberately NOT handled here — the on-chain SL
 * trigger owns it (and survives process restarts; this function doesn't).
 */
export function shouldExit(input: {
  entryPrice: number | null;
  side: "long" | "short";
  markPrice: number | null;
  ageMin: number;
  maxHoldMin: number;
}): boolean {
  if (input.ageMin >= input.maxHoldMin) return true;
  if (input.entryPrice == null || input.markPrice == null) return false;
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return false;
  }
  const moveFrac = (input.markPrice - input.entryPrice) / input.entryPrice;
  const favorable = input.side === "long" ? moveFrac : -moveFrac;
  return favorable >= EXIT_FAVORABLE_PCT;
}
```

- [ ] **4.4** Verify:

```bash
npx vitest run lib/autopilot/brain.test.ts && npm run typecheck
```

Expected: 9 tests pass, typecheck clean.

- [ ] **4.5** Commit:

```bash
git add lib/autopilot/brain.ts lib/autopilot/brain.test.ts
git commit -m "feat(autopilot): blitz momentum brain (entry + exit, pure)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5 — `lib/autopilot/shell.ts` (deterministic risk shell)

Files: `lib/autopilot/shell.ts`, `lib/autopilot/shell.test.ts`

The shell is the only thing allowed to say yes to a trade, and it alone sets stake/leverage/mode/stops. Budget semantics (locked): `lossBudgetRemaining = budgetUsd + min(realizedPnlUsd, 0)` — losses eat the budget, profits do NOT extend it (a winning session stops at `'target'` when `realizedPnlUsd >= budgetUsd`; the win is banked, not re-risked). Tilt guard ported from the bot kit's `isInLossCooldown`: 2 consecutive losses with the newest close within 5 minutes → entries blocked, exits unaffected.

- [ ] **5.1** (TDD) Create `lib/autopilot/shell.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BrainDecision } from "./brain";
import {
  evaluateShell,
  isTiltCooldown,
  lossBudgetRemaining,
  sessionPhase,
  type RecentClose,
} from "./shell";

const NOW = new Date("2026-06-11T12:00:00Z");

const decision: BrainDecision = {
  side: "long",
  conviction: 0.8,
  reason: "test",
};

function minsAgo(mins: number): Date {
  return new Date(NOW.getTime() - mins * 60_000);
}

describe("lossBudgetRemaining / sessionPhase", () => {
  it("losses eat the budget; profits do not extend it", () => {
    expect(lossBudgetRemaining({ budgetUsd: 100, realizedPnlUsd: -30, tier: "cruise" })).toBe(70);
    expect(lossBudgetRemaining({ budgetUsd: 100, realizedPnlUsd: 50, tier: "cruise" })).toBe(100);
  });

  it("phases: active / exhausted / target", () => {
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: 0, tier: "cruise" })).toBe("active");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: -100, tier: "cruise" })).toBe("exhausted");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: -150, tier: "cruise" })).toBe("exhausted");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: 100, tier: "cruise" })).toBe("target");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: 150, tier: "cruise" })).toBe("target");
  });
});

describe("isTiltCooldown", () => {
  it("two fresh consecutive losses trip the cooldown", () => {
    const closes: RecentClose[] = [
      { pnlUsd: -2, closedAt: minsAgo(1) },
      { pnlUsd: -1, closedAt: minsAgo(3) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(true);
  });

  it("a green close clears it", () => {
    const closes: RecentClose[] = [
      { pnlUsd: 1, closedAt: minsAgo(1) },
      { pnlUsd: -2, closedAt: minsAgo(2) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(false);
  });

  it("stale losses do not trip it (window anchors to the newest close)", () => {
    const closes: RecentClose[] = [
      { pnlUsd: -2, closedAt: minsAgo(10) },
      { pnlUsd: -1, closedAt: minsAgo(12) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(false);
  });

  it("fewer than two closes never trips it", () => {
    expect(isTiltCooldown([{ pnlUsd: -5, closedAt: minsAgo(1) }], NOW)).toBe(false);
    expect(isTiltCooldown([], NOW)).toBe(false);
  });
});

describe("evaluateShell", () => {
  const base = {
    session: { budgetUsd: 100, realizedPnlUsd: 0, tier: "cruise" as const },
    openCount: 0,
    recentCloses: [] as RecentClose[],
    decision,
    now: NOW,
  };

  it("approves with tier-decided money parameters", () => {
    const verdict = evaluateShell(base);
    expect(verdict).toEqual({
      allow: true,
      stakeUsdc: 10,
      leverage: 50,
      mode: "standard",
      slRoiPct: -50,
      tpRoiPct: 100,
      maxHoldMin: 90,
    });
  });

  it("denies when concurrency is maxed", () => {
    const verdict = evaluateShell({ ...base, openCount: 2 });
    expect(verdict.allow).toBe(false);
  });

  it("denies during tilt cooldown", () => {
    const verdict = evaluateShell({
      ...base,
      recentCloses: [
        { pnlUsd: -2, closedAt: minsAgo(1) },
        { pnlUsd: -1, closedAt: minsAgo(2) },
      ],
    });
    expect(verdict.allow).toBe(false);
  });

  it("denies when the loss budget cannot fund a stake", () => {
    const verdict = evaluateShell({
      ...base,
      session: { budgetUsd: 100, realizedPnlUsd: -99.5, tier: "cruise" },
    });
    expect(verdict.allow).toBe(false);
  });

  it("denies (and reports phase) when exhausted or at target", () => {
    expect(
      evaluateShell({
        ...base,
        session: { budgetUsd: 100, realizedPnlUsd: -100, tier: "cruise" },
      }).allow,
    ).toBe(false);
    expect(
      evaluateShell({
        ...base,
        session: { budgetUsd: 100, realizedPnlUsd: 120, tier: "cruise" },
      }).allow,
    ).toBe(false);
  });

  it("degen tier: hard $10 cap, 500x, degen mode, TP +150", () => {
    const verdict = evaluateShell({
      ...base,
      session: { budgetUsd: 200, realizedPnlUsd: 0, tier: "degen" },
    });
    expect(verdict).toEqual({
      allow: true,
      stakeUsdc: 10,
      leverage: 500,
      mode: "degen",
      slRoiPct: -50,
      tpRoiPct: 150,
      maxHoldMin: 15,
    });
  });
});
```

- [ ] **5.2** Watch it fail:

```bash
npx vitest run lib/autopilot/shell.test.ts
```

Expected: FAIL (module not found).

- [ ] **5.3** Create `lib/autopilot/shell.ts`:

```ts
// lib/autopilot/shell.ts
//
// The deterministic risk shell. THE rule of Phase 3c: the brain may pick
// direction and conviction; this shell — pure code, no model — decides
// whether a trade is allowed at all and sets every money parameter
// (stake, leverage, mode, stops, hold) from the tier. The brain's
// conviction is journaled, never sized on.
//
// Budget semantics (locked):
//   lossBudgetRemaining = budgetUsd + min(realizedPnlUsd, 0)
// Losses eat the budget; profits do NOT extend the deployable budget.
// The session ends 'exhausted' when the loss budget hits zero and ends
// 'target' when realized PnL reaches +100% of budget (bankable win).

import type { FlashTradeMode } from "@/lib/flash/markets";
import type { BrainDecision } from "./brain";
import { computeStake, getTier, type TierName } from "./tiers";

// Tilt guard ported from the bot kit (lib/bots/paper.ts isInLossCooldown):
// N consecutive losses with the newest close inside the window pauses
// entries. The window anchors to the latest close, not "now minus window".
export const TILT_LOSS_STREAK = 2;
export const TILT_WINDOW_MS = 5 * 60 * 1000;

export interface ShellSessionState {
  budgetUsd: number;
  realizedPnlUsd: number;
  tier: TierName;
}

export interface RecentClose {
  /** Realized PnL (proceeds - stake). Unknown proceeds count as -stake. */
  pnlUsd: number;
  closedAt: Date;
}

export type SessionPhase = "active" | "exhausted" | "target";

export function lossBudgetRemaining(session: ShellSessionState): number {
  return session.budgetUsd + Math.min(session.realizedPnlUsd, 0);
}

export function sessionPhase(session: ShellSessionState): SessionPhase {
  if (session.realizedPnlUsd >= session.budgetUsd) return "target";
  if (lossBudgetRemaining(session) <= 0) return "exhausted";
  return "active";
}

/** recentCloses must be newest-first. */
export function isTiltCooldown(
  recentCloses: RecentClose[],
  now: Date,
): boolean {
  if (recentCloses.length < TILT_LOSS_STREAK) return false;
  const newest = recentCloses.slice(0, TILT_LOSS_STREAK);
  if (!newest.every((c) => c.pnlUsd < 0)) return false;
  const ageMs = now.getTime() - newest[0].closedAt.getTime();
  return ageMs <= TILT_WINDOW_MS;
}

export type ShellVerdict =
  | {
      allow: true;
      stakeUsdc: number;
      leverage: number;
      mode: FlashTradeMode;
      slRoiPct: number;
      tpRoiPct: number;
      maxHoldMin: number;
    }
  | { allow: false; reason: string };

export function evaluateShell(input: {
  session: ShellSessionState;
  openCount: number;
  /** Newest-first realized results, for the tilt guard. */
  recentCloses: RecentClose[];
  decision: BrainDecision;
  now: Date;
}): ShellVerdict {
  const tier = getTier(input.session.tier);

  const phase = sessionPhase(input.session);
  if (phase !== "active") {
    return { allow: false, reason: `session ${phase}` };
  }
  if (input.openCount >= tier.maxConcurrent) {
    return { allow: false, reason: "max concurrent positions reached" };
  }
  if (isTiltCooldown(input.recentCloses, input.now)) {
    return { allow: false, reason: "tilt cooldown (2 fast losses)" };
  }

  const remaining = lossBudgetRemaining(input.session);
  if (remaining < 1) {
    return { allow: false, reason: "remaining budget below $1" };
  }
  const stakeUsdc = computeStake(tier.name, remaining);
  if (stakeUsdc == null) {
    return { allow: false, reason: "remaining budget below minimum stake" };
  }
  if (stakeUsdc > remaining) {
    return { allow: false, reason: "stake exceeds remaining budget" };
  }

  return {
    allow: true,
    stakeUsdc,
    leverage: Math.min(tier.leverage, tier.maxLeverage),
    mode: tier.mode,
    slRoiPct: tier.slRoiPct,
    tpRoiPct: tier.tpRoiPct,
    maxHoldMin: tier.maxHoldMin,
  };
}
```

- [ ] **5.4** Verify:

```bash
npx vitest run lib/autopilot/shell.test.ts && npm run typecheck
```

Expected: 13 tests pass, typecheck clean.

- [ ] **5.5** Commit:

```bash
git add lib/autopilot/shell.ts lib/autopilot/shell.test.ts
git commit -m "feat(autopilot): deterministic risk shell (budget bound, tilt guard, tier caps)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6 — `lib/autopilot/sessions.ts` (db CRUD + stats from bets rows)

Files: `lib/autopilot/sessions.ts`, `lib/autopilot/sessions.test.ts`

Stats are computed FROM the session's bets rows (`meta.autopilotSessionId`), never trusted from the cached column. Conservative accounting rule: a closed row with unknown proceeds (`closed-external` before the reconcile sweep prices it, e.g. an SL trigger fired) counts as a **full loss of stake** — the loss bound stays honest.

- [ ] **6.1** (TDD) Create `lib/autopilot/sessions.test.ts` (uses the chained-stub `@/lib/db` mock pattern from `lib/bets/flash-tail.test.ts`, extended with thenable chains because some queries terminate at `.where(...)`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    select: mocks.select,
  },
}));

import { buildFlashTailMeta } from "@/lib/bets/flash-tail-meta";
import {
  AutopilotSessionError,
  clampBudget,
  getActiveSession,
  listActiveSessions,
  listOpenAutopilotBets,
  recentClosedAutopilotResults,
  sessionStats,
  startSession,
  stopSession,
} from "./sessions";

const NOW = new Date("2026-06-11T12:00:00Z");

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    userId: "user-1",
    budgetUsd: 100,
    tier: "cruise",
    status: "active",
    realizedPnlUsd: 0,
    config: null,
    startedAt: NOW,
    endedAt: null,
    lastTickAt: null,
    ...overrides,
  };
}

function autopilotMeta(overrides: Record<string, unknown> = {}) {
  return {
    ...buildFlashTailMeta({
      lineage: {
        sourceKind: "autopilot",
        whaleId: null,
        botId: null,
        sourceName: "Autopilot",
        sourcePositionId: null,
      },
      market: "SOL",
      side: "long",
      leverage: 50,
      mode: "standard",
      walletAddress: "wallet-1",
      entryPriceUsd: 160,
      notionalUsd: 500,
      openFeeUsd: 0.2,
      autopilotSessionId: "sess-1",
    }),
    ...overrides,
  };
}

// Thenable select chain: any of from/innerJoin/where/orderBy/limit returns
// the chain, and awaiting the chain at any depth resolves the rows.
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (
    resolve: (rows: unknown[]) => unknown,
    reject: (err: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function updateChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  (chain as { then: unknown }).then = (
    resolve: (rows: unknown[]) => unknown,
    reject: (err: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function insertChain(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe("autopilot sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue(selectChain([]));
    mocks.update.mockReturnValue(updateChain([]));
    mocks.insert.mockReturnValue(insertChain([sessionRow()]));
  });

  it("clampBudget clamps to $5..$200 and rejects junk", () => {
    expect(clampBudget(50)).toBe(50);
    expect(clampBudget(1)).toBe(5);
    expect(clampBudget(1000)).toBe(200);
    expect(clampBudget(9.999)).toBe(9.99);
    expect(() => clampBudget(Number.NaN)).toThrow(AutopilotSessionError);
  });

  it("startSession inserts an active session", async () => {
    const session = await startSession({
      userId: "user-1",
      budgetUsd: 100,
      tier: "cruise",
    });
    expect(session.id).toBe("sess-1");
    expect(session.tier).toBe("cruise");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("startSession denies when an active session exists", async () => {
    mocks.select.mockReturnValue(selectChain([sessionRow()]));
    await expect(
      startSession({ userId: "user-1", budgetUsd: 100, tier: "cruise" }),
    ).rejects.toMatchObject({ code: "active-session-exists" });
  });

  it("startSession rejects an unknown tier", async () => {
    await expect(
      startSession({ userId: "user-1", budgetUsd: 100, tier: "yolo" }),
    ).rejects.toMatchObject({ code: "invalid-tier" });
  });

  it("getActiveSession maps the row", async () => {
    mocks.select.mockReturnValue(selectChain([sessionRow()]));
    const session = await getActiveSession("user-1");
    expect(session?.status).toBe("active");
  });

  it("stopSession CAS-updates active -> stopped", async () => {
    mocks.update.mockReturnValue(
      updateChain([sessionRow({ status: "stopped", endedAt: NOW })]),
    );
    const stopped = await stopSession({ sessionId: "sess-1", userId: "user-1" });
    expect(stopped?.status).toBe("stopped");
  });

  it("listActiveSessions joins user identity", async () => {
    mocks.select.mockReturnValue(
      selectChain([
        { session: sessionRow(), privyId: "privy-1", solanaPubkey: "wallet-1" },
      ]),
    );
    const sessions = await listActiveSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].privyUserId).toBe("privy-1");
    expect(sessions[0].walletAddress).toBe("wallet-1");
  });

  it("listOpenAutopilotBets parses meta and drops non-autopilot rows", async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          id: "bet-1",
          amountUsdc: 10,
          createdAt: NOW,
          meta: autopilotMeta(),
        },
        {
          id: "bet-2",
          amountUsdc: 5,
          createdAt: NOW,
          meta: { junk: true },
        },
      ]),
    );
    const open = await listOpenAutopilotBets("sess-1");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      betId: "bet-1",
      market: "SOL",
      side: "long",
      stakeUsdc: 10,
      leverage: 50,
      entryPriceUsd: 160,
    });
  });

  it("recentClosedAutopilotResults counts unknown proceeds as full loss", async () => {
    mocks.select.mockReturnValue(
      selectChain([
        { proceedsUsdc: 12, amountUsdc: 10, closedAt: NOW, createdAt: NOW },
        { proceedsUsdc: null, amountUsdc: 10, closedAt: null, createdAt: NOW },
      ]),
    );
    const closes = await recentClosedAutopilotResults("sess-1", 5);
    expect(closes[0].pnlUsd).toBe(2);
    expect(closes[1].pnlUsd).toBe(-10);
  });

  it("sessionStats sums realized PnL from bets rows", async () => {
    // First select: open bets. Second select: closed rows.
    mocks.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { proceedsUsdc: 15, amountUsdc: 10, closedAt: NOW, createdAt: NOW },
          { proceedsUsdc: null, amountUsdc: 5, closedAt: NOW, createdAt: NOW },
        ]),
      );
    const stats = await sessionStats("sess-1");
    expect(stats.realizedPnlUsd).toBe(0); // +5 - 5
    expect(stats.closedCount).toBe(2);
    expect(stats.openBets).toEqual([]);
    expect(mocks.update).toHaveBeenCalledTimes(1); // opportunistic cache write
  });
});
```

- [ ] **6.2** Watch it fail:

```bash
npx vitest run lib/autopilot/sessions.test.ts
```

Expected: FAIL (module not found).

- [ ] **6.3** Create `lib/autopilot/sessions.ts`:

```ts
// lib/autopilot/sessions.ts
//
// DB layer for autopilot sessions. The bets rows ARE the trade ledger
// (type 'flash-tail', meta.autopilotSessionId = session id); the session
// row carries the budget/tier/status and an opportunistic realizedPnlUsd
// cache that sessionStats() recomputes from bets every time it runs.
//
// Conservative accounting: a closed bet with unknown proceeds (a
// 'closed-external' row the reconcile sweep hasn't chain-priced yet —
// e.g. an SL trigger fired) counts as a FULL loss of its stake, so the
// loss budget can only be over-protected, never over-spent.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { autopilotSessions, bets, users } from "@/lib/db/schema";
import { parseFlashTailMeta } from "@/lib/bets/flash-tail-meta";
import { isTierName, type TierName } from "./tiers";

export const MIN_BUDGET_USD = 5;
export const MAX_BUDGET_USD = 200;

export type AutopilotSessionStatus =
  | "active"
  | "stopped"
  | "exhausted"
  | "target";

export interface AutopilotSession {
  id: string;
  userId: string;
  budgetUsd: number;
  tier: TierName;
  status: AutopilotSessionStatus;
  realizedPnlUsd: number;
  startedAt: Date;
  endedAt: Date | null;
  lastTickAt: Date | null;
}

export interface ActiveSessionWithIdentity extends AutopilotSession {
  /** users.privyId — the DID privyServer.getUserById signs with. */
  privyUserId: string | null;
  /** users.solanaPubkey — the trader wallet. */
  walletAddress: string | null;
}

export interface OpenAutopilotBet {
  betId: string;
  market: string;
  side: "long" | "short";
  stakeUsdc: number;
  leverage: number;
  entryPriceUsd: number | null;
  createdAt: Date;
}

export interface ClosedAutopilotResult {
  pnlUsd: number;
  closedAt: Date;
}

export interface SessionStats {
  realizedPnlUsd: number;
  closedCount: number;
  openBets: OpenAutopilotBet[];
}

export class AutopilotSessionError extends Error {
  constructor(
    public readonly code:
      | "active-session-exists"
      | "invalid-tier"
      | "invalid-budget",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AutopilotSessionError";
  }
}

function toSession(
  row: typeof autopilotSessions.$inferSelect,
): AutopilotSession {
  return {
    id: row.id,
    userId: row.userId,
    budgetUsd: row.budgetUsd,
    tier: isTierName(row.tier) ? row.tier : "cruise",
    status: row.status as AutopilotSessionStatus,
    realizedPnlUsd: row.realizedPnlUsd,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastTickAt: row.lastTickAt,
  };
}

export function clampBudget(budgetUsd: number): number {
  if (!Number.isFinite(budgetUsd)) {
    throw new AutopilotSessionError("invalid-budget", "budget must be a number");
  }
  const clamped = Math.min(MAX_BUDGET_USD, Math.max(MIN_BUDGET_USD, budgetUsd));
  return Math.floor(clamped * 100) / 100;
}

export async function startSession(args: {
  userId: string;
  budgetUsd: number;
  tier: string;
}): Promise<AutopilotSession> {
  if (!isTierName(args.tier)) {
    throw new AutopilotSessionError("invalid-tier", "tier must be cruise, sweat, or degen");
  }
  const budgetUsd = clampBudget(args.budgetUsd);
  const existing = await getActiveSession(args.userId);
  if (existing) {
    throw new AutopilotSessionError(
      "active-session-exists",
      "An autopilot session is already running. Stop it first.",
    );
  }
  const [row] = await db
    .insert(autopilotSessions)
    .values({
      userId: args.userId,
      budgetUsd,
      tier: args.tier,
      status: "active",
    })
    .returning();
  if (!row) throw new Error("autopilot session insert failed");
  return toSession(row);
}

/** CAS active -> stopped. Returns null if no active session matched. */
export async function stopSession(args: {
  sessionId: string;
  userId: string;
}): Promise<AutopilotSession | null> {
  const [row] = await db
    .update(autopilotSessions)
    .set({ status: "stopped", endedAt: new Date() })
    .where(
      and(
        eq(autopilotSessions.id, args.sessionId),
        eq(autopilotSessions.userId, args.userId),
        eq(autopilotSessions.status, "active"),
      ),
    )
    .returning();
  return row ? toSession(row) : null;
}

/** Engine-only: CAS active -> exhausted | target. */
export async function endSession(args: {
  sessionId: string;
  status: "exhausted" | "target";
}): Promise<void> {
  await db
    .update(autopilotSessions)
    .set({ status: args.status, endedAt: new Date() })
    .where(
      and(
        eq(autopilotSessions.id, args.sessionId),
        eq(autopilotSessions.status, "active"),
      ),
    );
}

export async function touchSession(sessionId: string): Promise<void> {
  await db
    .update(autopilotSessions)
    .set({ lastTickAt: new Date() })
    .where(eq(autopilotSessions.id, sessionId));
}

export async function getActiveSession(
  userId: string,
): Promise<AutopilotSession | null> {
  const [row] = await db
    .select()
    .from(autopilotSessions)
    .where(
      and(
        eq(autopilotSessions.userId, userId),
        eq(autopilotSessions.status, "active"),
      ),
    )
    .orderBy(desc(autopilotSessions.startedAt))
    .limit(1);
  return row ? toSession(row) : null;
}

/**
 * Every active session joined with its user's signing identity — ONE
 * query, called first thing each tick; zero rows = the cheap idle path.
 */
export async function listActiveSessions(): Promise<
  ActiveSessionWithIdentity[]
> {
  const rows = await db
    .select({
      session: autopilotSessions,
      privyId: users.privyId,
      solanaPubkey: users.solanaPubkey,
    })
    .from(autopilotSessions)
    .innerJoin(users, eq(users.id, autopilotSessions.userId))
    .where(eq(autopilotSessions.status, "active"));
  return rows.map((r) => ({
    ...toSession(r.session),
    privyUserId: r.privyId,
    walletAddress: r.solanaPubkey,
  }));
}

export async function listOpenAutopilotBets(
  sessionId: string,
): Promise<OpenAutopilotBet[]> {
  const rows = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        eq(bets.status, "confirmed"),
        sql`${bets.meta} ->> 'autopilotSessionId' = ${sessionId}`,
      ),
    )
    .orderBy(desc(bets.createdAt));
  const out: OpenAutopilotBet[] = [];
  for (const row of rows) {
    const meta = parseFlashTailMeta(row.meta);
    if (!meta || meta.sourceKind !== "autopilot") continue;
    out.push({
      betId: row.id,
      market: meta.market,
      side: meta.side,
      stakeUsdc: row.amountUsdc,
      leverage: meta.leverage,
      entryPriceUsd: meta.entryPriceUsd,
      createdAt: row.createdAt,
    });
  }
  return out;
}

/** Newest-first realized results for the tilt guard. */
export async function recentClosedAutopilotResults(
  sessionId: string,
  limit = 5,
): Promise<ClosedAutopilotResult[]> {
  const rows = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        inArray(bets.status, ["closed", "closed-external"]),
        sql`${bets.meta} ->> 'autopilotSessionId' = ${sessionId}`,
      ),
    )
    .orderBy(sql`coalesce(${bets.closedAt}, ${bets.createdAt}) DESC`)
    .limit(limit);
  return rows.map((row) => ({
    pnlUsd:
      row.proceedsUsdc == null
        ? -row.amountUsdc
        : row.proceedsUsdc - row.amountUsdc,
    closedAt: row.closedAt ?? row.createdAt,
  }));
}

/**
 * Realized PnL + open/closed counts computed FROM the session's bets rows.
 * Opportunistically syncs the cached column on the session row; failures
 * there are swallowed — the cache is cosmetic, the computation is truth.
 */
export async function sessionStats(sessionId: string): Promise<SessionStats> {
  const [openBets, closedRows] = await Promise.all([
    listOpenAutopilotBets(sessionId),
    db
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.type, "flash-tail"),
          inArray(bets.status, ["closed", "closed-external"]),
          sql`${bets.meta} ->> 'autopilotSessionId' = ${sessionId}`,
        ),
      ),
  ]);
  let realizedPnlUsd = 0;
  for (const row of closedRows) {
    realizedPnlUsd +=
      row.proceedsUsdc == null
        ? -row.amountUsdc
        : row.proceedsUsdc - row.amountUsdc;
  }
  try {
    await db
      .update(autopilotSessions)
      .set({ realizedPnlUsd })
      .where(eq(autopilotSessions.id, sessionId));
  } catch (err) {
    console.warn("[autopilot] realizedPnlUsd cache write failed:", err);
  }
  return { realizedPnlUsd, closedCount: closedRows.length, openBets };
}
```

- [ ] **6.4** Verify:

```bash
npx vitest run lib/autopilot/sessions.test.ts && npm run typecheck && npm test
```

Expected: 10 tests pass, typecheck clean, full suite green.

- [ ] **6.5** Commit:

```bash
git add lib/autopilot/sessions.ts lib/autopilot/sessions.test.ts
git commit -m "feat(autopilot): session CRUD + stats computed from bets rows" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7 — `lib/autopilot/engine.ts` (tick engine with injectable deps)

Files: `lib/autopilot/engine.ts`, `lib/autopilot/engine.test.ts`

Per-tick flow (locked): (1) load open autopilot bets; (2) exit pass via `shouldExit` + instant close + `confirmClose`; (3) recompute realized PnL → end session on `exhausted`/`target`; (4) entry pass — brain on each of BTC/ETH/SOL until one fires, shell approves, open instantly, **record the bet row BEFORE sending** (mirrors `/api/flash/perp`: a crash between the two leaves a reapable pending row, never a landed trade without a receipt), confirm, then attach SL (mandatory — failure = immediate emergency close) and TP triggers; (5) stamp `lastTickAt`. One new position max per tick. Errors are caught per bet / per market / per session and never kill the loop.

**Deliberate deps-shape deviation from the one-line sketch:** `openTrade`/`closeTrade`/`placeTrigger` are *build-only* (return `transactionB64`) and a separate `sendTransaction` dep does the Privy send. This is required to preserve the record-before-send ordering above; a combined build+send dep would force recording after the money moved.

- [ ] **7.1** (TDD) Create `lib/autopilot/engine.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Candle } from "@/lib/data/candles";
import { tickSession, type EngineDeps } from "./engine";
import type { ActiveSessionWithIdentity } from "./sessions";

const NOW = new Date("2026-06-11T12:00:00Z");

function makeSession(
  overrides: Partial<ActiveSessionWithIdentity> = {},
): ActiveSessionWithIdentity {
  return {
    id: "sess-1",
    userId: "user-1",
    budgetUsd: 100,
    tier: "cruise",
    status: "active",
    realizedPnlUsd: 0,
    startedAt: new Date("2026-06-11T11:00:00Z"),
    endedAt: null,
    lastTickAt: null,
    privyUserId: "privy-1",
    walletAddress: "wallet-1",
    ...overrides,
  };
}

function flat(count: number, price = 100, volume = 10): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: i * 900_000,
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volume,
  }));
}

function breakoutCandles(): Candle[] {
  return [
    ...flat(19),
    { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 30 },
  ];
}

function makeDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    getCandles: vi.fn().mockResolvedValue(flat(20)),
    getMark: vi.fn().mockResolvedValue(100),
    openTrade: vi.fn().mockResolvedValue({
      transactionB64: "open-tx",
      entryPriceUsd: 100,
      notionalUsd: 500,
      openFeeUsd: 0.2,
    }),
    closeTrade: vi.fn().mockResolvedValue({
      transactionB64: "close-tx",
      receiveUsd: 11,
    }),
    placeTrigger: vi.fn().mockResolvedValue({ transactionB64: "trigger-tx" }),
    sendTransaction: vi.fn().mockResolvedValue({ signature: "sig-1" }),
    listOpenBets: vi.fn().mockResolvedValue([]),
    recentCloses: vi.fn().mockResolvedValue([]),
    recordOpen: vi.fn().mockResolvedValue("bet-1"),
    confirmOpen: vi.fn().mockResolvedValue(true),
    confirmClose: vi.fn().mockResolvedValue(true),
    sessionRealizedPnl: vi.fn().mockResolvedValue(0),
    endSession: vi.fn().mockResolvedValue(undefined),
    touchSession: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe("tickSession", () => {
  it("opens one trade when the brain fires: record -> send -> confirm -> SL -> TP", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
    });
    const result = await tickSession(makeSession(), deps);

    expect(result.opened).toBe(1);
    expect(deps.openTrade).toHaveBeenCalledWith({
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
      stakeUsdc: 10,
      leverage: 50,
      mode: "standard",
    });
    // Bookkeeping order: record the pending row BEFORE the send.
    const recordOrder = (deps.recordOpen as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const sendOrder = (deps.sendTransaction as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(sendOrder);

    const recorded = (deps.recordOpen as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(recorded.meta.sourceKind).toBe("autopilot");
    expect(recorded.meta.sourceName).toBe("Autopilot");
    expect(recorded.meta.autopilotSessionId).toBe("sess-1");
    expect(deps.confirmOpen).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-1",
    });
    // Mandatory SL first, then TP, each sent.
    expect(deps.placeTrigger).toHaveBeenNthCalledWith(1, {
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
      kind: "sl",
      roiPct: -50,
    });
    expect(deps.placeTrigger).toHaveBeenNthCalledWith(2, {
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
      kind: "tp",
      roiPct: 100,
    });
    // 3 sends total: open + SL + TP.
    expect(deps.sendTransaction).toHaveBeenCalledTimes(3);
    expect(deps.touchSession).toHaveBeenCalledWith("sess-1");
  });

  it("opens at most one position per tick even when every market fires", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(1);
    expect(deps.openTrade).toHaveBeenCalledTimes(1);
  });

  it("skips entries when concurrency is full and never hedges a held market", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      listOpenBets: vi.fn().mockResolvedValue([
        {
          betId: "bet-a",
          market: "BTC",
          side: "long",
          stakeUsdc: 10,
          leverage: 50,
          entryPriceUsd: 100.9, // not yet at +1% from mark 101
          createdAt: new Date(NOW.getTime() - 60_000),
        },
        {
          betId: "bet-b",
          market: "ETH",
          side: "long",
          stakeUsdc: 10,
          leverage: 50,
          entryPriceUsd: 100.9,
          createdAt: new Date(NOW.getTime() - 60_000),
        },
      ]),
    });
    const result = await tickSession(makeSession(), deps); // cruise max 2
    expect(result.opened).toBe(0);
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("exits a position past max hold and confirms the close", async () => {
    const deps = makeDeps({
      listOpenBets: vi.fn().mockResolvedValue([
        {
          betId: "bet-old",
          market: "SOL",
          side: "long",
          stakeUsdc: 10,
          leverage: 50,
          entryPriceUsd: 100,
          createdAt: new Date(NOW.getTime() - 91 * 60_000), // 91 min > 90
        },
      ]),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.exited).toBe(1);
    expect(deps.closeTrade).toHaveBeenCalledWith({
      walletAddress: "wallet-1",
      market: "SOL",
      side: "long",
    });
    expect(deps.confirmClose).toHaveBeenCalledWith({
      betId: "bet-old",
      userId: "user-1",
      signature: "sig-1",
      receiveUsdEstimate: 11,
    });
  });

  it("ends the session as exhausted when losses ate the budget", async () => {
    const deps = makeDeps({
      sessionRealizedPnl: vi.fn().mockResolvedValue(-100),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.ended).toBe("exhausted");
    expect(deps.endSession).toHaveBeenCalledWith({
      sessionId: "sess-1",
      status: "exhausted",
    });
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("ends the session as target at +100% realized", async () => {
    const deps = makeDeps({
      sessionRealizedPnl: vi.fn().mockResolvedValue(100),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.ended).toBe("target");
  });

  it("tilt cooldown blocks entries", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      recentCloses: vi.fn().mockResolvedValue([
        { pnlUsd: -2, closedAt: new Date(NOW.getTime() - 60_000) },
        { pnlUsd: -1, closedAt: new Date(NOW.getTime() - 120_000) },
      ]),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(result.skipped.some((s) => s.includes("tilt"))).toBe(true);
  });

  it("closes the position immediately when SL placement fails", async () => {
    const placeTrigger = vi
      .fn()
      .mockRejectedValueOnce(new Error("trigger build failed"));
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      placeTrigger,
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(1);
    // Emergency close fired for the just-opened BTC long.
    expect(deps.closeTrade).toHaveBeenCalledWith({
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
    });
    expect(deps.confirmClose).toHaveBeenCalled();
    // No TP attempt after the SL failure.
    expect(placeTrigger).toHaveBeenCalledTimes(1);
  });

  it("a throwing market-data dep never kills the tick", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockRejectedValue(new Error("HL down")),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(deps.touchSession).toHaveBeenCalled();
  });

  it("skips a session with no wallet identity", async () => {
    const deps = makeDeps();
    const result = await tickSession(
      makeSession({ walletAddress: null }),
      deps,
    );
    expect(result.skipped).toContain("user has no wallet identity");
    expect(deps.listOpenBets).not.toHaveBeenCalled();
  });
});
```

- [ ] **7.2** Watch it fail:

```bash
npx vitest run lib/autopilot/engine.test.ts
```

Expected: FAIL (module not found).

- [ ] **7.3** Create `lib/autopilot/engine.ts`:

```ts
// lib/autopilot/engine.ts
//
// One tick of one autopilot session. Pure orchestration over injectable
// deps (tests stub them all; buildEngineDeps() wires the real Flash +
// Privy + DB calls). Errors are contained at the per-bet / per-market
// level — a tick can partially fail but never throws past tickSession,
// and the ticker additionally try/catches per session.
//
// Trigger facts (lib/flash/triggers.ts): TriggerKind is 'tp' | 'sl';
// roiPct clamps are TP 1..10000 and SL -95..-1 — every tier's values sit
// inside those bounds (asserted in tiers.test.ts).

import type { Candle, Timeframe } from "@/lib/data/candles";
import type { FlashMarketSymbol, FlashTradeMode } from "@/lib/flash/markets";
import {
  buildFlashTailMeta,
  type FlashTailMeta,
} from "@/lib/bets/flash-tail-meta";
import type { TriggerKind } from "@/lib/flash/triggers";
import {
  AUTOPILOT_CANDLE_COUNT,
  AUTOPILOT_TIMEFRAME,
  decide,
  shouldExit,
} from "./brain";
import {
  evaluateShell,
  sessionPhase,
  type RecentClose,
  type ShellSessionState,
} from "./shell";
import { getTier } from "./tiers";
import type {
  ActiveSessionWithIdentity,
  ClosedAutopilotResult,
  OpenAutopilotBet,
} from "./sessions";

export const AUTOPILOT_MARKETS = [
  "BTC",
  "ETH",
  "SOL",
] as const satisfies readonly FlashMarketSymbol[];
export type AutopilotMarket = (typeof AUTOPILOT_MARKETS)[number];

export interface BuiltOpen {
  transactionB64: string;
  entryPriceUsd: number | null;
  notionalUsd: number | null;
  openFeeUsd: number | null;
}

export interface BuiltClose {
  transactionB64: string;
  receiveUsd: number | null;
}

export interface EngineDeps {
  getCandles(
    asset: string,
    timeframe: Timeframe,
    count: number,
  ): Promise<Candle[]>;
  getMark(symbol: string): Promise<number | null>;
  /** Builds the open tx (does NOT send — ordering matters, see tickSession). */
  openTrade(args: {
    walletAddress: string;
    market: AutopilotMarket;
    side: "long" | "short";
    stakeUsdc: number;
    leverage: number;
    mode: FlashTradeMode;
  }): Promise<BuiltOpen>;
  /** Builds the close tx. */
  closeTrade(args: {
    walletAddress: string;
    market: string;
    side: "long" | "short";
  }): Promise<BuiltClose>;
  /** Builds a TP/SL trigger tx (roiPct pre-clamped by the tier). */
  placeTrigger(args: {
    walletAddress: string;
    market: string;
    side: "long" | "short";
    kind: TriggerKind;
    roiPct: number;
  }): Promise<{ transactionB64: string }>;
  /** Privy instant sign-and-send. */
  sendTransaction(args: {
    privyUserId: string;
    walletAddress: string;
    transactionB64: string;
  }): Promise<{ signature: string }>;
  listOpenBets(sessionId: string): Promise<OpenAutopilotBet[]>;
  recentCloses(
    sessionId: string,
    limit: number,
  ): Promise<ClosedAutopilotResult[]>;
  recordOpen(args: {
    userId: string;
    stakeUsdc: number;
    meta: FlashTailMeta;
  }): Promise<string>;
  confirmOpen(args: {
    betId: string;
    userId: string;
    signature: string;
  }): Promise<boolean>;
  confirmClose(args: {
    betId: string;
    userId: string;
    signature: string;
    receiveUsdEstimate: number | null;
  }): Promise<boolean>;
  /** Realized PnL recomputed from bets rows (sessionStats). */
  sessionRealizedPnl(sessionId: string): Promise<number>;
  endSession(args: {
    sessionId: string;
    status: "exhausted" | "target";
  }): Promise<void>;
  touchSession(sessionId: string): Promise<void>;
  now(): Date;
}

export interface TickResult {
  sessionId: string;
  exited: number;
  opened: number;
  ended: "exhausted" | "target" | null;
  /** Decision log lines for this tick (skipped entries and why). */
  skipped: string[];
}

export async function tickSession(
  session: ActiveSessionWithIdentity,
  deps: EngineDeps,
): Promise<TickResult> {
  const result: TickResult = {
    sessionId: session.id,
    exited: 0,
    opened: 0,
    ended: null,
    skipped: [],
  };
  if (!session.privyUserId || !session.walletAddress) {
    result.skipped.push("user has no wallet identity");
    return result;
  }
  const privyUserId = session.privyUserId;
  const walletAddress = session.walletAddress;
  const tier = getTier(session.tier);
  const now = deps.now();

  // (1) Open autopilot bets for this session.
  let openBets: OpenAutopilotBet[] = [];
  try {
    openBets = await deps.listOpenBets(session.id);
  } catch (err) {
    console.error(`[autopilot] listOpenBets failed session=${session.id}:`, err);
    await safeTouch(deps, session.id);
    return result;
  }

  // (2) Exit pass. On-chain triggers own the hard TP/SL; this pass banks
  // the Blitz-style 1% favorable move and enforces the tier's max hold.
  for (const bet of openBets) {
    try {
      const mark = await deps.getMark(bet.market);
      const ageMin = (now.getTime() - bet.createdAt.getTime()) / 60_000;
      const exit = shouldExit({
        entryPrice: bet.entryPriceUsd,
        side: bet.side,
        markPrice: mark,
        ageMin,
        maxHoldMin: tier.maxHoldMin,
      });
      if (!exit) continue;
      const built = await deps.closeTrade({
        walletAddress,
        market: bet.market,
        side: bet.side,
      });
      const sent = await deps.sendTransaction({
        privyUserId,
        walletAddress,
        transactionB64: built.transactionB64,
      });
      await deps.confirmClose({
        betId: bet.betId,
        userId: session.userId,
        signature: sent.signature,
        receiveUsdEstimate: built.receiveUsd,
      });
      openBets = openBets.filter((b) => b.betId !== bet.betId);
      result.exited += 1;
    } catch (err) {
      console.error(
        `[autopilot] exit failed session=${session.id} bet=${bet.betId}:`,
        err,
      );
    }
  }

  // (3) Budget phase from realized PnL (recomputed from bets rows).
  let realizedPnlUsd = session.realizedPnlUsd;
  try {
    realizedPnlUsd = await deps.sessionRealizedPnl(session.id);
  } catch (err) {
    console.error(
      `[autopilot] realized PnL recompute failed session=${session.id} — using cached value:`,
      err,
    );
  }
  const shellSession: ShellSessionState = {
    budgetUsd: session.budgetUsd,
    realizedPnlUsd,
    tier: session.tier,
  };
  const phase = sessionPhase(shellSession);
  if (phase !== "active") {
    try {
      await deps.endSession({ sessionId: session.id, status: phase });
      result.ended = phase;
    } catch (err) {
      console.error(`[autopilot] endSession failed session=${session.id}:`, err);
    }
    await safeTouch(deps, session.id);
    return result;
  }

  // (4) Entry pass: at most ONE new position per tick.
  if (openBets.length < tier.maxConcurrent) {
    let recentCloses: RecentClose[] = [];
    try {
      recentCloses = await deps.recentCloses(session.id, 5);
    } catch (err) {
      console.error(
        `[autopilot] recentCloses failed session=${session.id} — skipping entries this tick:`,
        err,
      );
      await safeTouch(deps, session.id);
      return result;
    }
    const heldMarkets = new Set(openBets.map((b) => b.market));
    for (const market of AUTOPILOT_MARKETS) {
      if (heldMarkets.has(market)) continue; // never hedge/stack a market
      try {
        const [candles, mark] = await Promise.all([
          deps.getCandles(market, AUTOPILOT_TIMEFRAME, AUTOPILOT_CANDLE_COUNT),
          deps.getMark(market),
        ]);
        if (mark == null) continue;
        const decision = decide({ candles, markPrice: mark });
        if (!decision) continue;
        const verdict = evaluateShell({
          session: shellSession,
          openCount: openBets.length,
          // Reserve open stakes against the budget (review fix: concurrent
          // opens must never overshoot the loss bound).
          openStakesUsd: openBets.reduce((sum, b) => sum + b.amountUsdc, 0),
          recentCloses,
          decision,
          now,
        });
        if (!verdict.allow) {
          // Shell denials are session-wide (budget/tilt/concurrency) —
          // no point asking about the remaining markets.
          result.skipped.push(`${market} ${decision.side}: ${verdict.reason}`);
          break;
        }

        const built = await deps.openTrade({
          walletAddress,
          market,
          side: decision.side,
          stakeUsdc: verdict.stakeUsdc,
          leverage: verdict.leverage,
          mode: verdict.mode,
        });
        const meta = buildFlashTailMeta({
          lineage: {
            sourceKind: "autopilot",
            whaleId: null,
            botId: null,
            sourceName: "Autopilot",
            sourcePositionId: null,
          },
          market,
          side: decision.side,
          leverage: verdict.leverage,
          mode: verdict.mode,
          walletAddress,
          entryPriceUsd: built.entryPriceUsd,
          notionalUsd: built.notionalUsd,
          openFeeUsd: built.openFeeUsd,
          autopilotSessionId: session.id,
        });
        // Record BEFORE send (mirrors /api/flash/perp): a crash between
        // the two leaves a pending row the portfolio reaper abandons;
        // the reverse order risks a landed trade with no receipt.
        const betId = await deps.recordOpen({
          userId: session.userId,
          stakeUsdc: verdict.stakeUsdc,
          meta,
        });
        const sent = await deps.sendTransaction({
          privyUserId,
          walletAddress,
          transactionB64: built.transactionB64,
        });
        try {
          await deps.confirmOpen({
            betId,
            userId: session.userId,
            signature: sent.signature,
          });
        } catch (err) {
          // Never let bookkeeping turn a landed trade into a tick failure;
          // the reconcile sweep picks the row up later.
          console.error(
            `[autopilot] confirmOpen failed post-send bet=${betId}:`,
            err,
          );
        }
        result.opened += 1;
        console.log(
          `[autopilot] OPEN session=${session.id} ${market} ${decision.side} ` +
            `$${verdict.stakeUsdc} @ ${verdict.leverage}x (${decision.reason})`,
        );

        // Mandatory SL. If it cannot be attached the position must not
        // live — close it immediately rather than run naked at leverage.
        try {
          const sl = await deps.placeTrigger({
            walletAddress,
            market,
            side: decision.side,
            kind: "sl",
            roiPct: verdict.slRoiPct,
          });
          await deps.sendTransaction({
            privyUserId,
            walletAddress,
            transactionB64: sl.transactionB64,
          });
        } catch (slErr) {
          console.error(
            `[autopilot] SL placement failed session=${session.id} — emergency close:`,
            slErr,
          );
          try {
            const closeBuilt = await deps.closeTrade({
              walletAddress,
              market,
              side: decision.side,
            });
            const closeSent = await deps.sendTransaction({
              privyUserId,
              walletAddress,
              transactionB64: closeBuilt.transactionB64,
            });
            await deps.confirmClose({
              betId,
              userId: session.userId,
              signature: closeSent.signature,
              receiveUsdEstimate: closeBuilt.receiveUsd,
            });
          } catch (closeErr) {
            console.error(
              "[autopilot] emergency close after SL failure also failed (reconcile sweep will catch the position):",
              closeErr,
            );
          }
          break;
        }
        // TP is best-effort: the exit pass banks wins even without it.
        try {
          const tp = await deps.placeTrigger({
            walletAddress,
            market,
            side: decision.side,
            kind: "tp",
            roiPct: verdict.tpRoiPct,
          });
          await deps.sendTransaction({
            privyUserId,
            walletAddress,
            transactionB64: tp.transactionB64,
          });
        } catch (tpErr) {
          console.error(
            "[autopilot] TP placement failed (exit pass still banks wins):",
            tpErr,
          );
        }
        break; // one entry per tick
      } catch (err) {
        console.error(
          `[autopilot] entry attempt failed session=${session.id} market=${market}:`,
          err,
        );
      }
    }
  }

  // (5) Heartbeat.
  await safeTouch(deps, session.id);
  return result;
}

async function safeTouch(deps: EngineDeps, sessionId: string): Promise<void> {
  try {
    await deps.touchSession(sessionId);
  } catch (err) {
    console.error(`[autopilot] touchSession failed session=${sessionId}:`, err);
  }
}

/**
 * Real deps. Server-only — drags in flash-sdk and the Privy wallet API.
 * The ticker imports this lazily so `next build` page bundles stay clean.
 */
export function buildEngineDeps(): EngineDeps {
  return {
    getCandles: async (asset, timeframe, count) => {
      const { getCandles } = await import("@/lib/data/candles");
      return getCandles(asset, timeframe, count);
    },
    getMark: async (symbol) => {
      const { getMark } = await import("@/lib/data/marks");
      return getMark(symbol);
    },
    openTrade: async ({ walletAddress, market, side, stakeUsdc, leverage, mode }) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const result = await getFlashPerpsService().open({
        trader: walletAddress,
        market,
        side,
        amountUsd: stakeUsdc,
        leverage,
        mode,
      });
      return {
        transactionB64: result.transaction,
        entryPriceUsd:
          result.quote.entryPriceUsd ?? result.position.entryPriceUsd ?? null,
        notionalUsd:
          result.quote.notionalUsd ?? result.position.sizeUsd ?? null,
        openFeeUsd: result.quote.feesUsd ?? null,
      };
    },
    closeTrade: async ({ walletAddress, market, side }) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const result = await getFlashPerpsService().close({
        trader: walletAddress,
        market: market as FlashMarketSymbol,
        side,
      });
      return {
        transactionB64: result.transaction,
        receiveUsd: result.quote.receiveUsd ?? null,
      };
    },
    placeTrigger: async ({ walletAddress, market, side, kind, roiPct }) => {
      const [{ getFlashPerpsService }, { validateTriggerRoi }] =
        await Promise.all([
          import("@/lib/flash/perps"),
          import("@/lib/flash/triggers"),
        ]);
      const validated = validateTriggerRoi(kind, roiPct);
      if (!validated.ok) throw new Error(validated.message);
      const result = await getFlashPerpsService().buildPlaceTriggerOrderTx({
        trader: walletAddress,
        market: market as FlashMarketSymbol,
        side,
        kind,
        roiPct: validated.roiPct,
      });
      return { transactionB64: result.transaction };
    },
    sendTransaction: async ({ privyUserId, walletAddress, transactionB64 }) => {
      const { signAndSendPrivySolanaTransaction } = await import(
        "@/lib/privy/instant-solana"
      );
      return signAndSendPrivySolanaTransaction({
        privyUserId,
        walletAddress,
        transactionB64,
      });
    },
    listOpenBets: async (sessionId) => {
      const { listOpenAutopilotBets } = await import("./sessions");
      return listOpenAutopilotBets(sessionId);
    },
    recentCloses: async (sessionId, limit) => {
      const { recentClosedAutopilotResults } = await import("./sessions");
      return recentClosedAutopilotResults(sessionId, limit);
    },
    recordOpen: async (args) => {
      const { recordFlashTailOpen } = await import("@/lib/bets/flash-tail");
      return recordFlashTailOpen(args);
    },
    confirmOpen: async (args) => {
      const { confirmFlashTailOpen } = await import("@/lib/bets/flash-tail");
      return confirmFlashTailOpen(args);
    },
    confirmClose: async (args) => {
      const { confirmFlashTailClose } = await import("@/lib/bets/flash-tail");
      return confirmFlashTailClose(args);
    },
    sessionRealizedPnl: async (sessionId) => {
      const { sessionStats } = await import("./sessions");
      return (await sessionStats(sessionId)).realizedPnlUsd;
    },
    endSession: async (args) => {
      const { endSession } = await import("./sessions");
      return endSession(args);
    },
    touchSession: async (sessionId) => {
      const { touchSession } = await import("./sessions");
      return touchSession(sessionId);
    },
    now: () => new Date(),
  };
}
```

- [ ] **7.4** Verify:

```bash
npx vitest run lib/autopilot/engine.test.ts && npm run typecheck && npm test
```

Expected: 10 engine tests pass, typecheck clean, full suite green.

- [ ] **7.5** Commit:

```bash
git add lib/autopilot/engine.ts lib/autopilot/engine.test.ts
git commit -m "feat(autopilot): tick engine with injectable deps (exit/budget/entry/triggers)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8 — `app/api/autopilot/session/route.ts` (start / status / stop)

Files: `app/api/autopilot/session/route.ts`, `lib/autopilot/session-route.test.ts`

POST starts (refusing when the server can't instant-sign — same env `lib/privy/server.ts` needs: `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY` or legacy `PRIVY_AUTHORIZATION_PRIVATE_KEY`), GET returns the active session + stats, DELETE stops. **DELETE closes nothing** — open positions keep their on-chain triggers and the engine simply stops managing them; the response message says so (locked v1 choice).

- [ ] **8.1** (TDD) Create `lib/autopilot/session-route.test.ts` (route contract test in `lib/` because vitest only includes `lib/**` and `components/**`; same convention as `lib/flash/flash-perp-route.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  getActiveSession: vi.fn(),
  sessionStats: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));
vi.mock("@/lib/autopilot/sessions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/autopilot/sessions")>();
  return {
    ...actual, // keep AutopilotSessionError + budget consts real
    startSession: mocks.startSession,
    stopSession: mocks.stopSession,
    getActiveSession: mocks.getActiveSession,
    sessionStats: mocks.sessionStats,
  };
});

import { AutopilotSessionError } from "@/lib/autopilot/sessions";
import {
  DELETE,
  GET,
  POST,
} from "../../app/api/autopilot/session/route";

const SESSION = {
  id: "sess-1",
  userId: "user-1",
  budgetUsd: 100,
  tier: "cruise",
  status: "active",
  realizedPnlUsd: 0,
  startedAt: new Date("2026-06-11T12:00:00Z"),
  endedAt: null,
  lastTickAt: null,
};

function request(method: string, body?: unknown) {
  return new Request("http://local.test/api/autopilot/session", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("autopilot session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY", "test-key");
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-1" });
    mocks.ensureUser.mockResolvedValue({
      id: "user-1",
      solanaPubkey: "wallet-1",
    });
    mocks.startSession.mockResolvedValue(SESSION);
    mocks.getActiveSession.mockResolvedValue(SESSION);
    mocks.stopSession.mockResolvedValue({ ...SESSION, status: "stopped" });
    mocks.sessionStats.mockResolvedValue({
      realizedPnlUsd: 0,
      closedCount: 0,
      openBets: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("401s without auth", async () => {
    mocks.verifyPrivyRequest.mockResolvedValue(null);
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(401);
  });

  it("503s when the server cannot instant-sign", async () => {
    vi.stubEnv("PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY", "");
    vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "");
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(503);
  });

  it("POST validates body shape", async () => {
    expect(
      (await POST(request("POST", { tier: "cruise", walletAddress: "w" })))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("POST", { budgetUsd: 50, tier: "yolo", walletAddress: "w" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request("POST", { budgetUsd: 50, tier: "cruise" }))).status,
    ).toBe(400);
  });

  it("POST starts a session", async () => {
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("sess-1");
    expect(mocks.startSession).toHaveBeenCalledWith({
      userId: "user-1",
      budgetUsd: 50,
      tier: "cruise",
    });
  });

  it("POST maps active-session-exists to 409", async () => {
    mocks.startSession.mockRejectedValue(
      new AutopilotSessionError("active-session-exists"),
    );
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(409);
  });

  it("GET returns the active session with stats", async () => {
    const res = await GET(request("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("sess-1");
    expect(body.stats.closedCount).toBe(0);
  });

  it("GET returns null when no session is active", async () => {
    mocks.getActiveSession.mockResolvedValue(null);
    const res = await GET(request("GET"));
    const body = await res.json();
    expect(body.session).toBeNull();
    expect(body.stats).toBeNull();
  });

  it("DELETE stops and documents the keep-positions-open choice", async () => {
    const res = await DELETE(request("DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.status).toBe("stopped");
    expect(body.message).toMatch(/positions stay open/i);
  });

  it("DELETE 404s with nothing to stop", async () => {
    mocks.getActiveSession.mockResolvedValue(null);
    const res = await DELETE(request("DELETE"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **8.2** Watch it fail:

```bash
npx vitest run lib/autopilot/session-route.test.ts
```

Expected: FAIL (route module not found).

- [ ] **8.3** Create `app/api/autopilot/session/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  AutopilotSessionError,
  getActiveSession,
  MAX_BUDGET_USD,
  MIN_BUDGET_USD,
  sessionStats,
  startSession,
  stopSession,
} from "@/lib/autopilot/sessions";
import { isTierName } from "@/lib/autopilot/tiers";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface StartBody {
  budgetUsd?: number;
  tier?: string;
  walletAddress?: string;
}

// The autopilot server signs with Privy's wallet API — same env
// lib/privy/server.ts wires into walletApi.authorizationPrivateKey. With
// it absent every engine send would throw, so refuse to arm at all.
function instantTradingConfigured(): boolean {
  return Boolean(
    process.env.PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY ||
      process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
  );
}

function sessionErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AutopilotSessionError) {
    const status = err.code === "active-session-exists" ? 409 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
  return null;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!instantTradingConfigured()) {
    return NextResponse.json(
      { error: "Instant trading is not configured on the server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as StartBody | null;
  if (
    typeof body?.budgetUsd !== "number" ||
    !Number.isFinite(body.budgetUsd) ||
    !isTierName(body.tier) ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      {
        error: `budgetUsd ($${MIN_BUDGET_USD}-$${MAX_BUDGET_USD}), tier (cruise|sweat|degen), walletAddress required`,
      },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  try {
    const session = await startSession({
      userId: user.id,
      budgetUsd: body.budgetUsd,
      tier: body.tier,
    });
    return NextResponse.json({
      session,
      stats: { realizedPnlUsd: 0, closedCount: 0, openBets: [] },
    });
  } catch (err) {
    const mapped = sessionErrorResponse(err);
    if (mapped) return mapped;
    console.error("[autopilot/session] start failed:", err);
    return NextResponse.json(
      { error: "Could not start autopilot. Try again." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);
  const session = await getActiveSession(user.id);
  if (!session) {
    return NextResponse.json({ session: null, stats: null });
  }
  const stats = await sessionStats(session.id).catch((err) => {
    console.warn("[autopilot/session] stats failed:", err);
    return null;
  });
  return NextResponse.json({ session, stats });
}

export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);
  const active = await getActiveSession(user.id);
  if (!active) {
    return NextResponse.json(
      { error: "no active autopilot session" },
      { status: 404 },
    );
  }
  const stopped = await stopSession({ sessionId: active.id, userId: user.id });
  if (!stopped) {
    return NextResponse.json(
      { error: "session already ended" },
      { status: 409 },
    );
  }
  return NextResponse.json({
    session: stopped,
    // v1 choice, on purpose: stopping disarms the engine but does NOT
    // close anything. Open positions keep their on-chain TP/SL triggers.
    message:
      "Autopilot stopped. Open positions stay open with their TP/SL triggers — close them from Scalp or Portfolio.",
  });
}
```

- [ ] **8.4** Verify:

```bash
npx vitest run lib/autopilot/session-route.test.ts && npm run typecheck && npm test
```

Expected: 9 route tests pass, typecheck clean, full suite green.

- [ ] **8.5** Commit:

```bash
git add app/api/autopilot/session/route.ts lib/autopilot/session-route.test.ts
git commit -m "feat(autopilot): session API route (start/status/stop)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9 — ticker + lease + instrumentation boot

Files: `lib/autopilot/ticker-lease.ts`, `lib/autopilot/ticker.ts`, `lib/autopilot/ticker.test.ts`, `instrumentation.ts`

Copy of the whale ticker pattern: 180s-TTL singleton lease in its own runtime-created table `autopilot_ticker_lease`, `globalThis.__autopilotTickerStarted` guard, `DISABLE_AUTOPILOT_TICKER` kill switch, 5s startup delay, 30s lease recheck, `AUTOPILOT_TICK_GAP_MS` default 60s. **Cheap idle:** each holder tick runs `listActiveSessions()` first; zero rows = no market data, no Flash, no Privy — one indexed query per minute (the Neon-cost lesson from the bot arena).

- [ ] **9.1** (TDD) Create `lib/autopilot/ticker.test.ts` (mirrors `lib/whales/ticker.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("autopilot ticker production controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    delete (
      globalThis as typeof globalThis & { __autopilotTickerStarted?: boolean }
    ).__autopilotTickerStarted;
  });

  it("can be disabled via DISABLE_AUTOPILOT_TICKER", async () => {
    vi.stubEnv("DISABLE_AUTOPILOT_TICKER", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { startAutopilotTicker } = await import("@/lib/autopilot/ticker");
    startAutopilotTicker();

    expect(
      (
        globalThis as typeof globalThis & {
          __autopilotTickerStarted?: boolean;
        }
      ).__autopilotTickerStarted,
    ).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      "[autopilot] ticker disabled via DISABLE_AUTOPILOT_TICKER",
    );
  });

  it("defaults to a one minute tick gap", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/autopilot/ticker.ts"),
      "utf8",
    );
    expect(source).toContain("process.env.AUTOPILOT_TICK_GAP_MS ?? 60_000");
  });

  it("uses its own lease table, not the whale one", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/autopilot/ticker-lease.ts"),
      "utf8",
    );
    expect(source).toContain("autopilot_ticker_lease");
    expect(source).not.toContain("whale_ticker_lease");
  });

  it("is booted from instrumentation.ts", () => {
    const source = readFileSync(
      join(process.cwd(), "instrumentation.ts"),
      "utf8",
    );
    expect(source).toContain("startAutopilotTicker");
  });
});
```

- [ ] **9.2** Watch it fail:

```bash
npx vitest run lib/autopilot/ticker.test.ts
```

Expected: FAIL (modules not found).

- [ ] **9.3** Create `lib/autopilot/ticker-lease.ts` (whale lease verbatim, table renamed):

```ts
import { sql as pg } from "@/lib/db";

const LEASE_TTL_SECONDS = 180;

function client() {
  return pg;
}

export async function ensureAutopilotLeaseTable(): Promise<void> {
  const sql = client();
  await sql`
    CREATE TABLE IF NOT EXISTS autopilot_ticker_lease (
      id           integer PRIMARY KEY,
      holder       text NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function acquireAutopilotTickerLease(
  holder: string,
): Promise<boolean> {
  const sql = client();
  const rows = (await sql`
    INSERT INTO autopilot_ticker_lease (id, holder, heartbeat_at)
    VALUES (1, ${holder}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, heartbeat_at = now()
      WHERE autopilot_ticker_lease.holder = ${holder}
         OR autopilot_ticker_lease.heartbeat_at
              < now() - make_interval(secs => ${LEASE_TTL_SECONDS})
    RETURNING holder
  `) as Array<{ holder: string }>;
  return rows.length > 0;
}
```

- [ ] **9.4** Create `lib/autopilot/ticker.ts`:

```ts
// lib/autopilot/ticker.ts
//
// The third in-process loop (whale ticker pattern): lease-guarded so
// exactly one process ticks, started from instrumentation.ts. Each tick
// first runs listActiveSessions() — ONE indexed query — and does nothing
// else when nobody is running autopilot (the Neon-cost lesson from the
// bot arena: idle loops must be near-free).

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const TICK_GAP_MS = Number(process.env.AUTOPILOT_TICK_GAP_MS ?? 60_000);
const LEASE_RECHECK_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

type AutopilotTickerDeps = {
  listActiveSessions: typeof import("./sessions").listActiveSessions;
  tickSession: typeof import("./engine").tickSession;
  buildEngineDeps: typeof import("./engine").buildEngineDeps;
  acquireAutopilotTickerLease: typeof import("./ticker-lease").acquireAutopilotTickerLease;
  ensureAutopilotLeaseTable: typeof import("./ticker-lease").ensureAutopilotLeaseTable;
};

let depsPromise: Promise<AutopilotTickerDeps> | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startAutopilotTicker(): void {
  if (process.env.DISABLE_AUTOPILOT_TICKER === "true") {
    console.log("[autopilot] ticker disabled via DISABLE_AUTOPILOT_TICKER");
    return;
  }
  const g = globalThis as typeof globalThis & {
    __autopilotTickerStarted?: boolean;
  };
  if (g.__autopilotTickerStarted) return;
  g.__autopilotTickerStarted = true;
  console.log(`[autopilot] ticker starting: holder=${HOLDER}`);
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  const {
    acquireAutopilotTickerLease,
    ensureAutopilotLeaseTable,
    listActiveSessions,
    tickSession,
    buildEngineDeps,
  } = await loadAutopilotTickerDeps();

  let tableReady = false;
  let wasHolder = false;
  let engineDeps: ReturnType<typeof buildEngineDeps> | null = null;

  for (;;) {
    if (!tableReady) {
      try {
        await ensureAutopilotLeaseTable();
        tableReady = true;
      } catch (err) {
        console.error("[autopilot] lease table not ready, retrying soon:", err);
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
    }

    let holder = false;
    try {
      holder = await acquireAutopilotTickerLease(HOLDER);
    } catch (err) {
      console.error("[autopilot] lease check failed:", err);
    }

    if (!holder) {
      if (wasHolder) {
        console.log("[autopilot] lost the lease, another process is ticking");
        wasHolder = false;
      }
      await sleep(LEASE_RECHECK_MS);
      continue;
    }

    if (!wasHolder) {
      console.log("[autopilot] acquired the lease, this process is ticking");
      wasHolder = true;
    }

    try {
      // Cheap idle: one query; zero active sessions = zero further work.
      const sessions = await listActiveSessions();
      if (sessions.length > 0) {
        engineDeps ??= buildEngineDeps();
        for (const session of sessions) {
          try {
            const result = await tickSession(session, engineDeps);
            if (
              result.opened > 0 ||
              result.exited > 0 ||
              result.ended !== null ||
              result.skipped.length > 0
            ) {
              console.log(
                `[autopilot] session=${session.id} opened=${result.opened} exited=${result.exited}` +
                  ` ended=${result.ended ?? "no"}` +
                  (result.skipped.length > 0
                    ? ` skipped=[${result.skipped.join("; ")}]`
                    : ""),
              );
            }
          } catch (err) {
            console.error(`[autopilot] tick failed session=${session.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[autopilot] tick sweep failed:", err);
    }

    await sleep(TICK_GAP_MS);
  }
}

function loadAutopilotTickerDeps(): Promise<AutopilotTickerDeps> {
  depsPromise ??= Promise.all([
    import("./sessions"),
    import("./engine"),
    import("./ticker-lease"),
  ]).then(([sessions, engine, lease]) => ({
    listActiveSessions: sessions.listActiveSessions,
    tickSession: engine.tickSession,
    buildEngineDeps: engine.buildEngineDeps,
    acquireAutopilotTickerLease: lease.acquireAutopilotTickerLease,
    ensureAutopilotLeaseTable: lease.ensureAutopilotLeaseTable,
  }));
  return depsPromise;
}
```

- [ ] **9.5** Edit `instrumentation.ts` — replace:

```ts
  const { startWhaleTicker } = await import("@/lib/whales/ticker");
  startWhaleTicker();
```

with:

```ts
  const { startWhaleTicker } = await import("@/lib/whales/ticker");
  startWhaleTicker();

  // Scalp Autopilot loop (Phase 3c). Lease-guarded like the whale ticker;
  // near-free when idle (one indexed query per tick, no market data).
  // Kill switch: DISABLE_AUTOPILOT_TICKER=true.
  const { startAutopilotTicker } = await import("@/lib/autopilot/ticker");
  startAutopilotTicker();
```

- [ ] **9.6** Verify:

```bash
npx vitest run lib/autopilot/ticker.test.ts && npm run typecheck && npm test
```

Expected: 4 ticker tests pass, typecheck clean, full suite green.

- [ ] **9.7** Commit:

```bash
git add lib/autopilot/ticker-lease.ts lib/autopilot/ticker.ts lib/autopilot/ticker.test.ts instrumentation.ts
git commit -m "feat(autopilot): lease-guarded ticker loop + instrumentation boot" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10 — `AutopilotPanel` + FastPerpsGame integration

Files: `components/trade/AutopilotPanel.tsx` (new), `components/trade/FastPerpsGame.tsx` (4 small edits)

Chosen approach (locked: "pick ONE and write it fully"): **the panel is a self-contained client component using `usePrivy` / `useSessionSigners` / `useEmbeddedSolanaWallet` directly**, mirroring FastPerpsGame's pattern — no prop drilling. FastPerpsGame only gains a `autopilotMode` boolean, a Manual/Autopilot toggle row, and a one-shot mount probe that flips to the Autopilot view when a session is already running.

- [ ] **10.1** Create `components/trade/AutopilotPanel.tsx`:

```tsx
"use client";

// Scalp Autopilot panel (Phase 3c). Self-contained: owns its session
// polling, the one-time instant-trading grant, and the distinct consent
// gate. The server loop does the trading; this panel only arms/disarms
// it and renders the budget ledger.

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useSessionSigners, type User } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  BG,
  DIM,
  FAINT,
  FG,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
} from "@/components/v2/ui";

// Same env plumbing as FastPerpsGame: the Flash session signer is the
// signer the autopilot server signs with.
const PRIVY_INSTANT_SIGNER_ID =
  process.env.NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID ??
  process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID ??
  "";
const PRIVY_INSTANT_POLICY_IDS = (
  process.env.NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS ??
  process.env.NEXT_PUBLIC_PRIVY_POLICY_IDS ??
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const PRIVY_INSTANT_TRADING_CONFIGURED = Boolean(PRIVY_INSTANT_SIGNER_ID);

const POLL_MS = 10_000;
const MIN_BUDGET = 5;
const MAX_BUDGET = 200;

type TierName = "cruise" | "sweat" | "degen";

// Honest tier copy. Liquidation distance is ~1/leverage; at 500x Flash's
// ~4bps open + ~4bps close fees burn ~40% of that 0.2% margin at entry.
const TIER_COPY: Record<
  TierName,
  { title: string; line: string; risk: string }
> = {
  cruise: {
    title: "Cruise — 50x",
    line: "Stakes 10% of budget per trade, up to 2 trades at once. TP +100% / SL -50% attached.",
    risk: "At 50x, a 2% move against you liquidates.",
  },
  sweat: {
    title: "Sweat — 150x degen",
    line: "Stakes 5% of budget, 1 trade at a time. TP +100% / SL -50% attached.",
    risk: "At 150x, a ~0.7% move against you liquidates.",
  },
  degen: {
    title: "Full Degen — 500x",
    line: "$1–$10 stakes, 1 trade at a time. TP +150% / SL -50% always attached.",
    risk: "At 500x, a 0.1% move can liquidate — fees alone burn ~40% of the survivable range at entry.",
  },
};

interface SessionDto {
  id: string;
  budgetUsd: number;
  tier: TierName;
  status: "active" | "stopped" | "exhausted" | "target";
  realizedPnlUsd: number;
  startedAt: string;
}

interface OpenBetDto {
  betId: string;
  market: string;
  side: "long" | "short";
  stakeUsdc: number;
  leverage: number;
}

interface StatsDto {
  realizedPnlUsd: number;
  closedCount: number;
  openBets: OpenBetDto[];
}

type PrivyWalletAccount = {
  type: string;
  address?: string;
  chainType?: string;
  delegated?: boolean;
  walletClientType?: string;
};

function hasServerSideSolanaWallet(
  user: User | null | undefined,
  walletAddress: string | undefined,
): boolean {
  if (!walletAddress) return false;
  return (
    user?.linkedAccounts.some((account) => {
      const walletAccount = account as PrivyWalletAccount;
      return (
        walletAccount.type === "wallet" &&
        walletAccount.address === walletAddress &&
        walletAccount.chainType === "solana" &&
        walletAccount.delegated === true &&
        walletAccount.walletClientType?.startsWith("privy")
      );
    }) ?? false
  );
}

function fmtUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function AutopilotPanel() {
  const { authenticated, getAccessToken, user } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const wallet = useEmbeddedSolanaWallet();

  const [budgetInput, setBudgetInput] = useState("5");
  const [tier, setTier] = useState<TierName>("cruise");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [sessionSignerWalletAddress, setSessionSignerWalletAddress] = useState<
    string | null
  >(null);

  const instantTradingEnabled =
    hasServerSideSolanaWallet(user, wallet?.address) ||
    sessionSignerWalletAddress === wallet?.address;

  const loadSession = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const resp = await fetch("/api/autopilot/session", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const body = (await resp.json()) as {
        session: SessionDto | null;
        stats: StatsDto | null;
      };
      setSession(body.session ?? null);
      setStats(body.stats ?? null);
    } catch {
      // polling is best-effort
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session || session.status !== "active") return;
    const id = setInterval(() => {
      if (!document.hidden) void loadSession();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadSession, session]);

  const ensureInstantTrading = useCallback(async (): Promise<boolean> => {
    if (!wallet?.address) throw new Error("wallet not ready");
    if (!PRIVY_INSTANT_TRADING_CONFIGURED) return false;
    if (instantTradingEnabled) return true;
    setNotice("Approve instant trading once...");
    await addSessionSigners({
      address: wallet.address,
      signers: [
        {
          signerId: PRIVY_INSTANT_SIGNER_ID,
          policyIds: PRIVY_INSTANT_POLICY_IDS,
        },
      ],
    });
    setSessionSignerWalletAddress(wallet.address);
    return true;
  }, [addSessionSigners, instantTradingEnabled, wallet?.address]);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    const budgetUsd = Number(budgetInput);
    if (
      !Number.isFinite(budgetUsd) ||
      budgetUsd < MIN_BUDGET ||
      budgetUsd > MAX_BUDGET
    ) {
      setError(`Budget must be between $${MIN_BUDGET} and $${MAX_BUDGET}.`);
      return;
    }
    if (!consented) {
      setError("Tick the consent box first.");
      return;
    }
    if (!wallet?.address) {
      setError("Connect a wallet first.");
      return;
    }
    setBusy(true);
    try {
      const instant = await ensureInstantTrading();
      if (!instant) {
        setError("Instant trading is not configured — Autopilot needs it.");
        return;
      }
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const resp = await fetch("/api/autopilot/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ budgetUsd, tier, walletAddress: wallet.address }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      setSession(body.session ?? null);
      setStats(body.stats ?? null);
      setNotice("Autopilot armed. First trade can take a minute or two.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    budgetInput,
    consented,
    ensureInstantTrading,
    getAccessToken,
    tier,
    wallet?.address,
  ]);

  const stop = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const resp = await fetch("/api/autopilot/session", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      setNotice(body.message ?? "Autopilot stopped.");
      await loadSession();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not stop Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  }, [getAccessToken, loadSession]);

  const active = session?.status === "active";

  return (
    <div
      className="mt-2 rounded-xl p-3"
      style={{ background: PANEL, border: `1px solid ${FAINT}` }}
    >
      <div
        className="text-[9px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        Autopilot
      </div>

      {active && session ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
                Budget
              </div>
              <div className="text-[15px] font-black" style={{ color: FG }}>
                {fmtUsd(session.budgetUsd)}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
                Realized P/L
              </div>
              <div
                className="text-[15px] font-black"
                style={{
                  color:
                    (stats?.realizedPnlUsd ?? 0) >= 0 ? GREEN : RED,
                }}
              >
                {fmtUsd(stats?.realizedPnlUsd ?? session.realizedPnlUsd)}
              </div>
            </div>
          </div>
          <div
            className="mt-1 text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {TIER_COPY[session.tier].title} · {stats?.closedCount ?? 0} closed
          </div>
          {(stats?.openBets ?? []).map((bet) => (
            <div
              key={bet.betId}
              className="mt-1.5 flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-black"
              style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
            >
              <span style={{ color: bet.side === "long" ? GREEN : RED }}>
                {bet.side.toUpperCase()} {bet.market} {bet.leverage}x
              </span>
              <span style={{ color: FG }}>{fmtUsd(bet.stakeUsdc)}</span>
            </div>
          ))}
          {(stats?.openBets ?? []).length === 0 && (
            <div
              className="mt-1.5 text-[10px] font-bold"
              style={{ color: DIM }}
            >
              Scanning BTC / ETH / SOL for a 15m breakout...
            </div>
          )}
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
            style={{ background: RED, color: BG }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Stop Autopilot
          </button>
          <div className="mt-1.5 text-[9px] font-bold" style={{ color: DIM }}>
            Stopping leaves open positions running with their TP/SL triggers.
          </div>
        </>
      ) : (
        <>
          {session && session.status !== "active" && (
            <div
              className="mt-1.5 text-[10px] font-black uppercase tracking-widest"
              style={{
                color:
                  session.status === "target"
                    ? GREEN
                    : session.status === "exhausted"
                      ? RED
                      : DIM,
              }}
            >
              Last session: {session.status} ({fmtUsd(session.realizedPnlUsd)})
            </div>
          )}
          <div className="mt-2">
            <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
              Budget (${MIN_BUDGET}–${MAX_BUDGET})
            </div>
            <input
              inputMode="decimal"
              value={budgetInput}
              onChange={(e) => {
                setBudgetInput(e.target.value);
                setError(null);
              }}
              placeholder="USDC budget"
              className="mt-1 w-full rounded-lg border bg-black/20 px-3 py-2 text-[12px] font-black text-white outline-none placeholder:text-white/30"
              style={{ borderColor: FAINT }}
            />
          </div>
          <div className="mt-2 grid gap-1.5">
            {(Object.keys(TIER_COPY) as TierName[]).map((nextTier) => {
              const isActive = tier === nextTier;
              const copy = TIER_COPY[nextTier];
              return (
                <button
                  key={nextTier}
                  type="button"
                  onClick={() => setTier(nextTier)}
                  className="rounded-lg px-2.5 py-2 text-left transition active:scale-[0.99]"
                  style={{
                    background: isActive ? PANEL_2 : "transparent",
                    border: `1px solid ${isActive ? FG : FAINT}`,
                  }}
                >
                  <div
                    className="text-[11px] font-black uppercase tracking-widest"
                    style={{ color: FG }}
                  >
                    {copy.title}
                  </div>
                  <div className="text-[10px] font-bold" style={{ color: DIM }}>
                    {copy.line}
                  </div>
                  <div className="text-[10px] font-bold" style={{ color: RED }}>
                    {copy.risk}
                  </div>
                </button>
              );
            })}
          </div>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-[10px] font-bold"
            style={{ color: FG }}
          >
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              This AI trades this budget from your wallet. It can lose all of
              it.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !consented || !authenticated}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: GREEN, color: BG }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Start Autopilot
          </button>
        </>
      )}

      {(error || notice) && (
        <div
          className="mt-2 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest"
          style={{
            background: error ? `${RED}18` : PANEL_2,
            color: error ? RED : DIM,
            border: `1px solid ${error ? `${RED}45` : FAINT}`,
          }}
        >
          {error ?? notice}
        </div>
      )}
    </div>
  );
}
```

- [ ] **10.2** Edit `components/trade/FastPerpsGame.tsx` — four edits. Anchors below are the file's current content; if drifted, find the equivalent spot.

Edit A (import) — after the line:

```ts
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
```

add:

```ts
import { AutopilotPanel } from "@/components/trade/AutopilotPanel";
```

Edit B (state) — after:

```ts
  const [sessionSignerWalletAddress, setSessionSignerWalletAddress] = useState<
    string | null
  >(null);
```

add:

```ts
  const [autopilotMode, setAutopilotMode] = useState(false);
```

Edit C (mount probe) — directly before:

```ts
  useEffect(() => {
    entryCostCacheRef.current = loadFlashEntryCostCache(wallet?.address);
  }, [wallet?.address]);
```

insert:

```ts
  // One-shot probe: if an autopilot session is already running, land the
  // user on the Autopilot view instead of the manual ticket.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const resp = await fetch("/api/autopilot/session", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const body = (await resp.json()) as {
          session?: { status?: string } | null;
        };
        if (!cancelled && body.session?.status === "active") {
          setAutopilotMode(true);
        }
      } catch {
        // non-fatal — the toggle still works manually
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken]);
```

Edit D (view switch) — two paired sub-edits that wrap the existing order-ticket internals. **D1:** in the order-ticket `<aside>`, find the close of the Stake/P-L/Total metrics grid followed by the no-position block, i.e. exactly:

```tsx
          </div>
          {!selectedPosition && (
```

(the `</div>` closing `<div className={\`grid gap-2 ...\`}>`). Replace with:

```tsx
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {([false, true] as const).map((next) => {
              const isActive = autopilotMode === next;
              return (
                <button
                  key={String(next)}
                  type="button"
                  onClick={() => setAutopilotMode(next)}
                  className="rounded-lg px-2 py-2 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
                  style={{
                    background: isActive ? FG : PANEL_2,
                    color: isActive ? BG : FG,
                    border: `1px solid ${isActive ? FG : FAINT}`,
                  }}
                >
                  {next ? "Autopilot" : "Manual"}
                </button>
              );
            })}
          </div>

          {autopilotMode ? (
            <AutopilotPanel />
          ) : (
            <>
              {!selectedPosition && (
```

**D2:** at the very end of the same `<aside>`, find exactly:

```tsx
          </div>
        </aside>
```

(the `</div>` closing the open/close-button container, immediately before `</aside>`). Replace with:

```tsx
          </div>
            </>
          )}
        </aside>
```

Everything between D1 and D2 (stake/leverage panels, position stats, TriggerChips, status row, the OPEN/CLOSE button) becomes children of the `<>...</>` fragment unchanged — JSX does not care about the indentation mismatch. Do NOT re-indent the block (a 240-line whitespace diff would bury the real change).

- [ ] **10.3** Verify:

```bash
npm run typecheck && npm test
```

Expected: clean. Then a smoke build of the page graph:

```bash
npx next build 2>&1 | tail -20
```

Expected: build completes (or fails only on pre-existing issues unrelated to `components/trade/*` — if so, note and continue; do not chase unrelated build breakage in this task).

- [ ] **10.4** Commit:

```bash
git add components/trade/AutopilotPanel.tsx components/trade/FastPerpsGame.tsx
git commit -m "feat(scalp): AutopilotPanel + Manual/Autopilot view switch in FastPerpsGame" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11 — portfolio + closed-history labelling for autopilot rows

Files: `app/api/portfolio/route.ts`, `lib/positions/flash-tail-closed.ts`, `lib/positions/flash-tail-closed.test.ts`

Autopilot rows reuse the `botName` display field (`formatCopySourceLabel` in `lib/positions/copy-row.ts` falls through whaleName → botName, so `botName: "Autopilot"` renders the row label with zero CopyRow changes). Open rows flow through `flashRowFromPosition` (live position attributed by market+side); closed/closed-external rows flow through `closedFlashTailCopyRows` automatically because they are `type: 'flash-tail'` — only the label mapping needs the autopilot arm.

- [ ] **11.1** (TDD) Append to `lib/positions/flash-tail-closed.test.ts`, inside the existing `describe("closedFlashTailCopyRows", ...)` block (after the last `it`), reusing the file's existing `flashTailMeta(overrides)` and `betRow(overrides)` helpers:

```ts
  it("labels closed autopilot rows via botName", () => {
    const rows = closedFlashTailCopyRows([
      betRow({
        id: "bet-ap",
        amountUsdc: 5,
        proceedsUsdc: 7.5,
        meta: flashTailMeta({
          sourceKind: "autopilot",
          whaleId: null,
          botId: null,
          sourceName: "Autopilot",
          sourcePositionId: null,
          autopilotSessionId: "sess-1",
        }),
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].botName).toBe("Autopilot");
    expect(rows[0].whaleName).toBeNull();
    expect(rows[0].pnlUsd).toBe(2.5);
  });
```

- [ ] **11.2** Watch it fail:

```bash
npx vitest run lib/positions/flash-tail-closed.test.ts
```

Expected: the new test FAILS (`botName` is null — the mapping keys on `sourceKind === "bot"` only).

- [ ] **11.3** Edit `lib/positions/flash-tail-closed.ts` — replace:

```ts
      botName: meta.sourceKind === "bot" ? meta.sourceName : null,
```

with:

```ts
      botName:
        meta.sourceKind === "bot" || meta.sourceKind === "autopilot"
          ? meta.sourceName
          : null,
```

- [ ] **11.4** Edit `app/api/portfolio/route.ts` in `flashRowFromPosition` — replace:

```ts
    botName:
      tailBet?.meta?.sourceKind === "bot"
        ? (tailBet.meta.sourceName ?? null)
        : null,
```

with:

```ts
    botName:
      tailBet?.meta?.sourceKind === "bot" ||
      tailBet?.meta?.sourceKind === "autopilot"
        ? (tailBet?.meta?.sourceName ?? null)
        : null,
```

(Note the extra `?.` in the value branch — TS narrowing across an `||` of two optional-chain comparisons is not guaranteed, the defensive chain costs nothing.)

- [ ] **11.5** Verify:

```bash
npx vitest run lib/positions/flash-tail-closed.test.ts && npm run typecheck && npm test
```

Expected: all pass.

- [ ] **11.6** Commit:

```bash
git add app/api/portfolio/route.ts lib/positions/flash-tail-closed.ts lib/positions/flash-tail-closed.test.ts
git commit -m "feat(portfolio): label autopilot flash-tail rows as Autopilot" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12 — browser verification (user-run, real money — read fully before starting)

No code. This trades **real USDC on Solana mainnet** with real Flash fees. Use the smallest configuration: **$5 budget, Cruise tier** (max single stake $1 at 50x — $50 notional, comfortably over the $10 Flash minimum). The wallet must hold at least ~$6 USDC (budget headroom + fees) — the engine does NOT preflight the wallet balance; an underfunded wallet just logs `Insufficient Funds` entry failures and skips.

- [ ] **12.1** Env check in `.env.local`: `DATABASE_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY` (or `PRIVY_AUTHORIZATION_PRIVATE_KEY`), `NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID` (or `NEXT_PUBLIC_PRIVY_SIGNER_ID`), `NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS`, `NEXT_PUBLIC_HELIUS_RPC_URL`. Make sure `DISABLE_AUTOPILOT_TICKER` is **unset**.
- [ ] **12.2** `npm run dev` — within ~10s the terminal should print `[autopilot] ticker starting: holder=...` then `[autopilot] acquired the lease, this process is ticking`.
- [ ] **12.3** Log in, open the Scalp screen. Confirm the new **Manual / Autopilot** toggle row under the Stake/Notional metrics. Flip to Autopilot.
- [ ] **12.4** Confirm the setup view shows: budget input, three tier cards with the liquidation-distance copy (Degen card must show the "0.1% move can liquidate" line), and the consent checkbox — "This AI trades this budget from your wallet. It can lose all of it." Start must be disabled until the box is ticked.
- [ ] **12.5** Enter `5`, keep Cruise, tick consent, press **Start Autopilot**. If instant trading was never granted, the Privy session-signer modal appears once. Expect the "Autopilot armed" notice and the active view (Budget $5.00, Realized P/L $0.00, "Scanning BTC / ETH / SOL...").
- [ ] **12.6** Watch the dev terminal across a few ticks (~60s apart). A quiet market logs nothing per tick (brain found no 15m breakout — normal; this can stay quiet for hours). If/when it fires you'll see `[autopilot] OPEN session=... BTC long $1 @ 50x (15m breakout ...)` and the open position appears in the panel within one 10s poll.
- [ ] **12.7** Whether or not a trade fired, verify the DB: `npm run db:studio` → `autopilot_sessions` has your row (`status: active`, `lastTickAt` advancing every ~60s). If a trade fired: `bets` has a `type: flash-tail` row whose meta shows `sourceKind: "autopilot"`, `sourceName: "Autopilot"`, your `autopilotSessionId`; `fills` has the open fill.
- [ ] **12.8** If a position opened: open Portfolio — the row must read **Autopilot** (not a whale/bot name). On Scalp manual view the position is visible/closable like any Flash position, with TP and SL trigger chips populated.
- [ ] **12.9** Press **Stop Autopilot**. Expect the message about positions staying open; `autopilot_sessions.status` flips to `stopped`; subsequent ticks go quiet (idle path). Any open position remains yours to close manually (its SL/TP still armed on-chain).
- [ ] **12.10** Restart check: stop the dev server, start it again, confirm the ticker re-acquires the lease and (with no active session) ticks idle — no market-data fetch spam in the logs.

---

## Task 13 — final gate + architecture note

Files: `docs/architecture.md`

- [ ] **13.1** Full gate:

```bash
npm run typecheck && npm test
```

Expected: clean, all suites green.

- [ ] **13.2** Edit `docs/architecture.md`: find the heading

```md
## 4. The bot resolver tick (what each tick does)
```

and insert immediately BEFORE it:

```md
### 3x. The autopilot ticker (Phase 3c)

A third lease-guarded in-process loop, `lib/autopilot/ticker.ts`, started from
`instrumentation.ts` next to the whale ticker (kill switch
`DISABLE_AUTOPILOT_TICKER=true`, cadence `AUTOPILOT_TICK_GAP_MS` default 60s,
singleton lease in the runtime-created `autopilot_ticker_lease` table). Each
tick first runs one indexed query (`listActiveSessions()`); with zero active
`autopilot_sessions` rows it does nothing else, so the idle cost lesson from
the bot arena holds. For each active session the engine
(`lib/autopilot/engine.ts`) runs exit → budget → entry: a pure Blitz-style 15m
momentum brain picks direction only, a deterministic shell
(`lib/autopilot/shell.ts`) owns stake/leverage/stops/tilt-guard against the
session budget (the absolute loss bound), and execution goes through
`getFlashPerpsService()` + `signAndSendPrivySolanaTransaction` in-process with
a mandatory SL trigger (emergency-close on attach failure). Trades persist as
ordinary `bets` rows (`type 'flash-tail'`, `meta.sourceKind 'autopilot'`,
`meta.autopilotSessionId`), so the flash reconcile sweep and closed-history
rendering cover them with no extra machinery. UI:
`components/trade/AutopilotPanel.tsx` inside FastPerpsGame's Manual/Autopilot
switch; API: `app/api/autopilot/session` (POST start / GET status / DELETE
stop — stop disarms the engine but leaves open positions and their triggers).

```

- [ ] **13.3** Commit:

```bash
git add docs/architecture.md
git commit -m "docs(architecture): scalp autopilot loop, sessions table, bets reuse" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **13.4** Done-check against the Phase 3c spec section (`docs/superpowers/specs/2026-06-11-live-ai-leaders-receipts-design.md`):
  - sessions table with budget/tier/status/pnl/config ✓ (Task 1)
  - budget = absolute loss bound, auto-stop on exhaustion ✓ (shell + engine phase)
  - +100% target auto-stop (bankable win) ✓ (shell `sessionPhase`)
  - tiers Cruise/Sweat/Full-Degen with server-enforced caps ✓ (tiers + shell)
  - deterministic shell rule (code owns money, brain owns direction) ✓
  - tilt guard / no revenge trading ✓ (shell, ported from bot kit)
  - mandatory SL at open, Full Degen TP+SL ✓ (engine attaches SL to every tier's open, TP too; SL failure = emergency close)
  - one shared lease-guarded loop, instant execution via session signer ✓ (Tasks 7/9)
  - distinct consent + liquidation/fee math in UI ✓ (Task 10)
  - per-session decision audit: console-level in v1 (TickResult.skipped) — persisted journal deferred, documented divergence
  - stop-leaves-positions-open: deliberate v1 divergence from spec, documented in API + UI

---

## Execution order & dependencies

Tasks 1 → 2 are prerequisites for 6 → 7. Tasks 3/4/5 are independent of 1/2 (pure modules) and of each other except 5 imports 3 and 7 imports 3/4/5/6. Task 8 needs 6; Task 9 needs 6+7; Task 10 needs 8; Task 11 needs 2. Strict sequence 1,2,3,4,5,6,7,8,9,10,11,12,13 is always safe.
