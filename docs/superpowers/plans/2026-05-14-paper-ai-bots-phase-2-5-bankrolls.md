# Paper AI Bots — Phase 2.5 (Bankrolls + Multi-Position + Conviction) Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each bot manages a $1000 paper bankroll, holds up to 4 concurrent positions, and sizes each position by the strategy's conviction score (0.3–1.0 floor/ceiling × 50% max-stake cap × current balance).

**Architecture:** The existing Phase 2 resolver pattern (one tick → evaluate exits, then evaluate entries) extends naturally to multi-position: per bot, iterate ALL open positions for exit checks, then iterate ALL allowed markets for entry checks (capped by `maxConcurrentPositions` and `freeBalance`). Conviction lives in `EntryDecision`; resolver computes `stake = balance × maxStakePct × conviction`, capped at remaining `freeBalance`. On close: `balance += paperPnlUsd`. If `balance < $10` the bot's status flips to `"busted"`.

**Tech Stack:** Same as Phase 2 — TypeScript strict, Drizzle, Vitest, no new external deps.

**Spec:** [docs/superpowers/specs/2026-05-14-paper-ai-bots-design.md](../specs/2026-05-14-paper-ai-bots-design.md)
**Prior plans:** [Phase 1](2026-05-14-paper-ai-bots-phase-1.md), [Phase 2](2026-05-14-paper-ai-bots-phase-2.md)

**Branch:** Continuing on `paper-bots-phase-1` (worktree).

**Defaults locked:**
- Starting balance: $1000 per bot
- Max concurrent positions: 4
- Max stake per position: 50% of balance (ceiling)
- Conviction floor: 0.3 (no near-zero stakes)
- Conviction ceiling: 1.0 (50% stake at max conviction)
- Bust threshold: balance < $10

**Phase 2.5 scope (in):**
- Schema: `bots.balance_usd`, `bots.starting_balance_usd`, `paper_positions.stake_usd`
- `EntryDecision.conviction` field (0..1)
- Conviction formula in all 6 strategy `evaluateEntry`s
- Resolver: multi-position loop + position sizing + balance updates + busted handling
- Paper helpers: `openPaperPosition` writes `stakeUsd`; `closePaperPosition` returns the bot to credit
- BotSignal: `currentPosition` → `currentPositions[]` + balance/return fields
- BotCard: render N positions + balance/return header
- Seed: reset existing bots to $1000 balance

**Out of scope (Phase 3+):**
- Kelly criterion / volatility-adjusted sizing
- Cross-bot capital awareness
- Busted-bot auto-revival
- Per-bot config of stake percentages

---

## File map

**New columns / no new files:**
```
lib/db/schema.ts                          # add balance_usd, starting_balance_usd, stake_usd cols
```

**Modified files:**
```
lib/bots/types.ts                         # EntryDecision adds conviction
lib/bots/strategies/liquidation-lizard.ts # conviction formula
lib/bots/strategies/funding-phoebe.ts     # conviction formula
lib/bots/strategies/mean-revert-mike.ts   # conviction formula
lib/bots/strategies/momo-max.ts           # conviction formula
lib/bots/strategies/vol-vector.ts         # conviction formula
lib/bots/strategies/boomer-trend.ts       # conviction formula
lib/bots/paper.ts                         # openPaperPosition takes stake; closePaperPosition updates balance
lib/bots/resolver.ts                      # multi-position loop + position sizing + busted
lib/types.ts                              # BotSignal payload: currentPosition → currentPositions[] + balance fields
lib/signals/bot-signals.ts                # rebuild signals from N open positions; emit balance
components/feed/BotCard.tsx               # render multi-positions + balance/return header
scripts/seed-bots.ts                      # include balance fields (idempotent reset)
```

---

## Tasks

### Task 1: Schema — add balance + stake columns

**Files:** `lib/db/schema.ts`

- [ ] **Step 1: Add columns**

In `lib/db/schema.ts`, modify the `bots` table to add two new columns (place them before `createdAt`):

```ts
  balanceUsd: doublePrecision("balance_usd").notNull().default(1000),
  startingBalanceUsd: doublePrecision("starting_balance_usd").notNull().default(1000),
```

Modify the `paperPositions` table to add `stakeUsd` (place it after `leverage`):

```ts
  stakeUsd: doublePrecision("stake_usd").notNull().default(0),
```

The `default(0)` on `stake_usd` is for the schema-push to succeed against existing rows; new inserts always set an explicit value.

