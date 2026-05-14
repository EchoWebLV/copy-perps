# Paper AI Bots — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the vertical slice for the paper-AI-bots rail: one bot (Liquidation Lizard) running a deterministic strategy against real Hyperliquid liquidations and Pacifica marks, producing paper-PnL rows in the database, surfaced on the existing feed UI, copyable by users at $5/$10/$20/$50 via the existing agent-wallet flow to open real Pacifica orders. After Phase 1, the foundation (schema, resolver, mark cache, feature flags) is in place; Phase 2 adds the remaining 11 bots, regime detection, cross-bot awareness, leaderboard polish, Helius/Pyth, microstructure, and backtest gate.

**Architecture:** Bots paper-trade against canonical Pacifica WS marks (no real execution on the bot side). A single resolver runs on a 1-minute Vercel cron, sweeping for strategy entries and exits, writing to a new `paper_positions` table. Strategies are deterministic TypeScript modules implementing a small `Strategy` interface; persona voice (xAI Grok) only runs at open/close events, lazily fetched by the UI and cached. User tap-to-copy reuses the existing `/api/bet/copy` route with a new `botId` parameter — server scales the bot's current paper position to user stake, opens a real Pacifica order via the user's agent wallet, mirror-close cron picks up exits.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, **Vitest (new)** for pure-logic tests, `@ai-sdk/xai` (existing), Pacifica REST+WS (existing), Hyperliquid WS (expanded from existing REST client), Binance public funding REST (new).

**Spec:** [docs/superpowers/specs/2026-05-14-paper-ai-bots-design.md](../specs/2026-05-14-paper-ai-bots-design.md)

**Supersedes** (operationally, behind feature flags — code stays in repo): wallet-leaderboard copy-trade rail.

**Branch:** Working directly on `casino-mode` branch where the spec lives. Future Phase 2+ plans may decide to re-branch.

**Verification model:** Vitest for pure logic (strategies, paper-PnL math, mark cache, decision helpers). `npm run typecheck && npm run lint` for the rest. Manual browser verification on the dev server for the feed UI.

**Phase 1 scope (in):**
- Vitest test runner installed and wired into the project
- `FEATURE_COPY_TRADE` and `FEATURE_CASINO_MODE` feature flags
- `bots` and `paper_positions` schema tables
- Bot type interfaces + bot registry skeleton
- In-memory mark cache fed by Pacifica WS
- Resolver loop (1-min cron) + `/api/cron/bots-resolver` endpoint
- Hyperliquid WS subscription for liquidations
- Binance funding REST endpoint (one venue — placeholder for the multi-CEX aggregator interface; Bybit/OKX/dYdX come in Phase 2)
- Liquidation Lizard persona, strategy, registration, end-to-end paper-trade execution
- Signal generator that publishes bot signals from `paper_positions`
- `/api/feed` returns bot signals when `FEATURE_COPY_TRADE=false`
- Basic `BotCard` component rendering one bot's current paper position with copy buttons
- `/api/bet/copy` updated to accept `botId` and open real Pacifica orders matching the bot's position
- Mirror-close cron extended to match on `meta.botId`
- 24h hard close + per-position −50% circuit breaker via existing expire-stale-copies cron
- Legacy copy-trade rail gated behind `FEATURE_COPY_TRADE` (default false)

**Out of scope (Phase 2+):**
- Remaining 11 bots (Funding Phoebe, Mean-Revert Mike, Momo Max, Vol Vector, Boomer Trend + 6 variants)
- Regime classifier (xAI co-pilot role)
- Cross-bot awareness logic
- Multi-venue funding aggregation (Bybit, OKX, dYdX)
- Helius webhooks listener
- Pyth oracle subscription
- Order-book microstructure analyzer
- Backtest gate + CI integration
- Weekly dossier cron
- Leaderboard sort controls / time windows
- Live Feed dedicated tab
- Bot detail page
- Onboarding intro overlay
- xAI narrator caching tier (Phase 1 narrates synchronously on read; lazy cache is Phase 2)

---

## File map

**New files (created in Phase 1):**

```
vitest.config.ts                                      # vitest config
lib/bots/types.ts                                     # BotConfig, Strategy, EntryDecision, ExternalSignals types
lib/bots/index.ts                                     # bot registry (HEADLINER_BOTS map + helpers)
lib/bots/paper.ts                                     # openPaperPosition, closePaperPosition, livePaperPnl helpers
lib/bots/paper.test.ts                                # unit tests for paper helpers
lib/bots/resolver.ts                                  # tick(): evaluates strategies, opens/closes paper positions
lib/bots/resolver.test.ts                             # unit tests for tick
lib/bots/personas/liquidation-lizard.ts               # persona name/avatar/voice prompt
lib/bots/strategies/liquidation-lizard.ts             # Strategy implementation
lib/bots/strategies/liquidation-lizard.test.ts        # unit tests for the strategy
lib/bots/narrator.ts                                  # narrate(event, persona, payload) → xAI call
lib/data/marks.ts                                     # in-memory mark cache subscribing to Pacifica WS
lib/data/cex-funding.ts                               # fetchBinanceFunding(symbol) — first venue, aggregator interface
lib/signals/bot-signals.ts                            # buildBotSignals(): paper_positions → signals rows
components/feed/BotCard.tsx                           # bot card renderer
app/api/cron/bots-resolver/route.ts                   # cron: kicks the resolver tick
app/api/feed/bots/route.ts                            # GET: bot signals for the feed
```

**Modified files:**

```
package.json                                          # add vitest devDep + scripts
lib/features.ts                                       # add copyTradeEnabled() + casinoModeEnabled() helpers
lib/db/schema.ts                                      # add bots + paper_positions tables
lib/hyperliquid/client.ts                             # add subscribeLiquidations(onLiquidation)
lib/types.ts                                          # add BotSignal type to Signal union
lib/feed/pool.ts                                      # add bot signals to pool; gate trader signals on copyTradeEnabled()
components/feed/FeedContainer.tsx                     # route 'bot' signal type to BotCard
app/api/bet/copy/route.ts                             # accept body.botId; open real order matching paper position
app/api/cron/mirror-close/route.ts                    # match on meta.botId in addition to meta.leaderAddress
app/api/cron/refresh-traders/route.ts                 # short-circuit when copyTradeEnabled()=false
vercel.json                                           # add /api/cron/bots-resolver entry
.env.example                                          # document FEATURE_COPY_TRADE + FEATURE_CASINO_MODE
```

---

## Tasks

### Task 1: Install Vitest + smoke test

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/bots/smoke.test.ts` (delete after Task 2)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^2.0.0
```

- [ ] **Step 2: Add scripts to package.json**

Edit `package.json`'s `scripts` block to add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 4: Write smoke test**

```ts
// lib/bots/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 6: Delete the smoke test**

```bash
rm lib/bots/smoke.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): add vitest runner for bot-logic unit tests"
```

---

### Task 2: Feature flag helpers

**Files:**
- Modify: `lib/features.ts`
- Modify: `.env.example`

- [ ] **Step 1: Extend lib/features.ts**

Current content of [lib/features.ts](../../lib/features.ts) defines `legacyRailsEnabled()`. Add two new helpers:

```ts
// lib/features.ts (append)
export function copyTradeEnabled(): boolean {
  return process.env.FEATURE_COPY_TRADE === "true";
}

export function casinoModeEnabled(): boolean {
  return process.env.FEATURE_CASINO_MODE === "true";
}
```

- [ ] **Step 2: Document the new env vars**

Append to `.env.example`:

```bash
# --- Phase 1 (paper AI bots) ---
# When unset or "false", the wallet-leaderboard copy-trade rail returns 410
# on all routes and is hidden from the feed. Default off. Paper AI bots are
# the active rail.
FEATURE_COPY_TRADE=false

# Reserved for casino-mode work (parked). Default off.
FEATURE_CASINO_MODE=false
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/features.ts .env.example
git commit -m "feat(features): add FEATURE_COPY_TRADE + FEATURE_CASINO_MODE flags"
```

---

### Task 3: Schema — bots table

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add bots table to schema**

Append to `lib/db/schema.ts`:

```ts
// lib/db/schema.ts (append, after agentWallets)

