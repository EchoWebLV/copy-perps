# Ostium Whale Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only **Ostium** (RWA perp DEX) whale source so the tape shows real whale positions in gold, silver, oil, FX, equities, S&P, and HYPE — markets the crypto-only Hyperliquid/Pacifica sources can't cover.

**Architecture:** A new source that mirrors the existing per-source pattern (`*-source.ts` mapper + `refresh-*.ts` pipeline) and plugs into `refreshWhales()`. Discovery is **per-market top-N** via one aliased query against Ostium's public Ormi subgraph; positions are written to the same `whales`/`whale_positions` tables and live-cache snapshot the tape already reads. Non-tailable markets render "Watch only" (already supported).

**Tech Stack:** TypeScript (strict), Drizzle/Neon, vitest, `fetch()` GraphQL (no Python SDK).

**Spec:** `docs/superpowers/specs/2026-06-02-ostium-whale-source-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/whales/types.ts` (modify) | Add `"ostium"` to `WhaleSource`. |
| `lib/whales/ostium-markets.ts` (create) | Subgraph URL, authoritative Ostium `pairId → Flash symbol` table, mapped-id list, resolver. |
| `lib/whales/ostium-source.ts` (create) | `OstiumRawTrade` type, `mapOstiumTrade()` pure mapper, `ostiumDisplayName()`, scaling. |
| `lib/whales/ostium-subgraph.ts` (create) | `buildDiscoverQuery()` (pure), `parseDiscoverResponse()` (pure), `fetchOstiumTopTradesByMarket()` (fetch). |
| `lib/whales/refresh-ostium.ts` (create) | `refreshOstiumWhales()` — fetch → map → upsert → close-missing → snapshot. |
| `lib/whales/refresh.ts` (modify) | Add the Ostium arm to the `Promise.allSettled` fan-out. |
| `scripts/refresh-ostium.ts` (create) | Manual runner; `package.json` gets `refresh:ostium`. |

Tests live beside each module (`*.test.ts`), matching the repo convention.

---

### Task 1: Add `"ostium"` to the `WhaleSource` union

**Files:**
- Modify: `lib/whales/types.ts:1`

- [ ] **Step 1: Edit the union**

Change line 1 of `lib/whales/types.ts` from:

```ts
export type WhaleSource = "pacifica" | "hyperliquid";
```

to:

```ts
export type WhaleSource = "pacifica" | "hyperliquid" | "ostium";
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add lib/whales/types.ts
git commit -m "feat(whales): add ostium to WhaleSource union"
```

---

### Task 2: Ostium markets map (pairId → Flash symbol)

**Files:**
- Create: `lib/whales/ostium-markets.ts`
- Test: `lib/whales/ostium-markets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/whales/ostium-markets.test.ts
import { describe, expect, it } from "vitest";
import {
  OSTIUM_MAPPED_PAIR_IDS,
  ostiumPairToFlashSymbol,
} from "./ostium-markets";

describe("ostium-markets", () => {
  it("maps Ostium pair ids to Flash symbols", () => {
    expect(ostiumPairToFlashSymbol("5")).toBe("XAU"); // gold
    expect(ostiumPairToFlashSymbol("7")).toBe("CRUDEOIL"); // CL -> CRUDEOIL
    expect(ostiumPairToFlashSymbol("2")).toBe("EUR");
    expect(ostiumPairToFlashSymbol("4")).toBe("USDJPY"); // USD/JPY
    expect(ostiumPairToFlashSymbol("10")).toBe("SPY"); // SPX -> SPY
    expect(ostiumPairToFlashSymbol("18")).toBe("NVDA");
    expect(ostiumPairToFlashSymbol("41")).toBe("HYPE");
  });

  it("returns null for unmapped pairs", () => {
    expect(ostiumPairToFlashSymbol("16")).toBeNull(); // USD/CAD - not a Flash market
    expect(ostiumPairToFlashSymbol("999")).toBeNull();
  });

  it("exposes exactly the 17 mapped pair ids", () => {
    expect(OSTIUM_MAPPED_PAIR_IDS).toHaveLength(17);
    expect(new Set(OSTIUM_MAPPED_PAIR_IDS).size).toBe(17);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/whales/ostium-markets.test.ts`
Expected: FAIL — cannot find module `./ostium-markets`.