Also extend the `status` semantics for `bots`: still text, but Phase 2.5 introduces `"busted"` as a valid value alongside `"paper"|"backtest-fail"|"live"|"retired"`. No schema change needed — just code-level convention.

- [ ] **Step 2: Apply schema**

```bash
npm run db:push
```

Expected: `bots` table grows by 2 columns, `paper_positions` by 1. Existing rows get defaults. If drizzle prompts for any destructive operation, STOP.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): add bot balance_usd + position stake_usd columns"
```

---

### Task 2: EntryDecision.conviction + conviction in all 6 strategies

**Files:**
- Modify: `lib/bots/types.ts`
- Modify: `lib/bots/strategies/liquidation-lizard.ts`
- Modify: `lib/bots/strategies/funding-phoebe.ts`
- Modify: `lib/bots/strategies/mean-revert-mike.ts`
- Modify: `lib/bots/strategies/momo-max.ts`
- Modify: `lib/bots/strategies/vol-vector.ts`
- Modify: `lib/bots/strategies/boomer-trend.ts`

This is one task with 7 file edits. They all follow the same pattern: each strategy already computes some signal-strength quantity; we map it through a clamp function to a `conviction: number` and stuff it into the returned `EntryDecision`.

- [ ] **Step 1: Widen the EntryDecision type**

In `lib/bots/types.ts`, change `EntryDecision`:

```ts
export interface EntryDecision {
  asset: string;
  side: "long" | "short";
  leverage: number;
  conviction: number; // 0..1, clamped to [0.3, 1.0] in practice
  triggerMeta: Record<string, unknown>;
}
```

- [ ] **Step 2: Add a clamp helper used by all strategies**

In `lib/bots/types.ts` (or a new tiny `lib/bots/conviction.ts` — same file is fine), export:

```ts
export function clampConviction(
  raw: number,
  floor: number = 0.3,
  ceiling: number = 1.0,
): number {
  if (!Number.isFinite(raw)) return floor;
  return Math.min(ceiling, Math.max(floor, raw));
}
```

- [ ] **Step 3: Update each strategy's evaluateEntry**

For each of the 6 strategy files, add `conviction` to the returned `EntryDecision`. Use these formulas:

**lib/bots/strategies/liquidation-lizard.ts:**
```ts
import { clampConviction } from "../types"; // (or wherever you put it)

// Inside evaluateEntry, after `if (!candidate) return null;`:
const conviction = clampConviction(candidate.notionalUsd / 200_000);
return {
  asset: ctx.asset,
  side: candidate.side,
  leverage: p.leverage,
  conviction,
  triggerMeta: { /* existing fields */ },
};
```

**lib/bots/strategies/funding-phoebe.ts:**
```ts
// After thresholding:
const conviction = clampConviction(Math.abs(funding) / 0.0003); // |funding| / 30bps
return {
  asset: ctx.asset,
  side,
  leverage: p.leverage,
  conviction,
  triggerMeta: { /* existing */ },
};
```

**lib/bots/strategies/mean-revert-mike.ts:**
```ts
// After z-score check:
const conviction = clampConviction((Math.abs(z) - 2.5) / 1.5); // z=2.5 → 0, z=4 → 1
return {
  asset: ctx.asset,
  side,
  leverage: p.leverage,
  conviction,
  triggerMeta: { /* existing */ },
};
```

**lib/bots/strategies/momo-max.ts:**
```ts
// After breakout + volume check:
const volRatio = last.volume / meanPriorVolume;
const conviction = clampConviction(volRatio / 3);
return {
  asset: ctx.asset,
  side,
  leverage: p.leverage,
  conviction,
  triggerMeta: { /* existing */ },
};
```

**lib/bots/strategies/vol-vector.ts:**
```ts
// After vol + trend check:
const ratio = baseVol === 0 ? 3 : recentVol / baseVol;
const conviction = clampConviction(ratio / 3);
return {
  asset: ctx.asset,
  side,
  leverage: p.leverage,
  conviction,
  triggerMeta: { /* existing */ },
};
```

**lib/bots/strategies/boomer-trend.ts:**
```ts
// After crossover detection (use the last close as price reference):
const lastClose = candles[candles.length - 1].close;
const crossStrength = Math.abs(lastDiff) / Math.max(lastClose, 1);
const conviction = clampConviction(crossStrength * 100); // typical lastDiff is 0..1% of price
return {
  asset: ctx.asset,
  side,
  leverage: p.leverage,
  conviction,
  triggerMeta: { /* existing */ },
};
```

- [ ] **Step 4: Update existing tests**

Each strategy test currently asserts shape like `expect(decision!.side).toBe("long")`. Those keep passing. Don't add new assertions on conviction unless useful — the runtime values depend on the test fixtures.

If TypeScript complains in any test about a missing `conviction` field on a hand-constructed `EntryDecision`, add `conviction: 0.5` to those test fixtures.

- [ ] **Step 5: Run typecheck + all tests**

```bash
npm run typecheck && npm test
```

Expected: both pass. Test count should still be 58 unless you added new tests.

- [ ] **Step 6: Commit**

```bash
git add lib/bots/types.ts lib/bots/strategies/
git commit -m "feat(bots): conviction-weighted entry decisions across all 6 strategies"
```

---

### Task 3: Paper helpers — openPaperPosition takes stake; closePaperPosition credits bot balance

**Files:** `lib/bots/paper.ts`

- [ ] **Step 1: Update `openPaperPosition` signature**

```ts
export async function openPaperPosition(args: {
  botId: string;
  decision: EntryDecision;
  entryMark: number;
  stakeUsd: number; // NEW
  narration: string | null;
}): Promise<PaperPosition> {
  const [row] = await db
    .insert(paperPositions)
    .values({
      botId: args.botId,
      asset: args.decision.asset,
      side: args.decision.side,
      leverage: args.decision.leverage,
      entryMark: args.entryMark,
      stakeUsd: args.stakeUsd, // NEW
      triggerMeta: args.decision.triggerMeta,
      narrationOpen: args.narration,
      status: "open",
    })
    .returning();
  return rowToPosition(row);
}
```

The `PaperPosition` type needs `stakeUsd` too. In `lib/bots/types.ts`, add to the `PaperPosition` interface:

```ts
  stakeUsd: number;