export const bots = pgTable("bots", {
  id: text("id").primaryKey(), // e.g. "liquidation-lizard"
  parentId: text("parent_id"), // null for headliners; parent slug for variants
  name: text("name").notNull(),
  avatarEmoji: text("avatar_emoji").notNull(),
  personaVoiceKey: text("persona_voice_key").notNull(),
  strategyKey: text("strategy_key").notNull(),
  config: jsonb("config").notNull(),
  status: text("status").notNull().default("paper"), // 'paper' | 'backtest-fail' | 'live' | 'retired'
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 2: Apply schema to DB**

Run: `npm run db:push`
Expected: "bots" table created. Confirm at `npm run db:studio` → bots table visible.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): add bots table for paper AI bot registry"
```

---

### Task 4: Schema — paper_positions table

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add paper_positions table**

Append to `lib/db/schema.ts`:

```ts
export const paperPositions = pgTable(
  "paper_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    asset: text("asset").notNull(),
    side: text("side").notNull(), // 'long' | 'short'
    leverage: integer("leverage").notNull(),
    entryMark: doublePrecision("entry_mark").notNull(),
    entryTs: timestamp("entry_ts", { withTimezone: true })
      .notNull()
      .defaultNow(),
    exitMark: doublePrecision("exit_mark"),
    exitTs: timestamp("exit_ts", { withTimezone: true }),
    paperPnlUsd: doublePrecision("paper_pnl_usd"),
    triggerMeta: jsonb("trigger_meta"),
    narrationOpen: text("narration_open"),
    narrationClose: text("narration_close"),
    status: text("status").notNull().default("open"), // 'open' | 'closed' | 'expired'
  },
  (t) => ({
    botOpenIdx: index("paper_positions_bot_open_idx").on(t.botId, t.status),
    statusTsIdx: index("paper_positions_status_ts_idx").on(
      t.status,
      t.entryTs,
    ),
  }),
);
```

- [ ] **Step 2: Apply schema**

Run: `npm run db:push`
Expected: "paper_positions" table created with 2 indexes.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): add paper_positions table for bot paper-trading bookkeeping"
```

---

### Task 5: Bot type interfaces

**Files:**
- Create: `lib/bots/types.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/bots/types.ts

export interface BotConfig {
  id: string;
  parentId: string | null;
  name: string;
  avatarEmoji: string;
  personaVoiceKey: string;
  strategyKey: string;
  config: Record<string, unknown>;
  status: "paper" | "backtest-fail" | "live" | "retired";
}

export interface PaperPosition {
  id: string;
  botId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  entryTs: Date;
  exitMark: number | null;
  exitTs: Date | null;
  paperPnlUsd: number | null;
  triggerMeta: Record<string, unknown> | null;
  narrationOpen: string | null;
  narrationClose: string | null;
  status: "open" | "closed" | "expired";
}

export interface EntryDecision {
  asset: string;
  side: "long" | "short";
  leverage: number;
  triggerMeta: Record<string, unknown>;
}

export interface LiquidationEvent {
  asset: string;
  side: "long" | "short"; // which side got liquidated
  notionalUsd: number;
  ts: number; // unix ms
  source: "hyperliquid";
}

export interface ExternalSignals {
  // Recent liquidation events (e.g. last 60s, rolling buffer)
  liquidations: LiquidationEvent[];
  // Per-asset funding rate from primary venue (Binance in Phase 1)
  funding: Record<string, number>;
}

export interface MarketContext {
  asset: string;
  mark: number;
  // Future-extensible: candles by timeframe come in Phase 2
}

export interface Strategy {
  readonly id: string;
  readonly markets: readonly string[];
  evaluateEntry(
    ctx: MarketContext,
    signals: ExternalSignals,
  ): EntryDecision | null;
  evaluateExit(
    ctx: MarketContext,
    position: PaperPosition,
  ): boolean;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lib/bots/types.ts
git commit -m "feat(bots): define BotConfig, Strategy, PaperPosition types"
```

---

### Task 6: Bot registry skeleton

**Files:**
- Create: `lib/bots/index.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/bots/index.ts
import type { BotConfig, Strategy } from "./types";

// In-memory registry of all bots known to the system. Database `bots` rows
// are the source of truth for status/parameters; this map provides the
// strategy + persona implementations that DB rows reference by key.
const BOTS = new Map<string, BotConfig>();
const STRATEGIES = new Map<string, Strategy>();

export function registerBot(config: BotConfig, strategy: Strategy): void {
  if (BOTS.has(config.id)) {
    throw new Error(`Bot ${config.id} already registered`);
  }
  BOTS.set(config.id, config);
  STRATEGIES.set(config.strategyKey, strategy);
}

export function getBot(id: string): BotConfig | null {
  return BOTS.get(id) ?? null;
}

export function getStrategy(strategyKey: string): Strategy | null {
  return STRATEGIES.get(strategyKey) ?? null;
}

export function listBots(): BotConfig[] {
  return Array.from(BOTS.values());
}

// Bot strategy implementations register themselves on import. Phase 1 ships
// Liquidation Lizard only; Phase 2 adds the rest.
import "./strategies/liquidation-lizard";
```

