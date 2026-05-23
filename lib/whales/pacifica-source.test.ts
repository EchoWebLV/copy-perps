import { describe, expect, it } from "vitest";
import {
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
});