```

And in `rowToPosition` inside `lib/bots/paper.ts`:

```ts
return {
  id: row.id,
  botId: row.botId,
  asset: row.asset,
  side: row.side as "long" | "short",
  leverage: row.leverage,
  stakeUsd: row.stakeUsd, // NEW
  entryMark: row.entryMark,
  entryTs: row.entryTs,
  exitMark: row.exitMark,
  exitTs: row.exitTs,
  paperPnlUsd: row.paperPnlUsd,
  triggerMeta: (row.triggerMeta as Record<string, unknown> | null) ?? null,
  narrationOpen: row.narrationOpen,
  narrationClose: row.narrationClose,
  status: row.status as "open" | "closed" | "expired",
};
```

- [ ] **Step 2: Update `closePaperPosition` to credit the bot's balance**

```ts
export async function closePaperPosition(args: {
  positionId: string;
  botId: string; // NEW — needed for the balance update
  exitMark: number;
  paperPnlUsd: number;
  narration: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(paperPositions)
      .set({
        exitMark: args.exitMark,
        exitTs: new Date(),
        paperPnlUsd: args.paperPnlUsd,
        narrationClose: args.narration,
        status: "closed",
      })
      .where(eq(paperPositions.id, args.positionId));

    // Credit bot's balance (positive PnL adds, negative subtracts)
    await tx
      .update(bots)
      .set({
        balanceUsd: sql`${bots.balanceUsd} + ${args.paperPnlUsd}`,
      })
      .where(eq(bots.id, args.botId));
  });
}
```

You'll need to import `bots` from the schema and `sql` from drizzle-orm at the top of the file:

```ts
import { bots, paperPositions } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
```

Note: if `db.transaction` is unavailable on the Neon HTTP driver (the project uses `@neondatabase/serverless` HTTP, not Pool), fall back to two sequential statements. Document this in a comment if needed.

- [ ] **Step 3: Add new helpers — `fetchOpenPositionsForBot` (returns array, not single) + `getBotBalance` + `markBotBusted`**

```ts
// Append to paper.ts
export async function fetchOpenPositionsForBot(
  botId: string,
): Promise<PaperPosition[]> {
  const rows = await db
    .select()
    .from(paperPositions)
    .where(
      and(eq(paperPositions.botId, botId), eq(paperPositions.status, "open")),
    );
  return rows.map(rowToPosition);
}

export async function getBotBalance(botId: string): Promise<number> {
  const [row] = await db
    .select({ balance: bots.balanceUsd })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  return row?.balance ?? 0;
}

