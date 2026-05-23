# Whale Copy Social Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 Pacifica-native whale copy social platform: whale roster, open-position slides, AI analysis chatter, real Pacifica copy trading, and optional auto-close when the source whale closes.

**Architecture:** Add whale-source persistence and refresh services next to the existing Pacifica execution stack. Keep `bets` as the user copy ledger, extend `bets.meta` for whale sources, and replace bot-facing UI surfaces through a `FEATURE_WHALE_SOCIAL` flag so rollback is possible. Use pure helpers for source identity, stale checks, copy metadata, and close eligibility so the risky behavior is covered by fast Vitest tests before UI work.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Drizzle ORM, Neon Postgres, Pacifica REST, Privy embedded Solana wallet, xAI through Vercel AI SDK, Vitest.

---

## Scope

This plan implements the V1 Pacifica-native whale product only. Hyperliquid whales stay out of implementation except for source type names and interface boundaries that make V2 possible.

## File Structure

- Modify `lib/db/schema.ts`: add `whales`, `whale_positions`, and `whale_position_analysis`.
- Modify `lib/features.ts`: add `whaleSocialEnabled()`.
- Modify `instrumentation.ts`: start the whale refresh loop when the flag is enabled.
- Modify `lib/types.ts`: add `WhaleTraderSignal` and `WhalePositionSignal` while keeping legacy `WhaleSignal`.
- Create `lib/whales/types.ts`: shared whale source, position, analysis, and signal types.
- Create `lib/whales/identity.ts`: deterministic whale ids, position ids, generated handles, and stale checks.
- Create `lib/whales/identity.test.ts`: pure tests for identity and stale behavior.
- Create `lib/whales/pacifica-source.ts`: Pacifica leaderboard and position mapping helpers.
- Create `lib/whales/pacifica-source.test.ts`: pure tests for side, leverage, notional, and stale mapping.
- Create `lib/whales/curated.ts`: curated Pacifica source accounts and manual display overrides.
- Create `lib/whales/repository.ts`: database upserts and reads for whales, positions, and analysis.
- Create `lib/whales/refresh-pacifica.ts`: refresh service for curated plus leaderboard Pacifica accounts.
- Create `lib/whales/ticker.ts`: in-process refresh loop for Railway and local dev.
- Create `app/api/cron/refresh-whales/route.ts`: manual refresh endpoint for operators and local checks.
- Create `lib/signals/whale-signals.ts`: build roster and live-position signals from persisted whale data.
- Create `app/api/whales/roster/route.ts`: poll endpoint for `/feed`.
- Create `app/api/whales/live/route.ts`: poll endpoint for `/live`.
- Create `lib/bets/whale-meta.ts`: parse and build `bets.meta` for whale copies.
- Create `lib/bets/whale-meta.test.ts`: metadata tests.
- Create `app/api/bet/whale/route.ts`: open real Pacifica copy order from a whale position.
- Modify `lib/bets/copy-guard.ts`: continue enforcing one open tail per market.
- Modify `lib/bets/mirror-close.ts`: add source-position close path gated by `autoCloseOnSourceClose`.
- Create `lib/bets/source-close.test.ts`: pure tests for close eligibility.
- Create `lib/whales/analysis.ts`: AI analysis prompt, fallback text, and cache policy.
- Create `lib/whales/analysis.test.ts`: prompt and fallback tests.
- Create `components/whales/WhaleRoster.tsx`: whale roster UI.
- Create `components/whales/WhaleLiveFeed.tsx`: open-position slide UI.
- Create `components/whales/WhaleAnalysisStream.tsx`: chatter analysis UI.
- Modify `components/tail/TailModal.tsx`: support whale sources and close-listening toggle.
- Modify `app/(app)/feed/page.tsx`: use whale roster when `FEATURE_WHALE_SOCIAL=true`.
- Modify `app/(app)/live/page.tsx`: use whale live feed when `FEATURE_WHALE_SOCIAL=true`.
- Modify `app/(app)/chatter/page.tsx`: use whale analysis when `FEATURE_WHALE_SOCIAL=true`.
- Modify `app/api/portfolio/route.ts`: return whale metadata and close-listening state for copy rows.
- Modify `components/portfolio/CopyRow.tsx`: show source whale, auto-close state, and source-closed warning.

---

### Task 1: Whale Core Types, Feature Flag, And Schema

**Files:**
- Modify: `lib/features.ts`
- Modify: `lib/db/schema.ts`
- Modify: `lib/types.ts`
- Create: `lib/whales/types.ts`
- Create: `lib/whales/identity.ts`
- Test: `lib/whales/identity.test.ts`

- [ ] **Step 1: Write identity tests**

Create `lib/whales/identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  makeWhaleId,
  makeWhalePositionId,
  generatedWhaleHandle,
  isSourceFresh,
} from "./identity";

describe("whale identity", () => {
  it("builds stable whale ids by source and account", () => {
    expect(makeWhaleId("pacifica", "ABC123")).toBe("pacifica:ABC123");
    expect(makeWhaleId("hyperliquid", "0xabc")).toBe("hyperliquid:0xabc");
  });

  it("builds stable position ids from source, account, market, side, and openedAt", () => {
    expect(
      makeWhalePositionId({
        source: "pacifica",
        sourceAccount: "ABC123",
        market: "BTC",
        side: "long",
        openedAtMs: 1779543000000,
      }),
    ).toBe("pacifica:ABC123:BTC:long:1779543000000");
  });

  it("generates public handles without exposing full addresses", () => {
    expect(generatedWhaleHandle("ABC123xyz")).toBe("whale_ABC1");
    expect(generatedWhaleHandle("")).toBe("whale_anon");
  });

  it("treats source data older than the max age as stale", () => {
    expect(isSourceFresh(Date.now() - 30_000, 60_000)).toBe(true);
    expect(isSourceFresh(Date.now() - 61_000, 60_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the identity test and verify it fails**

Run:

```bash
npx vitest run lib/whales/identity.test.ts
```

Expected: FAIL because `lib/whales/identity.ts` does not exist.

- [ ] **Step 3: Add whale shared types**

Create `lib/whales/types.ts`:

```ts
export type WhaleSource = "pacifica" | "hyperliquid";
export type WhaleSide = "long" | "short";
export type WhaleStatus = "active" | "hidden" | "retired";
export type WhalePositionStatus = "open" | "closed";

