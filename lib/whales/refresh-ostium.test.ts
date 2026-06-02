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
    pair: {
      id: "2",
      from: "EUR",
      to: "USD",
      lastTradePrice: "1164450000000000000",
    },
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
      rawTrade({
        tradeID: "700000",
        pair: {
          id: "5",
          from: "XAU",
          to: "USD",
          lastTradePrice: "4530000000000000000000",
        },
        openPrice: "4500000000000000000000",
      }),
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
