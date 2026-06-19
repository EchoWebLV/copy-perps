import { describe, expect, it } from "vitest";
import {
  buildWhaleV2Body,
  flashV2WhaleOpenToOpenResponse,
} from "./whale-v2-open";
import type { WhaleTailPosition } from "./tail-types";

const position: WhaleTailPosition = {
  sourcePositionId: "pacifica:acc:SOL:long:1000",
  asset: "SOL",
  side: "long",
  leverage: 5,
  entryMark: 140,
  currentMark: 150,
  stale: false,
  lastSeenAtMs: 1_700_000_000_000,
};

describe("buildWhaleV2Body", () => {
  it("maps a pacifica whale + position into the /api/bet/whale body with a snapshot", () => {
    const body = buildWhaleV2Body({
      whale: { whaleId: "pacifica:acc", sourceAccount: "acc", displayName: "Whale A" },
      position,
      stakeUsdc: 20,
      leverage: 3,
      walletAddress: "WALLET",
      autoCloseOnSourceClose: true,
    });
    expect(body).toMatchObject({
      positionId: "pacifica:acc:SOL:long:1000",
      stakeUsdc: 20,
      leverage: 3,
      walletAddress: "WALLET",
      autoCloseOnSourceClose: true,
    });
    expect(body.snapshot).toMatchObject({
      source: "pacifica",
      sourceAccount: "acc",
      market: "SOL",
      side: "long",
      entryPrice: 140,
      currentMark: 150,
    });
  });

  it("derives source: 'hyperliquid' from the whaleId prefix", () => {
    const body = buildWhaleV2Body({
      whale: { whaleId: "hyperliquid:0xabc", sourceAccount: "0xabc", displayName: "HL" },
      position,
      stakeUsdc: 10,
      leverage: 5,
      walletAddress: "W",
      autoCloseOnSourceClose: false,
    });
    expect(body.snapshot.source).toBe("hyperliquid");
  });
});

describe("flashV2WhaleOpenToOpenResponse", () => {
  it("adapts the server-executed v2 open onto the OpenResponse shape", () => {
    const out = flashV2WhaleOpenToOpenResponse({
      betId: "bet-1",
      txSig: "SIG",
      source: { whaleId: "pacifica:acc", displayName: "Whale A", asset: "SOL", side: "long", leverage: 3 },
    });
    expect(out).toMatchObject({
      phase: "open",
      betId: "bet-1",
      fill: { orderId: "SIG", filledAmount: "Flash v2 position", side: "long" },
      source: { asset: "SOL", side: "long", leverage: 3 },
    });
  });
});