export async function markBotBusted(botId: string): Promise<void> {
  await db.update(bots).set({ status: "busted" }).where(eq(bots.id, botId));
}
```

The existing `fetchOpenPositionForBot` (singular) returned `PaperPosition | null` for the wallet-copy flow at `/api/bet/bot`. That callsite still needs to work — keep it, but make it return the first open position (or null). Or just leave it as-is.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: pass. Some callsites in the resolver still pass the old `closePaperPosition` signature — those break and get fixed in Task 4.

If typecheck fails specifically on resolver-side callsites, that's expected — Task 4 fixes them. But the paper.ts file itself should be clean.

- [ ] **Step 5: Commit** (will be paired with resolver in next task)

For atomicity, hold off committing until Task 4 — typecheck will fail in resolver until then. Stage the changes:

```bash
git add lib/bots/paper.ts lib/bots/types.ts
```

Then proceed to Task 4 in the same logical commit.

---

### Task 4: Resolver — multi-position loop + sizing + busted handling

**Files:** `lib/bots/resolver.ts`

Rewrite the body of the resolver tick to:
1. Skip bots whose status is not `"paper"` (including `"busted"`)
2. For each remaining bot:
   - Fetch all its open positions; for each, run `evaluateExit`; if true, close it (which credits balance via the new helper)
   - After exit pass, fetch updated balance and open positions
   - If `balance < $10`, mark `"busted"` and continue
   - Compute `freeBalance = balance - sum(stake of remaining open positions)`
   - Compute available slots: `maxConcurrentPositions - openCount`
   - For each market in `strategy.markets`, if slots remain and `freeBalance ≥ MIN_STAKE_USD`:
     - Call `evaluateEntry(ctx, signals)`; if it returns a decision, compute `stake = min(balance × MAX_STAKE_PCT × conviction, freeBalance)` and open the position
     - Decrement slots and freeBalance

- [ ] **Step 1: Replace resolver.ts**

```ts
// lib/bots/resolver.ts
import { listBots, getStrategy } from "./index";
import { getMarksSnapshot } from "@/lib/data/marks";
import { getRecentLiquidations } from "@/lib/hyperliquid/client";
import { getFundingRates } from "@/lib/data/cex-funding";
import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositionsForBot,
  getBotBalance,
  markBotBusted,
  computePaperPnlUsd,
} from "./paper";
import type { ExternalSignals, MarketContext } from "./types";

const MAX_CONCURRENT_POSITIONS = 4;
const MAX_STAKE_PCT = 0.5;
const MIN_STAKE_USD = 10;
const BUST_THRESHOLD_USD = 10;

export async function tick(): Promise<{
  opened: number;
  closed: number;
  busted: number;
}> {
  const [marks, liquidations, funding] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
  ]);
  const signals: ExternalSignals = { liquidations, funding };

  let opened = 0;
  let closed = 0;
  let busted = 0;

  for (const bot of listBots()) {
    if (bot.status !== "paper") continue;
    const strategy = getStrategy(bot.strategyKey);
    if (!strategy) continue;

    // Phase 1: evaluate exits on all open positions for this bot.
    const openPositions = await fetchOpenPositionsForBot(bot.id);
    for (const pos of openPositions) {
      const mark = marks.get(pos.asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset: pos.asset, mark };
      if (strategy.evaluateExit(ctx, pos)) {
        const pnl = computePaperPnlUsd({
          side: pos.side,
          leverage: pos.leverage,
          entryMark: pos.entryMark,
          exitMark: mark,
          stakeUsd: pos.stakeUsd,
        });
        await closePaperPosition({
          positionId: pos.id,
          botId: bot.id,
          exitMark: mark,
          paperPnlUsd: pnl,
          narration: null,
        });
        closed += 1;
      }
    }

    // Phase 2: check balance after closes; bust if too low.
    const balance = await getBotBalance(bot.id);
    if (balance < BUST_THRESHOLD_USD) {
      await markBotBusted(bot.id);
      busted += 1;
      continue;
    }

    // Phase 3: figure out free balance and remaining slots.
    const remaining = await fetchOpenPositionsForBot(bot.id);
    const lockedStake = remaining.reduce((s, p) => s + p.stakeUsd, 0);
    let freeBalance = balance - lockedStake;
    let slots = MAX_CONCURRENT_POSITIONS - remaining.length;
    const openAssets = new Set(remaining.map((p) => p.asset));

    // Phase 4: scan markets for entries.
    if (slots <= 0 || freeBalance < MIN_STAKE_USD) continue;

    for (const asset of strategy.markets) {
      if (slots <= 0 || freeBalance < MIN_STAKE_USD) break;
      // Don't open a second position on the same asset for the same bot.
      if (openAssets.has(asset)) continue;
      const mark = marks.get(asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset, mark };
      const decision = await strategy.evaluateEntry(ctx, signals);
      if (!decision) continue;

      const targetStake = balance * MAX_STAKE_PCT * decision.conviction;
      const stake = Math.min(targetStake, freeBalance);
      if (stake < MIN_STAKE_USD) continue;

      await openPaperPosition({
        botId: bot.id,
        decision,
        entryMark: marks.get(decision.asset) ?? mark,
        stakeUsd: stake,
        narration: null,
      });
      opened += 1;
      slots -= 1;
      freeBalance -= stake;
      openAssets.add(decision.asset);
    }
  }

  return { opened, closed, busted };
}
```

- [ ] **Step 2: Update existing resolver tests**

`lib/bots/resolver.test.ts` is heavily mocked and uses `fetchOpenPositions` (the global open-positions fetcher). That helper is no longer used by the new resolver — the new resolver calls `fetchOpenPositionsForBot(bot.id)` instead.

Update the test mocks to swap `fetchOpenPositions` for `fetchOpenPositionsForBot`, `getBotBalance`, and `markBotBusted`:

```ts
vi.mock("./paper", async () => {
  const actual = await vi.importActual<typeof import("./paper")>("./paper");
  return {
    ...actual,
    openPaperPosition: vi.fn(),
    closePaperPosition: vi.fn(),
    fetchOpenPositionsForBot: vi.fn(async () => []),
    getBotBalance: vi.fn(async () => 1000),
    markBotBusted: vi.fn(),
  };
});

