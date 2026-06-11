# Flash Tail Persistence (Phase 1 — Follower-Side Truth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flash tail opens/closes persist as `bets` + `fills` rows with whale/bot lineage, the portfolio attributes live Flash positions to their source, and a reconciliation sweep verifies fills against the chain.

**Architecture:** A new `flash-tail` bet type flows through the existing `/api/flash/perp` routes (additive `tail` payload — the Scalp game path is untouched), with confirm postbacks mirroring the Pacifica pattern. DB logic lives in `lib/bets/flash-tail*.ts` modules so route contract tests mock one boundary. Reconciliation derives real proceeds from USDC balance deltas in parsed transactions (no Flash instruction decoding in v1) and piggybacks on the lease-guarded whale ticker.

**Tech Stack:** Next.js 16 App Router routes, Drizzle/Neon (`postgres-js`), `@solana/web3.js` `Connection.getTransaction`, vitest (`npm test`).

**Scope notes (deliberate):**
- Closed flash-tail bets get correct DB rows; rendering them as closed history rows in the portfolio UI is a follow-up, not this plan. This plan fixes *open-position* attribution (the amnesia bug) + persistence + reconciliation.
- If the client's confirm postback fails after a landed tx, the row is reaped to `abandoned` after 5 min — same loss mode the Pacifica rail accepts today. Signature-scan recovery is a Phase-1.5 nice-to-have, not here.
- `db:push` adds one new table (`fills`); it is additive and safe against the shared Neon DB. **Never run any `scripts/reset-*.ts`.**

**Verification commands:** `npm run typecheck && npm run lint && npm test` (no test runner flag changes needed; vitest picks up `lib/**/*.test.ts`).

---

### Task 1: `fills` table schema

**Files:**
- Modify: `lib/db/schema.ts` (append after the `bets` table block, line ~65)

- [ ] **Step 1: Add the table definition**

Append to `lib/db/schema.ts` directly after the `bets` table definition:

```ts
// One row per executed fill (open or close), both venues. betId is nullable
// because Phase-2 leader (bot) fills have no bets row; botId is a soft text
// column (no FK) for the same reason. source tracks data quality:
// 'quote-estimate' rows are written at confirm time from the build-time
// quote; the reconcile sweep upgrades them to 'chain' with real numbers.
export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    betId: uuid("bet_id").references(() => bets.id),
    botId: text("bot_id"),
    action: text("action").notNull(), // 'open' | 'close'
    market: text("market").notNull(),
    side: text("side").notNull(), // 'long' | 'short'
    fillUsd: doublePrecision("fill_usd"),
    priceUsd: doublePrecision("price_usd"),
    feeUsd: doublePrecision("fee_usd"),
    txSig: text("tx_sig").notNull(),
    source: text("source").notNull().default("quote-estimate"), // 'quote-estimate' | 'chain'
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sigActionIdx: uniqueIndex("fills_sig_action_idx").on(t.txSig, t.action),
    betIdx: index("fills_bet_idx").on(t.betId),
  }),
);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (all imports — `uniqueIndex`, `index`, `doublePrecision` — are already imported at the top of schema.ts).

- [ ] **Step 3: Push the schema**

Run: `npm run db:push`
Expected: drizzle-kit reports creating table `fills` only. If it proposes ANY destructive change to another table, ABORT and stop — do not confirm.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): fills table for venue fill tracking"
```

---

### Task 2: Flash tail meta module

**Files:**
- Create: `lib/bets/flash-tail-meta.ts`
- Test: `lib/bets/flash-tail-meta.test.ts`

Follows the `lib/bets/whale-meta.ts` pattern exactly (typed meta + build + strict parse).

- [ ] **Step 1: Write the failing test**

Create `lib/bets/flash-tail-meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildFlashTailMeta,
  parseFlashTailMeta,
  parseTailLineage,
} from "./flash-tail-meta";

const lineage = {
  sourceKind: "whale" as const,
  whaleId: "whale-1",
  botId: null,
  sourceName: "Big Whale",
  sourcePositionId: "pos-1",
};

describe("flash-tail meta", () => {
  it("round-trips build -> parse", () => {
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
    expect(meta.sourceType).toBe("flash-tail");
    expect(meta.openSignature).toBeNull();
    expect(parseFlashTailMeta(meta)).toEqual(meta);
  });

  it("rejects junk", () => {
    expect(parseFlashTailMeta(null)).toBeNull();
    expect(parseFlashTailMeta({ sourceType: "whale" })).toBeNull();
    expect(parseFlashTailMeta({ sourceType: "flash-tail" })).toBeNull();
  });

  it("parses tail lineage from a request body", () => {
    expect(parseTailLineage(lineage)).toEqual(lineage);
    expect(
      parseTailLineage({ sourceKind: "bot", botId: "pulse" }),
    ).toEqual({
      sourceKind: "bot",
      whaleId: null,
      botId: "pulse",
      sourceName: null,
      sourcePositionId: null,
    });
    expect(parseTailLineage({ sourceKind: "nope" })).toBeNull();
    expect(parseTailLineage(undefined)).toBeNull();
    expect(parseTailLineage({ sourceKind: "whale" })).toBeNull(); // whale needs whaleId
    expect(parseTailLineage({ sourceKind: "bot" })).toBeNull(); // bot needs botId
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/bets/flash-tail-meta.test.ts`
Expected: FAIL — cannot resolve `./flash-tail-meta`.

- [ ] **Step 3: Write the implementation**

Create `lib/bets/flash-tail-meta.ts`:

```ts
import type { FlashTradeMode } from "@/lib/flash/markets";

export type TailLineage = {
  sourceKind: "whale" | "bot";
  whaleId: string | null;
  botId: string | null;
  sourceName: string | null;
  sourcePositionId: string | null;
};

export type FlashTailMeta = {
  sourceType: "flash-tail";
  venue: "flash";
  sourceKind: "whale" | "bot";
  whaleId: string | null;
  botId: string | null;
  sourceName: string | null;
  sourcePositionId: string | null;
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
  closeReason: "manual" | null;
  proceedsSource: "quote-estimate" | "chain" | null;
  reconciledAt: string | null; // ISO; set once the open fill is chain-verified
};

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
};

export function buildFlashTailMeta(args: BuildArgs): FlashTailMeta {
  return {
    sourceType: "flash-tail",
    venue: "flash",
    sourceKind: args.lineage.sourceKind,
    whaleId: args.lineage.whaleId,
    botId: args.lineage.botId,
    sourceName: args.lineage.sourceName,
    sourcePositionId: args.lineage.sourcePositionId,
    market: args.market,
    side: args.side,
    leverage: args.leverage,
    mode: args.mode,
    walletAddress: args.walletAddress,
    entryPriceUsd: args.entryPriceUsd,
    notionalUsd: args.notionalUsd,
    openFeeUsd: args.openFeeUsd,
    openSignature: null,
    closeSignature: null,
    closeReason: null,
    proceedsSource: null,
    reconciledAt: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isSide(value: unknown): value is "long" | "short" {
  return value === "long" || value === "short";
}

/** Parse the optional `tail` object from the /api/flash/perp request body. */
export function parseTailLineage(value: unknown): TailLineage | null {
  if (!isRecord(value)) return null;
  if (value.sourceKind !== "whale" && value.sourceKind !== "bot") return null;
  const whaleId = isString(value.whaleId) ? value.whaleId : null;
  const botId = isString(value.botId) ? value.botId : null;
  if (value.sourceKind === "whale" && !whaleId) return null;
  if (value.sourceKind === "bot" && !botId) return null;
  return {
    sourceKind: value.sourceKind,
    whaleId,
    botId,
    sourceName: isString(value.sourceName) ? value.sourceName : null,
    sourcePositionId: isString(value.sourcePositionId)
      ? value.sourcePositionId
      : null,
  };
}

export function parseFlashTailMeta(value: unknown): FlashTailMeta | null {
  if (!isRecord(value)) return null;
  if (value.sourceType !== "flash-tail" || value.venue !== "flash") return null;
  if (value.sourceKind !== "whale" && value.sourceKind !== "bot") return null;
  if (!isStringOrNull(value.whaleId ?? null)) return null;
  if (!isStringOrNull(value.botId ?? null)) return null;
  if (!isString(value.market)) return null;
  if (!isSide(value.side)) return null;
  if (typeof value.leverage !== "number") return null;
  if (value.mode !== "standard" && value.mode !== "degen") return null;
  if (!isString(value.walletAddress)) return null;
  if (!isNumberOrNull(value.entryPriceUsd ?? null)) return null;
  if (!isNumberOrNull(value.notionalUsd ?? null)) return null;
  if (!isNumberOrNull(value.openFeeUsd ?? null)) return null;
  if (!isStringOrNull(value.openSignature ?? null)) return null;
  if (!isStringOrNull(value.closeSignature ?? null)) return null;
  if (value.closeReason !== null && value.closeReason !== "manual") return null;
  if (
    value.proceedsSource !== null &&
    value.proceedsSource !== "quote-estimate" &&
    value.proceedsSource !== "chain"
  ) {
    return null;
  }
  if (!isStringOrNull(value.reconciledAt ?? null)) return null;

  return {
    sourceType: "flash-tail",
    venue: "flash",
    sourceKind: value.sourceKind,
    whaleId: (value.whaleId as string | null) ?? null,
    botId: (value.botId as string | null) ?? null,
    sourceName: isString(value.sourceName) ? value.sourceName : null,
    sourcePositionId: isString(value.sourcePositionId)
      ? value.sourcePositionId
      : null,
    market: value.market,
    side: value.side,
    leverage: value.leverage,
    mode: value.mode,
    walletAddress: value.walletAddress,
    entryPriceUsd: (value.entryPriceUsd as number | null) ?? null,
    notionalUsd: (value.notionalUsd as number | null) ?? null,
    openFeeUsd: (value.openFeeUsd as number | null) ?? null,
    openSignature: (value.openSignature as string | null) ?? null,
    closeSignature: (value.closeSignature as string | null) ?? null,
    closeReason: (value.closeReason as "manual" | null) ?? null,
    proceedsSource:
      (value.proceedsSource as "quote-estimate" | "chain" | null) ?? null,
    reconciledAt: (value.reconciledAt as string | null) ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/bets/flash-tail-meta.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bets/flash-tail-meta.ts lib/bets/flash-tail-meta.test.ts
git commit -m "feat(bets): flash-tail meta type + lineage parsing"
```

---

### Task 3: Flash tail DB helpers

**Files:**
- Create: `lib/bets/flash-tail.ts`
- Test: `lib/bets/flash-tail.test.ts`

The module owns every bets/fills write for the flash-tail lifecycle. Routes call these; route tests mock this module.

- [ ] **Step 1: Write the failing test**

Create `lib/bets/flash-tail.test.ts`:

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

import {
  confirmFlashTailClose,
  confirmFlashTailOpen,
  findOpenFlashTailBet,
  recordFlashTailOpen,
} from "./flash-tail";
import { buildFlashTailMeta } from "./flash-tail-meta";

const meta = buildFlashTailMeta({
  lineage: {
    sourceKind: "whale",
    whaleId: "whale-1",
    botId: null,
    sourceName: "Big Whale",
    sourcePositionId: "pos-1",
  },
  market: "SOL",
  side: "long",
  leverage: 20,
  mode: "standard",
  walletAddress: "wallet-1",
  entryPriceUsd: 160,
  notionalUsd: 20,
  openFeeUsd: 0.01,
});

function betRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    userId: "user-1",
    type: "flash-tail",
    status: "pending",
    amountUsdc: 1,
    meta,
    ...overrides,
  };
}