- [ ] **Step 3: Implement the module**

```ts
// lib/whales/ostium-markets.ts
import type { FlashMarketSymbol } from "@/lib/flash/markets";

/**
 * Ostium's public Ormi subgraph (Arbitrum mainnet). The API key is part of the
 * public URL — no auth header. Override via env if Ostium rotates it.
 */
export const OSTIUM_SUBGRAPH_URL =
  process.env.OSTIUM_SUBGRAPH_URL ??
  "https://api.subgraph.ormilabs.com/api/public/67a599d5-c8d2-4cc4-9c4d-2975a97bc5d8/subgraphs/ost-prod/live/gn";

/**
 * Authoritative Ostium pairId -> Flash symbol map. Enumerated live from the
 * subgraph `pairs` query on 2026-06-02. We store the *Flash* symbol as the
 * position market so isFlashCopyableMarket and card headlines work unchanged.
 * Only pairs that map to one of the 31 Flash markets are included (focused
 * scope); crypto majors are included because the Ostium wallets are distinct
 * from HL/Pacifica and add HYPE/BNB density.
 */
const OSTIUM_PAIR_TO_FLASH: Record<string, FlashMarketSymbol> = {
  // commodities
  "5": "XAU", // XAU/USD gold
  "8": "XAG", // XAG/USD silver
  "7": "CRUDEOIL", // CL/USD WTI crude
  // forex
  "2": "EUR", // EUR/USD
  "3": "GBP", // GBP/USD
  "4": "USDJPY", // USD/JPY
  // index
  "10": "SPY", // SPX/USD -> S&P 500
  // stocks
  "18": "NVDA",
  "20": "AMZN",
  "22": "TSLA",
  "23": "AAPL",
  "45": "AMD",
  // crypto majors (distinct wallets; HYPE/BNB density)
  "0": "BTC",
  "1": "ETH",
  "9": "SOL",
  "38": "BNB",
  "41": "HYPE",
};

export const OSTIUM_MAPPED_PAIR_IDS = Object.keys(OSTIUM_PAIR_TO_FLASH);

export function ostiumPairToFlashSymbol(
  pairId: string,
): FlashMarketSymbol | null {
  return OSTIUM_PAIR_TO_FLASH[pairId] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/whales/ostium-markets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whales/ostium-markets.ts lib/whales/ostium-markets.test.ts
git commit -m "feat(whales): Ostium pairId -> Flash symbol map"
```

---

### Task 3: Ostium position mapper

**Files:**
- Create: `lib/whales/ostium-source.ts`
- Test: `lib/whales/ostium-source.test.ts`

The golden fixture is the real top trade from the live probe (EUR/USD long, $1.167M notional).

- [ ] **Step 1: Write the failing test**