- [ ] **Step 2: Run typecheck (will fail — strategy file doesn't exist yet)**

Run: `npm run typecheck`
Expected: error pointing at the missing `./strategies/liquidation-lizard` import. This is expected; Task 9 creates that file. Leave the import.

- [ ] **Step 3: Commit**

```bash
git add lib/bots/index.ts
git commit -m "feat(bots): add bot + strategy registry"
```

---

### Task 7: Paper-PnL helpers + tests

**Files:**
- Create: `lib/bots/paper.ts`
- Create: `lib/bots/paper.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/bots/paper.test.ts
import { describe, it, expect } from "vitest";
import { computePaperPnlUsd, computeLivePaperPnlPct } from "./paper";

describe("computePaperPnlUsd", () => {
  it("long 10x with 10% price move returns +stake * leverage", () => {
    // $100 stake, 10x leverage = $1000 notional, +10% move = +$100 pnl
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 110,
        notionalUsd: 1000,
      }),
    ).toBeCloseTo(100, 4);
  });

  it("short 5x with 10% price drop returns +stake * leverage", () => {
    expect(
      computePaperPnlUsd({
        side: "short",
        leverage: 5,
        entryMark: 100,
        exitMark: 90,
        notionalUsd: 500,
      }),
    ).toBeCloseTo(50, 4);
  });

  it("long with adverse move returns negative", () => {
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 95,
        notionalUsd: 1000,
      }),
    ).toBeCloseTo(-50, 4);
  });
});

describe("computeLivePaperPnlPct", () => {
  it("matches the closed PnL when called with the live mark", () => {
    const pct = computeLivePaperPnlPct({
      side: "long",
      leverage: 10,
      entryMark: 100,
      currentMark: 105,
    });
    // 5% move × 10x = 50% PnL on stake
    expect(pct).toBeCloseTo(0.5, 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/bots/paper.test.ts`
Expected: FAIL — "computePaperPnlUsd is not a function".

- [ ] **Step 3: Implement the helpers**

```ts
// lib/bots/paper.ts

export interface PaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  exitMark: number;
  notionalUsd: number;
}

/**
 * Realized paper PnL in USD at exit. notionalUsd is the position size in
 * USD (== stake × leverage). Sign convention: positive = profit.
 */
export function computePaperPnlUsd(args: PaperPnlArgs): number {
  const { side, entryMark, exitMark, notionalUsd } = args;
  const moveFrac = (exitMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  return notionalUsd * directional;
}

export interface LivePaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
}

/**
 * Unrealized paper PnL as a fraction of stake (not notional). At leverage L
 * and price move M%, this returns L*M (e.g. 5x with +10% move = +50%).
 */
export function computeLivePaperPnlPct(args: LivePaperPnlArgs): number {
  const { side, leverage, entryMark, currentMark } = args;
  const moveFrac = (currentMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  return directional * leverage;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/bots/paper.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/bots/paper.ts lib/bots/paper.test.ts
git commit -m "feat(bots): paper-PnL math helpers + tests"
```

---

### Task 8: Mark cache fed by Pacifica WS

**Files:**
- Create: `lib/data/marks.ts`

The frontend already subscribes to Pacifica WS in [lib/pacifica/live-context.tsx](../../lib/pacifica/live-context.tsx). The bot resolver runs server-side and needs its own mark source. Pacifica's WS is browser-friendly, so for server use we fetch marks via REST (`GET /api/v1/markets`) on each resolver tick. This avoids holding a long-lived WS connection in a serverless function.

- [ ] **Step 1: Create the marks fetcher**

```ts
// lib/data/marks.ts
import { getMarketsCached } from "@/lib/pacifica/markets";

/**
 * Returns a map of symbol → mark for all Pacifica markets, sampled from
 * REST. Cached for 5s to avoid hammering Pacifica when the resolver
 * tick is short.
 */
let _cache: { marks: Map<string, number>; expiresAt: number } | null = null;
const TTL_MS = 5_000;

export async function getMarksSnapshot(): Promise<Map<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.marks;
  const markets = await getMarketsCached();
  const marks = new Map<string, number>();
  for (const m of markets) {
    // PacificaMarketInfo has a `mark` field per current types.ts.
    // If the field name is different in the runtime payload, fix at consumer.
    if (typeof (m as { mark?: number }).mark === "number") {
      marks.set(m.symbol, (m as { mark: number }).mark);
    }
  }
  _cache = { marks, expiresAt: Date.now() + TTL_MS };
  return marks;
}

export async function getMark(symbol: string): Promise<number | null> {
  const snap = await getMarksSnapshot();
  return snap.get(symbol) ?? null;
}
```

- [ ] **Step 2: Verify PacificaMarketInfo shape**

Open [lib/pacifica/types.ts](../../lib/pacifica/types.ts) and confirm `PacificaMarketInfo` has a `mark` field (or equivalent like `last_mark` / `oracle_price`). If the field is named differently, update the cast in `lib/data/marks.ts` accordingly.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/data/marks.ts
git commit -m "feat(data): mark snapshot fetcher backed by Pacifica REST"
```

---

### Task 9: Liquidation Lizard strategy + tests

**Files:**
- Create: `lib/bots/strategies/liquidation-lizard.ts`
- Create: `lib/bots/strategies/liquidation-lizard.test.ts`

The Liquidation Lizard strategy: when a Hyperliquid liquidation event >$50k forces selling in an asset, open the *opposite* side (fade the wick) for 1m hold, exit on +0.5% favorable move or after 90s elapsed.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/bots/strategies/liquidation-lizard.test.ts
import { describe, it, expect } from "vitest";
import { LiquidationLizardStrategy } from "./liquidation-lizard";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const baseCtx: MarketContext = { asset: "SOL", mark: 100 };
const emptySignals: ExternalSignals = { liquidations: [], funding: {} };

describe("LiquidationLizard.evaluateEntry", () => {
  it("returns null when no liquidations", () => {
    expect(LiquidationLizardStrategy.evaluateEntry(baseCtx, emptySignals)).toBeNull();
  });

  it("opens a long when a long was just liquidated above threshold", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "SOL",
          side: "long",
          notionalUsd: 75_000,
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).not.toBeNull();
    expect(decision!.asset).toBe("SOL");
    expect(decision!.side).toBe("long");
  });

  it("ignores liquidations below the $50k threshold", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "SOL",
          side: "long",
          notionalUsd: 30_000,
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).toBeNull();
  });

  it("ignores liquidations for other assets", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "BTC",
          side: "long",
          notionalUsd: 100_000,
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).toBeNull();
  });

  it("ignores stale liquidations (>60s old)", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "SOL",
          side: "long",
          notionalUsd: 100_000,
          ts: Date.now() - 120_000,
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).toBeNull();
  });
});

describe("LiquidationLizard.evaluateExit", () => {
  const openPos: PaperPosition = {
    id: "p1",
    botId: "liquidation-lizard",
    asset: "SOL",
    side: "long",
    leverage: 50,
    entryMark: 100,
    entryTs: new Date(),
    exitMark: null,
    exitTs: null,
    paperPnlUsd: null,
    triggerMeta: null,
    narrationOpen: null,
    narrationClose: null,
    status: "open",
  };

  it("exits when price moves +0.5% favorable on a long", () => {
    expect(
      LiquidationLizardStrategy.evaluateExit(
        { asset: "SOL", mark: 100.6 },
        openPos,
      ),
    ).toBe(true);
  });

  it("does not exit on a small favorable move", () => {
    expect(
      LiquidationLizardStrategy.evaluateExit(
        { asset: "SOL", mark: 100.2 },
        openPos,
      ),
    ).toBe(false);
  });

  it("exits after 90s timeout", () => {
    const oldPos: PaperPosition = {
      ...openPos,
      entryTs: new Date(Date.now() - 100_000),
    };
    expect(
      LiquidationLizardStrategy.evaluateExit(
        { asset: "SOL", mark: 100 },
        oldPos,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/bots/strategies/liquidation-lizard.test.ts`
Expected: FAIL — "LiquidationLizardStrategy is not defined".

- [ ] **Step 3: Implement the strategy**

```ts
// lib/bots/strategies/liquidation-lizard.ts
import { registerBot } from "../index";
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";

const MIN_LIQ_NOTIONAL_USD = 50_000;
const LIQUIDATION_STALE_MS = 60_000;
const EXIT_FAVORABLE_PCT = 0.005; // +0.5%
const MAX_HOLD_MS = 90_000;
const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;
const LEVERAGE = 50;

export const LiquidationLizardStrategy: Strategy = {
  id: "liquidation-lizard",
  markets: ALLOWED_MARKETS,

  evaluateEntry(
    ctx: MarketContext,
    signals: ExternalSignals,
  ): EntryDecision | null {
    if (!ALLOWED_MARKETS.includes(ctx.asset as (typeof ALLOWED_MARKETS)[number])) {
      return null;
    }
    const now = Date.now();
    const candidate = signals.liquidations.find(
      (l) =>
        l.asset === ctx.asset &&
        l.notionalUsd >= MIN_LIQ_NOTIONAL_USD &&
        now - l.ts <= LIQUIDATION_STALE_MS,
    );
    if (!candidate) return null;
    // Fade: if a long was liquidated (forced sell), the wick goes down — we
    // go long. If a short was liquidated (forced buy), we go short.
    const side: "long" | "short" =
      candidate.side === "long" ? "long" : "short";
    return {
      asset: ctx.asset,
      side,
      leverage: LEVERAGE,
      triggerMeta: {
        liquidationNotionalUsd: candidate.notionalUsd,
        liquidationSide: candidate.side,
        liquidationTs: candidate.ts,
      },
    };
  },

  evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
    const heldMs = Date.now() - position.entryTs.getTime();
    if (heldMs >= MAX_HOLD_MS) return true;
    const moveFrac = (ctx.mark - position.entryMark) / position.entryMark;
    const favorable =
      position.side === "long" ? moveFrac : -moveFrac;
    return favorable >= EXIT_FAVORABLE_PCT;
  },
};

const LiquidationLizardBot: BotConfig = {
  id: "liquidation-lizard",
  parentId: null,
  name: "Liquidation Lizard",
  avatarEmoji: "🦎",
  personaVoiceKey: "liquidation-lizard",
  strategyKey: "liquidation-lizard",
  config: {
    minLiqNotionalUsd: MIN_LIQ_NOTIONAL_USD,
    leverage: LEVERAGE,
    exitFavorablePct: EXIT_FAVORABLE_PCT,
    maxHoldMs: MAX_HOLD_MS,
  },
  status: "paper",
};

registerBot(LiquidationLizardBot, LiquidationLizardStrategy);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/bots/strategies/liquidation-lizard.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: pass (the import in `lib/bots/index.ts` from Task 6 now resolves).

- [ ] **Step 6: Commit**

```bash
git add lib/bots/strategies/liquidation-lizard.ts lib/bots/strategies/liquidation-lizard.test.ts
git commit -m "feat(bots): Liquidation Lizard strategy — fade HL liquidation wicks"
```

---

### Task 10: Liquidation Lizard persona prompt

**Files:**
- Create: `lib/bots/personas/liquidation-lizard.ts`

- [ ] **Step 1: Write the persona file**

```ts
// lib/bots/personas/liquidation-lizard.ts

export const LIQUIDATION_LIZARD_PERSONA = {
  key: "liquidation-lizard",
  name: "Liquidation Lizard",
  avatarEmoji: "🦎",
  bio: "Hunts forced sellers. Feasts on cascades. Doesn't tip.",
  systemPrompt: `You are Liquidation Lizard, a predator AI trading bot that hunts forced sellers and feasts on liquidation cascades.

Voice:
- Predatory, irreverent, brief. Maximum 2 short sentences per output.
- Crypto-degen vocabulary fine ("rekt", "wick", "longs got farmed", etc.).
- You celebrate when liquidations hit. You taunt the liquidated, not the user.
- Never mention you are an AI. Never give financial advice. Never use the word "delicious".

Output format: plain text, no markdown, no quotes, no preamble. Just the line itself.`.trim(),
} as const;
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lib/bots/personas/liquidation-lizard.ts
git commit -m "feat(bots): Liquidation Lizard persona + voice prompt"
```

---

### Task 11: xAI narrator

**Files:**
- Create: `lib/bots/narrator.ts`

- [ ] **Step 1: Verify the xAI SDK is wired**

Open [package.json](../../package.json) and confirm `@ai-sdk/xai` and `ai` are present. Open [app/api/analyze/](../../app/api/analyze/) to see the existing xAI usage pattern for reference.

- [ ] **Step 2: Write the narrator**

```ts
// lib/bots/narrator.ts
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { LIQUIDATION_LIZARD_PERSONA } from "./personas/liquidation-lizard";

const PERSONAS = {
  "liquidation-lizard": LIQUIDATION_LIZARD_PERSONA,
} as const;

export type PersonaKey = keyof typeof PERSONAS;

export interface NarrateOpenArgs {
  personaKey: PersonaKey;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  trigger: Record<string, unknown>;
}

export interface NarrateCloseArgs {
  personaKey: PersonaKey;
  asset: string;
  side: "long" | "short";
  entryMark: number;
  exitMark: number;
  paperPnlUsd: number;
}

const MODEL_ID = "grok-2-1212";

export async function narrateOpen(args: NarrateOpenArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey];
  if (!persona) throw new Error(`Unknown persona: ${args.personaKey}`);
  const { text } = await generateText({
    model: xai(MODEL_ID),
    system: persona.systemPrompt,
    prompt: JSON.stringify(
      {
        event: "open",
        asset: args.asset,
        side: args.side,
        leverage: args.leverage,
        entry_mark: args.entryMark,
        context: args.trigger,
      },
      null,
      2,
    ),
    maxOutputTokens: 80,
  });
  return text.trim();
}