describe("flash-tail db helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([betRow()]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mocks.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([betRow({ status: "confirmed" })]),
        }),
      }),
    });
    mocks.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([betRow({ status: "confirmed" })]),
          }),
          limit: vi.fn().mockResolvedValue([betRow({ status: "confirmed" })]),
        }),
      }),
    });
  });

  it("recordFlashTailOpen inserts a pending flash-tail bet and returns its id", async () => {
    const betId = await recordFlashTailOpen({
      userId: "user-1",
      stakeUsdc: 1,
      meta,
    });
    expect(betId).toBe("bet-1");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("confirmFlashTailOpen flips status and writes an estimate fill", async () => {
    const ok = await confirmFlashTailOpen({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-open",
    });
    expect(ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1); // bets row
    expect(mocks.insert).toHaveBeenCalledTimes(1); // fills row
  });

  it("confirmFlashTailClose stamps close fields and writes a close fill", async () => {
    const ok = await confirmFlashTailClose({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-close",
      receiveUsdEstimate: 1.24,
    });
    expect(ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("findOpenFlashTailBet returns the newest confirmed bet for market+side", async () => {
    const bet = await findOpenFlashTailBet({
      userId: "user-1",
      market: "SOL",
      side: "long",
    });
    expect(bet?.id).toBe("bet-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/bets/flash-tail.test.ts`
Expected: FAIL — cannot resolve `./flash-tail`.

- [ ] **Step 3: Write the implementation**

Create `lib/bets/flash-tail.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, fills } from "@/lib/db/schema";
import {
  parseFlashTailMeta,
  type FlashTailMeta,
} from "./flash-tail-meta";

export type FlashTailBet = {
  id: string;
  userId: string;
  status: string;
  amountUsdc: number;
  meta: FlashTailMeta;
};

function toFlashTailBet(row: typeof bets.$inferSelect): FlashTailBet | null {
  const meta = parseFlashTailMeta(row.meta);
  if (!meta) return null;
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    amountUsdc: row.amountUsdc,
    meta,
  };
}

export async function recordFlashTailOpen(args: {
  userId: string;
  stakeUsdc: number;
  meta: FlashTailMeta;
}): Promise<string> {
  const [row] = await db
    .insert(bets)
    .values({
      userId: args.userId,
      type: "flash-tail",
      amountUsdc: args.stakeUsdc,
      status: "pending",
      meta: args.meta,
    })
    .returning();
  if (!row) throw new Error("flash-tail bet insert failed");
  return row.id;
}

async function loadOwnedFlashTailBet(
  betId: string,
  userId: string,
): Promise<FlashTailBet | null> {
  const [row] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, betId), eq(bets.userId, userId), eq(bets.type, "flash-tail")))
    .limit(1);
  return row ? toFlashTailBet(row) : null;
}

export async function confirmFlashTailOpen(args: {
  betId: string;
  userId: string;
  signature: string;
}): Promise<boolean> {
  const bet = await loadOwnedFlashTailBet(args.betId, args.userId);
  if (!bet || bet.status !== "pending") return false;

  const nextMeta: FlashTailMeta = { ...bet.meta, openSignature: args.signature };
  await db
    .update(bets)
    .set({ status: "confirmed", txHash: args.signature, meta: nextMeta })
    .where(eq(bets.id, args.betId));

  await db
    .insert(fills)
    .values({
      betId: args.betId,
      action: "open",
      market: bet.meta.market,
      side: bet.meta.side,
      fillUsd: bet.meta.notionalUsd,
      priceUsd: bet.meta.entryPriceUsd,
      feeUsd: bet.meta.openFeeUsd,
      txSig: args.signature,
      source: "quote-estimate",
    })
    .onConflictDoNothing();
  return true;
}

export async function confirmFlashTailClose(args: {
  betId: string;
  userId: string;
  signature: string;
  receiveUsdEstimate: number | null;
}): Promise<boolean> {
  const bet = await loadOwnedFlashTailBet(args.betId, args.userId);
  if (!bet || bet.status !== "confirmed") return false;

  const nextMeta: FlashTailMeta = {
    ...bet.meta,
    closeSignature: args.signature,
    closeReason: "manual",
    proceedsSource: "quote-estimate",
  };
  await db
    .update(bets)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeTxHash: args.signature,
      proceedsUsdc: args.receiveUsdEstimate,
      meta: nextMeta,
    })
    .where(eq(bets.id, args.betId));

  await db
    .insert(fills)
    .values({
      betId: args.betId,
      action: "close",
      market: bet.meta.market,
      side: bet.meta.side,
      fillUsd: args.receiveUsdEstimate,
      priceUsd: null,
      feeUsd: null,
      txSig: args.signature,
      source: "quote-estimate",
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Newest confirmed flash-tail bet for (user, market, side). Flash holds one
 * position per (owner, market, side), so this maps a live on-chain position
 * back to the bet that opened it.
 */
export async function findOpenFlashTailBet(args: {
  userId: string;
  market: string;
  side: "long" | "short";
}): Promise<FlashTailBet | null> {
  const rows = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.userId, args.userId),
        eq(bets.type, "flash-tail"),
        eq(bets.status, "confirmed"),
        sql`${bets.meta} ->> 'market' = ${args.market}`,
        sql`${bets.meta} ->> 'side' = ${args.side}`,
      ),
    )
    .orderBy(desc(bets.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? toFlashTailBet(row) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/bets/flash-tail.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected PASS.

```bash
git add lib/bets/flash-tail.ts lib/bets/flash-tail.test.ts
git commit -m "feat(bets): flash-tail bet lifecycle db helpers"
```

---

### Task 4: `/api/flash/perp` accepts tail lineage and records the bet

**Files:**
- Modify: `app/api/flash/perp/route.ts`
- Test: `lib/flash/flash-perp-route.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `lib/flash/flash-perp-route.test.ts`, add to the hoisted mocks object (inside `vi.hoisted`):

```ts
  recordFlashTailOpen: vi.fn(),
  confirmFlashTailOpen: vi.fn(),
```

Add a module mock below the other `vi.mock` calls:

```ts
vi.mock("@/lib/bets/flash-tail", () => ({
  recordFlashTailOpen: mocks.recordFlashTailOpen,
  confirmFlashTailOpen: mocks.confirmFlashTailOpen,
}));
```

In `beforeEach`, add:

```ts
    mocks.recordFlashTailOpen.mockResolvedValue("bet-1");
    mocks.confirmFlashTailOpen.mockResolvedValue(true);
```

Add these tests inside the `describe` block:

```ts
  it("records a pending flash-tail bet when tail lineage is present", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
        tail: { sourceKind: "whale", whaleId: "whale-1", sourceName: "Big Whale" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordFlashTailOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        stakeUsdc: 1,
        meta: expect.objectContaining({
          sourceType: "flash-tail",
          whaleId: "whale-1",
          market: "SOL",
          side: "long",
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      phase: "sign",
      betId: "bet-1",
    });
  });

  it("does not touch the db when tail lineage is absent (Scalp path)", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordFlashTailOpen).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.betId).toBeUndefined();
  });

  it("records and immediately confirms a flash-tail bet on the instant path", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
        instant: true,
        tail: { sourceKind: "bot", botId: "pulse", sourceName: "Pulse" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordFlashTailOpen).toHaveBeenCalled();
    expect(mocks.confirmFlashTailOpen).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "instant-sig",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sent",
      betId: "bet-1",
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/flash/flash-perp-route.test.ts`
Expected: the 3 new tests FAIL (no `betId`, mocks uncalled); the existing tests still pass.

- [ ] **Step 3: Modify the route**

In `app/api/flash/perp/route.ts`:

Add imports after the `ensureUser` import (line 16):

```ts
import {
  buildFlashTailMeta,
  parseTailLineage,
} from "@/lib/bets/flash-tail-meta";
import {
  confirmFlashTailOpen,
  recordFlashTailOpen,
} from "@/lib/bets/flash-tail";
```

Extend the `Body` interface:

```ts
interface Body {
  market?: string;
  side?: FlashSide;
  stakeUsdc?: number;
  leverage?: number;
  walletAddress?: string;
  instant?: boolean;
  mode?: FlashTradeMode;
  tail?: unknown;
}
```

Replace the `try` block of `POST` (lines 150–197) with:

```ts
  const tailLineage = parseTailLineage(body.tail);

  try {
    const result = await getFlashPerpsService().open({
      trader: user.solanaPubkey,
      market,
      side: body.side,
      amountUsd: body.stakeUsdc,
      leverage: body.leverage,
      mode,
    });

    let betId: string | undefined;
    if (tailLineage) {
      betId = await recordFlashTailOpen({
        userId: user.id,
        stakeUsdc: body.stakeUsdc,
        meta: buildFlashTailMeta({
          lineage: tailLineage,
          market,
          side: body.side,
          leverage: body.leverage,
          mode,
          walletAddress: user.solanaPubkey,
          entryPriceUsd:
            result.quote.entryPriceUsd ?? result.position.entryPriceUsd ?? null,
          notionalUsd: result.quote.notionalUsd ?? result.position.sizeUsd ?? null,
          openFeeUsd: result.quote.feesUsd ?? null,
        }),
      });
    }

    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      if (betId) {
        await confirmFlashTailOpen({
          betId,
          userId: user.id,
          signature: sent.signature,
        });
      }
      return NextResponse.json({
        phase: "sent",
        venue: "flash",
        betId,
        signature: sent.signature,
        caip2: sent.caip2,
        quote: result.quote,
        position: result.position,
        trade: {
          market,
          side: body.side,
          stakeUsdc: body.stakeUsdc,
          leverage: body.leverage,
          mode,
        },
      });
    }
    return NextResponse.json({
      phase: "sign",
      venue: "flash",
      betId,
      transactionB64: result.transaction,
      quote: result.quote,
      position: result.position,
      trade: {
        market,
        side: body.side,
        stakeUsdc: body.stakeUsdc,
        leverage: body.leverage,
        mode,
      },
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
```

Note: `result.quote.entryPriceUsd` / `feesUsd` are optional on `FlashTxQuote` — the `?? null` chain above handles absence. The existing test's quote mock lacks them; that's fine.

- [ ] **Step 4: Run the full test file**

Run: `npx vitest run lib/flash/flash-perp-route.test.ts`
Expected: ALL tests pass (old + 3 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/flash/perp/route.ts lib/flash/flash-perp-route.test.ts
git commit -m "feat(api): flash perp open records flash-tail bets when lineage present"
```

---

### Task 5: Confirm routes (open + close postbacks)

**Files:**
- Create: `app/api/flash/perp/confirm/route.ts`
- Create: `app/api/flash/perp/close/confirm/route.ts`
- Test: `lib/bets/flash-tail-confirm-route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/bets/flash-tail-confirm-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  confirmFlashTailOpen: vi.fn(),
  confirmFlashTailClose: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));
vi.mock("@/lib/bets/flash-tail", () => ({
  confirmFlashTailOpen: mocks.confirmFlashTailOpen,
  confirmFlashTailClose: mocks.confirmFlashTailClose,
}));

import { POST as CONFIRM_OPEN } from "../../app/api/flash/perp/confirm/route";
import { POST as CONFIRM_CLOSE } from "../../app/api/flash/perp/close/confirm/route";

function postRequest(path: string, body: unknown) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

describe("flash-tail confirm routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: "wallet-1" });
    mocks.confirmFlashTailOpen.mockResolvedValue(true);
    mocks.confirmFlashTailClose.mockResolvedValue(true);
  });

  it("confirms an open", async () => {
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", {
        betId: "bet-1",
        signature: "sig-open",
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.confirmFlashTailOpen).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-open",
    });
  });

  it("rejects a confirm without betId or signature", async () => {
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", { betId: "bet-1" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.confirmFlashTailOpen).not.toHaveBeenCalled();
  });

  it("404s when the bet is not confirmable", async () => {
    mocks.confirmFlashTailOpen.mockResolvedValue(false);
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", {
        betId: "bet-x",
        signature: "sig",
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("confirms a close with the receive estimate", async () => {
    const response = await CONFIRM_CLOSE(
      postRequest("/api/flash/perp/close/confirm", {
        betId: "bet-1",
        signature: "sig-close",
        receiveUsd: 1.24,
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.confirmFlashTailClose).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-close",
      receiveUsdEstimate: 1.24,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/bets/flash-tail-confirm-route.test.ts`
Expected: FAIL — route modules don't exist.

- [ ] **Step 3: Create the open-confirm route**

Create `app/api/flash/perp/confirm/route.ts`:

```ts
import { NextResponse } from "next/server";
import { confirmFlashTailOpen } from "@/lib/bets/flash-tail";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  betId?: string;
  signature?: string;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.betId || !body.signature) {
    return NextResponse.json(
      { error: "betId and signature required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  const ok = await confirmFlashTailOpen({
    betId: body.betId,
    userId: user.id,
    signature: body.signature,
  });
  if (!ok) {
    return NextResponse.json({ error: "bet not confirmable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, betId: body.betId });
}
```

- [ ] **Step 4: Create the close-confirm route**

Create `app/api/flash/perp/close/confirm/route.ts`:

```ts
import { NextResponse } from "next/server";
import { confirmFlashTailClose } from "@/lib/bets/flash-tail";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  betId?: string;
  signature?: string;
  receiveUsd?: number;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.betId || !body.signature) {
    return NextResponse.json(
      { error: "betId and signature required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  const ok = await confirmFlashTailClose({
    betId: body.betId,
    userId: user.id,
    signature: body.signature,
    receiveUsdEstimate:
      typeof body.receiveUsd === "number" && Number.isFinite(body.receiveUsd)
        ? body.receiveUsd
        : null,
  });
  if (!ok) {
    return NextResponse.json({ error: "bet not closable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, betId: body.betId });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/bets/flash-tail-confirm-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/flash/perp/confirm/route.ts app/api/flash/perp/close/confirm/route.ts lib/bets/flash-tail-confirm-route.test.ts
git commit -m "feat(api): flash-tail open/close confirm postback routes"
```

---

### Task 6: Close route returns the betId

**Files:**
- Modify: `app/api/flash/perp/close/route.ts`
- Test: `lib/flash/flash-perp-route.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `lib/flash/flash-perp-route.test.ts`, add to hoisted mocks: `findOpenFlashTailBet: vi.fn(),` and extend the existing `vi.mock("@/lib/bets/flash-tail", ...)` factory (from Task 4) with `findOpenFlashTailBet: mocks.findOpenFlashTailBet,`. In `beforeEach` add `mocks.findOpenFlashTailBet.mockResolvedValue(null);`. Then add:

```ts
  it("returns the betId on close when an open flash-tail bet matches", async () => {
    mocks.findOpenFlashTailBet.mockResolvedValue({ id: "bet-1" });
    const response = await CLOSE(
      postRequest("/api/flash/perp/close", {
        market: "SOL",
        side: "short",
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.findOpenFlashTailBet).toHaveBeenCalledWith({
      userId: "user-1",
      market: "SOL",
      side: "short",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sign-close",
      betId: "bet-1",
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/flash/flash-perp-route.test.ts`
Expected: the new test FAILS (no betId in response).

- [ ] **Step 3: Modify the close route**

In `app/api/flash/perp/close/route.ts`, add the import after `ensureUser`:

```ts
import { findOpenFlashTailBet } from "@/lib/bets/flash-tail";
```

In `POST`, after the `ensureUser` block and before `try`, add:

```ts
  const tailBet = await findOpenFlashTailBet({
    userId: user.id,
    market,
    side: body.side,
  }).catch(() => null);
```

Add `betId: tailBet?.id,` to BOTH response payloads (the `phase: "sent-close"` object and the `phase: "sign-close"` object), directly under `venue: "flash",`.

Also, on the instant path, confirm the close immediately after `signAndSendPrivySolanaTransaction` succeeds — add the import `confirmFlashTailClose` from `@/lib/bets/flash-tail` and, inside `if (body.instant) { ... }` after `const sent = ...`:

```ts
      if (tailBet) {
        await confirmFlashTailClose({
          betId: tailBet.id,
          userId: user.id,
          signature: sent.signature,
          receiveUsdEstimate: result.quote.receiveUsd ?? null,
        });
      }
```

(Extend the Task-4 module mock with `confirmFlashTailClose: mocks.confirmFlashTailClose` — add that fn to hoisted mocks if not present, defaulting `mockResolvedValue(true)` in `beforeEach`.)

- [ ] **Step 4: Run the full test file**

Run: `npx vitest run lib/flash/flash-perp-route.test.ts`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/flash/perp/close/route.ts lib/flash/flash-perp-route.test.ts
git commit -m "feat(api): flash close resolves and returns the owning flash-tail betId"
```

---

### Task 7: TailModal sends lineage + confirms opens

**Files:**
- Modify: `components/tail/TailModal.tsx`

No unit test (vitest here is node-env, `.ts` only); verification is typecheck + the browser flow in Task 10.

- [ ] **Step 1: Add `betId` to FlashSignResponse**

In `components/tail/TailModal.tsx`, `interface FlashSignResponse` (line ~95): add `betId?: string;` directly under `venue: "flash";`.

- [ ] **Step 2: Send lineage in the request body**

In `requestTail` (line ~456), replace the `body` literal with:

```ts
        const body = {
          market: flashMarket,
          side: flashSide,
          stakeUsdc: effectiveStake,
          leverage: flashLeverage,
          mode: flashTradeModeForLeverage(flashMarket, flashLeverage) ?? "standard",
          walletAddress: wallet.address,
          tail:
            source.kind === "whale"
              ? {
                  sourceKind: "whale",
                  whaleId: source.whaleId,
                  sourceName: source.displayName,
                  sourcePositionId:
                    copyPosition?.sourcePositionId ?? source.sourcePositionId,
                }
              : {
                  sourceKind: "bot",
                  botId: source.botId,
                  sourceName: source.botName,
                  sourcePositionId: source.positionId ?? null,
                },
        };
```

- [ ] **Step 3: Post the confirm after the Flash sign+send**

In `openOne` (line ~550), replace the `if (first.phase === "sign") { ... }` block with:

```ts
        if (first.phase === "sign") {
          const signature = await signAndSendDeposit(
            first.transactionB64,
            "Signing Flash trade…",
          );
          if (first.betId) {
            await fetch("/api/flash/perp/confirm", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                betId: first.betId,
                signature,
                walletAddress: wallet.address,
              }),
            }).catch((err) =>
              console.warn("[tail] flash confirm postback failed:", err),
            );
          }
          setStatus("Opened on Flash");
          return flashSignResponseToOpen(first, signature, source);
        }
```

- [ ] **Step 4: Use the server betId in the success object**

In `flashSignResponseToOpen` (line ~180), change the `betId` line to:

```ts
    betId: response.betId ?? `flash:${signature}`,
```

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add components/tail/TailModal.tsx
git commit -m "feat(tail): send lineage to flash open and confirm persisted bets"
```

---

### Task 8: CopyRow confirms flash closes

**Files:**
- Modify: `components/portfolio/CopyRow.tsx`

- [ ] **Step 1: Return the signature from the close signer**

In `signAndSendFlashClose` (line ~138), after `await conn.confirmTransaction(signatureText, "confirmed");` add `return signatureText;` (the function becomes `Promise<string>`).

- [ ] **Step 2: Send market/side for tail rows and post the close confirm**

In `handleClose` (line ~158): flash rows must always send `market`/`side` (the close route derives the position from them), and tail-attributed rows then post the confirm. Replace the request-body expression so flash positions are never routed down the `{ betId }`-only branch:

```ts
          body: JSON.stringify(
            isFlashPosition
              ? {
                  market: row.market,
                  side: row.side,
                  walletAddress: wallet?.address,
                }
              : isWalletPosition
                ? {
                    market: row.market,
                    side: row.side,
                    walletAddress: wallet?.address,
                  }
                : { betId: row.betId, walletAddress: wallet?.address },
          ),
```

Then replace the `if (isFlashPosition) { ... }` block after the response check with:

```ts
      if (isFlashPosition) {
        if (typeof body.transactionB64 !== "string") {
          throw new Error("Flash close transaction missing");
        }
        const signature = await signAndSendFlashClose(body.transactionB64);
        const closeBetId =
          typeof body.betId === "string" ? body.betId : row.betId;
        if (closeBetId && !closeBetId.startsWith("flash:")) {
          await fetch("/api/flash/perp/close/confirm", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              betId: closeBetId,
              signature,
              receiveUsd:
                typeof body.quote?.receiveUsd === "number"
                  ? body.quote.receiveUsd
                  : null,
              walletAddress: wallet?.address,
            }),
          }).catch((err) =>
            console.warn("[copy] flash close confirm failed:", err),
          );
        }
      }
```

Note: `body` here is the close route's JSON (`{ transactionB64, quote, position, betId? }`); the guard on `flash:`-prefixed ids skips legacy client-only ids.

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint` — expected PASS.

```bash
git add components/portfolio/CopyRow.tsx
git commit -m "feat(portfolio): confirm flash-tail closes with realized signature"
```

---

### Task 9: Portfolio attributes live Flash positions to their bets

**Files:**
- Modify: `app/api/portfolio/route.ts`

- [ ] **Step 1: Accept an optional tail bet in `flashRowFromPosition`**

Add the import at the top of `app/api/portfolio/route.ts`:

```ts
import { parseFlashTailMeta } from "@/lib/bets/flash-tail-meta";
```

Change the signature of `flashRowFromPosition` (line ~95) to:

```ts
function flashRowFromPosition(
  p: FlashPositionSummary,
  pricedAt: string,
  tailBet?: { id: string; meta: ReturnType<typeof parseFlashTailMeta> } | null,
): PortfolioSnapshotPayload["copyRows"][number] {
```

and inside the returned object replace these fields:

```ts
    betId: tailBet?.id ?? null,
    venue: "flash" satisfies CopyVenue,
    sourceKind: (tailBet ? "tail" : "wallet") satisfies CopySourceKind,
```

and:

```ts
    whaleId: tailBet?.meta?.whaleId ?? null,
    whaleName:
      tailBet?.meta?.sourceKind === "whale"
        ? (tailBet.meta.sourceName ?? null)
        : null,
```

and:

```ts
    botId: tailBet?.meta?.botId ?? null,
    botName:
      tailBet?.meta?.sourceKind === "bot"
        ? (tailBet.meta.sourceName ?? null)
        : null,
```

(If `CopySourceKind` does not include `"tail"`, check its definition where `CopySourceKind` is declared — the Pacifica rows already use `"tail"` at the `sourceKind: "tail"` call site in this file, so the union already has it.)

- [ ] **Step 2: Build the lookup map and pass matches at the call site**

Find the call site that maps `flashPositions` through `flashRowFromPosition` (search for `flashRowFromPosition(` — it appears once in a `.map(...)` around line 419). Directly before that statement, add:

```ts
  const flashTailByKey = new Map<
    string,
    { id: string; meta: ReturnType<typeof parseFlashTailMeta> }
  >();
  for (const b of userBets) {
    if (b.type !== "flash-tail" || b.status !== "confirmed") continue;
    const meta = parseFlashTailMeta(b.meta);
    if (!meta) continue;
    const key = positionKey(meta.market, meta.side);
    if (!flashTailByKey.has(key)) flashTailByKey.set(key, { id: b.id, meta });
  }
```

and change the map call to:

```ts
flashRowFromPosition(p, pricedAt, flashTailByKey.get(positionKey(p.symbol, p.side)) ?? null)
```

- [ ] **Step 3: Keep flash-tail bets out of the legacy enrichment**

Find `const positions = await Promise.all(userBets.map((bet) => enrichBet(bet, user.solanaPubkey)));` (line ~198) and change it to:

```ts
  const legacyBets = userBets.filter((b) => b.type !== "flash-tail");
  const positions = await Promise.all(
    legacyBets.map((bet) => enrichBet(bet, user.solanaPubkey)),
  );
```

- [ ] **Step 4: Typecheck, lint, full tests, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

```bash
git add app/api/portfolio/route.ts
git commit -m "feat(portfolio): attribute live flash positions to flash-tail bets"
```

---

### Task 10: Browser verification of the whole loop

No code. Run the flow against dev and verify rows.

- [ ] **Step 1: Start dev + open a tiny tail**

Run `npm run dev`, open `localhost:3000/feed`, tail any whale position with a $1 stake (standard leverage). Complete the signing flow.

- [ ] **Step 2: Verify persistence**

Run: `npm run db:studio`, open `bets` — expect a `flash-tail` row, `status: confirmed`, `txHash` = the open signature, meta carrying `whaleId`/`market`/`side`. Open `fills` — expect one `open` row, `source: quote-estimate`.

- [ ] **Step 3: Verify portfolio attribution + reload survival**

Open `/portfolio`: the Flash row must show the whale name (not bare "Flash") — then RELOAD the page and confirm it still does (this is the amnesia bug fix).

- [ ] **Step 4: Close and verify**

Close the position from the portfolio. Expect in `bets`: `status: closed`, `closeTxHash`, `proceedsUsdc` ≈ the close quote. Expect a second `fills` row (`action: close`).

- [ ] **Step 5: Commit nothing — record findings**

If any step fails, fix forward before Task 11 (the reconcile sweep depends on these rows existing).

---

### Task 11: Reconciliation sweep

**Files:**
- Create: `lib/bets/flash-reconcile.ts`
- Test: `lib/bets/flash-reconcile.test.ts`

Pure logic (`usdcDeltaForOwner`) tested with fixtures; the sweep takes injectable deps so the test never touches a real RPC or db.

- [ ] **Step 1: Write the failing test**

Create `lib/bets/flash-reconcile.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runFlashReconcileSweep, usdcDeltaForOwner } from "./flash-reconcile";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function txMeta(owner: string, preUi: number, postUi: number) {
  return {
    err: null,
    preTokenBalances: [
      {
        owner,
        mint: USDC,
        uiTokenAmount: { uiAmount: preUi },
      },
    ],
    postTokenBalances: [
      {
        owner,
        mint: USDC,
        uiTokenAmount: { uiAmount: postUi },
      },
    ],
  };
}

describe("usdcDeltaForOwner", () => {
  it("computes the owner's USDC delta", () => {
    expect(usdcDeltaForOwner(txMeta("w1", 10, 11.24), "w1")).toBeCloseTo(1.24);
    expect(usdcDeltaForOwner(txMeta("w1", 10, 8.99), "w1")).toBeCloseTo(-1.01);
  });

  it("ignores other owners and other mints", () => {
    expect(usdcDeltaForOwner(txMeta("other", 10, 20), "w1")).toBeNull();
    const meta = txMeta("w1", 10, 20);
    meta.preTokenBalances[0].mint = "SomeOtherMint";
    meta.postTokenBalances[0].mint = "SomeOtherMint";
    expect(usdcDeltaForOwner(meta, "w1")).toBeNull();
  });
});

describe("runFlashReconcileSweep", () => {
  it("upgrades a quote-estimate close to chain truth", async () => {
    const bet = {
      id: "bet-1",
      userId: "user-1",
      status: "closed",
      amountUsdc: 1,
      meta: {
        sourceType: "flash-tail",
        venue: "flash",
        sourceKind: "whale",
        whaleId: "whale-1",
        botId: null,
        sourceName: "Big Whale",
        sourcePositionId: "pos-1",
        market: "SOL",
        side: "long",
        leverage: 20,
        mode: "standard",
        walletAddress: "w1",
        entryPriceUsd: 160,
        notionalUsd: 20,
        openFeeUsd: 0.01,
        openSignature: "sig-open",
        closeSignature: "sig-close",
        closeReason: "manual",
        proceedsSource: "quote-estimate",
        reconciledAt: null,
      },
    };
    const deps = {
      listBetsToReconcile: vi.fn().mockResolvedValue([bet]),
      reapStalePending: vi.fn().mockResolvedValue(0),
      getTx: vi.fn().mockResolvedValue({ meta: txMeta("w1", 10, 11.24) }),
      applyChainTruth: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-06-11T12:00:00Z"),
    };

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.getTx).toHaveBeenCalledWith("sig-close");
    expect(deps.applyChainTruth).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: "bet-1",
        action: "close",
        txSig: "sig-close",
        usdcDelta: expect.closeTo(1.24, 5),
        txFailed: false,
      }),
    );
    expect(result.checked).toBe(1);
  });

  it("flags an on-chain-failed tx instead of writing proceeds", async () => {
    const deps = {
      listBetsToReconcile: vi.fn().mockResolvedValue([
        {
          id: "bet-2",
          userId: "user-1",
          status: "confirmed",
          amountUsdc: 1,
          meta: {
            sourceType: "flash-tail",
            venue: "flash",
            sourceKind: "bot",
            whaleId: null,
            botId: "pulse",
            sourceName: "Pulse",
            sourcePositionId: null,
            market: "SOL",
            side: "long",
            leverage: 20,
            mode: "standard",
            walletAddress: "w1",
            entryPriceUsd: 160,
            notionalUsd: 20,
            openFeeUsd: 0.01,
            openSignature: "sig-open",
            closeSignature: null,
            closeReason: null,
            proceedsSource: null,
            reconciledAt: null,
          },
        },
      ]),
      reapStalePending: vi.fn().mockResolvedValue(0),
      getTx: vi.fn().mockResolvedValue({ meta: { err: { custom: 1 } } }),
      applyChainTruth: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-06-11T12:00:00Z"),
    };

    await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.applyChainTruth).toHaveBeenCalledWith(
      expect.objectContaining({ betId: "bet-2", action: "open", txFailed: true }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/bets/flash-reconcile.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

Create `lib/bets/flash-reconcile.ts`:

```ts
import { and, eq, lt, or, sql } from "drizzle-orm";
import { Connection } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, fills } from "@/lib/db/schema";
import {
  parseFlashTailMeta,
  type FlashTailMeta,
} from "./flash-tail-meta";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STALE_PENDING_MS = 5 * 60_000;
const BATCH = 10;

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

type TokenBalance = {
  owner?: string;
  mint?: string;
  uiTokenAmount?: { uiAmount?: number | null };
};

type TxMetaLike = {
  err: unknown;
  preTokenBalances?: TokenBalance[] | null;
  postTokenBalances?: TokenBalance[] | null;
};

/** USDC balance change for `owner` across a parsed tx. Null = owner had no USDC account in the tx. */
export function usdcDeltaForOwner(
  meta: TxMetaLike,
  owner: string,
): number | null {
  const sum = (balances: TokenBalance[] | null | undefined) => {
    let total: number | null = null;
    for (const b of balances ?? []) {
      if (b.owner !== owner || b.mint !== USDC_MINT) continue;
      total = (total ?? 0) + (b.uiTokenAmount?.uiAmount ?? 0);
    }
    return total;
  };
  const pre = sum(meta.preTokenBalances);
  const post = sum(meta.postTokenBalances);
  if (pre === null && post === null) return null;
  return (post ?? 0) - (pre ?? 0);
}

type ReconcileBet = {
  id: string;
  userId: string;
  status: string;
  amountUsdc: number;
  meta: FlashTailMeta;
};

type ChainTruth = {
  betId: string;
  action: "open" | "close";
  txSig: string;
  usdcDelta: number | null;
  txFailed: boolean;
  meta: FlashTailMeta;
  nowIso: string;
};

export type ReconcileDeps = {
  listBetsToReconcile: () => Promise<ReconcileBet[]>;
  reapStalePending: () => Promise<number>;
  getTx: (sig: string) => Promise<{ meta: TxMetaLike | null } | null>;
  applyChainTruth: (truth: ChainTruth) => Promise<void>;
  now: () => Date;
};

function defaultDeps(): ReconcileDeps {
  const conn = new Connection(RPC, "confirmed");
  return {
    async listBetsToReconcile() {
      const rows = await db
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.type, "flash-tail"),
            or(
              // closes still on the quote estimate
              and(
                eq(bets.status, "closed"),
                sql`${bets.meta} ->> 'proceedsSource' = 'quote-estimate'`,
              ),
              // opens never chain-verified
              and(
                eq(bets.status, "confirmed"),
                sql`${bets.meta} ->> 'reconciledAt' IS NULL`,
              ),
            ),
          ),
        )
        .limit(BATCH);
      const out: ReconcileBet[] = [];
      for (const row of rows) {
        const meta = parseFlashTailMeta(row.meta);
        if (!meta) continue;
        out.push({
          id: row.id,
          userId: row.userId,
          status: row.status,
          amountUsdc: row.amountUsdc,
          meta,
        });
      }
      return out;
    },
    async reapStalePending() {
      const cutoff = new Date(Date.now() - STALE_PENDING_MS);
      const reaped = await db
        .update(bets)
        .set({ status: "abandoned" })
        .where(
          and(
            eq(bets.type, "flash-tail"),
            eq(bets.status, "pending"),
            lt(bets.createdAt, cutoff),
          ),
        )
        .returning();
      return reaped.length;
    },
    async getTx(sig: string) {
      const tx = await conn.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      return tx ? { meta: tx.meta } : null;
    },
    async applyChainTruth(truth: ChainTruth) {
      if (truth.txFailed) {
        if (truth.action === "open") {
          // open never landed → bet is dead
          await db
            .update(bets)
            .set({
              status: "failed",
              meta: { ...truth.meta, reconciledAt: truth.nowIso },
            })
            .where(eq(bets.id, truth.betId));
        } else {
          // close tx failed → the position is still open
          await db
            .update(bets)
            .set({
              status: "confirmed",
              closedAt: null,
              closeTxHash: null,
              proceedsUsdc: null,
              meta: {
                ...truth.meta,
                closeSignature: null,
                closeReason: null,
                proceedsSource: null,
              },
            })
            .where(eq(bets.id, truth.betId));
        }
        return;
      }

      if (truth.action === "close") {
        await db
          .update(bets)
          .set({
            proceedsUsdc: truth.usdcDelta,
            meta: {
              ...truth.meta,
              proceedsSource: "chain",
              reconciledAt: truth.nowIso,
            },
          })
          .where(eq(bets.id, truth.betId));
      } else {
        await db
          .update(bets)
          .set({ meta: { ...truth.meta, reconciledAt: truth.nowIso } })
          .where(eq(bets.id, truth.betId));
      }

      await db
        .update(fills)
        .set({
          fillUsd: truth.usdcDelta === null ? null : Math.abs(truth.usdcDelta),
          source: "chain",
        })
        .where(
          and(eq(fills.txSig, truth.txSig), eq(fills.action, truth.action)),
        );
    },
    now: () => new Date(),
  };
}

export async function runFlashReconcileSweep(args?: {
  timeBoxMs?: number;
  deps?: ReconcileDeps;
}): Promise<{ checked: number; reaped: number }> {
  const timeBoxMs = args?.timeBoxMs ?? 10_000;
  const deps = args?.deps ?? defaultDeps();
  const deadline = Date.now() + timeBoxMs;
  const nowIso = deps.now().toISOString();

  const reaped = await deps.reapStalePending();

  let checked = 0;
  const candidates = await deps.listBetsToReconcile();
  for (const bet of candidates) {
    if (Date.now() > deadline) break;

    const isClose =
      bet.status === "closed" && bet.meta.proceedsSource === "quote-estimate";
    const action: "open" | "close" = isClose ? "close" : "open";
    const sig = isClose ? bet.meta.closeSignature : bet.meta.openSignature;
    if (!sig) continue;

    let tx: { meta: TxMetaLike | null } | null = null;
    try {
      tx = await deps.getTx(sig);
    } catch (err) {
      console.warn("[flash-reconcile] getTransaction failed:", err);
      continue;
    }
    if (!tx?.meta) continue; // not yet visible; retry next sweep

    checked += 1;
    const txFailed = tx.meta.err != null;
    await deps.applyChainTruth({
      betId: bet.id,
      action,
      txSig: sig,
      usdcDelta: txFailed
        ? null
        : usdcDeltaForOwner(tx.meta, bet.meta.walletAddress),
      txFailed,
      meta: bet.meta,
      nowIso,
    });
  }

  return { checked, reaped };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/bets/flash-reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected PASS.

```bash
git add lib/bets/flash-reconcile.ts lib/bets/flash-reconcile.test.ts
git commit -m "feat(bets): flash reconcile sweep — chain-verified fills + stale reaping"
```

---

### Task 12: Wire the sweep into the whale ticker

**Files:**
- Modify: `lib/whales/ticker.ts`

The whale ticker is the existing lease-guarded ~60s loop; the sweep rides it (no new loop, no extra Neon wake-ups).

- [ ] **Step 1: Add the dep**

In `lib/whales/ticker.ts`:

Extend `WhaleTickerDeps` (line ~11):

```ts
type WhaleTickerDeps = {
  refreshWhales: typeof import("./refresh").refreshWhales;
  acquireWhaleTickerLease: typeof import("./ticker-lease").acquireWhaleTickerLease;
  ensureWhaleLeaseTable: typeof import("./ticker-lease").ensureWhaleLeaseTable;
  startWhaleSourceMonitor: typeof import("./source-monitor").startWhaleSourceMonitor;
  runFlashReconcileSweep: typeof import("../bets/flash-reconcile").runFlashReconcileSweep;
};
```

In `loadWhaleTickerDeps()` (line ~100), add `import("../bets/flash-reconcile")` to the `Promise.all` array and map it:

```ts
function loadWhaleTickerDeps(): Promise<WhaleTickerDeps> {
  depsPromise ??= Promise.all([
    import("./refresh"),
    import("./ticker-lease"),
    import("./source-monitor"),
    import("../bets/flash-reconcile"),
  ]).then(([refresh, lease, sourceMonitor, flashReconcile]) => ({
    refreshWhales: refresh.refreshWhales,
    acquireWhaleTickerLease: lease.acquireWhaleTickerLease,
    ensureWhaleLeaseTable: lease.ensureWhaleLeaseTable,
    startWhaleSourceMonitor: sourceMonitor.startWhaleSourceMonitor,
    runFlashReconcileSweep: flashReconcile.runFlashReconcileSweep,
  }));
  return depsPromise;
}
```

- [ ] **Step 2: Call it after the refresh**

In `loop()`, destructure `runFlashReconcileSweep` alongside the other deps (line ~38), then inside the holder branch after the `refreshWhales` try/catch (line ~95) and before `await sleep(REFRESH_GAP_MS);`, add:

```ts
    try {
      const sweep = await runFlashReconcileSweep({ timeBoxMs: 10_000 });
      if (sweep.checked > 0 || sweep.reaped > 0) {
        console.log(
          `[whales] flash reconcile: ${sweep.checked} checked, ${sweep.reaped} reaped`,
        );
      }
    } catch (err) {
      console.error("[whales] flash reconcile failed:", err);
    }
```

- [ ] **Step 3: Typecheck, full test run, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS everywhere.

```bash
git add lib/whales/ticker.ts
git commit -m "feat(whales): run flash reconcile sweep on the ticker tick"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 2: End-to-end re-check in the browser**

Repeat Task 10's flow once more (tail → reload → close). Additionally, within ~2 minutes of closing, check `bets` in db:studio: `meta.proceedsSource` should flip from `quote-estimate` to `chain` and `proceedsUsdc` should become the actual on-chain USDC delta (the ticker sweep did it). The `fills` close row should show `source: chain`.

- [ ] **Step 3: Update the architecture doc**

Add to `docs/architecture.md` (in the API routes / bet lifecycle area): flash-tail bets persist via `/api/flash/perp` (+`/confirm`, `/close/confirm`), `fills` table tracks per-fill truth, the whale ticker runs `runFlashReconcileSweep`. Keep it to one short paragraph.

```bash
git add docs/architecture.md
git commit -m "docs: record flash-tail persistence + reconcile in architecture map"
```