```ts
// lib/whales/ostium-source.test.ts
import { describe, expect, it } from "vitest";
import {
  InvalidOstiumTradeError,
  mapOstiumTrade,
  ostiumDisplayName,
  type OstiumRawTrade,
} from "./ostium-source";

const NOW = new Date("2026-06-02T00:00:00.000Z");

function trade(overrides: Partial<OstiumRawTrade> = {}): OstiumRawTrade {
  return {
    tradeID: "663595",
    trader: "0xb5fb748ec3e019a7ed4f6f701158bc23fa3a2626",
    collateral: "66434263231", // /1e6 = $66,434.26
    leverage: "1757",
    notional: "1167250004997", // /1e6 = $1,167,250
    openPrice: "1151799999999999872", // /1e18 = 1.1518
    isBuy: true,
    isOpen: true,
    timestamp: "1762169223", // 2025-11-03
    index: "1",
    pair: {
      id: "2",
      from: "EUR",
      to: "USD",
      lastTradePrice: "1164450000000000000", // /1e18 = 1.16445
    },
    ...overrides,
  };
}

describe("mapOstiumTrade", () => {
  it("maps the golden EUR/USD trade with correct scaling", () => {
    const r = mapOstiumTrade({ trade: trade(), now: NOW });
    expect(r.source).toBe("ostium");
    expect(r.market).toBe("EUR");
    expect(r.side).toBe("long");
    expect(r.sourceAccount).toBe(
      "0xb5fb748ec3e019a7ed4f6f701158bc23fa3a2626",
    );
    expect(r.entryPrice).toBeCloseTo(1.1518, 4);
    expect(r.currentMark).toBeCloseTo(1.16445, 5);
    expect(r.notionalUsd).toBeCloseTo(1167250.004997, 2);
    expect(r.leverage).toBe(18); // round(1167250/66434 = 17.57)
    expect(r.amountBase).toBeCloseTo(1167250.004997 / 1.1518, 1);
    expect(r.status).toBe("open");
    expect(r.openedAt.getTime()).toBe(1762169223 * 1000);
    expect(r.lastSeenAt).toEqual(NOW);
    // long, mark above entry -> positive PnL; ~ (1.16445/1.1518 - 1)*17.57*100
    expect(r.unrealizedPnlPct).not.toBeNull();
    expect(r.unrealizedPnlPct!).toBeGreaterThan(0);
  });

  it("derives leverage from notional/collateral, not the raw field", () => {
    // leverage field deliberately wrong; ratio is the source of truth
    const r = mapOstiumTrade({ trade: trade({ leverage: "999999" }), now: NOW });
    expect(r.leverage).toBe(18);
  });

  it("maps a short with negative PnL when mark moved against it", () => {
    const r = mapOstiumTrade({
      trade: trade({
        isBuy: false,
        pair: {
          id: "2",
          from: "EUR",
          to: "USD",
          lastTradePrice: "1200000000000000000", // 1.20 > entry 1.1518 -> short loses
        },
      }),
      now: NOW,
    });
    expect(r.side).toBe("short");
    expect(r.unrealizedPnlPct!).toBeLessThan(0);
  });

  it("returns null mark and PnL when lastTradePrice is zero/missing", () => {
    const r = mapOstiumTrade({
      trade: trade({
        pair: { id: "2", from: "EUR", to: "USD", lastTradePrice: "0" },
      }),
      now: NOW,
    });
    expect(r.currentMark).toBeNull();
    expect(r.unrealizedPnlPct).toBeNull();
  });

  it("throws InvalidOstiumTradeError for an unmapped pair", () => {
    expect(() =>
      mapOstiumTrade({
        trade: trade({
          pair: { id: "16", from: "USD", to: "CAD", lastTradePrice: "1" },
        }),
        now: NOW,
      }),
    ).toThrow(InvalidOstiumTradeError);
  });

  it("throws for a non-positive entry price", () => {
    expect(() =>
      mapOstiumTrade({ trade: trade({ openPrice: "0" }), now: NOW }),
    ).toThrow(InvalidOstiumTradeError);
  });
});

describe("ostiumDisplayName", () => {
  it("formats a short OST handle", () => {
    expect(ostiumDisplayName("0xb5fb748ec3e019a7ed4f6f701158bc23fa3a2626")).toBe(
      "OST 0xb5fb…2626",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/whales/ostium-source.test.ts`
Expected: FAIL — cannot find module `./ostium-source`.

- [ ] **Step 3: Implement the mapper**