export interface WhaleRecord {
  id: string;
  source: WhaleSource;
  sourceAccount: string;
  displayName: string;
  avatarUrl: string | null;
  status: WhaleStatus;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface WhalePositionRecord {
  id: string;
  whaleId: string;
  source: WhaleSource;
  sourceAccount: string;
  market: string;
  side: WhaleSide;
  leverage: number;
  amountBase: number;
  notionalUsd: number;
  entryPrice: number;
  currentMark: number | null;
  unrealizedPnlPct: number | null;
  openedAt: Date;
  closedAt: Date | null;
  status: WhalePositionStatus;
  raw: Record<string, unknown>;
  lastSeenAt: Date;
}

export interface WhalePositionAnalysis {
  positionId: string;
  summary: string;
  thesis: string;
  risk: string;
  entryGapWarning: string | null;
  confidence: number;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 4: Implement identity helpers**

Create `lib/whales/identity.ts`:

```ts
import type { WhaleSide, WhaleSource } from "./types";

export const WHALE_SOURCE_MAX_AGE_MS = 60_000;

export function makeWhaleId(source: WhaleSource, sourceAccount: string): string {
  return `${source}:${sourceAccount}`;
}

export function makeWhalePositionId(args: {
  source: WhaleSource;
  sourceAccount: string;
  market: string;
  side: WhaleSide;
  openedAtMs: number;
}): string {
  return [
    args.source,
    args.sourceAccount,
    args.market.toUpperCase(),
    args.side,
    Math.floor(args.openedAtMs),
  ].join(":");
}

export function generatedWhaleHandle(sourceAccount: string | null | undefined): string {
  if (!sourceAccount) return "whale_anon";
  return `whale_${sourceAccount.slice(0, 4)}`;
}

export function isSourceFresh(
  lastSeenAtMs: number,
  maxAgeMs = WHALE_SOURCE_MAX_AGE_MS,
  nowMs = Date.now(),
): boolean {
  return nowMs - lastSeenAtMs <= maxAgeMs;
}
```

- [ ] **Step 5: Add feature flag**

Modify `lib/features.ts` by adding:

```ts
export function whaleSocialEnabled(): boolean {
  return process.env.FEATURE_WHALE_SOCIAL === "true";
}
```

- [ ] **Step 6: Add schema tables**

Modify the import in `lib/db/schema.ts` to include `uniqueIndex`:

```ts
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  doublePrecision,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
```

Append these tables after `thoughtSettings`:

```ts
export const whales = pgTable(
  "whales",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceAccountIdx: uniqueIndex("whales_source_account_idx").on(
      t.source,
      t.sourceAccount,
    ),
    statusIdx: index("whales_status_idx").on(t.status),
  }),
);

export const whalePositions = pgTable(
  "whale_positions",
  {
    id: text("id").primaryKey(),
    whaleId: text("whale_id")
      .notNull()
      .references(() => whales.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    market: text("market").notNull(),
    side: text("side").notNull(),
    leverage: integer("leverage").notNull(),
    amountBase: doublePrecision("amount_base").notNull(),
    notionalUsd: doublePrecision("notional_usd").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    currentMark: doublePrecision("current_mark"),
    unrealizedPnlPct: doublePrecision("unrealized_pnl_pct"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    whaleOpenIdx: index("whale_positions_whale_open_idx").on(t.whaleId, t.status),
    sourceOpenIdx: index("whale_positions_source_open_idx").on(
      t.source,
      t.sourceAccount,
      t.status,
    ),
    openFreshIdx: index("whale_positions_open_fresh_idx").on(t.status, t.lastSeenAt),
  }),
);

export const whalePositionAnalysis = pgTable(
  "whale_position_analysis",
  {
    positionId: text("position_id")
      .primaryKey()
      .references(() => whalePositions.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    thesis: text("thesis").notNull(),
    risk: text("risk").notNull(),
    entryGapWarning: text("entry_gap_warning"),
    confidence: doublePrecision("confidence").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

- [ ] **Step 7: Extend public signal types**

Modify `lib/types.ts`:

1. Add `"whale_trader"` and `"whale_position"` to `SignalType`.
2. Add these interfaces before `BotSignal`:

```ts
export interface WhaleTraderSignal extends BaseSignal {
  type: "whale_trader";
  payload: {
    whaleId: string;
    source: "pacifica" | "hyperliquid";
    sourceAccount: string;
    displayName: string;
    avatarUrl: string | null;
    tags: string[];
    openPositionsCount: number;
    bestPosition: WhalePositionSignal["payload"] | null;
    stats: {
      pnl1dUsdc: number;
      pnl7dUsdc: number;
      pnl30dUsdc: number;
      winRatePct1d: number | null;
      totalCloses1d: number;
      volume1dUsdc: number;
    };
    lastSeenAt: string | null;
    stale: boolean;
  };
}

export interface WhalePositionSignal extends BaseSignal {
  type: "whale_position";
  payload: {
    positionId: string;
    whaleId: string;
    source: "pacifica" | "hyperliquid";
    sourceAccount: string;
    displayName: string;
    avatarUrl: string | null;
    market: string;
    side: "long" | "short";
    leverage: number;
    amountBase: number;
    notionalUsd: number;
    entryPrice: number;
    currentMark: number | null;
    unrealizedPnlPct: number | null;
    openedAtMs: number;
    lastSeenAtMs: number;
    stale: boolean;
    analysis: {
      summary: string;
      thesis: string;
      risk: string;
      entryGapWarning: string | null;
      confidence: number;
    } | null;
  };
}
```

3. Add `WhaleTraderSignal | WhalePositionSignal` to the `Signal` union.

- [ ] **Step 8: Run identity tests**

Run:

```bash
npx vitest run lib/whales/identity.test.ts
```

Expected: PASS.

- [ ] **Step 9: Typecheck schema and types**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add lib/features.ts lib/db/schema.ts lib/types.ts lib/whales/types.ts lib/whales/identity.ts lib/whales/identity.test.ts
git commit -m "Add whale source schema and identity helpers"
```

---

### Task 2: Pacifica Whale Source Mapping

**Files:**
- Create: `lib/whales/pacifica-source.ts`
- Test: `lib/whales/pacifica-source.test.ts`

- [ ] **Step 1: Write source mapping tests**

Create `lib/whales/pacifica-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  pacificaSideToWhaleSide,
  leverageFromPacificaPosition,
  mapPacificaPosition,
} from "./pacifica-source";
import type { PacificaPosition } from "@/lib/pacifica/types";

const basePosition: PacificaPosition = {
  symbol: "BTC",
  side: "bid",
  amount: "0.10",
  entry_price: "65000",
  margin: "650",
  funding: "0",
  isolated: true,
  liquidation_price: "60000",
  created_at: 1779543000000,
  updated_at: 1779543060000,
};

describe("pacifica source mapping", () => {
  it("maps Pacifica bid and ask to long and short", () => {
    expect(pacificaSideToWhaleSide("bid")).toBe("long");
    expect(pacificaSideToWhaleSide("ask")).toBe("short");
  });

  it("derives isolated leverage from notional divided by margin", () => {
    expect(
      leverageFromPacificaPosition({
        amountBase: 0.1,
        entryPrice: 65_000,
        marginUsd: 650,
        marketMaxLeverage: 50,
      }),
    ).toBe(10);
  });

  it("falls back to market max leverage when margin is zero", () => {
    expect(
      leverageFromPacificaPosition({
        amountBase: 0.1,
        entryPrice: 65_000,
        marginUsd: 0,
        marketMaxLeverage: 25,
      }),
    ).toBe(25);
  });

  it("maps a Pacifica position to a whale position input", () => {
    const mapped = mapPacificaPosition({
      sourceAccount: "ABC123",
      position: basePosition,
      marketMaxLeverage: 50,
      currentMark: 66_300,
    });
    expect(mapped.id).toBe("pacifica:ABC123:BTC:long:1779543000000");
    expect(mapped.whaleId).toBe("pacifica:ABC123");
    expect(mapped.side).toBe("long");
    expect(mapped.notionalUsd).toBe(6500);
    expect(mapped.unrealizedPnlPct).toBeCloseTo(20);
  });
});
```

- [ ] **Step 2: Run the mapping test and verify it fails**

Run:

```bash
npx vitest run lib/whales/pacifica-source.test.ts
```

Expected: FAIL because `lib/whales/pacifica-source.ts` does not exist.

- [ ] **Step 3: Implement Pacifica mapping helpers**

Create `lib/whales/pacifica-source.ts`:

```ts
import type { PacificaPosition } from "@/lib/pacifica/types";
import { makeWhaleId, makeWhalePositionId } from "./identity";
import type { WhalePositionRecord, WhaleSide } from "./types";

export function pacificaSideToWhaleSide(side: PacificaPosition["side"]): WhaleSide {
  return side === "bid" ? "long" : "short";
}

export function leverageFromPacificaPosition(args: {
  amountBase: number;
  entryPrice: number;
  marginUsd: number;
  marketMaxLeverage: number;
}): number {
  if (args.marginUsd <= 0) return Math.max(1, Math.floor(args.marketMaxLeverage));
  const notional = Math.abs(args.amountBase * args.entryPrice);
  const raw = notional / args.marginUsd;
  return Math.max(1, Math.min(args.marketMaxLeverage, Math.round(raw)));
}

export function mapPacificaPosition(args: {
  sourceAccount: string;
  position: PacificaPosition;
  marketMaxLeverage: number;
  currentMark: number | null;
  now?: Date;
}): WhalePositionRecord {
  const side = pacificaSideToWhaleSide(args.position.side);
  const amountBase = Math.abs(Number(args.position.amount));
  const entryPrice = Number(args.position.entry_price);
  const marginUsd = Number(args.position.margin);
  const notionalUsd = amountBase * entryPrice;
  const leverage = leverageFromPacificaPosition({
    amountBase,
    entryPrice,
    marginUsd,
    marketMaxLeverage: args.marketMaxLeverage,
  });
  const mark = args.currentMark;
  const directional = mark == null ? null : side === "long" ? mark - entryPrice : entryPrice - mark;
  const unrealizedPnlPct =
    directional == null || notionalUsd <= 0
      ? null
      : (directional / entryPrice) * leverage * 100;
  const openedAtMs = Number(args.position.created_at);
  const source = "pacifica";
  const whaleId = makeWhaleId(source, args.sourceAccount);

  return {
    id: makeWhalePositionId({
      source,
      sourceAccount: args.sourceAccount,
      market: args.position.symbol,
      side,
      openedAtMs,
    }),
    whaleId,
    source,
    sourceAccount: args.sourceAccount,
    market: args.position.symbol,
    side,
    leverage,
    amountBase,
    notionalUsd,
    entryPrice,
    currentMark: mark,
    unrealizedPnlPct,
    openedAt: new Date(openedAtMs),
    closedAt: null,
    status: "open",
    raw: args.position as unknown as Record<string, unknown>,
    lastSeenAt: args.now ?? new Date(),
  };
}
```

- [ ] **Step 4: Run mapping tests**

Run:

```bash
npx vitest run lib/whales/pacifica-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/whales/pacifica-source.ts lib/whales/pacifica-source.test.ts
git commit -m "Map Pacifica positions to whale source records"
```

---

### Task 3: Whale Repository And Pacifica Refresh

**Files:**
- Create: `lib/whales/curated.ts`
- Create: `lib/whales/repository.ts`
- Create: `lib/whales/refresh-pacifica.ts`
- Create: `lib/whales/ticker.ts`
- Modify: `instrumentation.ts`
- Create: `app/api/cron/refresh-whales/route.ts`

- [ ] **Step 1: Add curated whale config**

Create `lib/whales/curated.ts`:

```ts
export interface CuratedWhale {
  sourceAccount: string;
  displayName?: string;
  avatarUrl?: string | null;
  tags?: string[];
  pinned?: boolean;
}

export const CURATED_PACIFICA_WHALES: CuratedWhale[] = [];
```

This launches from leaderboard discovery. Add curated accounts only after a real Pacifica account has been selected by the operator.

- [ ] **Step 2: Add repository functions**

Create `lib/whales/repository.ts`:

```ts
import { and, desc, eq, inArray, lt, not } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  whales,
  whalePositions,
  whalePositionAnalysis,
} from "@/lib/db/schema";
import type {
  WhalePositionAnalysis,
  WhalePositionRecord,
  WhaleRecord,
  WhaleSource,
} from "./types";

export async function upsertWhale(args: {
  id: string;
  source: WhaleSource;
  sourceAccount: string;
  displayName: string;
  avatarUrl: string | null;
  tags: string[];
}): Promise<void> {
  await db
    .insert(whales)
    .values({
      id: args.id,
      source: args.source,
      sourceAccount: args.sourceAccount,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
      status: "active",
      tags: args.tags,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whales.id,
      set: {
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        tags: args.tags,
        status: "active",
        updatedAt: new Date(),
      },
    });
}

export async function upsertWhalePosition(pos: WhalePositionRecord): Promise<void> {
  await db
    .insert(whalePositions)
    .values({
      id: pos.id,
      whaleId: pos.whaleId,
      source: pos.source,
      sourceAccount: pos.sourceAccount,
      market: pos.market,
      side: pos.side,
      leverage: pos.leverage,
      amountBase: pos.amountBase,
      notionalUsd: pos.notionalUsd,
      entryPrice: pos.entryPrice,
      currentMark: pos.currentMark,
      unrealizedPnlPct: pos.unrealizedPnlPct,
      openedAt: pos.openedAt,
      closedAt: pos.closedAt,
      status: pos.status,
      raw: pos.raw,
      lastSeenAt: pos.lastSeenAt,
    })
    .onConflictDoUpdate({
      target: whalePositions.id,
      set: {
        leverage: pos.leverage,
        amountBase: pos.amountBase,
        notionalUsd: pos.notionalUsd,
        currentMark: pos.currentMark,
        unrealizedPnlPct: pos.unrealizedPnlPct,
        raw: pos.raw,
        status: "open",
        closedAt: null,
        lastSeenAt: pos.lastSeenAt,
      },
    });
}

export async function markMissingPacificaPositionsClosed(args: {
  sourceAccount: string;
  openPositionIds: string[];
  graceCutoff: Date;
}): Promise<void> {
  const baseFilters = [
    eq(whalePositions.source, "pacifica"),
    eq(whalePositions.sourceAccount, args.sourceAccount),
    eq(whalePositions.status, "open"),
    lt(whalePositions.lastSeenAt, args.graceCutoff),
  ];
  const filters =
    args.openPositionIds.length > 0
      ? [
          ...baseFilters,
          not(inArray(whalePositions.id, args.openPositionIds)),
        ]
      : baseFilters;
  await db
    .update(whalePositions)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(...filters));
}

export async function getOpenWhalePositions(limit = 100): Promise<WhalePositionRecord[]> {
  const rows = await db
    .select()
    .from(whalePositions)
    .where(eq(whalePositions.status, "open"))
    .orderBy(desc(whalePositions.lastSeenAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    whaleId: r.whaleId,
    source: r.source as WhalePositionRecord["source"],
    sourceAccount: r.sourceAccount,
    market: r.market,
    side: r.side as WhalePositionRecord["side"],
    leverage: r.leverage,
    amountBase: r.amountBase,
    notionalUsd: r.notionalUsd,
    entryPrice: r.entryPrice,
    currentMark: r.currentMark,
    unrealizedPnlPct: r.unrealizedPnlPct,
    openedAt: r.openedAt,
    closedAt: r.closedAt,
    status: r.status as WhalePositionRecord["status"],
    raw: r.raw as Record<string, unknown>,
    lastSeenAt: r.lastSeenAt,
  }));
}

export async function getWhalesByIds(ids: string[]): Promise<Map<string, WhaleRecord>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(whales).where(inArray(whales.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        source: r.source as WhaleRecord["source"],
        sourceAccount: r.sourceAccount,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        status: r.status as WhaleRecord["status"],
        tags: (r.tags as string[]) ?? [],
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
    ]),
  );
}

export async function upsertWhaleAnalysis(
  analysis: WhalePositionAnalysis,
): Promise<void> {
  await db
    .insert(whalePositionAnalysis)
    .values({
      positionId: analysis.positionId,
      summary: analysis.summary,
      thesis: analysis.thesis,
      risk: analysis.risk,
      entryGapWarning: analysis.entryGapWarning,
      confidence: analysis.confidence,
      model: analysis.model,
      updatedAt: analysis.updatedAt,
    })
    .onConflictDoUpdate({
      target: whalePositionAnalysis.positionId,
      set: {
        summary: analysis.summary,
        thesis: analysis.thesis,
        risk: analysis.risk,
        entryGapWarning: analysis.entryGapWarning,
        confidence: analysis.confidence,
        model: analysis.model,
        updatedAt: analysis.updatedAt,
      },
    });
}
```

- [ ] **Step 3: Add refresh service**

Create `lib/whales/refresh-pacifica.ts`:

```ts
import { getLeaderboard, getMarkets, getPositions } from "@/lib/pacifica/client";
import { filterTradeable, preRankByActivity } from "@/lib/pacifica/leaderboard";
import { getMarksSnapshot } from "@/lib/data/marks";
import { generatedWhaleHandle, makeWhaleId } from "./identity";
import { mapPacificaPosition } from "./pacifica-source";
import { CURATED_PACIFICA_WHALES } from "./curated";
import {
  markMissingPacificaPositionsClosed,
  upsertWhale,
  upsertWhalePosition,
} from "./repository";

const LEADERBOARD_LIMIT = 30;
const CLOSE_GRACE_MS = 90_000;

export async function refreshPacificaWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  const [leaderboard, markets, marks] = await Promise.all([
    getLeaderboard(),
    getMarkets(),
    getMarksSnapshot(),
  ]);

  const marketMaxLeverage = new Map(
    markets.map((m) => [m.symbol, Number(m.max_leverage) || 1]),
  );
  const curatedByAccount = new Map(
    CURATED_PACIFICA_WHALES.map((w) => [w.sourceAccount, w]),
  );
  const tradeable = preRankByActivity(filterTradeable(leaderboard)).slice(
    0,
    LEADERBOARD_LIMIT,
  );
  const accounts = new Set<string>();
  for (const w of CURATED_PACIFICA_WHALES) accounts.add(w.sourceAccount);
  for (const entry of tradeable) accounts.add(entry.address);

  let positionsSeen = 0;
  for (const sourceAccount of accounts) {
    const curated = curatedByAccount.get(sourceAccount);
    const lb = leaderboard.find((e) => e.address === sourceAccount);
    const whaleId = makeWhaleId("pacifica", sourceAccount);
    await upsertWhale({
      id: whaleId,
      source: "pacifica",
      sourceAccount,
      displayName:
        curated?.displayName ?? lb?.username ?? generatedWhaleHandle(sourceAccount),
      avatarUrl: curated?.avatarUrl ?? null,
      tags: curated?.tags ?? [],
    });

    let positions;
    try {
      positions = await getPositions(sourceAccount);
    } catch (err) {
      console.warn(`[whales] positions failed for ${sourceAccount}:`, err);
      continue;
    }

    const openIds: string[] = [];
    for (const position of positions) {
      const maxLev = marketMaxLeverage.get(position.symbol) ?? 1;
      const mapped = mapPacificaPosition({
        sourceAccount,
        position,
        marketMaxLeverage: maxLev,
        currentMark: marks.get(position.symbol) ?? null,
      });
      openIds.push(mapped.id);
      await upsertWhalePosition(mapped);
      positionsSeen += 1;
    }

    await markMissingPacificaPositionsClosed({
      sourceAccount,
      openPositionIds: openIds,
      graceCutoff: new Date(Date.now() - CLOSE_GRACE_MS),
    });
  }

  return { whalesSeen: accounts.size, positionsSeen };
}
```

- [ ] **Step 4: Add refresh loop**

Create `lib/whales/ticker.ts`:

```ts
import { refreshPacificaWhales } from "./refresh-pacifica";
import { whaleSocialEnabled } from "@/lib/features";

const REFRESH_GAP_MS = Number(process.env.WHALE_REFRESH_GAP_MS ?? 15_000);
const STARTUP_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startWhaleTicker(): void {
  if (!whaleSocialEnabled()) return;
  const g = globalThis as typeof globalThis & {
    __whaleTickerStarted?: boolean;
  };
  if (g.__whaleTickerStarted) return;
  g.__whaleTickerStarted = true;
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  for (;;) {
    const started = Date.now();
    try {
      const result = await refreshPacificaWhales();
      console.log(
        `[whales] refresh: ${result.whalesSeen} whales, ${result.positionsSeen} positions in ${Date.now() - started}ms`,
      );
    } catch (err) {
      console.error("[whales] refresh failed:", err);
    }
    await sleep(REFRESH_GAP_MS);
  }
}
```

Modify `instrumentation.ts`:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBotTicker } = await import("@/lib/bots/ticker");
  startBotTicker();
  const { startWhaleTicker } = await import("@/lib/whales/ticker");
  startWhaleTicker();
}
```

- [ ] **Step 5: Add manual refresh route**

Create `app/api/cron/refresh-whales/route.ts`:

```ts
import { NextResponse } from "next/server";
import { refreshPacificaWhales } from "@/lib/whales/refresh-pacifica";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await refreshPacificaWhales();
  return NextResponse.json({ ok: true, ...result });
}
```

- [ ] **Step 6: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add lib/whales/curated.ts lib/whales/repository.ts lib/whales/refresh-pacifica.ts lib/whales/ticker.ts instrumentation.ts app/api/cron/refresh-whales/route.ts
git commit -m "Add Pacifica whale refresh service"
```

