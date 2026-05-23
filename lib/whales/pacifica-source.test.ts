import { describe, expect, it } from "vitest";
import {
  InvalidPacificaPositionError,
  pacificaSideToWhaleSide,
  leverageFromPacificaPosition,
  mapPacificaPosition,
} from "./pacifica-source";
import type { PacificaPosition } from "@/lib/pacifica/types";

const basePosition: PacificaPosition = {
  symbol: "BTC",
  side: "bid",
  amount: "0.10",
  entry_price: "65000",
  margin: "650",
  funding: "0",
  isolated: true,
  liquidation_price: "60000",
  created_at: 1779543000000,
  updated_at: 1779543060000,
};

function positionWith(
  overrides: Partial<PacificaPosition>,
): PacificaPosition {
  return {
    ...basePosition,
    ...overrides,
  };
}

describe("pacifica source mapping", () => {
  it("maps Pacifica bid and ask to long and short", () => {
    expect(pacificaSideToWhaleSide("bid")).toBe("long");
    expect(pacificaSideToWhaleSide("ask")).toBe("short");
  });

  it("derives isolated leverage from notional divided by margin", () => {
    expect(
      leverageFromPacificaPosition({
        amountBase: 0.1,
        entryPrice: 65_000,
        marginUsd: 650,
        marketMaxLeverage: 50,
      }),
    ).toBe(10);
  });

  it("falls back to market max leverage when margin is zero", () => {
    expect(
      leverageFromPacificaPosition({
        amountBase: 0.1,
        entryPrice: 65_000,
        marginUsd: 0,
        marketMaxLeverage: 25,
      }),
    ).toBe(25);
  });

  it("maps a Pacifica position to a whale position input", () => {
    const mapped = mapPacificaPosition({
      sourceAccount: "ABC123",
      position: basePosition,
      marketMaxLeverage: 50,
      currentMark: 66_300,
    });
    expect(mapped.id).toBe("pacifica:ABC123:BTC:long:1779543000000");
    expect(mapped.whaleId).toBe("pacifica:ABC123");
    expect(mapped.side).toBe("long");
    expect(mapped.notionalUsd).toBe(6500);
    expect(mapped.unrealizedPnlPct).toBeCloseTo(20);
  });

  it("rejects an invalid amount", () => {
    expect(() =>
      mapPacificaPosition({
        sourceAccount: "ABC123",
        position: positionWith({ amount: "nope" }),
        marketMaxLeverage: 50,
        currentMark: 66_300,
      }),
    ).toThrow(InvalidPacificaPositionError);
  });

  it("rejects a zero entry price", () => {
    expect(() =>
      mapPacificaPosition({
        sourceAccount: "ABC123",
        position: positionWith({ entry_price: "0" }),
        marketMaxLeverage: 50,
        currentMark: 66_300,
      }),
    ).toThrow(InvalidPacificaPositionError);
  });

  it("rejects an invalid margin", () => {
    expect(() =>
      mapPacificaPosition({
        sourceAccount: "ABC123",
        position: positionWith({ margin: "NaN" }),
        marketMaxLeverage: 50,
        currentMark: 66_300,
      }),
    ).toThrow(InvalidPacificaPositionError);
  });

  it("rejects an invalid created_at", () => {
    expect(() =>
      mapPacificaPosition({
        sourceAccount: "ABC123",
        position: positionWith({ created_at: Number.NaN }),
        marketMaxLeverage: 50,
        currentMark: 66_300,
      }),
    ).toThrow(InvalidPacificaPositionError);
  });

  it("rejects non-finite market max leverage", () => {
    expect(() =>
      mapPacificaPosition({
        sourceAccount: "ABC123",
        position: basePosition,
        marketMaxLeverage: Number.POSITIVE_INFINITY,
        currentMark: 66_300,
      }),
    ).toThrow(InvalidPacificaPositionError);
  });

  it("calculates short PnL direction from entry price minus current mark", () => {
    const mapped = mapPacificaPosition({
      sourceAccount: "ABC123",
      position: positionWith({ side: "ask" }),
      marketMaxLeverage: 50,
      currentMark: 63_700,
    });

    expect(mapped.side).toBe("short");
    expect(mapped.unrealizedPnlPct).toBeCloseTo(20);
  });

  it("uses null unrealized PnL when current mark is null", () => {
    const mapped = mapPacificaPosition({
      sourceAccount: "ABC123",
      position: basePosition,
      marketMaxLeverage: 50,
      currentMark: null,
    });

    expect(mapped.currentMark).toBeNull();
    expect(mapped.unrealizedPnlPct).toBeNull();
  });

  it("uses the provided now value for lastSeenAt", () => {
    const now = new Date("2026-05-23T12:00:00.000Z");
    const mapped = mapPacificaPosition({
      sourceAccount: "ABC123",
      position: basePosition,
      marketMaxLeverage: 50,
      currentMark: 66_300,
      now,
    });

    expect(mapped.lastSeenAt).toBe(now);
  });
});