```ts
// lib/whales/ostium-source.ts
import { ostiumPairToFlashSymbol } from "./ostium-markets";
import { makeWhaleId } from "./identity";
import type { WhalePositionRecord, WhaleSide } from "./types";

const PRICE_SCALE = 1e18; // openPrice, lastTradePrice
const USD_SCALE = 1e6; // collateral, notional (USDC 6dp)

export class InvalidOstiumTradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOstiumTradeError";
  }
}

export interface OstiumRawTrade {
  tradeID: string;
  trader: string;
  collateral: string;
  leverage: string;
  notional: string;
  openPrice: string;
  isBuy: boolean;
  isOpen: boolean;
  timestamp: string;
  index: string;
  pair: {
    id: string;
    from: string;
    to: string;
    lastTradePrice: string | null;
  };
}

export function ostiumDisplayName(account: string): string {
  if (account.length <= 10) return `OST ${account}`;
  return `OST ${account.slice(0, 6)}…${account.slice(-4)}`;
}

function finitePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidOstiumTradeError(`Invalid Ostium trade ${field}`);
  }
  return value;
}

export function mapOstiumTrade(args: {
  trade: OstiumRawTrade;
  now?: Date;
}): WhalePositionRecord {
  const { trade } = args;
  const market = ostiumPairToFlashSymbol(trade.pair.id);
  if (market === null) {
    throw new InvalidOstiumTradeError(`Unmapped Ostium pair ${trade.pair.id}`);
  }

  const sourceAccount = trade.trader.toLowerCase();
  const side: WhaleSide = trade.isBuy ? "long" : "short";
  const entryPrice = finitePositive(
    Number(trade.openPrice) / PRICE_SCALE,
    "openPrice",
  );
  const notionalUsd = finitePositive(
    Number(trade.notional) / USD_SCALE,
    "notional",
  );
  const collateralUsd = Number(trade.collateral) / USD_SCALE;
  const leverageRaw =
    Number.isFinite(collateralUsd) && collateralUsd > 0
      ? notionalUsd / collateralUsd
      : Number(trade.leverage) / 100;
  const leverage = Math.max(1, Math.round(leverageRaw));
  const amountBase = notionalUsd / entryPrice;

  const markRaw = Number(trade.pair.lastTradePrice) / PRICE_SCALE;
  const currentMark =
    Number.isFinite(markRaw) && markRaw > 0 ? markRaw : null;
  const directional =
    currentMark === null
      ? null
      : side === "long"
        ? currentMark - entryPrice
        : entryPrice - currentMark;
  const unrealizedPnlPct =
    directional === null
      ? null
      : (directional / entryPrice) * leverageRaw * 100;

  const openedAtMs = Number(trade.timestamp) * 1000;
  if (!Number.isFinite(openedAtMs) || openedAtMs <= 0) {
    throw new InvalidOstiumTradeError("Invalid Ostium trade timestamp");
  }
  const now = args.now ?? new Date();

  return {
    id: `ostium:${sourceAccount}:${market}:${side}:${trade.tradeID}`,
    whaleId: makeWhaleId("ostium", sourceAccount),
    source: "ostium",
    sourceAccount,
    market,
    side,
    leverage,
    amountBase,
    notionalUsd,
    entryPrice,
    currentMark,
    unrealizedPnlPct,
    openedAt: new Date(openedAtMs),
    closedAt: null,
    status: "open",
    raw: {
      ...trade,
      flashSymbol: market,
      ostiumPairId: trade.pair.id,
    } as unknown as Record<string, unknown>,
    lastSeenAt: now,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/whales/ostium-source.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/whales/ostium-source.ts lib/whales/ostium-source.test.ts
git commit -m "feat(whales): Ostium trade -> WhalePositionRecord mapper"
```

---

### Task 4: Ostium subgraph query (build + parse + fetch)

**Files:**
- Create: `lib/whales/ostium-subgraph.ts`
- Test: `lib/whales/ostium-subgraph.test.ts`

Split into pure `buildDiscoverQuery` / `parseDiscoverResponse` (unit-tested) and the thin `fetchOstiumTopTradesByMarket` wrapper (network, not unit-tested here).

- [ ] **Step 1: Write the failing test**

```ts
// lib/whales/ostium-subgraph.test.ts
import { describe, expect, it } from "vitest";
import {
  buildDiscoverQuery,
  parseDiscoverResponse,
} from "./ostium-subgraph";

describe("buildDiscoverQuery", () => {
  it("emits one aliased trades sub-query per pair id", () => {
    const q = buildDiscoverQuery(["2", "5"], 15);
    expect(q).toContain('p2: trades(');
    expect(q).toContain('p5: trades(');
    expect(q).toContain("first: 15");
    expect(q).toContain('where: { isOpen: true, pair: "2" }');
    expect(q).toContain("orderBy: tradeNotional");
    expect(q).toContain("lastTradePrice");
  });
});

describe("parseDiscoverResponse", () => {
  it("flattens every alias bucket into one trade array", () => {
    const json = {
      data: {
        p2: [{ tradeID: "1" }, { tradeID: "2" }],
        p5: [{ tradeID: "3" }],
      },
    };
    const out = parseDiscoverResponse(json, ["2", "5"]);
    expect(out.map((t) => t.tradeID)).toEqual(["1", "2", "3"]);
  });

  it("tolerates missing/empty buckets", () => {
    const out = parseDiscoverResponse({ data: { p2: null } }, ["2", "5"]);
    expect(out).toEqual([]);
  });

  it("throws when the response carries GraphQL errors", () => {
    expect(() =>
      parseDiscoverResponse({ errors: [{ message: "boom" }] }, ["2"]),
    ).toThrow(/Ostium subgraph/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/whales/ostium-subgraph.test.ts`