import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositionsForBot,
  getBotBalance,
  markBotBusted,
} from "./paper";
```

Update the test bodies:

- "opens a paper position when a strategy fires for an idle bot": same shape, but ensure the mocked strategy returns `conviction: 0.5` in the EntryDecision; the resolver will compute `stake = 1000 × 0.5 × 0.5 = 250` and call `openPaperPosition` with `stakeUsd: 250`.
- "closes an open paper position when the strategy says exit": mock `fetchOpenPositionsForBot` to return `[openPos]` (with the new `stakeUsd` field on the PaperPosition fixture); assert `closePaperPosition` is called with the right botId + positionId.
- "skips bots with status != 'paper'": unchanged.
- Add a new test: "marks a bot busted when balance drops below $10":
  - `getBotBalance.mockResolvedValue(5)`
  - Strategy provides an open position that hits exit at a big loss
  - Expect `markBotBusted` called

- [ ] **Step 3: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit (combined with Task 3's staged changes)**

```bash
git add lib/bots/paper.ts lib/bots/types.ts lib/bots/resolver.ts lib/bots/resolver.test.ts
git commit -m "feat(bots): multi-position resolver with bankroll management + conviction sizing + busted state"
```

---

### Task 5: BotSignal widening — currentPositions[] + balance fields

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/signals/bot-signals.ts`

The card needs to know about all open positions (up to 4), the current balance, and the lifetime return. Widen the BotSignal payload accordingly.

- [ ] **Step 1: Update BotSignal payload shape**

In `lib/types.ts`, find `BotSignal` and replace the `payload` shape:

```ts
export interface BotSignal extends BaseSignal {
  type: "bot";
  payload: {
    botId: string;
    botName: string;
    avatarEmoji: string;
    balanceUsd: number;
    startingBalanceUsd: number;
    lifetimeReturnPct: number; // (balance - starting) / starting
    freeBalanceUsd: number;
    busted: boolean;
    currentPositions: Array<{
      positionId: string;
      asset: string;
      side: "long" | "short";
      leverage: number;
      entryMark: number;
      currentMark: number;
      stakeUsd: number;
      livePaperPnlPct: number;
      livePaperPnlUsd: number;
      openSinceMs: number;
    }>;
    stats: {
      totalTrades: number;
      winRate: number;
      paperPnl24hUsd: number;
      paperPnl7dUsd: number;
      paperPnlAllUsd: number;
    };
  };
}
```

- [ ] **Step 2: Rewrite the signal generator**

In `lib/signals/bot-signals.ts`, replace `buildBotSignals` to read N open positions per bot:

```ts
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getMarksSnapshot } from "@/lib/data/marks";
import { computeLivePaperPnlPct } from "@/lib/bots/paper";
import type { BotSignal } from "@/lib/types";

export async function buildBotSignals(): Promise<BotSignal[]> {
  const botRows = await db
    .select()
    .from(bots)
    .where(eq(bots.status, "paper")); // hide busted bots from feed for now
  if (botRows.length === 0) return [];

  const marks = await getMarksSnapshot();
  const signals: BotSignal[] = [];

  for (const bot of botRows) {
    const openRows = await db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.botId, bot.id),
          eq(paperPositions.status, "open"),
        ),
      );

    const closedRows = await db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.botId, bot.id),
          eq(paperPositions.status, "closed"),
        ),
      )
      .orderBy(desc(paperPositions.exitTs))
      .limit(200);

    const totalTrades = closedRows.length;
    const wins = closedRows.filter((r) => (r.paperPnlUsd ?? 0) > 0).length;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const paperPnlAll = closedRows.reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const paperPnl24h = closedRows
      .filter((r) => r.exitTs && r.exitTs.getTime() >= since24h)
      .reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const paperPnl7d = closedRows
      .filter((r) => r.exitTs && r.exitTs.getTime() >= since7d)
      .reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);

    const currentPositions = openRows.map((openRow) => {
      const currentMark = marks.get(openRow.asset) ?? openRow.entryMark;
      const livePaperPnlPct = computeLivePaperPnlPct({
        side: openRow.side as "long" | "short",
        leverage: openRow.leverage,
        entryMark: openRow.entryMark,
        currentMark,
      });
      return {
        positionId: openRow.id,
        asset: openRow.asset,
        side: openRow.side as "long" | "short",
        leverage: openRow.leverage,
        entryMark: openRow.entryMark,
        currentMark,
        stakeUsd: openRow.stakeUsd,
        livePaperPnlPct,
        livePaperPnlUsd: livePaperPnlPct * openRow.stakeUsd,
        openSinceMs: openRow.entryTs.getTime(),
      };
    });

    const lockedStake = currentPositions.reduce(
      (s, p) => s + p.stakeUsd,
      0,
    );
    const freeBalance = bot.balanceUsd - lockedStake;
    const lifetimeReturnPct =
      (bot.balanceUsd - bot.startingBalanceUsd) / bot.startingBalanceUsd;

    const heatScore = Math.round(
      500 +
        currentPositions.length * 50 +
        Math.max(-200, Math.min(200, paperPnl24h / 10)),
    );

    signals.push({
      type: "bot",
      id: `bot:${bot.id}`,
      assetId: bot.id,
      heatScore,
      payload: {
        botId: bot.id,
        botName: bot.name,
        avatarEmoji: bot.avatarEmoji,
        balanceUsd: bot.balanceUsd,
        startingBalanceUsd: bot.startingBalanceUsd,
        lifetimeReturnPct,
        freeBalanceUsd: freeBalance,
        busted: bot.status === "busted",
        currentPositions,
        stats: {
          totalTrades,
          winRate,
          paperPnl24hUsd: paperPnl24h,
          paperPnl7dUsd: paperPnl7d,
          paperPnlAllUsd: paperPnlAll,
        },
      },
    });
  }

  return signals;
}
```

Also note that `lib/types.ts`'s `BaseSignal` includes `chips` (or whatever Phase 1 added). Keep that intact — `BotSignal extends BaseSignal` already.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: pass. The consumer that breaks is `components/feed/BotCard.tsx` (next task) — that's fine.

- [ ] **Step 4: Commit (staged with next task)**

Hold the commit — pair with BotCard in Task 6 for atomicity.

```bash
git add lib/types.ts lib/signals/bot-signals.ts
```

---

### Task 6: BotCard — multi-position render + balance/return header

**Files:** `components/feed/BotCard.tsx`

The current BotCard renders a single `pos` (or "Watching the tape"). Phase 2.5 renders the balance header, lifetime return, and ALL open positions as a list, with stake buttons attached to each position individually.

- [ ] **Step 1: Replace BotCard.tsx**

Read the current `components/feed/BotCard.tsx` first. The CSS classes and overall card frame should be preserved — only the internal content changes.

