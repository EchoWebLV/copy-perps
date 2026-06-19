import { describe, expect, it, vi } from "vitest";
import {
  FlashV2PositionConflictError,
  planFlashV2Close,
  planFlashV2Open,
} from "./self-trade";

const fakeTx = { serialize: () => new Uint8Array([1, 2, 3]) };
const B64 = Buffer.from([1, 2, 3]).toString("base64");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function venue(overrides: Record<string, unknown> = {}): any {
  return {
    getPositions: vi.fn(async () => []),
    openPosition: vi.fn(async () => ({
      unsigned: { tx: fakeTx, layer: "er" },
      quote: { entryPriceUi: 100 },
    })),
    closePosition: vi.fn(async () => ({ unsigned: { tx: fakeTx, layer: "er" } })),
    ...overrides,
  };
}

describe("planFlashV2Open", () => {
  it("returns an unsigned ER open tx + quote when no conflicting position", async () => {
    const v = venue();
    const plan = await planFlashV2Open({
      venue: v,
      owner: "OWNER",
      market: "SOL",
      side: "long",
      stakeUsdc: 25,
      leverage: 5,
    });
    expect(plan).toMatchObject({ phase: "open", layer: "er", transactionB64: B64 });
    expect(plan.quote).toMatchObject({ entryPriceUi: 100 });
    expect(v.openPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "OWNER",
        symbol: "SOL",
        collateralUsd: 25,
        leverage: 5,
        side: "long",
        orderType: "market",
      }),
    );
  });

  it("throws FlashV2PositionConflictError when that market is already open", async () => {
    const v = venue({ getPositions: vi.fn(async () => [{ symbol: "SOL", side: "short" }]) });
    await expect(
      planFlashV2Open({
        venue: v,
        owner: "OWNER",
        market: "SOL",
        side: "long",
        stakeUsdc: 25,
        leverage: 5,
      }),
    ).rejects.toBeInstanceOf(FlashV2PositionConflictError);
    expect(v.openPosition).not.toHaveBeenCalled();
  });
});

describe("planFlashV2Close", () => {
  it("found: builds an unsigned ER close + mark-price PnL estimate", async () => {
    const v = venue({
      getPositions: vi.fn(async () => [
        { symbol: "SOL", side: "long", sizeUsd: 100, entryPrice: 100, markPrice: 110 },
      ]),
    });
    const result = await planFlashV2Close({ venue: v, owner: "OWNER", market: "SOL", side: "long" });
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.plan).toMatchObject({
      phase: "close",
      layer: "er",
      transactionB64: B64,
      market: "SOL",
      side: "long",
    });
    expect(result.plan.estPnlUsd).toBeCloseTo(10); // long +10% of $100 size
    expect(v.closePosition).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "OWNER", symbol: "SOL", side: "long", closeUsd: 100 }),
    );
  });

  it("not found: returns { found: false } and never builds a close", async () => {
    const v = venue({ getPositions: vi.fn(async () => [{ symbol: "BTC", side: "long" }]) });
    const result = await planFlashV2Close({ venue: v, owner: "OWNER", market: "SOL", side: "long" });
    expect(result.found).toBe(false);
    expect(v.closePosition).not.toHaveBeenCalled();
  });

  it("a same-market opposite-side position is treated as not found", async () => {
    const v = venue({ getPositions: vi.fn(async () => [{ symbol: "SOL", side: "short" }]) });
    const result = await planFlashV2Close({ venue: v, owner: "OWNER", market: "SOL", side: "long" });
    expect(result.found).toBe(false);
  });
});