Expected: FAIL — cannot find module `./ostium-subgraph`.

- [ ] **Step 3: Implement the subgraph client**

```ts
// lib/whales/ostium-subgraph.ts
import { OSTIUM_SUBGRAPH_URL } from "./ostium-markets";
import type { OstiumRawTrade } from "./ostium-source";

const TRADE_FIELDS = `
    tradeID
    trader
    collateral
    leverage
    notional
    openPrice
    isBuy
    isOpen
    timestamp
    index
    pair { id from to lastTradePrice }`;

export function buildDiscoverQuery(
  pairIds: string[],
  perMarket: number,
): string {
  const aliases = pairIds
    .map(
      (id) =>
        `  p${id}: trades(first: ${perMarket}, orderBy: tradeNotional, orderDirection: desc, where: { isOpen: true, pair: "${id}" }) {${TRADE_FIELDS}\n  }`,
    )
    .join("\n");
  return `query Discover {\n${aliases}\n}`;
}

export function parseDiscoverResponse(
  json: unknown,
  pairIds: string[],
): OstiumRawTrade[] {
  const body = json as {
    data?: Record<string, OstiumRawTrade[] | null>;
    errors?: unknown;
  };
  if (body.errors) {
    throw new Error(`Ostium subgraph errors: ${JSON.stringify(body.errors)}`);
  }
  const data = body.data ?? {};
  const out: OstiumRawTrade[] = [];
  for (const id of pairIds) {
    const bucket = data[`p${id}`];
    if (Array.isArray(bucket)) out.push(...bucket);
  }
  return out;
}

export async function fetchOstiumTopTradesByMarket(
  pairIds: string[],
  perMarket: number,
  timeoutMs = 10_000,
): Promise<OstiumRawTrade[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OSTIUM_SUBGRAPH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: buildDiscoverQuery(pairIds, perMarket) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ostium subgraph HTTP ${res.status}`);
    }
    return parseDiscoverResponse(await res.json(), pairIds);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/whales/ostium-subgraph.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whales/ostium-subgraph.ts lib/whales/ostium-subgraph.test.ts
git commit -m "feat(whales): Ostium subgraph discovery query (per-market top-N)"
```

---

### Task 5: Ostium refresh pipeline

**Files:**
- Create: `lib/whales/refresh-ostium.ts`
- Test: `lib/whales/refresh-ostium.test.ts`

- [ ] **Step 1: Write the failing test** (mocks subgraph + repository + live-cache)

```ts
// lib/whales/refresh-ostium.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOstiumTopTradesByMarket: vi.fn(),
  upsertWhale: vi.fn(),
  upsertWhalePosition: vi.fn(),
  markMissingWhalePositionsClosed: vi.fn(),
  writeWhaleLiveSnapshot: vi.fn(),
}));

vi.mock("./ostium-subgraph", () => ({
  fetchOstiumTopTradesByMarket: mocks.fetchOstiumTopTradesByMarket,
}));
vi.mock("./repository", () => ({
  upsertWhale: mocks.upsertWhale,
  upsertWhalePosition: mocks.upsertWhalePosition,
  markMissingWhalePositionsClosed: mocks.markMissingWhalePositionsClosed,
}));
vi.mock("./live-cache", () => ({
  writeWhaleLiveSnapshot: mocks.writeWhaleLiveSnapshot,
}));

import { refreshOstiumWhales } from "./refresh-ostium";

