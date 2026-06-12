import { describe, expect, it } from "vitest";
import type { ArenaBot, ArenaPosition } from "@/lib/arena/decode";
import type { WhalePositionRecord } from "@/lib/whales/types";
import {
  arenaBotSourcePositions,
  flashWalletSourcePositions,
  parseWhaleTargetKey,
  whaleSourcePositions,
} from "./sources";

function position(overrides: Partial<ArenaPosition> = {}): ArenaPosition {
  return {
    active: true,
    marketId: 0,
    side: "long",
    entryPrice: 66.796,
    stakeUsd: 100,
    leverage: 50,
    openedTsMs: 1_765_540_000_000,
    ticksHeld: 3,
    liqPrice: 65.5,
    ...overrides,
  };
}

function bot(positions: ArenaPosition[]): ArenaBot {
  return {
    balanceUsd: 897,
    grossPnlUsd: 0,
    feesUsd: 3,
    equityHighUsd: 1000,
    seq: 4,
    positions,
    tape: [],
    params: {
      maxHoldTicks: 20,
      breakoutBps: 5,
      activityMultBps: 10_000,
      stakeFracBps: 1_000,
      leverage: 50,
      exitFavorableBps: 10,
      readSpan: 1,
      trendFilter: false,
    },
    personaName: "degen-v1",
    trades: 0,
    wins: 0,
    tapeHead: 4,
    bump: 255,
  };
}

describe("arenaBotSourcePositions", () => {
  it("maps active positions with the tail-compatible key", () => {
    const out = arenaBotSourcePositions("degen-v1", bot([position()]));
    expect(out).toEqual([
      {
        key: "arena:degen-v1:1765540000000",
        market: "SOL",
        side: "long",
        entryPriceUsd: 66.796,
        leverage: 50,
        openedTsMs: 1_765_540_000_000,
        sourceMarkUsd: null,
      },
    ]);
  });

  it("drops inactive slots and unknown markets", () => {
    const out = arenaBotSourcePositions(
      "degen-v1",
      bot([
        position({ active: false }),
        position({ marketId: 9, openedTsMs: 1 }),
      ]),
    );
    expect(out).toEqual([]);
  });
});

function whaleRecord(
  overrides: Partial<WhalePositionRecord> = {},
): WhalePositionRecord {
  return {
    id: "pacifica:AcctA:SOL:long:1765540000000",
    whaleId: "pacifica:AcctA",
    source: "pacifica",
    sourceAccount: "AcctA",
    market: "SOL",
    side: "long",
    leverage: 20,
    amountBase: 10,
    notionalUsd: 1336,
    entryPrice: 66.8,
    currentMark: 66.9,
    unrealizedPnlPct: 1.2,
    openedAt: new Date(1_765_540_000_000),
    closedAt: null,
    status: "open",
    raw: {},
    lastSeenAt: new Date(1_765_540_050_000),
    ...overrides,
  };
}

describe("whaleSourcePositions", () => {
  it("maps open positions with the record id as the key", () => {
    expect(whaleSourcePositions([whaleRecord()])).toEqual([
      {
        key: "pacifica:AcctA:SOL:long:1765540000000",
        market: "SOL",
        side: "long",
        entryPriceUsd: 66.8,
        leverage: 20,
        openedTsMs: 1_765_540_000_000,
        sourceMarkUsd: 66.9,
      },
    ]);
  });

  it("drops closed positions and unlisted markets, keeps XAU/FX (Flash lists them)", () => {
    const out = whaleSourcePositions([
      whaleRecord({ status: "closed" }),
      whaleRecord({ id: "x:XAU", market: "XAU" }),
      whaleRecord({ id: "x:NOPE", market: "NOTAMARKET" }),
    ]);
    expect(out.map((p) => p.key)).toEqual(["x:XAU"]);
    expect(out[0]!.market).toBe("XAU");
  });
});

describe("parseWhaleTargetKey", () => {
  it("parses source:account and rejects junk", () => {
    expect(parseWhaleTargetKey("hyperliquid:0xabc")).toEqual({
      source: "hyperliquid",
      sourceAccount: "0xabc",
    });
    expect(parseWhaleTargetKey("pacifica:AcctA")).toEqual({
      source: "pacifica",
      sourceAccount: "AcctA",
    });
    expect(parseWhaleTargetKey("flash:Wallet")).toBeNull(); // not a whale source
    expect(parseWhaleTargetKey("degen-v1")).toBeNull();
    expect(parseWhaleTargetKey("pacifica:")).toBeNull();
  });
});

describe("flashWalletSourcePositions", () => {
  it("keys per market+side and derives leverage from size/collateral", () => {
    const out = flashWalletSourcePositions("WalletA", [
      {
        symbol: "SOL",
        side: "short",
        positionPubkey: "Pos111",
        marketAccount: "Mkt111",
        entryPriceUsd: 66.8,
        sizeUsd: 500,
        collateralUsd: 25,
        collateralSymbol: "SOL",
        openTime: 1_765_540_000_000,
      },
    ]);
    expect(out).toEqual([
      {
        key: "flash:WalletA:SOL:short",
        market: "SOL",
        side: "short",
        entryPriceUsd: 66.8,
        leverage: 20,
        openedTsMs: 1_765_540_000_000,
        sourceMarkUsd: null,
      },
    ]);
  });
});