export async function narrateClose(args: NarrateCloseArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey];
  if (!persona) throw new Error(`Unknown persona: ${args.personaKey}`);
  const { text } = await generateText({
    model: xai(MODEL_ID),
    system: persona.systemPrompt,
    prompt: JSON.stringify(
      {
        event: "close",
        asset: args.asset,
        side: args.side,
        entry_mark: args.entryMark,
        exit_mark: args.exitMark,
        paper_pnl_usd: args.paperPnlUsd,
      },
      null,
      2,
    ),
    maxOutputTokens: 80,
  });
  return text.trim();
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/bots/narrator.ts
git commit -m "feat(bots): xAI persona narrator for open + close events"
```

---

### Task 12: Hyperliquid liquidation subscription

**Files:**
- Modify: `lib/hyperliquid/client.ts`

Current Hyperliquid client is REST-only for whale polling. Phase 1 adds a WS subscription to liquidations. Hyperliquid WS endpoint: `wss://api.hyperliquid.xyz/ws`. Subscription message for forced trades: `{"method":"subscribe","subscription":{"type":"trades","coin":"<asset>"}}`. Liquidations are flagged in trade events via the `liquidation` field.

Server-side WS in serverless is awkward; for Phase 1 we use a simpler approach: a 5s in-memory polling buffer of HL's recent fills REST endpoint, filtered to liquidation flags. The "WS upgrade" is Phase 2 once the resolver runs in a long-lived process.

- [ ] **Step 1: Read the current client**

```bash
wc -l lib/hyperliquid/client.ts
```

Skim the file to understand existing patterns. The resolver will call a new function `getRecentLiquidations()` from this module.

- [ ] **Step 2: Add the liquidation fetcher**

Append to `lib/hyperliquid/client.ts`:

```ts
// lib/hyperliquid/client.ts (append)
import type { LiquidationEvent } from "@/lib/bots/types";

const HL_API = "https://api.hyperliquid.xyz/info";

interface HLFill {
  coin: string;
  side: "B" | "A"; // B = buy/long taker, A = ask/short taker
  px: string;
  sz: string;
  time: number;
  liquidation?: boolean;
}

const HL_ASSET_NORMALIZE: Record<string, string> = {
  // Hyperliquid uses bare tickers; Pacifica uses the same. Add aliases here
  // when assets diverge.
};

let _buffer: LiquidationEvent[] = [];
let _lastFetchMs = 0;
const POLL_INTERVAL_MS = 5_000;
const BUFFER_RETENTION_MS = 120_000;

export async function getRecentLiquidations(): Promise<LiquidationEvent[]> {
  const now = Date.now();
  if (now - _lastFetchMs > POLL_INTERVAL_MS) {
    _lastFetchMs = now;
    try {
      const res = await fetch(HL_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "recentTrades" }),
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("[HL] recentTrades failed:", res.status);
      } else {
        const fills = (await res.json()) as HLFill[];
        for (const f of fills) {
          if (!f.liquidation) continue;
          const asset = HL_ASSET_NORMALIZE[f.coin] ?? f.coin;
          const notionalUsd = Number(f.px) * Number(f.sz);
          // side semantics: a liquidation buy means a SHORT got liquidated;
          // a liquidation sell means a LONG got liquidated.
          const side: "long" | "short" = f.side === "A" ? "long" : "short";
          _buffer.push({
            asset,
            side,
            notionalUsd,
            ts: f.time,
            source: "hyperliquid",
          });
        }
      }
    } catch (err) {
      console.error("[HL] fetch error:", err);
    }
    // Drop stale entries
    const cutoff = now - BUFFER_RETENTION_MS;
    _buffer = _buffer.filter((e) => e.ts >= cutoff);
  }
  return _buffer.slice();
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Verify the endpoint shape with a probe**

Create a one-off probe at `scripts/_probe-hl-liquidations.mjs`:

```js
// scripts/_probe-hl-liquidations.mjs
const res = await fetch("https://api.hyperliquid.xyz/info", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "recentTrades" }),
});
const fills = await res.json();
const liqs = fills.filter((f) => f.liquidation);
console.log(`fills: ${fills.length}, liqs: ${liqs.length}`);
if (liqs.length > 0) console.log(JSON.stringify(liqs[0], null, 2));
```

Run: `node scripts/_probe-hl-liquidations.mjs`
Expected: prints fill count + at least one liquidation example. If the response shape differs from `HLFill`, adjust the type + parsing in `getRecentLiquidations()` before continuing.

- [ ] **Step 5: Commit**

```bash
git add lib/hyperliquid/client.ts scripts/_probe-hl-liquidations.mjs
git commit -m "feat(hyperliquid): poll recent liquidations into rolling buffer"
```

---

### Task 13: Binance funding endpoint

**Files:**
- Create: `lib/data/cex-funding.ts`

Phase 1 wires Binance as the first venue. Bybit/OKX/dYdX are Phase 2; the function signature is designed to accept additional venues without breaking callers.

- [ ] **Step 1: Create the file**

```ts
// lib/data/cex-funding.ts

const BINANCE_FUNDING_URL =
  "https://fapi.binance.com/fapi/v1/premiumIndex";

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  HYPE: "HYPEUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
};

let _cache: { funding: Record<string, number>; expiresAt: number } | null = null;
const TTL_MS = 30_000;

/**
 * Returns a map of our internal asset code → Binance funding rate
 * (1-period rate, not annualized). Cached for 30s. Phase 2 will fan-out to
 * Bybit, OKX, dYdX and return an aggregate.
 */
