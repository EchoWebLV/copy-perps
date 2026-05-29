import { describe, expect, it } from "vitest";
import type { HLAssetPosition, HLFill } from "@/lib/hyperliquid/client";
import {
  deriveHyperliquidPositionOpenTime,
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

function fill(overrides: Partial<HLFill>): HLFill {
  return {
    coin: overrides.coin ?? "ETH",
    px: overrides.px ?? "2000",
    sz: overrides.sz ?? "1",
    side: overrides.side ?? "B",
    time: overrides.time ?? Date.parse("2026-05-23T11:00:00.000Z"),
    startPosition: overrides.startPosition ?? "0",
    dir: overrides.dir ?? "Open Long",
    closedPnl: overrides.closedPnl ?? "0",
    hash: overrides.hash ?? "0xhash",
    oid: overrides.oid ?? 1,
    crossed: overrides.crossed ?? true,
    fee: overrides.fee ?? "1",
    tid: overrides.tid ?? 1,
  };
}

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

  it("derives current position open time from the fill that opened the current side", () => {
    const openShortAt = Date.parse("2026-05-23T11:20:00.000Z");

    expect(
      deriveHyperliquidPositionOpenTime({
        coin: "ETH",
        side: "short",
        fills: [
          fill({
            side: "B",
            sz: "2",
            startPosition: "0",
            time: Date.parse("2026-05-23T11:00:00.000Z"),
            dir: "Open Long",
          }),
          fill({
            side: "A",
            sz: "3",
            startPosition: "2",
            time: openShortAt,
            dir: "Long > Short",
          }),
          fill({
            side: "A",
            sz: "0.5",
            startPosition: "-1",
            time: Date.parse("2026-05-23T11:25:00.000Z"),
            dir: "Open Short",
          }),
        ],
      }),
    ).toBe(openShortAt);
  });

  it("returns null when the position was already open before the fill lookback", () => {
    expect(
      deriveHyperliquidPositionOpenTime({
        coin: "ETH",
        side: "long",
        fills: [
          fill({
            side: "B",
            sz: "1",
            startPosition: "2",
            time: Date.parse("2026-05-23T11:25:00.000Z"),
            dir: "Open Long",
          }),
        ],
      }),
    ).toBeNull();
  });
});