The new shape (adapt the styling to match the existing card's tokens):

```tsx
"use client";

import { useState } from "react";
import type { BotSignal } from "@/lib/types";
import { usePrivy } from "@privy-io/react-auth";

interface Props {
  signal: BotSignal;
}

const STAKE_AMOUNTS = [5, 10, 20, 50] as const;

export function BotCard({ signal }: Props) {
  const { getAccessToken } = usePrivy();
  const [busy, setBusy] = useState<string | null>(null); // positionId being staked
  const [msg, setMsg] = useState<string | null>(null);

  const p = signal.payload;
  const positions = p.currentPositions;
  const lifetimeReturnPct = p.lifetimeReturnPct;
  const returnColor =
    lifetimeReturnPct >= 0 ? "text-emerald-400" : "text-rose-400";

  async function onStake(positionId: string, asset: string, side: "long" | "short", leverage: number, stakeUsdc: number) {
    setBusy(positionId);
    setMsg(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no token");
      const resp = await fetch("/api/bet/bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          botId: p.botId,
          market: asset,
          side,
          leverage,
          stakeUsdc,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "open failed");
      const fill = data.fill;
      setMsg(`Opened ${asset} ${side} ${leverage}x — fill ${fill?.avgFillPrice ?? "?"}`);
    } catch (err) {
      setMsg(`Failed: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4 bg-zinc-900 text-zinc-100 rounded-2xl">
      <header className="flex items-center gap-3">
        <span className="text-3xl">{p.avatarEmoji}</span>
        <div className="flex-1">
          <h2 className="font-semibold text-lg leading-tight">{p.botName}</h2>
          <p className="text-xs text-zinc-400">Paper AI bot</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Balance</p>
          <p className="text-xl font-bold">${p.balanceUsd.toFixed(0)}</p>
          <p className={`text-xs font-semibold ${returnColor}`}>
            {lifetimeReturnPct >= 0 ? "+" : ""}{(lifetimeReturnPct * 100).toFixed(1)}%
          </p>
        </div>
      </header>

      <section className="flex-1 flex flex-col gap-2 overflow-y-auto">
        {positions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <p className="text-lg font-semibold">Watching the tape</p>
              <p className="text-xs mt-1">No active positions · ${p.freeBalanceUsd.toFixed(0)} free</p>
            </div>
          </div>
        ) : (
          positions.map((pos) => {
            const livePnlColor = pos.livePaperPnlPct >= 0 ? "text-emerald-400" : "text-rose-400";
            return (
              <div key={pos.positionId} className="bg-zinc-800/60 rounded-xl p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-base font-bold">
                    {pos.side === "long" ? "LONG" : "SHORT"} {pos.asset}{" "}
                    <span className="text-zinc-400">{pos.leverage}x</span>
                  </p>
                  <p className={`text-sm font-semibold ${livePnlColor}`}>
                    {pos.livePaperPnlPct >= 0 ? "+" : ""}{(pos.livePaperPnlPct * 100).toFixed(1)}%
                  </p>
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Stake ${pos.stakeUsd.toFixed(0)} · entry {pos.entryMark.toFixed(2)} · now {pos.currentMark.toFixed(2)}
                </p>
                <div className="flex gap-1 mt-2">
                  {STAKE_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      disabled={busy === pos.positionId}
                      onClick={() => onStake(pos.positionId, pos.asset, pos.side, pos.leverage, amt)}
                      className="flex-1 py-1.5 text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded transition"
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}

        <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Win</p>
            <p className="font-semibold">{(p.stats.winRate * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">24h paper</p>
            <p className={p.stats.paperPnl24hUsd >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
              ${p.stats.paperPnl24hUsd.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Trades</p>
            <p className="font-semibold">{p.stats.totalTrades}</p>
          </div>
        </div>
      </section>

      {msg && <p className="text-xs text-zinc-400">{msg}</p>}
    </div>
  );
}
```

If the existing BotCard imported `postBetWithConsolidation` and used a different fetch pattern (the Phase 1 implementer found that CopyCard uses direct fetch — match that pattern), preserve it. If it called `/api/bet/copy` with a different shape, the actual route in `/api/bet/bot` is what counts — check `app/api/bet/bot/route.ts` to confirm the body shape, then call it from BotCard.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit (combined with Task 5)**

```bash
git add lib/types.ts lib/signals/bot-signals.ts components/feed/BotCard.tsx
git commit -m "feat(feed): BotCard renders multi-position + balance/return header"
```

---

### Task 7: Seed update — initialize all 12 bots to $1000

**Files:** `scripts/seed-bots.ts`

The seed is idempotent (uses `onConflictDoNothing`), but Phase 1's row for Liquidation Lizard was inserted before the `balance_usd` column existed — Drizzle's `db:push` would have given it `default(1000)`, so it should already be at $1000. Just verify and (optionally) explicitly set balance in seed rows for clarity.

- [ ] **Step 1: Add balance fields to seed rows**

Update each row in `scripts/seed-bots.ts` to explicitly include `balanceUsd: 1000` and `startingBalanceUsd: 1000`:

```ts
{
  id: "liquidation-lizard",
  parentId: null,
  // ...
  balanceUsd: 1000,
  startingBalanceUsd: 1000,
  status: "paper",
},
```

Add this to all 12 entries.

- [ ] **Step 2: Re-run seed (idempotent)**

```bash
npm run seed:bots
```

Expected: `seeded 12 bots` — `onConflictDoNothing` skips existing rows. Their balance values came from the default at schema-push time.

- [ ] **Step 3: Reset balances to fresh state for testing**

Run a one-off SQL via db:studio OR add a one-off script. Easier: use the resolver itself — the existing rows already have balance=$1000 from the column default. No action needed unless you want to wipe paper history.

If you DO want to wipe and restart fresh (for a clean demo):

```bash
# Optional: clear all paper positions + reset balances
npx tsx --env-file=.env.local -e '
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
await db.delete(paperPositions);
await db.update(bots).set({ balanceUsd: 1000, status: "paper" });
console.log("reset");
process.exit(0);
'
```

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-bots.ts
git commit -m "chore(seed): explicit balance fields for all 12 bot rows"
```

---

### Task 8: Final verification

- [ ] **Step 1: typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: all pass.

- [ ] **Step 2: Dev server + feed probe**

```bash
npm run dev &
# wait ~5s
curl -s "http://localhost:3001/api/feed?limit=30&cursor=0" | python3 -c "
import sys, json
d = json.load(sys.stdin)
bots = [s for s in d.get('signals', []) if s.get('type') == 'bot']
for b in sorted(bots, key=lambda x: -x['payload']['balanceUsd']):
    p = b['payload']
    n = len(p['currentPositions'])
    ret = p['lifetimeReturnPct'] * 100
    print(f\"  {p['avatarEmoji']} {p['botName']:32s} \${p['balanceUsd']:7.0f}  {ret:+5.1f}%   {n} open\")
"
```

Expected: 12 rows, each starting at $1000 (or whatever paper PnL has accumulated), with `0 open` or 1-4 open positions.

- [ ] **Step 3: Run resolver to see multi-position behavior**

```bash
curl -s -H "Authorization: Bearer dev-cron-secret-rotate-in-prod" \
  http://localhost:3001/api/cron/bots-resolver
```

Expected: `{"ok":true,"opened":<n>,"closed":<n>,"busted":<n>,"ms":<n>}`. Watch the feed JSON over a few ticks — positions should accumulate and close, balances should move.

- [ ] **Step 4: Browser check**

Open `http://localhost:3001/feed`. Each bot card should show:
- Balance at top right
- Lifetime return %
- 0–4 position rows, each with its own stake buttons
- "Watching the tape" + free balance when idle

- [ ] **Step 5: Kill dev server**

```bash
pkill -f "perps-maxxing-paper-bots.*next dev"
```

- [ ] **Step 6: Final commit if any fixes landed**

If verification surfaced anything, commit those fixes. Otherwise skip.

---

## Self-Review

**Spec coverage:**
- [x] $1000 balance per bot — Task 1 schema + Task 7 seed
- [x] Multi-position — Task 4 resolver
- [x] Conviction-weighted sizing — Task 2 across strategies + Task 4 resolver
- [x] Bust handling — Task 4 resolver
- [x] BotCard shows balance + N positions — Task 6

**Type consistency:**
- `EntryDecision.conviction` added in Task 2, consumed in Task 4 (resolver).
- `PaperPosition.stakeUsd` added in Task 3, persisted in Task 4 (resolver close path), surfaced in Task 5 (signal payload).
- `BotSignal.payload.currentPositions[]` added in Task 5, rendered in Task 6.

**Phase 3+ deferred:**
- Per-bot config for `maxConcurrentPositions` and `maxStakePct` — all bots share defaults in Phase 2.5.
- Auto-revival from busted state.
- Kelly criterion.
- Per-position circuit breakers (existing 24h hard close still applies through expire-stale-copies cron).
- Conviction in the narrator prompt (Phase 3 wires this).