function rawTrade(over: Record<string, unknown> = {}) {
  return {
    tradeID: "663595",
    trader: "0xB5FB748EC3E019A7ED4F6F701158BC23FA3A2626",
    collateral: "66434263231",
    leverage: "1757",
    notional: "1167250004997",
    openPrice: "1151799999999999872",
    isBuy: true,
    isOpen: true,
    timestamp: "1762169223",
    index: "1",
    pair: { id: "2", from: "EUR", to: "USD", lastTradePrice: "1164450000000000000" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertWhale.mockResolvedValue(undefined);
  mocks.upsertWhalePosition.mockResolvedValue(undefined);
  mocks.markMissingWhalePositionsClosed.mockResolvedValue(undefined);
  mocks.writeWhaleLiveSnapshot.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("refreshOstiumWhales", () => {
  it("upserts whales + positions and writes a snapshot", async () => {
    mocks.fetchOstiumTopTradesByMarket.mockResolvedValue([
      rawTrade(),
      rawTrade({ tradeID: "700000", pair: { id: "5", from: "XAU", to: "USD", lastTradePrice: "4530000000000000000000" }, openPrice: "4500000000000000000000" }),
    ]);

    const result = await refreshOstiumWhales();

    expect(result.positionsSeen).toBe(2);
    expect(result.whalesSeen).toBe(1); // same trader
    expect(mocks.upsertWhale).toHaveBeenCalledTimes(1);
    expect(mocks.upsertWhale).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ostium" }),
    );
    expect(mocks.upsertWhalePosition).toHaveBeenCalledTimes(2);
    expect(mocks.markMissingWhalePositionsClosed).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ostium" }),
    );
    expect(mocks.writeWhaleLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ostium" }),
    );
  });

  it("skips invalid trades without aborting the batch", async () => {
    mocks.fetchOstiumTopTradesByMarket.mockResolvedValue([
      rawTrade({ openPrice: "0" }), // invalid -> skipped
      rawTrade({ tradeID: "2" }), // valid
    ]);
    const result = await refreshOstiumWhales();
    expect(result.positionsSeen).toBe(1);
  });

  it("returns zeros and does not throw when the subgraph fails", async () => {
    mocks.fetchOstiumTopTradesByMarket.mockRejectedValue(new Error("down"));
    const result = await refreshOstiumWhales();
    expect(result).toEqual({ whalesSeen: 0, positionsSeen: 0 });
    expect(mocks.upsertWhalePosition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/whales/refresh-ostium.test.ts`
Expected: FAIL — cannot find module `./refresh-ostium`.

- [ ] **Step 3: Implement the refresh pipeline**

```ts
// lib/whales/refresh-ostium.ts
import { makeWhaleId } from "./identity";
import { writeWhaleLiveSnapshot } from "./live-cache";
import { OSTIUM_MAPPED_PAIR_IDS } from "./ostium-markets";
import {
  InvalidOstiumTradeError,
  mapOstiumTrade,
  ostiumDisplayName,
} from "./ostium-source";
import { fetchOstiumTopTradesByMarket } from "./ostium-subgraph";
import {
  markMissingWhalePositionsClosed,
  upsertWhale,
  upsertWhalePosition,
} from "./repository";
import type { WhalePositionRecord, WhaleRecord } from "./types";

const CLOSE_GRACE_MS = 90_000;
const TOP_PER_MARKET = (() => {
  const parsed = Number(process.env.OSTIUM_TOP_PER_MARKET);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 15;
})();

export async function refreshOstiumWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  let rawTrades;
  try {
    rawTrades = await fetchOstiumTopTradesByMarket(
      OSTIUM_MAPPED_PAIR_IDS,
      TOP_PER_MARKET,
    );
  } catch (err) {
    console.warn("[whales] Ostium subgraph fetch failed:", err);
    return { whalesSeen: 0, positionsSeen: 0 };
  }

  const now = new Date();
  const byAccount = new Map<string, WhalePositionRecord[]>();
  for (const trade of rawTrades) {
    let mapped: WhalePositionRecord;
    try {
      mapped = mapOstiumTrade({ trade, now });
    } catch (err) {
      if (err instanceof InvalidOstiumTradeError) continue;
      throw err;
    }
    const list = byAccount.get(mapped.sourceAccount) ?? [];
    list.push(mapped);
    byAccount.set(mapped.sourceAccount, list);
  }

  const observedAt = now;
  const snapshotAccounts: string[] = [];
  const snapshotWhales: WhaleRecord[] = [];
  const snapshotPositions: WhalePositionRecord[] = [];
  let positionsSeen = 0;

  for (const [account, positions] of byAccount) {
    const displayName = ostiumDisplayName(account);
    const whaleId = makeWhaleId("ostium", account);
    const tags = ["ostium"];

    await upsertWhale({
      id: whaleId,
      source: "ostium",
      sourceAccount: account,
      displayName,
      avatarUrl: null,
      tags,
    });

    const openPositionIds: string[] = [];
    for (const position of positions) {
      await upsertWhalePosition(position);
      openPositionIds.push(position.id);
      snapshotPositions.push(position);
      positionsSeen += 1;
    }

    await markMissingWhalePositionsClosed({
      source: "ostium",
      sourceAccount: account,
      openPositionIds,
      graceCutoff: new Date(Date.now() - CLOSE_GRACE_MS),
    });

    snapshotAccounts.push(account);
    snapshotWhales.push({
      id: whaleId,
      source: "ostium",
      sourceAccount: account,
      displayName,
      avatarUrl: null,
      status: "active",
      tags,
      createdAt: observedAt,
      updatedAt: observedAt,
    });
  }

  if (snapshotAccounts.length > 0) {
    try {
      await writeWhaleLiveSnapshot({
        source: "ostium",
        observedAt,
        accounts: snapshotAccounts,
        whales: snapshotWhales,
        positions: snapshotPositions,
      });
    } catch (err) {
      console.warn("[whales] Ostium live cache write failed:", err);
    }
  }

  return { whalesSeen: byAccount.size, positionsSeen };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/whales/refresh-ostium.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whales/refresh-ostium.ts lib/whales/refresh-ostium.test.ts
git commit -m "feat(whales): Ostium refresh pipeline (per-market discovery -> DB + snapshot)"
```

---

### Task 6: Wire Ostium into the `refreshWhales()` orchestrator

**Files:**
- Modify: `lib/whales/refresh.ts`
- Test: `lib/whales/refresh.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// lib/whales/refresh.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshPacificaWhales: vi.fn(),
  refreshHyperliquidWhales: vi.fn(),
  refreshOstiumWhales: vi.fn(),
}));

vi.mock("./refresh-pacifica", () => ({
  refreshPacificaWhales: mocks.refreshPacificaWhales,
}));
vi.mock("./refresh-hyperliquid", () => ({
  refreshHyperliquidWhales: mocks.refreshHyperliquidWhales,
}));
vi.mock("./refresh-ostium", () => ({
  refreshOstiumWhales: mocks.refreshOstiumWhales,
}));

import { refreshWhales } from "./refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshPacificaWhales.mockResolvedValue({ whalesSeen: 1, positionsSeen: 2 });
  mocks.refreshHyperliquidWhales.mockResolvedValue({ whalesSeen: 1, positionsSeen: 3 });
  mocks.refreshOstiumWhales.mockResolvedValue({ whalesSeen: 1, positionsSeen: 5 });
});

describe("refreshWhales", () => {
  it("runs all three sources and sums their counts", async () => {
    const result = await refreshWhales();
    expect(mocks.refreshOstiumWhales).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ whalesSeen: 3, positionsSeen: 10 });
  });

  it("still succeeds when one source rejects", async () => {
    mocks.refreshOstiumWhales.mockRejectedValue(new Error("ostium down"));
    const result = await refreshWhales();
    expect(result).toEqual({ whalesSeen: 2, positionsSeen: 5 });
  });

  it("throws only when every source rejects", async () => {
    mocks.refreshPacificaWhales.mockRejectedValue(new Error("p"));
    mocks.refreshHyperliquidWhales.mockRejectedValue(new Error("h"));
    mocks.refreshOstiumWhales.mockRejectedValue(new Error("o"));
    await expect(refreshWhales()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/whales/refresh.test.ts`
Expected: FAIL — Ostium not called / counts wrong.

- [ ] **Step 3: Rewrite `lib/whales/refresh.ts`**

```ts
// lib/whales/refresh.ts
import { refreshHyperliquidWhales } from "./refresh-hyperliquid";
import { refreshOstiumWhales } from "./refresh-ostium";
import { refreshPacificaWhales } from "./refresh-pacifica";

type RefreshResult = { whalesSeen: number; positionsSeen: number };

export async function refreshWhales(): Promise<RefreshResult> {
  const sources: Array<[string, Promise<RefreshResult>]> = [
    ["Pacifica", refreshPacificaWhales()],
    ["Hyperliquid", refreshHyperliquidWhales()],
    ["Ostium", refreshOstiumWhales()],
  ];

  const settled = await Promise.allSettled(sources.map(([, p]) => p));

  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<RefreshResult> => r.status === "fulfilled",
  );

  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(`[whales] ${sources[i]![0]} refresh failed:`, result.reason);
    }
  });

  if (fulfilled.length === 0) {
    throw new AggregateError(
      settled.map((r) => (r as PromiseRejectedResult).reason),
      "all whale refresh sources failed",
    );
  }

  return {
    whalesSeen: fulfilled.reduce((sum, r) => sum + r.value.whalesSeen, 0),
    positionsSeen: fulfilled.reduce((sum, r) => sum + r.value.positionsSeen, 0),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/whales/refresh.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whales/refresh.ts lib/whales/refresh.test.ts
git commit -m "feat(whales): run Ostium in the refreshWhales fan-out"
```

---

### Task 7: Manual runner script

**Files:**
- Create: `scripts/refresh-ostium.ts`
- Modify: `package.json:16`

- [ ] **Step 1: Write the runner**

```ts
// scripts/refresh-ostium.ts
import { refreshOstiumWhales } from "@/lib/whales/refresh-ostium";

async function main() {
  console.log("[refresh:ostium] starting…");
  const start = Date.now();
  const result = await refreshOstiumWhales();
  console.log(
    `[refresh:ostium] done in ${Date.now() - start}ms`,
    result,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[refresh:ostium] failed:", err);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (after `"seed:bots"`):

```json
    "seed:bots": "tsx --env-file=.env.local scripts/seed-bots.ts",
    "refresh:ostium": "tsx --env-file=.env.local scripts/refresh-ostium.ts"
```

(Confirm the `@/` path alias resolves in scripts — `scripts/seed-bots.ts` uses the same import style, so tsconfig `paths` already covers it.)

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/refresh-ostium.ts package.json
git commit -m "feat(whales): refresh:ostium manual runner"
```

---

### Task 8: Full verification + live smoke test

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS; all prior tests (601+) still green plus the new Ostium tests.

- [ ] **Step 2: Live smoke test against the real subgraph + DB**

Run: `npm run refresh:ostium`
Expected: logs `{ whalesSeen: >0, positionsSeen: >0 }` (e.g., 100–200 positions). If it returns zeros, inspect the warning line (network/schema).

- [ ] **Step 3: Confirm rows landed and markets are diverse**

Write a one-off check (temp script `scripts/_check-ostium.ts`, delete after) that queries `whale_positions` for `source = 'ostium'` grouped by `market`, and prints counts. Expected: rows for XAU, SPY, EUR, NVDA, etc. Delete the temp script after.

- [ ] **Step 4: Confirm the tape surfaces them**

Start dev (`npm run dev`), GET `/api/whales/live?limit=1000`, and grep the JSON for `"source":"ostium"` and `"market":"XAU"` / `"SPY"`. Expected: Ostium positions present, `canTail` true (they're Flash-mapped).

- [ ] **Step 5: Revert any dev noise + final commit**

```bash
git checkout -- next-env.d.ts 2>/dev/null || true
git status --short
```

---

## Self-Review (completed during planning)

- **Spec coverage:** subgraph URL/scaling/mapping (Task 2–3), per-market discovery (Task 4), refresh+close+snapshot (Task 5), orchestrator (Task 6), automation/script (Task 7), testing (every task), verification/rollout (Task 8). Phase 2 (HL HIP-3) intentionally deferred to a follow-up plan.
- **Placeholder scan:** no TBD/TODO; every code step is complete.
- **Type/name consistency:** `OstiumRawTrade` defined in `ostium-source.ts`, imported by `ostium-subgraph.ts`; `mapOstiumTrade`, `ostiumDisplayName`, `InvalidOstiumTradeError`, `fetchOstiumTopTradesByMarket`, `OSTIUM_MAPPED_PAIR_IDS`, `ostiumPairToFlashSymbol` names are identical across tasks; `markMissingWhalePositionsClosed` matches the real repository signature (`{source, sourceAccount, openPositionIds, graceCutoff}`); `writeWhaleLiveSnapshot` matches `{source, observedAt, accounts, whales, positions}`; `WhaleSource` now includes `"ostium"` so `WhaleLiveSnapshot.source` accepts it.

## Out of scope (this plan)

- Tailing/execution of new markets (Watch only until the separate Pacifica/Flash unlock).
- Hyperliquid HIP-3 (Phase 2 — separate plan).
- NATGAS, USDCNH, ZEC, Solana memes/alts (no Ostium source).
