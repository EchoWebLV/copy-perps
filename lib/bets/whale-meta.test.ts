import { describe, expect, it } from "vitest";

import { buildWhaleCopyMeta, parseWhaleCopyMeta } from "./whale-meta";

describe("whale copy metadata", () => {
  it("builds and parses whale copy metadata", () => {
    const meta = buildWhaleCopyMeta({
      whaleId: "pacifica:abc",
      source: "pacifica",
      sourceAccount: "abc",
      sourcePositionId: "pos-1",
      leaderMarket: "ETH",
      leaderSide: "long",
      leverage: 7,
      autoCloseOnSourceClose: true,
      userEntryPrice: 2118.51,
      sourceEntryPriceAtCopy: 2110.25,
      pacificaOrderId: "order-1",
    });

    expect(meta).toEqual({
      sourceType: "whale",
      whaleId: "pacifica:abc",
      source: "pacifica",
      sourceAccount: "abc",
      sourcePositionId: "pos-1",
      leaderMarket: "ETH",
      leaderSide: "long",
      leverage: 7,
      autoCloseOnSourceClose: true,
      userEntryPrice: 2118.51,
      sourceEntryPriceAtCopy: 2110.25,
      pacificaOrderId: "order-1",
      closeReason: null,
    });
    expect(parseWhaleCopyMeta(meta)).toEqual(meta);
  });

  it("returns null for missing or invalid whale metadata", () => {
    expect(parseWhaleCopyMeta(null)).toBeNull();
    expect(parseWhaleCopyMeta({})).toBeNull();
    expect(
      parseWhaleCopyMeta({
        sourceType: "bot",
        whaleId: "pacifica:abc",
      }),
    ).toBeNull();
    expect(
      parseWhaleCopyMeta({
        sourceType: "whale",
        whaleId: "pacifica:abc",
        source: "pacifica",
        sourceAccount: "abc",
        sourcePositionId: "pos-1",
        leaderMarket: "ETH",
        leaderSide: "sideways",
        leverage: 7,
        autoCloseOnSourceClose: true,
        userEntryPrice: 2118.51,
        sourceEntryPriceAtCopy: 2110.25,
        pacificaOrderId: "order-1",
        closeReason: null,
      }),
    ).toBeNull();
  });

  it("returns null for unsupported whale sources", () => {
    expect(
      parseWhaleCopyMeta({
        sourceType: "whale",
        whaleId: "binance:abc",
        source: "binance",
        sourceAccount: "abc",
        sourcePositionId: "pos-1",
        leaderMarket: "ETH",
        leaderSide: "long",
        leverage: 7,
        autoCloseOnSourceClose: true,
        userEntryPrice: 2118.51,
        sourceEntryPriceAtCopy: 2110.25,
        pacificaOrderId: "order-1",
        closeReason: null,
      }),
    ).toBeNull();
  });

  it("returns null for unsupported whale close reasons", () => {
    expect(
      parseWhaleCopyMeta({
        sourceType: "whale",
        whaleId: "pacifica:abc",
        source: "pacifica",
        sourceAccount: "abc",
        sourcePositionId: "pos-1",
        leaderMarket: "ETH",
        leaderSide: "long",
        leverage: 7,
        autoCloseOnSourceClose: true,
        userEntryPrice: 2118.51,
        sourceEntryPriceAtCopy: 2110.25,
        pacificaOrderId: "order-1",
        closeReason: "liquidated",
      }),
    ).toBeNull();
  });
});
