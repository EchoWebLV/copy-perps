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
    expect(r.sourceAccount).toBe("0xb5fb748ec3e019a7ed4f6f701158bc23fa3a2626");
    expect(r.entryPrice).toBeCloseTo(1.1518, 4);
    expect(r.currentMark).toBeCloseTo(1.16445, 5);
    expect(r.notionalUsd).toBeCloseTo(1167250.004997, 2);
    expect(r.leverage).toBe(18); // round(1167250/66434 = 17.57)
    expect(r.amountBase).toBeCloseTo(1167250.004997 / 1.1518, 1);
    expect(r.status).toBe("open");
    expect(r.openedAt.getTime()).toBe(1762169223 * 1000);
    expect(r.lastSeenAt).toEqual(NOW);
    expect(r.unrealizedPnlPct).not.toBeNull();
    expect(r.unrealizedPnlPct!).toBeGreaterThan(0);
  });

  it("derives leverage from notional/collateral, not the raw field", () => {
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
    expect(
      ostiumDisplayName("0xb5fb748ec3e019a7ed4f6f701158bc23fa3a2626"),
    ).toBe("OST 0xb5fb…2626");
  });
});