export async function getFundingRates(): Promise<Record<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.funding;
  try {
    const res = await fetch(BINANCE_FUNDING_URL, { cache: "no-store" });
    if (!res.ok) {
      console.error("[binance funding]", res.status);
      return _cache?.funding ?? {};
    }
    const all = (await res.json()) as BinancePremiumIndex[];
    const out: Record<string, number> = {};
    for (const [internal, binSymbol] of Object.entries(BINANCE_SYMBOL_MAP)) {
      const row = all.find((r) => r.symbol === binSymbol);
      if (row) out[internal] = Number(row.lastFundingRate);
    }
    _cache = { funding: out, expiresAt: Date.now() + TTL_MS };
    return out;
  } catch (err) {
    console.error("[binance funding] fetch error:", err);
    return _cache?.funding ?? {};
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Probe the endpoint**

```bash
curl -s "https://fapi.binance.com/fapi/v1/premiumIndex" | head -c 200
```

Expected: JSON array with `lastFundingRate` fields. If the response is gzipped or rate-limited, retry; the production code uses `cache: "no-store"` so behavior under retry is expected to be stable.

- [ ] **Step 4: Commit**

```bash
git add lib/data/cex-funding.ts
git commit -m "feat(data): Binance funding rate fetcher (multi-venue Phase 2)"
```

---

### Task 14: Resolver loop + tests

**Files:**
- Create: `lib/bots/resolver.ts`
- Create: `lib/bots/resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/bots/resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  BotConfig,
  EntryDecision,
  PaperPosition,
  Strategy,
} from "./types";

// We stub out the registry + DB to test resolver logic in isolation.
vi.mock("./index", () => ({
  listBots: vi.fn(),
  getStrategy: vi.fn(),
}));
vi.mock("@/lib/data/marks", () => ({
  getMarksSnapshot: vi.fn(async () => new Map([["SOL", 100]])),
}));
vi.mock("@/lib/hyperliquid/client", () => ({
  getRecentLiquidations: vi.fn(async () => []),
}));
vi.mock("@/lib/data/cex-funding", () => ({
  getFundingRates: vi.fn(async () => ({})),
}));
vi.mock("./paper", () => ({
  openPaperPosition: vi.fn(),
  closePaperPosition: vi.fn(),
  fetchOpenPositions: vi.fn(async () => []),
}));

import { tick } from "./resolver";
import { listBots, getStrategy } from "./index";
import { openPaperPosition, closePaperPosition, fetchOpenPositions } from "./paper";

describe("resolver.tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a paper position when a strategy fires for an idle bot", async () => {
    const bot: BotConfig = {
      id: "test-bot",
      parentId: null,
      name: "Test",
      avatarEmoji: "🧪",
      personaVoiceKey: "test",
      strategyKey: "test",
      config: {},
      status: "paper",
    };
    const strategy: Strategy = {
      id: "test",
      markets: ["SOL"],
      evaluateEntry: () =>
        ({
          asset: "SOL",
          side: "long",
          leverage: 10,
          triggerMeta: { reason: "test" },
        }) satisfies EntryDecision,
      evaluateExit: () => false,
    };
    vi.mocked(listBots).mockReturnValue([bot]);
    vi.mocked(getStrategy).mockReturnValue(strategy);
    vi.mocked(fetchOpenPositions).mockResolvedValue([]);

    await tick();

    expect(openPaperPosition).toHaveBeenCalledTimes(1);
    expect(closePaperPosition).not.toHaveBeenCalled();
  });

  it("closes an open paper position when the strategy says exit", async () => {
    const bot: BotConfig = {
      id: "test-bot",
      parentId: null,
      name: "Test",
      avatarEmoji: "🧪",
      personaVoiceKey: "test",
      strategyKey: "test",
      config: {},
      status: "paper",
    };
    const strategy: Strategy = {
      id: "test",
      markets: ["SOL"],
      evaluateEntry: () => null,
      evaluateExit: () => true,
    };
    const openPos: PaperPosition = {
      id: "pp-1",
      botId: "test-bot",
      asset: "SOL",
      side: "long",
      leverage: 10,
      entryMark: 90,
      entryTs: new Date(),
      exitMark: null,
      exitTs: null,
      paperPnlUsd: null,
      triggerMeta: null,
      narrationOpen: null,
      narrationClose: null,
      status: "open",
    };
    vi.mocked(listBots).mockReturnValue([bot]);
    vi.mocked(getStrategy).mockReturnValue(strategy);
    vi.mocked(fetchOpenPositions).mockResolvedValue([openPos]);

    await tick();

    expect(closePaperPosition).toHaveBeenCalledTimes(1);
    expect(openPaperPosition).not.toHaveBeenCalled();
  });

  it("skips bots with status != 'paper'", async () => {
    const bot: BotConfig = {
      id: "retired",
      parentId: null,
      name: "Retired",
      avatarEmoji: "💤",
      personaVoiceKey: "test",
      strategyKey: "test",
      config: {},
      status: "retired",
    };
    vi.mocked(listBots).mockReturnValue([bot]);

    await tick();

    expect(openPaperPosition).not.toHaveBeenCalled();
    expect(closePaperPosition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/bots/resolver.test.ts`
Expected: FAIL — tick is not defined, openPaperPosition not defined, etc.

- [ ] **Step 3: Implement paper position DB helpers**

Append to `lib/bots/paper.ts`:

```ts
// lib/bots/paper.ts (append)
import { db } from "@/lib/db";
import { paperPositions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { PaperPosition, EntryDecision } from "./types";

function rowToPosition(row: typeof paperPositions.$inferSelect): PaperPosition {
  return {
    id: row.id,
    botId: row.botId,
    asset: row.asset,
    side: row.side as "long" | "short",
    leverage: row.leverage,
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
}

export async function fetchOpenPositions(): Promise<PaperPosition[]> {
  const rows = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.status, "open"));
  return rows.map(rowToPosition);
}

export async function fetchOpenPositionForBot(
  botId: string,
): Promise<PaperPosition | null> {
  const rows = await db
    .select()
    .from(paperPositions)
    .where(
      and(eq(paperPositions.botId, botId), eq(paperPositions.status, "open")),
    )
    .limit(1);
  return rows[0] ? rowToPosition(rows[0]) : null;
}

export async function openPaperPosition(args: {
  botId: string;
  decision: EntryDecision;
  entryMark: number;
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
      triggerMeta: args.decision.triggerMeta,
      narrationOpen: args.narration,
      status: "open",
    })
    .returning();
  return rowToPosition(row);
}

export async function closePaperPosition(args: {
  positionId: string;
  exitMark: number;
  paperPnlUsd: number;
  narration: string | null;
}): Promise<void> {
  await db
    .update(paperPositions)
    .set({
      exitMark: args.exitMark,
      exitTs: new Date(),
      paperPnlUsd: args.paperPnlUsd,
      narrationClose: args.narration,
      status: "closed",
    })
    .where(eq(paperPositions.id, args.positionId));
}
```

- [ ] **Step 4: Implement the resolver**

```ts
// lib/bots/resolver.ts
import { listBots, getStrategy } from "./index";
import { getMarksSnapshot } from "@/lib/data/marks";
import { getRecentLiquidations } from "@/lib/hyperliquid/client";
import { getFundingRates } from "@/lib/data/cex-funding";
import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositions,
  computePaperPnlUsd,
} from "./paper";
import type { ExternalSignals, MarketContext, PaperPosition } from "./types";

// Default notional used for paper-PnL computation. Real $ figure doesn't
// matter for paper bookkeeping — leaderboard ranks by percent return — but
// keeping a consistent number makes raw USD figures comparable across bots.
const PAPER_NOTIONAL_PER_BOT_USD = 1_000;

export async function tick(): Promise<{
  opened: number;
  closed: number;
}> {
  const [marks, liquidations, funding] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
  ]);
  const signals: ExternalSignals = { liquidations, funding };
  const openPositions = await fetchOpenPositions();
  const openByBot = new Map(openPositions.map((p) => [p.botId, p]));

  let opened = 0;
  let closed = 0;

  for (const bot of listBots()) {
    if (bot.status !== "paper") continue;
    const strategy = getStrategy(bot.strategyKey);
    if (!strategy) continue;

    const existing = openByBot.get(bot.id);
    if (existing) {
      const mark = marks.get(existing.asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset: existing.asset, mark };
      if (strategy.evaluateExit(ctx, existing)) {
        const pnl = computePaperPnlUsd({
          side: existing.side,
          leverage: existing.leverage,
          entryMark: existing.entryMark,
          exitMark: mark,
          notionalUsd: PAPER_NOTIONAL_PER_BOT_USD,
        });
        await closePaperPosition({
          positionId: existing.id,
          exitMark: mark,
          paperPnlUsd: pnl,
          narration: null, // narrator runs out-of-band; Phase 2 wires it lazily
        });
        closed += 1;
      }
      continue;
    }

    // Bot is idle. Try each allowed market.
    for (const asset of strategy.markets) {
      const mark = marks.get(asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset, mark };
      const decision = strategy.evaluateEntry(ctx, signals);
      if (!decision) continue;
      await openPaperPosition({
        botId: bot.id,
        decision,
        entryMark: marks.get(decision.asset) ?? mark,
        narration: null,
      });
      opened += 1;
      break; // one position per bot per tick
    }
  }

  return { opened, closed };
}

// Re-export so the test file can import from resolver.ts symbols if needed.
export { computePaperPnlUsd } from "./paper";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- lib/bots/`
Expected: all tests pass (paper.test.ts, liquidation-lizard.test.ts, resolver.test.ts).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/bots/resolver.ts lib/bots/resolver.test.ts lib/bots/paper.ts
git commit -m "feat(bots): resolver tick — evaluates strategies, opens/closes paper positions"
```

---

### Task 15: Resolver cron endpoint

**Files:**
- Create: `app/api/cron/bots-resolver/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the route**

```ts
// app/api/cron/bots-resolver/route.ts
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { tick } from "@/lib/bots/resolver";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const start = Date.now();
  const result = await tick();
  const ms = Date.now() - start;
  console.log(`[bots-resolver] tick: ${result.opened} opened, ${result.closed} closed in ${ms}ms`);
  return NextResponse.json({ ok: true, ...result, ms });
}
```

- [ ] **Step 2: Add cron entry to vercel.json**

Edit [vercel.json](../../vercel.json) and add:

```json
{
  "path": "/api/cron/bots-resolver",
  "schedule": "* * * * *"
}
```

Final structure should look like:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/refresh-traders", "schedule": "*/2 * * * *" },
    { "path": "/api/cron/mirror-close", "schedule": "* * * * *" },
    { "path": "/api/cron/expire-stale-copies", "schedule": "0 * * * *" },
    { "path": "/api/cron/bots-resolver", "schedule": "* * * * *" }
  ]
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Manual verification — local invoke**