---

### Task 4: Whale Signals And API Endpoints

**Files:**
- Create: `lib/signals/whale-signals.ts`
- Create: `app/api/whales/roster/route.ts`
- Create: `app/api/whales/live/route.ts`

- [ ] **Step 1: Add whale signal builder**

Create `lib/signals/whale-signals.ts`:

```ts
import { db } from "@/lib/db";
import { whales, whalePositions, whalePositionAnalysis } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { isSourceFresh } from "@/lib/whales/identity";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";

function heatForPosition(args: {
  notionalUsd: number;
  unrealizedPnlPct: number | null;
  lastSeenAtMs: number;
}): number {
  const fresh = isSourceFresh(args.lastSeenAtMs) ? 100 : -250;
  const notional = Math.min(300, args.notionalUsd / 1000);
  const pnl = Math.max(-100, Math.min(100, args.unrealizedPnlPct ?? 0));
  return Math.round(500 + fresh + notional + pnl);
}

export async function buildWhalePositionSignals(
  limit = 100,
): Promise<WhalePositionSignal[]> {
  const rows = await db
    .select({
      position: whalePositions,
      whale: whales,
      analysis: whalePositionAnalysis,
    })
    .from(whalePositions)
    .innerJoin(whales, eq(whales.id, whalePositions.whaleId))
    .leftJoin(
      whalePositionAnalysis,
      eq(whalePositionAnalysis.positionId, whalePositions.id),
    )
    .where(eq(whalePositions.status, "open"))
    .orderBy(desc(whalePositions.lastSeenAt))
    .limit(limit);

  const stamp = new Date().toISOString();
  return rows.map(({ position, whale, analysis }) => {
    const lastSeenAtMs = position.lastSeenAt.getTime();
    const stale = !isSourceFresh(lastSeenAtMs);
    return {
      id: `whale_position:${position.id}`,
      type: "whale_position",
      heatScore: heatForPosition({
        notionalUsd: position.notionalUsd,
        unrealizedPnlPct: position.unrealizedPnlPct,
        lastSeenAtMs,
      }),
      createdAt: stamp,
      chips: [],
      payload: {
        positionId: position.id,
        whaleId: whale.id,
        source: whale.source as "pacifica" | "hyperliquid",
        sourceAccount: whale.sourceAccount,
        displayName: whale.displayName,
        avatarUrl: whale.avatarUrl,
        market: position.market,
        side: position.side as "long" | "short",
        leverage: position.leverage,
        amountBase: position.amountBase,
        notionalUsd: position.notionalUsd,
        entryPrice: position.entryPrice,
        currentMark: position.currentMark,
        unrealizedPnlPct: position.unrealizedPnlPct,
        openedAtMs: position.openedAt.getTime(),
        lastSeenAtMs,
        stale,
        analysis: analysis
          ? {
              summary: analysis.summary,
              thesis: analysis.thesis,
              risk: analysis.risk,
              entryGapWarning: analysis.entryGapWarning,
              confidence: analysis.confidence,
            }
          : null,
      },
    };
  });
}

export async function buildWhaleTraderSignals(): Promise<WhaleTraderSignal[]> {
  const positions = await buildWhalePositionSignals(200);
  const byWhale = new Map<string, WhalePositionSignal[]>();
  for (const pos of positions) {
    const list = byWhale.get(pos.payload.whaleId) ?? [];
    list.push(pos);
    byWhale.set(pos.payload.whaleId, list);
  }

  const stamp = new Date().toISOString();
  return Array.from(byWhale.entries())
    .map(([whaleId, list]) => {
      const best = [...list].sort((a, b) => b.heatScore - a.heatScore)[0];
      const newest = Math.max(...list.map((p) => p.payload.lastSeenAtMs));
      return {
        id: `whale_trader:${whaleId}`,
        type: "whale_trader",
        heatScore: best.heatScore + list.length * 25,
        createdAt: stamp,
        chips: [],
        payload: {
          whaleId,
          source: best.payload.source,
          sourceAccount: best.payload.sourceAccount,
          displayName: best.payload.displayName,
          avatarUrl: best.payload.avatarUrl,
          tags: [],
          openPositionsCount: list.length,
          bestPosition: best.payload,
          stats: {
            pnl1dUsdc: 0,
            pnl7dUsdc: 0,
            pnl30dUsdc: 0,
            winRatePct1d: null,
            totalCloses1d: 0,
            volume1dUsdc: 0,
          },
          lastSeenAt: new Date(newest).toISOString(),
          stale: list.every((p) => p.payload.stale),
        },
      } satisfies WhaleTraderSignal;
    })
    .sort((a, b) => b.heatScore - a.heatScore);
}
```

