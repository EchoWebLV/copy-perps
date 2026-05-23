import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PacificaPosition } from "@/lib/pacifica/types";

const getLeaderboard = vi.fn();
const getMarkets = vi.fn();
const getPositions = vi.fn();
const getMarksSnapshot = vi.fn();
const upsertWhale = vi.fn();
const upsertWhalePosition = vi.fn();
const markMissingPacificaPositionsClosed = vi.fn();
const writeWhaleLiveSnapshot = vi.fn();

vi.mock("@/lib/pacifica/client", () => ({
  getLeaderboard,
  getMarkets,
  getPositions,
}));

vi.mock("@/lib/data/marks", () => ({
  getMarksSnapshot,
}));

vi.mock("./repository", () => ({
  upsertWhale,
  upsertWhalePosition,
  markMissingPacificaPositionsClosed,
}));

vi.mock("./live-cache", () => ({
  writeWhaleLiveSnapshot,
}));

const validPosition: PacificaPosition = {
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

describe("refreshPacificaWhales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLeaderboard.mockResolvedValue([
      {
        address: "ABC123",
        username: "captaindegen",
        pnl_1d: "10",
        pnl_7d: "20",
        pnl_30d: "30",
        pnl_all_time: "40",
        equity_current: "10000",
        oi_current: "1000",
        volume_1d: "100000",
        volume_7d: "200000",
        volume_30d: "300000",
        volume_all_time: "400000",
      },
    ]);
    getMarkets.mockResolvedValue([{ symbol: "BTC", max_leverage: 50 }]);
    getMarksSnapshot.mockResolvedValue(new Map([["BTC", 66_300]]));
    upsertWhale.mockResolvedValue(undefined);
    upsertWhalePosition.mockResolvedValue(undefined);
    markMissingPacificaPositionsClosed.mockResolvedValue(undefined);
    writeWhaleLiveSnapshot.mockResolvedValue(undefined);
  });

  it("skips invalid source positions and persists valid positions", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getPositions.mockResolvedValue([
      { ...validPosition, amount: "nope" },
      validPosition,
    ]);

    const { refreshPacificaWhales } = await import("./refresh-pacifica");
    const result = await refreshPacificaWhales();

    expect(result).toEqual({ whalesSeen: 1, positionsSeen: 1 });
    expect(upsertWhale).toHaveBeenCalledWith({
      id: "pacifica:ABC123",
      source: "pacifica",
      sourceAccount: "ABC123",
      displayName: "captaindegen",
      avatarUrl: null,
      tags: [],
    });
    expect(upsertWhalePosition).toHaveBeenCalledTimes(1);
    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pacifica:ABC123:BTC:long:1779543000000",
        sourceAccount: "ABC123",
      }),
    );
    expect(markMissingPacificaPositionsClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccount: "ABC123",
        openPositionIds: ["pacifica:ABC123:BTC:long:1779543000000"],
      }),
    );
    expect(writeWhaleLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "pacifica",
        accounts: ["ABC123"],
        whales: [
          expect.objectContaining({
            id: "pacifica:ABC123",
            sourceAccount: "ABC123",
            displayName: "captaindegen",
            status: "active",
          }),
        ],
        positions: [
          expect.objectContaining({
            id: "pacifica:ABC123:BTC:long:1779543000000",
            sourceAccount: "ABC123",
            status: "open",
          }),
        ],
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[whales] skipping invalid Pacifica position for ABC123:",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("rejects unexpected errors while persisting positions", async () => {
    getPositions.mockResolvedValue([validPosition]);
    upsertWhalePosition.mockRejectedValue(new Error("db down"));

    const { refreshPacificaWhales } = await import("./refresh-pacifica");

    await expect(refreshPacificaWhales()).rejects.toThrow("db down");
  });
});