Start dev server: `npm run dev`
In another terminal:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/bots-resolver
```

(Use the value of `CRON_SECRET` from `.env.local`.)

Expected: 200 OK with JSON `{ ok: true, opened: <n>, closed: <n>, ms: <n> }`. May be `opened: 0` if no HL liquidations triggered Liquidation Lizard during the tick.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/bots-resolver/route.ts vercel.json
git commit -m "feat(api): /api/cron/bots-resolver endpoint + Vercel cron entry"
```

---

### Task 16: Seed the bots row in DB

**Files:**
- Create: `scripts/seed-bots.ts`

- [ ] **Step 1: Write the seed script**

```ts
// scripts/seed-bots.ts
import "dotenv/config";
import { db } from "@/lib/db";
import { bots } from "@/lib/db/schema";

async function main() {
  await db
    .insert(bots)
    .values({
      id: "liquidation-lizard",
      parentId: null,
      name: "Liquidation Lizard",
      avatarEmoji: "🦎",
      personaVoiceKey: "liquidation-lizard",
      strategyKey: "liquidation-lizard",
      config: {
        minLiqNotionalUsd: 50_000,
        leverage: 50,
        exitFavorablePct: 0.005,
        maxHoldMs: 90_000,
      },
      status: "paper",
    })
    .onConflictDoNothing();
  console.log("seeded liquidation-lizard");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add seed script to package.json**

Add to `scripts`:

```json
"seed:bots": "tsx --env-file=.env.local scripts/seed-bots.ts"
```

- [ ] **Step 3: Run the seed**

```bash
npm run seed:bots
```

Expected: "seeded liquidation-lizard"

- [ ] **Step 4: Verify in DB**

```bash
npm run db:studio
```

Open the `bots` table in browser — should show 1 row.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-bots.ts package.json
git commit -m "chore(seed): insert liquidation-lizard bot row"
```

---

### Task 17: BotSignal type + bot signals generator

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/signals/bot-signals.ts`

- [ ] **Step 1: Add BotSignal to the type union**

Open [lib/types.ts](../../lib/types.ts), find the `Signal` union type, add a new variant:

```ts
// In lib/types.ts, extending the existing Signal types

export interface BotSignal {
  type: "bot";
  id: string;
  assetId: string;
  heatScore: number;
  payload: {
    botId: string;
    botName: string;
    avatarEmoji: string;
    currentPosition: {
      asset: string;
      side: "long" | "short";
      leverage: number;
      entryMark: number;
      currentMark: number;
      livePaperPnlPct: number;
      openSinceMs: number;
    } | null;
    stats: {
      totalTrades: number;
      winRate: number; // 0..1
      paperPnl24hUsd: number;
      paperPnl7dUsd: number;
      paperPnlAllUsd: number;
    };
  };
}

// Add BotSignal to the Signal union, e.g.:
// export type Signal = MemeSignal | PredictionSignal | MultiPredictionSignal | WhaleSignal | PacificaTraderSignal | BotSignal;

// Add "bot" to the SignalType union, e.g.:
// export type SignalType = "meme" | "prediction" | "multiprediction" | "whale" | "pacifica_trader" | "bot";
```

Read the existing file first to see exact union names — adjust the inserts to match.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Write the bot signals generator**

```ts
// lib/signals/bot-signals.ts
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getMarksSnapshot } from "@/lib/data/marks";
import { computeLivePaperPnlPct } from "@/lib/bots/paper";
import type { BotSignal } from "@/lib/types";

const NOTIONAL_USD = 1_000;