- [ ] **Step 2: Add roster API**

Create `app/api/whales/roster/route.ts`:

```ts
import { NextResponse } from "next/server";
import { buildWhaleTraderSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const whales = await buildWhaleTraderSignals();
  return NextResponse.json({ whales });
}
```

- [ ] **Step 3: Add live positions API**

Create `app/api/whales/live/route.ts`:

```ts
import { NextResponse } from "next/server";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const positions = await buildWhalePositionSignals();
  positions.sort((a, b) => b.heatScore - a.heatScore);
  return NextResponse.json({ positions });
}
```

- [ ] **Step 4: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add lib/signals/whale-signals.ts app/api/whales/roster/route.ts app/api/whales/live/route.ts
git commit -m "Expose whale roster and live position APIs"
```

---

### Task 5: Whale Copy Metadata And Tail Endpoint

**Files:**
- Create: `lib/bets/whale-meta.ts`
- Test: `lib/bets/whale-meta.test.ts`
- Create: `app/api/bet/whale/route.ts`

- [ ] **Step 1: Write whale metadata tests**

Create `lib/bets/whale-meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWhaleCopyMeta, parseWhaleCopyMeta } from "./whale-meta";

describe("whale copy metadata", () => {
  it("builds and parses whale copy metadata", () => {
    const meta = buildWhaleCopyMeta({
      whaleId: "pacifica:ABC123",
      source: "pacifica",
      sourceAccount: "ABC123",
      sourcePositionId: "pos1",
      market: "BTC",
      side: "long",
      leverage: 10,
      autoCloseOnSourceClose: true,
      userEntryPrice: 65_100,
      sourceEntryPriceAtCopy: 65_000,
      pacificaOrderId: "order1",
    });
    expect(parseWhaleCopyMeta(meta)).toEqual(meta);
  });

  it("rejects missing source position metadata", () => {
    expect(parseWhaleCopyMeta({ sourceType: "whale" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run metadata test and verify it fails**

Run:

```bash
npx vitest run lib/bets/whale-meta.test.ts
```

Expected: FAIL because `lib/bets/whale-meta.ts` does not exist.

- [ ] **Step 3: Implement metadata helpers**

Create `lib/bets/whale-meta.ts`:

```ts
export interface WhaleCopyMeta {
  sourceType: "whale";
  whaleId: string;
  source: "pacifica" | "hyperliquid";
  sourceAccount: string;
  sourcePositionId: string;
  leaderMarket: string;
  leaderSide: "long" | "short";
  leverage: number;
  autoCloseOnSourceClose: boolean;
  userEntryPrice: number;
  sourceEntryPriceAtCopy: number;
  pacificaOrderId: string;
  closeReason: "manual" | "source_closed" | "already_flat" | null;
}

export function buildWhaleCopyMeta(args: {
  whaleId: string;
  source: "pacifica" | "hyperliquid";
  sourceAccount: string;
  sourcePositionId: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  autoCloseOnSourceClose: boolean;
  userEntryPrice: number;
  sourceEntryPriceAtCopy: number;
  pacificaOrderId: string;
}): WhaleCopyMeta {
  return {
    sourceType: "whale",
    whaleId: args.whaleId,
    source: args.source,
    sourceAccount: args.sourceAccount,
    sourcePositionId: args.sourcePositionId,
    leaderMarket: args.market,
    leaderSide: args.side,
    leverage: args.leverage,
    autoCloseOnSourceClose: args.autoCloseOnSourceClose,
    userEntryPrice: args.userEntryPrice,
    sourceEntryPriceAtCopy: args.sourceEntryPriceAtCopy,
    pacificaOrderId: args.pacificaOrderId,
    closeReason: null,
  };
}

export function parseWhaleCopyMeta(meta: unknown): WhaleCopyMeta | null {
  const m = meta as Partial<WhaleCopyMeta> | null;
  if (!m || m.sourceType !== "whale") return null;
  if (
    typeof m.whaleId !== "string" ||
    typeof m.sourceAccount !== "string" ||
    typeof m.sourcePositionId !== "string" ||
    typeof m.leaderMarket !== "string" ||
    (m.leaderSide !== "long" && m.leaderSide !== "short") ||
    typeof m.leverage !== "number" ||
    typeof m.autoCloseOnSourceClose !== "boolean" ||
    typeof m.userEntryPrice !== "number" ||
    typeof m.sourceEntryPriceAtCopy !== "number" ||
    typeof m.pacificaOrderId !== "string" ||
    (m.source !== "pacifica" && m.source !== "hyperliquid")
  ) {
    return null;
  }
  return m as WhaleCopyMeta;
}
```

- [ ] **Step 4: Run metadata tests**

Run:

```bash
npx vitest run lib/bets/whale-meta.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add whale tail endpoint**

Create `app/api/bet/whale/route.ts` by adapting `app/api/bet/bot/route.ts`. The endpoint must:

1. Verify Privy auth.
2. Require body fields `positionId`, `stakeUsdc`, `walletAddress`, and `autoCloseOnSourceClose`.
3. Load the source row from `whale_positions` joined to `whales`.
4. Reject if `status !== "open"`.
5. Reject if source `lastSeenAt` is stale using `isSourceFresh`.
6. Enforce stake range `$5` to `$1000`.
7. Enforce one open tail per market through `hasOpenTailOnMarket`.
8. Reuse Pacifica onboarding and deposit planning from `app/api/bet/bot/route.ts`.
9. Place the Pacifica order with `openCopyOrder`.
10. Insert a `bets` row with `type: "copy"` and `buildWhaleCopyMeta`.

The response shape for the open phase must be:

```ts
{
  phase: "open";
  betId: string;
  fill: {
    orderId: string;
    avgFillPrice: string;
    filledAmount: string;
    side: string;
  };
  source: {
    whaleId: string;
    displayName: string;
    asset: string;
    side: "long" | "short";
    leverage: number;
    autoCloseOnSourceClose: boolean;
  };
}
```

- [ ] **Step 6: Typecheck endpoint**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add lib/bets/whale-meta.ts lib/bets/whale-meta.test.ts app/api/bet/whale/route.ts
git commit -m "Add whale copy trade endpoint"
```

---

### Task 6: Source Close Listener With Optional Auto-Close

**Files:**
- Create: `lib/bets/source-close.ts`
- Test: `lib/bets/source-close.test.ts`
- Modify: `lib/bets/mirror-close.ts`

- [ ] **Step 1: Write source close tests**

Create `lib/bets/source-close.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldAutoCloseWhaleCopy } from "./source-close";
import type { WhaleCopyMeta } from "./whale-meta";

const meta: WhaleCopyMeta = {
  sourceType: "whale",
  whaleId: "pacifica:ABC123",
  source: "pacifica",
  sourceAccount: "ABC123",
  sourcePositionId: "pos1",
  leaderMarket: "BTC",
  leaderSide: "long",
  leverage: 10,
  autoCloseOnSourceClose: true,
  userEntryPrice: 65_100,
  sourceEntryPriceAtCopy: 65_000,
  pacificaOrderId: "order1",
  closeReason: null,
};

describe("source close eligibility", () => {
  it("auto-closes only when enabled and source is closed", () => {
    expect(
      shouldAutoCloseWhaleCopy({
        meta,
        sourceStillOpen: false,
      }),
    ).toBe(true);
  });

  it("does not auto-close when the user disabled close listening", () => {
    expect(
      shouldAutoCloseWhaleCopy({
        meta: { ...meta, autoCloseOnSourceClose: false },
        sourceStillOpen: false,
      }),
    ).toBe(false);
  });

  it("does not auto-close while source is still open", () => {
    expect(
      shouldAutoCloseWhaleCopy({
        meta,
        sourceStillOpen: true,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run source close test and verify it fails**

Run:

```bash
npx vitest run lib/bets/source-close.test.ts
```

Expected: FAIL because `lib/bets/source-close.ts` does not exist.

- [ ] **Step 3: Implement source close helper**

Create `lib/bets/source-close.ts`:

```ts
import type { WhaleCopyMeta } from "./whale-meta";

export function shouldAutoCloseWhaleCopy(args: {
  meta: WhaleCopyMeta;
  sourceStillOpen: boolean;
}): boolean {
  return args.meta.autoCloseOnSourceClose && !args.sourceStillOpen;
}
```

- [ ] **Step 4: Run source close tests**

Run:

```bash
npx vitest run lib/bets/source-close.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend mirror close sweep**

Modify `lib/bets/mirror-close.ts`:

1. Import `parseWhaleCopyMeta` and `shouldAutoCloseWhaleCopy`.
2. In `runMirrorCloseSweep`, split confirmed copy bets into bot, leader wallet, and whale-source buckets.
3. Add a `closeWhaleFollowers` function that:
   - Parses `WhaleCopyMeta`.
   - Skips rows where parse returns null.
   - Skips rows where `autoCloseOnSourceClose` is false.
   - For Pacifica source, fetches `getPositions(meta.sourceAccount)`.
   - Checks for a matching position by `leaderMarket` and `leaderSide`.
   - Calls `closeFollowerBet` when `shouldAutoCloseWhaleCopy` returns true.
   - Updates `meta.closeReason` to `"source_closed"` using the existing `withLeaderClosedAt` merge pattern.

Use this matching expression:

```ts
const sourceStillOpen = sourcePositions.some(
  (p) =>
    p.symbol === meta.leaderMarket &&
    ((meta.leaderSide === "long" && p.side === "bid") ||
      (meta.leaderSide === "short" && p.side === "ask")),
);
```

- [ ] **Step 6: Run close tests and existing copy tests**

Run:

```bash
npx vitest run lib/bets/source-close.test.ts lib/bets/bot-route.test.ts lib/bets/funding.test.ts
```

Expected: PASS.

- [ ] **Step 7: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add lib/bets/source-close.ts lib/bets/source-close.test.ts lib/bets/mirror-close.ts
git commit -m "Auto-close whale copies from source closes"
```

---

### Task 7: Whale Analysis Service

**Files:**
- Create: `lib/whales/analysis.ts`
- Test: `lib/whales/analysis.test.ts`

- [ ] **Step 1: Write analysis tests**

Create `lib/whales/analysis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  fallbackWhaleAnalysis,
  whaleEntryGapWarning,
  buildWhaleAnalysisPrompt,
} from "./analysis";

describe("whale analysis", () => {
  it("describes entry gap when follower is late", () => {
    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 100,
        currentMark: 106,
      }),
    ).toContain("6.0% above");
  });

  it("returns null when current mark is unavailable", () => {
    expect(
      whaleEntryGapWarning({
        side: "short",
        sourceEntry: 100,
        currentMark: null,
      }),
    ).toBeNull();
  });

  it("builds a prompt with caveat instructions", () => {
    const prompt = buildWhaleAnalysisPrompt({
      displayName: "Whale One",
      market: "BTC",
      side: "long",
      leverage: 10,
      entryPrice: 65_000,
      currentMark: 66_000,
      notionalUsd: 250_000,
      openedAtMs: 1779543000000,
      source: "pacifica",
    });
    expect(prompt).toContain("Whale One");
    expect(prompt).toContain("Do not claim to know private intent");
  });

  it("has a deterministic fallback", () => {
    expect(
      fallbackWhaleAnalysis({
        displayName: "Whale One",
        market: "BTC",
        side: "long",
        leverage: 10,
      }).summary,
    ).toContain("Whale One is long BTC");
  });
});
```

- [ ] **Step 2: Run analysis test and verify it fails**

Run:

```bash
npx vitest run lib/whales/analysis.test.ts
```

Expected: FAIL because `lib/whales/analysis.ts` does not exist.

- [ ] **Step 3: Implement analysis helpers**

Create `lib/whales/analysis.ts`:

```ts
import { generateObject } from "ai";
import { xai } from "@ai-sdk/xai";
import { z } from "zod";

const MODEL_ID = "grok-4.3";

export const WhaleAnalysisSchema = z.object({
  summary: z.string().min(1),
  thesis: z.string().min(1),
  risk: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export function whaleEntryGapWarning(args: {
  side: "long" | "short";
  sourceEntry: number;
  currentMark: number | null;
}): string | null {
  if (args.currentMark == null || args.sourceEntry <= 0) return null;
  const diffPct = ((args.currentMark - args.sourceEntry) / args.sourceEntry) * 100;
  if (Math.abs(diffPct) < 1) return null;
  const relation =
    diffPct > 0
      ? `${Math.abs(diffPct).toFixed(1)}% above`
      : `${Math.abs(diffPct).toFixed(1)}% below`;
  return `Current mark is ${relation} the whale entry. Followers enter at the live price, not the whale entry.`;
}

export function buildWhaleAnalysisPrompt(args: {
  displayName: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  currentMark: number | null;
  notionalUsd: number;
  openedAtMs: number;
  source: "pacifica" | "hyperliquid";
}): string {
  return [
    `Analyze this public whale perp position for a copy-trading feed.`,
    `Whale: ${args.displayName}`,
    `Source: ${args.source}`,
    `Position: ${args.side} ${args.market} at ${args.leverage}x`,
    `Entry: ${args.entryPrice}`,
    `Current mark: ${args.currentMark ?? "unknown"}`,
    `Notional USD: ${args.notionalUsd}`,
    `Opened at ms: ${args.openedAtMs}`,
    `Explain likely public-market context, not private intent.`,
    `Do not claim to know private intent.`,
    `Include one risk caveat for a follower entering now.`,
  ].join("\\n");
}

export function fallbackWhaleAnalysis(args: {
  displayName: string;
  market: string;
  side: "long" | "short";
  leverage: number;
}) {
  return {
    summary: `${args.displayName} is ${args.side} ${args.market} at ${args.leverage}x.`,
    thesis:
      "The position is live and recently verified, but no AI analysis is cached yet.",
    risk:
      "Followers enter at the current market price and may not match the whale's original entry.",
    confidence: 0.25,
  };
}

export async function generateWhaleAnalysis(args: {
  displayName: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  currentMark: number | null;
  notionalUsd: number;
  openedAtMs: number;
  source: "pacifica" | "hyperliquid";
}) {
  const entryGapWarning = whaleEntryGapWarning({
    side: args.side,
    sourceEntry: args.entryPrice,
    currentMark: args.currentMark,
  });
  try {
    const { object } = await generateObject({
      model: xai(MODEL_ID),
      schema: WhaleAnalysisSchema,
      prompt: buildWhaleAnalysisPrompt(args),
    });
    return {
      ...object,
      entryGapWarning,
      model: MODEL_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch {
    return {
      ...fallbackWhaleAnalysis(args),
      entryGapWarning,
      model: "fallback",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
```

- [ ] **Step 4: Run analysis tests**

Run:

```bash
npx vitest run lib/whales/analysis.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add lib/whales/analysis.ts lib/whales/analysis.test.ts
git commit -m "Add whale position analysis helpers"
```

---

### Task 8: Whale UI And Tail Modal

**Files:**
- Create: `components/whales/WhaleRoster.tsx`
- Create: `components/whales/WhaleLiveFeed.tsx`
- Create: `components/whales/WhaleAnalysisStream.tsx`
- Modify: `components/tail/TailModal.tsx`
- Modify: `app/(app)/feed/page.tsx`
- Modify: `app/(app)/live/page.tsx`
- Modify: `app/(app)/chatter/page.tsx`

- [ ] **Step 1: Extend TailSource**

Modify `components/tail/TailModal.tsx` so `TailSource` becomes a union:

```ts
export type TailSource =
  | {
      kind: "bot";
      botId: string;
      botName: string;
      avatarEmoji?: string;
      avatarImageUrl?: string | null;
      asset: string;
      side: "long" | "short";
      leverage: number;
      entryMark: number;
      positionId?: string;
    }
  | {
      kind: "whale";
      whaleId: string;
      displayName: string;
      avatarUrl: string | null;
      sourceAccount: string;
      sourcePositionId: string;
      asset: string;
      side: "long" | "short";
      leverage: number;
      entryMark: number;
      currentMark: number | null;
      stale: boolean;
    };
```

Add state:

```ts
const [autoCloseOnSourceClose, setAutoCloseOnSourceClose] = useState(false);
```

Reset it to `false` in the existing open reset effect.

When `source.kind === "whale"`, post to `/api/bet/whale` with:

```ts
{
  positionId: source.sourcePositionId,
  stakeUsdc: effectiveStake,
  walletAddress: wallet.address,
  autoCloseOnSourceClose,
}
```

When `source.kind === "bot"`, keep the current `/api/bet/bot` request body.

Add a toggle in the modal body for whale sources:

```tsx
{source?.kind === "whale" && (
  <label className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-[11px] font-black uppercase tracking-widest">
    <span>Auto-close when whale exits</span>
    <input
      type="checkbox"
      checked={autoCloseOnSourceClose}
      onChange={(e) => setAutoCloseOnSourceClose(e.target.checked)}
    />
  </label>
)}
```

- [ ] **Step 2: Add whale roster component**

Create `components/whales/WhaleRoster.tsx` as a client component that:

- Accepts `initialWhales: WhaleTraderSignal[]`.
- Polls `/api/whales/roster` every 4 seconds while visible.
- Renders ranked whale cards.
- Uses `TailModal` when the best position is available and not stale.

The main prop shape:

```ts
import type { WhaleTraderSignal } from "@/lib/types";

interface Props {
  initialWhales: WhaleTraderSignal[];
}
```

The tail source construction:

```ts
const source = best
  ? {
      kind: "whale" as const,
      whaleId: whale.payload.whaleId,
      displayName: whale.payload.displayName,
      avatarUrl: whale.payload.avatarUrl,
      sourceAccount: whale.payload.sourceAccount,
      sourcePositionId: best.positionId,
      asset: best.market,
      side: best.side,
      leverage: best.leverage,
      entryMark: best.entryPrice,
      currentMark: best.currentMark,
      stale: best.stale,
    }
  : null;
```

- [ ] **Step 3: Add whale live feed component**

Create `components/whales/WhaleLiveFeed.tsx` as a client component that:

- Accepts `initialPositions: WhalePositionSignal[]`.
- Polls `/api/whales/live` every 4 seconds while visible.
- Uses mobile snap-scroll for cards.
- Shows `analysis.summary`, `analysis.risk`, and entry gap warning when present.
- Disables the tail button when `payload.stale === true`.

- [ ] **Step 4: Add whale analysis stream**

Create `components/whales/WhaleAnalysisStream.tsx` as a client component that:

- Accepts `initialPositions: WhalePositionSignal[]`.
- Polls `/api/whales/live` every 10 seconds while visible.
- Renders a list sorted by `openedAtMs` descending.
- Shows summary, thesis, risk, market, side, leverage, and source freshness.

- [ ] **Step 5: Switch pages behind feature flag**

Modify `app/(app)/feed/page.tsx`:

```ts
import { whaleSocialEnabled } from "@/lib/features";
import { WhaleRoster } from "@/components/whales/WhaleRoster";
import { buildWhaleTraderSignals } from "@/lib/signals/whale-signals";
```

At the top of `FeedPage`:

```ts
if (whaleSocialEnabled()) {
  const whales = await buildWhaleTraderSignals();
  return (
    <>
      <WhaleRoster initialWhales={whales} />
      <BottomNav />
    </>
  );
}
```

Keep the existing bot path below it.

Apply the same pattern to:

- `app/(app)/live/page.tsx` using `WhaleLiveFeed` and `buildWhalePositionSignals`.
- `app/(app)/chatter/page.tsx` using `WhaleAnalysisStream` and `buildWhalePositionSignals`.

- [ ] **Step 6: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add components/whales/WhaleRoster.tsx components/whales/WhaleLiveFeed.tsx components/whales/WhaleAnalysisStream.tsx components/tail/TailModal.tsx app/'(app)'/feed/page.tsx app/'(app)'/live/page.tsx app/'(app)'/chatter/page.tsx
git commit -m "Switch app surfaces to whale social mode"
```

---

### Task 9: Portfolio Whale Copy State

**Files:**
- Modify: `app/api/portfolio/route.ts`
- Modify: `components/portfolio/CopyRow.tsx`

- [ ] **Step 1: Extend copy row API data**

Modify the `copyRows` mapping in `app/api/portfolio/route.ts`:

```ts
const whaleMeta = parseWhaleCopyMeta(b.meta);
return {
  betId: b.id,
  market: meta.leaderMarket,
  side: meta.leaderSide,
  leverage: meta.leverage,
  stakeUsdc: b.amountUsdc,
  leaderAddress: meta.leaderAddress ?? whaleMeta?.sourceAccount ?? null,
  leaderUsername: whaleMeta?.whaleId ?? null,
  botId: meta.botId ?? null,
  botName: meta.botId ? (getBot(meta.botId)?.name ?? meta.botId) : null,
  whaleId: whaleMeta?.whaleId ?? null,
  whaleName: whaleMeta?.whaleId ?? null,
  autoCloseOnSourceClose: whaleMeta?.autoCloseOnSourceClose ?? false,
  closeReason: whaleMeta?.closeReason ?? null,
  unrealizedPnlPct,
  leaderClosedAt: meta.leaderClosedAt ?? null,
};
```

Import `parseWhaleCopyMeta` from `@/lib/bets/whale-meta`.

- [ ] **Step 2: Extend CopyRowData**

Modify `components/portfolio/CopyRow.tsx` type:

```ts
export interface CopyRowData {
  betId: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  stakeUsdc: number;
  leaderAddress: string | null;
  leaderUsername: string | null;
  botId: string | null;
  botName: string | null;
  whaleId?: string | null;
  whaleName?: string | null;
  autoCloseOnSourceClose?: boolean;
  closeReason?: "manual" | "source_closed" | "already_flat" | null;
  unrealizedPnlPct: number | null;
  leaderClosedAt: string | null;
}
```

In the rendered copy, prefer `row.whaleName ?? row.botName ?? row.leaderUsername ?? row.leaderAddress`.

Add a compact status line:

```tsx
{row.autoCloseOnSourceClose ? "AUTO-CLOSE ON" : "MANUAL CLOSE"}
```

If `row.closeReason === "source_closed"`, show:

```tsx
<span>Closed after whale exited</span>
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 9**

```bash
git add app/api/portfolio/route.ts components/portfolio/CopyRow.tsx
git commit -m "Show whale copy state in portfolio"
```

---

### Task 10: Verification And Browser QA

**Files:**
- No planned file changes unless verification reveals defects.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: PASS with all Vitest files.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Start the app with whale mode**

Run:

```bash
FEATURE_WHALE_SOCIAL=true npm run dev
```

Expected: Next.js dev server starts. Use a free port if `3000` is occupied.

- [ ] **Step 5: Browser QA**

Open the app and verify:

- `/feed` shows whale roster, not bot roster.
- `/live` shows open whale positions, not bot positions.
- `/chatter` shows whale analysis stream.
- Tail modal opens from a whale card.
- Tail modal has close-listening toggle defaulted off.
- Stale positions disable tailing.
- `/portfolio` still loads when authenticated.

- [ ] **Step 6: Final git state**

Run:

```bash
git status --short --branch
```

Expected: no unstaged changes except generated local artifacts that are ignored.

---

## Self-Review

Spec coverage:

- Whale roster is implemented by Tasks 4 and 8.
- Open position slides are implemented by Tasks 4 and 8.
- AI analysis chatter is implemented by Tasks 7 and 8.
- Pacifica-native V1 refresh is implemented by Tasks 2 and 3.
- Real copy trading is implemented by Task 5.
- Optional close listening is implemented by Tasks 5 and 6.
- Portfolio state is implemented by Task 9.
- Migration safety through a feature flag is implemented by Tasks 1 and 8.

Plan constraints:

- No Hyperliquid copy is included in V1.
- No social posting, comments, or likes are included.
- The one-open-tail-per-market guard remains intact.
- Auto-close defaults off.
- Source stale limit is 60 seconds through `isSourceFresh`.
