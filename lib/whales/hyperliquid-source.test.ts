import { describe, expect, it } from "vitest";
import type { HLAssetPosition } from "@/lib/hyperliquid/client";
import {
  hyperliquidSideToWhaleSide,
  makeHyperliquidPositionId,
  mapHyperliquidPosition,
} from "./hyperliquid-source";

const baseAssetPosition: HLAssetPosition = {
  type: "oneWay",
  position: {
    coin: "ETH",
    szi: "2.5",
    leverage: { type: "cross", value: 15 },
    entryPx: "2265.48",
    positionValue: "5663.70",
    unrealizedPnl: "120.5",
    returnOnEquity: "0.32",
    liquidationPx: "1350.9",
    marginUsed: "377.58",
    maxLeverage: 25,
  },
};

describe("hyperliquid source mapping", () => {
  it("maps signed Hyperliquid size to whale side", () => {
    expect(hyperliquidSideToWhaleSide("1")).toBe("long");
    expect(hyperliquidSideToWhaleSide("-1")).toBe("short");
  });

  it("uses market, side, and entry price for a stable copyable position id", () => {
    expect(
      makeHyperliquidPositionId({
        sourceAccount: "0xabc",
        market: "ETH",
        side: "long",
        entryPrice: 2265.48,
      }),
    ).toBe("hyperliquid:0xabc:ETH:long:2265480000");
  });

  it("maps a Hyperliquid asset position to a whale position record", () => {
    const now = new Date("2026-05-23T12:00:00.000Z");

    const mapped = mapHyperliquidPosition({
      sourceAccount: "0xabc",
      assetPosition: baseAssetPosition,
      currentMark: 2300,
      now,
    });

    expect(mapped).toMatchObject({
      id: "hyperliquid:0xabc:ETH:long:2265480000",
      whaleId: "hyperliquid:0xabc",
      source: "hyperliquid",
      sourceAccount: "0xabc",
      market: "ETH",
      side: "long",
      leverage: 15,
      amountBase: 2.5,
      notionalUsd: 5663.7,
      entryPrice: 2265.48,
      currentMark: 2300,
      unrealizedPnlPct: 32,
      openedAt: now,
      closedAt: null,
      status: "open",
      lastSeenAt: now,
    });
  });

  it("maps negative size as a short and derives mark from position value", () => {
    const mapped = mapHyperliquidPosition({
      sourceAccount: "0xabc",
      assetPosition: {
        ...baseAssetPosition,
        position: {
          ...baseAssetPosition.position,
          szi: "-2",
          positionValue: "5000",
          entryPx: "2600",
          returnOnEquity: "-0.125",
        },
      },
      currentMark: null,
      now: new Date("2026-05-23T12:00:00.000Z"),
    });

    expect(mapped.side).toBe("short");
    expect(mapped.currentMark).toBe(2500);
    expect(mapped.unrealizedPnlPct).toBe(-12.5);
  });
});