export async function buildBotSignals(): Promise<BotSignal[]> {
  const botRows = await db
    .select()
    .from(bots)
    .where(eq(bots.status, "paper"));
  if (botRows.length === 0) return [];

  const marks = await getMarksSnapshot();
  const signals: BotSignal[] = [];

  for (const bot of botRows) {
    const [openRow] = await db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.botId, bot.id),
          eq(paperPositions.status, "open"),
        ),
      )
      .limit(1);

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
    const paperPnlAll = closedRows.reduce(
      (s, r) => s + (r.paperPnlUsd ?? 0),
      0,
    );
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const paperPnl24h = closedRows
      .filter((r) => r.exitTs && r.exitTs.getTime() >= since24h)
      .reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const paperPnl7d = closedRows
      .filter((r) => r.exitTs && r.exitTs.getTime() >= since7d)
      .reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);

    let currentPosition: BotSignal["payload"]["currentPosition"] = null;
    if (openRow) {
      const currentMark = marks.get(openRow.asset) ?? openRow.entryMark;
      currentPosition = {
        asset: openRow.asset,
        side: openRow.side as "long" | "short",
        leverage: openRow.leverage,
        entryMark: openRow.entryMark,
        currentMark,
        livePaperPnlPct: computeLivePaperPnlPct({
          side: openRow.side as "long" | "short",
          leverage: openRow.leverage,
          entryMark: openRow.entryMark,
          currentMark,
        }),
        openSinceMs: openRow.entryTs.getTime(),
      };
    }

    const heatScore = Math.round(
      500 + (currentPosition ? 200 : 0) + Math.max(-200, Math.min(200, paperPnl24h / 10)),
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
        currentPosition,
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

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/signals/bot-signals.ts
git commit -m "feat(signals): BotSignal type + generator from paper_positions"
```

---

### Task 18: Wire bot signals into the feed pool

**Files:**
- Modify: `lib/feed/pool.ts`

- [ ] **Step 1: Read the existing pool**

```bash
wc -l lib/feed/pool.ts
```

Skim the file to understand how signals are assembled today. The function `getFeedPool()` is the entry point used by [/api/feed/route.ts](../../app/api/feed/route.ts).

- [ ] **Step 2: Add bot signals + gate trader signals**

In `lib/feed/pool.ts`, find the function that builds the pool (likely `getFeedPool` or similar). Add at the top:

```ts
import { buildBotSignals } from "@/lib/signals/bot-signals";
import { copyTradeEnabled } from "@/lib/features";
```

Then inside the function, before the existing signal assembly:

```ts
const botSignals = await buildBotSignals();
```

And replace any unconditional fetch of `pacifica_trader` signals with a gated version, e.g.:

```ts
const traderSignals = copyTradeEnabled() ? await fetchTraderSignals() : [];
```

(Adapt the specific calls to match what's already there — the goal is: bots are always included; pacifica_trader signals only when the flag is on.)

Append `botSignals` to the returned pool.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Manual verification**

Start dev server: `npm run dev`

```bash
curl -s "http://localhost:3000/api/feed?limit=20&cursor=0" | head -c 1000
```

Expected: JSON response with `signals` array including at least one entry with `type: "bot"`. The Liquidation Lizard signal should be present (with `currentPosition: null` if the bot is idle).

- [ ] **Step 5: Commit**

```bash
git add lib/feed/pool.ts
git commit -m "feat(feed): wire bot signals into pool, gate trader signals on FEATURE_COPY_TRADE"
```

---

### Task 19: BotCard component

**Files:**
- Create: `components/feed/BotCard.tsx`
- Modify: `components/feed/FeedContainer.tsx`

- [ ] **Step 1: Read existing CopyCard for reference**

```bash
wc -l components/feed/CopyCard.tsx
```

Skim [components/feed/CopyCard.tsx](../../components/feed/CopyCard.tsx) to see how the existing wallet-copy card is shaped (stake buttons, leverage display, PnL chart). The BotCard reuses the same visual language but pulls data from `BotSignal` instead of `PacificaTraderSignal`.

- [ ] **Step 2: Write BotCard**

```tsx
// components/feed/BotCard.tsx
"use client";

import { useState } from "react";
import type { BotSignal } from "@/lib/types";
import { StakeButtons } from "./StakeButtons";
import { usePrivy } from "@privy-io/react-auth";
import { postBetWithConsolidation } from "@/lib/bets/post-with-consolidation";

interface Props {
  signal: BotSignal;
}

export function BotCard({ signal }: Props) {
  const { getAccessToken } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const p = signal.payload;
  const pos = p.currentPosition;

  async function onStake(stakeUsdc: number) {
    if (!pos) return;
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no token");
      const res = await postBetWithConsolidation({
        accessToken: token,
        rail: "copy",
        body: {
          botId: p.botId,
          market: pos.asset,
          side: pos.side,
          leverage: pos.leverage,
          stakeUsdc,
        },
      });
      setMsg(`Opened ${pos.asset} ${pos.side} ${pos.leverage}x — fill ${(res as { fill?: { avgFillPrice?: number } }).fill?.avgFillPrice ?? "?"}`);
    } catch (err) {
      setMsg(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4 bg-zinc-900 text-zinc-100 rounded-2xl">
      <header className="flex items-center gap-3">
        <span className="text-3xl">{p.avatarEmoji}</span>
        <div>
          <h2 className="font-semibold text-lg leading-tight">{p.botName}</h2>
          <p className="text-xs text-zinc-400">Paper AI bot</p>
        </div>
      </header>

      <section className="flex-1 flex flex-col gap-3 justify-center">
        {pos ? (
          <div className="space-y-2">
            <p className="text-zinc-400 text-xs uppercase tracking-wide">
              Current position
            </p>
            <p className="text-2xl font-bold">
              {pos.side === "long" ? "LONG" : "SHORT"} {pos.asset}{" "}
              <span className="text-zinc-400">{pos.leverage}x</span>
            </p>
            <p
              className={
                pos.livePaperPnlPct >= 0
                  ? "text-emerald-400 text-xl font-semibold"
                  : "text-rose-400 text-xl font-semibold"
              }
            >
              {(pos.livePaperPnlPct * 100).toFixed(1)}% paper
            </p>
            <p className="text-xs text-zinc-500">
              Entry {pos.entryMark.toFixed(2)} · Now {pos.currentMark.toFixed(2)}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-zinc-400 text-xs uppercase tracking-wide">
              Status
            </p>
            <p className="text-xl font-semibold">Watching the tape</p>
            <p className="text-sm text-zinc-500">No active position</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Win</p>
            <p className="font-semibold">{(p.stats.winRate * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">24h paper</p>
            <p
              className={
                p.stats.paperPnl24hUsd >= 0
                  ? "text-emerald-400 font-semibold"
                  : "text-rose-400 font-semibold"
              }
            >
              ${p.stats.paperPnl24hUsd.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Trades</p>
            <p className="font-semibold">{p.stats.totalTrades}</p>
          </div>
        </div>
      </section>

      {pos ? (
        <StakeButtons disabled={busy} onStake={onStake} />
      ) : (
        <p className="text-center text-sm text-zinc-500">
          Bot is idle — check back in a few minutes
        </p>
      )}
      {msg && <p className="text-xs text-zinc-400">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Route the bot signal type in FeedContainer**

Open [components/feed/FeedContainer.tsx](../../components/feed/FeedContainer.tsx). Find the switch/conditional that picks a card component by `signal.type` (look for `MemeCard`, `WhaleCard`, `CopyCard`, etc.). Add a branch:

```tsx
import { BotCard } from "./BotCard";
// ...
if (signal.type === "bot") return <BotCard signal={signal} />;
```

Also update `buildAllowedTypes(prefs)` in the same file — bots are always allowed (no user pref toggle in Phase 1):

```ts
function buildAllowedTypes(prefs: FeedPrefs): Set<SignalType> {
  const allowed = new Set<SignalType>();
  allowed.add("bot");
  // ... existing additions stay
  return allowed;
}
```

If `pacifica_trader` is unconditionally added in this function, gate it behind `copyTradeEnabled()` — but `copyTradeEnabled` is server-side. Instead, route this through a server-passed prop or simply rely on the pool filter (Task 18 already gates the signal type at the pool level, so the client doesn't need to filter).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 5: Manual verification**

Start dev server: `npm run dev`. Open `http://localhost:3000/feed`. Login, ensure agent wallet is bound. The Liquidation Lizard card should appear. While the bot is idle, the card shows "Watching the tape." Once a real HL liquidation fires (which can take minutes), the card flips to show an active position with stake buttons.

- [ ] **Step 6: Commit**

```bash
git add components/feed/BotCard.tsx components/feed/FeedContainer.tsx
git commit -m "feat(feed): BotCard + FeedContainer routing for bot signals"
```

---

### Task 20: Update /api/bet/copy to accept botId

**Files:**
- Modify: `app/api/bet/copy/route.ts`

- [ ] **Step 1: Read the current route**

Reread [app/api/bet/copy/route.ts](../../app/api/bet/copy/route.ts) to refresh on the existing wallet-leader flow. The current handler reads `body.leaderAddress` and queries Pacifica for the leader's position. The bot path is symmetric but reads from `paper_positions` instead.

- [ ] **Step 2: Add botId branch**

Add at the top of the file imports:

```ts
import { fetchOpenPositionForBot } from "@/lib/bots/paper";
import { getBot } from "@/lib/bots";
```

Update the `Body` interface to include the new field:

```ts
interface Body {
  leaderAddress?: string;
  botId?: string;
  market?: string;
  side?: "long" | "short";
  leverage?: number;
  stakeUsdc?: number;
  signalId?: string;
  walletAddress?: string;
}
```

After the stake validation block, add a branch:

```ts
// New bot-driven copy path. Replaces leader lookup with paper-position lookup.
if (body.botId) {
  const bot = getBot(body.botId);
  if (!bot) {
    return NextResponse.json({ error: "unknown bot" }, { status: 404 });
  }
  const paperPos = await fetchOpenPositionForBot(body.botId);
  if (!paperPos) {
    return NextResponse.json(
      { error: "bot has no open position" },
      { status: 409 },
    );
  }
  if (paperPos.asset !== body.market) {
    return NextResponse.json(
      { error: "market mismatch with bot's current position" },
      { status: 409 },
    );
  }
  if (paperPos.side !== body.side) {
    return NextResponse.json(
      { error: "side mismatch with bot's current position" },
      { status: 409 },
    );
  }

  // Compute user notional + base amount from stake + bot's leverage
  const userNotional = body.stakeUsdc * paperPos.leverage;
  const { clampLeverageForNotional } = await import("@/lib/pacifica/markets");
  const clamped = await clampLeverageForNotional(body.market, userNotional);
  const effectiveLeverage = Math.min(paperPos.leverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const amountBase = (finalNotional / paperPos.entryMark).toFixed(6);

  // Ensure user has agent wallet (reuse existing onboarding flow)
  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }
  const agent = await getAgentWallet(user.id);
  if (!agent) {
    const plan = await planOnboarding({
      userId: user.id,
      userMainPubkey: user.solanaPubkey,
      desiredStakeUsdc: body.stakeUsdc,
    });
    return NextResponse.json({ phase: "onboard", ...plan });
  }

  // Open the real Pacifica order
  let fill;
  try {
    fill = await openCopyOrder({
      agent,
      symbol: body.market,
      side: body.side,
      amountBase,
    });
  } catch (err) {
    console.error("[bet/copy bot] open failed:", err);
    return NextResponse.json(
      { error: `Pacifica order failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "copy",
      signalId: body.signalId ?? null,
      amountUsdc: body.stakeUsdc,
      status: "confirmed",
      meta: {
        botId: body.botId,
        botPaperPositionId: paperPos.id,
        leaderMarket: body.market,
        leaderSide: body.side,
        leverage: effectiveLeverage,
        pacificaOrderId: fill.order_id,
        botEntryMarkAtTap: paperPos.entryMark,
        userFillPriceAtTap: Number(fill.avg_fill_price),
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    fill: {
      orderId: fill.order_id,
      avgFillPrice: fill.avg_fill_price,
      filledAmount: fill.filled_amount,
      side: fill.side,
    },
  });
}
```

Keep the existing `leaderAddress` branch intact below for legacy wallet-rail compatibility.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/bet/copy/route.ts
git commit -m "feat(api): /api/bet/copy accepts botId — opens real Pacifica order matching bot's paper position"
```

---

### Task 21: Mirror-close handles botId

**Files:**
- Modify: `app/api/cron/mirror-close/route.ts`
- Modify: `lib/bets/mirror-close.ts`

- [ ] **Step 1: Read the current mirror-close worker**

Skim [lib/bets/mirror-close.ts](../../lib/bets/mirror-close.ts) and [app/api/cron/mirror-close/route.ts](../../app/api/cron/mirror-close/route.ts) to see the existing leader-keyed close logic.

- [ ] **Step 2: Extend the worker to handle bot-keyed bets**

Modify `lib/bets/mirror-close.ts`. The current implementation groups open bets by `meta.leaderAddress` and queries Pacifica for the leader's positions. Add a parallel path that groups bot-keyed bets by `meta.botId` and queries the local `paper_positions` table for the bot's current open position.

Pseudocode for the additional branch (adapt to the file's actual structure):

```ts
import { db } from "@/lib/db";
import { paperPositions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { submitReduceOnlyClose } from "@/lib/pacifica/orders";
import { getAgentWallet } from "@/lib/wallets/agent";

// For bets where meta.botId is set: a bot is "closed" iff its
// paper_positions row for that botId is no longer 'open'. If closed, fire
// reduce_only on the follower's bet.

async function closeBotFollowers(openBets: Array<typeof bets.$inferSelect>) {
  const byBot = new Map<string, typeof openBets>();
  for (const b of openBets) {
    const meta = b.meta as { botId?: string } | null;
    if (!meta?.botId) continue;
    const arr = byBot.get(meta.botId) ?? [];
    arr.push(b);
    byBot.set(meta.botId, arr);
  }
  for (const [botId, followers] of byBot.entries()) {
    const [openPos] = await db
      .select()
      .from(paperPositions)
      .where(
        and(eq(paperPositions.botId, botId), eq(paperPositions.status, "open")),
      )
      .limit(1);
    if (openPos) continue; // bot still in position; do nothing
    // Bot is flat — close each follower's real Pacifica position
    for (const follower of followers) {
      const userAgent = await getAgentWallet(follower.userId);
      if (!userAgent) continue;
      const meta = follower.meta as {
        leaderMarket?: string;
        leaderSide?: "long" | "short";
      } | null;
      if (!meta?.leaderMarket || !meta.leaderSide) continue;
      try {
        await submitReduceOnlyClose({
          agent: userAgent,
          symbol: meta.leaderMarket,
          side: meta.leaderSide,
        });
        await db
          .update(bets)
          .set({ status: "closed", closedAt: new Date() })
          .where(eq(bets.id, follower.id));
      } catch (err) {
        console.error("[mirror-close bot]", err);
      }
    }
  }
}
```

Call `closeBotFollowers(openBets)` from the main worker function alongside the existing leader-keyed logic.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass. If `submitReduceOnlyClose` isn't yet exported from `@/lib/pacifica/orders`, add a thin wrapper that calls `openCopyOrder` with `reduce_only: true` and the opposite side.

- [ ] **Step 4: Commit**

```bash
git add lib/bets/mirror-close.ts app/api/cron/mirror-close/route.ts
git commit -m "feat(mirror-close): close follower bets when their bot's paper position exits"
```

---

### Task 22: Gate /api/cron/refresh-traders behind FEATURE_COPY_TRADE

**Files:**
- Modify: `app/api/cron/refresh-traders/route.ts`

- [ ] **Step 1: Add the gate**

Open [app/api/cron/refresh-traders/route.ts](../../app/api/cron/refresh-traders/route.ts). At the top of the handler (after cron auth), short-circuit when the flag is off:

```ts
import { copyTradeEnabled } from "@/lib/features";

// ... inside handler, after checkCronAuth:
if (!copyTradeEnabled()) {
  return NextResponse.json({ ok: true, skipped: "FEATURE_COPY_TRADE off" });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/refresh-traders/route.ts
git commit -m "feat(cron): skip refresh-traders when FEATURE_COPY_TRADE is off"
```

---

### Task 23: End-to-end manual verification

**Files:** none

This is a checklist task — no code changes, just exercising the wired-up flow on the live dev server.

- [ ] **Step 1: Set env**

In `.env.local`, ensure:
- `FEATURE_COPY_TRADE=false` (or unset)
- `FEATURE_CASINO_MODE=false` (or unset)
- `CRON_SECRET=<some-value>`

- [ ] **Step 2: Start dev**

Run: `npm run dev`

- [ ] **Step 3: Seed bots row**

If not already done in Task 16:
```bash
npm run seed:bots
```

- [ ] **Step 4: Manually trigger the resolver**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/bots-resolver
```

Expected: 200 OK + `{ ok: true, opened: 0|1, closed: 0|1, ms: <n> }`. If `opened: 1`, a HL liquidation triggered Liquidation Lizard during this tick.

- [ ] **Step 5: Verify feed includes the bot**

Open `http://localhost:3000/feed` in browser (logged in). Liquidation Lizard's card should appear. Initially the card may say "Watching the tape" if no HL liquidation has fired yet.

- [ ] **Step 6: Force a paper position for testing**

Insert a paper-position row manually to test the copy flow without waiting for a real liquidation:

```bash
npm run db:studio
```

In `paper_positions`, manually INSERT:
- `bot_id = "liquidation-lizard"`
- `asset = "SOL"`
- `side = "long"`
- `leverage = 50`
- `entry_mark = <current SOL mark from Pacifica>`
- `status = "open"`

- [ ] **Step 7: Reload feed and tap copy**

Refresh `/feed`. Liquidation Lizard's card now shows the LONG SOL 50x position. Tap `$5`. The flow should:
1. POST `/api/bet/copy` with `{ botId: "liquidation-lizard", market: "SOL", side: "long", leverage: 50, stakeUsdc: 5 }`
2. Either return an onboarding plan (if first time), or open a real Pacifica order and return `{ phase: "open", betId, fill }`
3. UI shows confirmation toast

- [ ] **Step 8: Close the paper position and verify mirror-close**

In `paper_positions`, update the row from Step 6: set `status = "closed"`, `exit_mark = <current SOL mark>`, `exit_ts = NOW()`, `paper_pnl_usd = <some number>`.

Trigger the mirror-close cron:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/mirror-close
```

Expected: the user's real Pacifica position closes (visible in their `/portfolio` page or via Pacifica's account page).

- [ ] **Step 9: Cleanup**

Delete the test paper-position row and any leftover open bets.

- [ ] **Step 10: Commit verification note**

No code changes, but add a note to the spec:

```bash
git commit --allow-empty -m "chore(verify): paper AI bots phase-1 end-to-end flow verified"
```

---

### Task 24: Run full lint + typecheck pass

**Files:** none

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: 0 errors. Fix anything that surfaces.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests in `lib/bots/**/*.test.ts` pass.

- [ ] **Step 4: Final commit (if any fixes landed)**

```bash
git add -u
git commit -m "chore: lint + typecheck cleanup for phase-1 paper bots"
```

If no fixes needed, skip this commit.

---

## Self-Review Checklist

After completing all 24 tasks, run this checklist against the spec:

**Spec coverage (sections from `2026-05-14-paper-ai-bots-design.md`):**
- [x] Goal — vertical slice for one bot lands here; full 12-bot roster is Phase 2+
- [x] Core mechanic (tap → real order, auto-mirror close) — Tasks 20, 21
- [x] Roster — Liquidation Lizard only in Phase 1; remaining 11 bots are Phase 2
- [ ] Strategy + LLM model — narrator wired but not lazy-cached (deferred to Phase 2)
- [x] Data stack — Pacifica marks, HL liquidations, Binance funding (Phase 1 subset)
- [ ] Architectural sophistication — none of the 6 in Phase 1 (deferred to Phase 2)
- [x] Surface — feed shows BotCard; leaderboard ranking by heatScore in pool order
- [x] Schema — bots + paper_positions tables, bets.meta.botId extension
- [x] Bot decision + paper-trade resolution loop — 1-min cron (spec called for 10s; deferred)
- [x] Existing infrastructure reuse — agent wallet, Pacifica orders, mirror-close, expire-stale
- [x] Phase A scope (in) item 10 — migration of copy-trade behind FEATURE_COPY_TRADE
- [ ] Phase A scope items 1-9 — only item 7 (copy mechanic), partial 1 (1 bot of 12), 2 (3 sources of 6), 5+6 (none) — these are the explicit Phase 2 deferrals
- [x] Migration of existing surfaces — refresh-traders gated; pacifica_trader signals gated in pool

**Placeholder scan:** No TBD/TODO/FIXME in plan tasks. ✓

**Type consistency:** `BotSignal.payload.currentPosition.livePaperPnlPct` matches consumer in BotCard. `bets.meta.botId` matches between `/api/bet/copy` write and `mirror-close.ts` read. ✓

**Phase 1 deliberately partial:** Phase 1 ships Liquidation Lizard as proof-of-concept across the full vertical slice (signal → DB → API → UI → real copy → mirror close). Phase 2 layers in the remaining 5 headliner personas + 6 variants, regime detection, cross-bot awareness, multi-CEX funding, Helius/Pyth, microstructure, backtest gate, dossier cron, dedicated Live Feed tab, bot detail page.

---

## What Phase 2 will need (preview, not in scope)

This is informational — Phase 2 will be its own plan document. The hooks Phase 1 leaves for Phase 2:

- `lib/bots/index.ts` registry accepts more `registerBot` calls — Phase 2 imports 11 more strategy files
- `lib/data/cex-funding.ts` aggregator interface accepts new venues — Phase 2 fans out to Bybit/OKX/dYdX
- `lib/bots/resolver.ts` already loops over all registered bots — Phase 2 just adds more
- `BotSignal` heat score is intentionally crude — Phase 2 introduces sort controls + multi-timeframe stats
- `BotCard` UI is intentionally minimal — Phase 2 adds disagreement linking, narration display, dossier link, sparkline chart
- Narrator is wired but unused — Phase 2 calls it from the resolver and caches the result

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-14-paper-ai-bots-phase-1.md`.
