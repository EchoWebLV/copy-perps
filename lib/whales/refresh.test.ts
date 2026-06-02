import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshPacificaWhales: vi.fn(),
  refreshHyperliquidWhales: vi.fn(),
  refreshOstiumWhales: vi.fn(),
}));

vi.mock("./refresh-pacifica", () => ({
  refreshPacificaWhales: mocks.refreshPacificaWhales,
}));
vi.mock("./refresh-hyperliquid", () => ({
  refreshHyperliquidWhales: mocks.refreshHyperliquidWhales,
}));
vi.mock("./refresh-ostium", () => ({
  refreshOstiumWhales: mocks.refreshOstiumWhales,
}));

import { refreshWhales } from "./refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshPacificaWhales.mockResolvedValue({
    whalesSeen: 1,
    positionsSeen: 2,
  });
  mocks.refreshHyperliquidWhales.mockResolvedValue({
    whalesSeen: 1,
    positionsSeen: 3,
  });
  mocks.refreshOstiumWhales.mockResolvedValue({
    whalesSeen: 1,
    positionsSeen: 5,
  });
});

describe("refreshWhales", () => {
  it("runs all three sources and sums their counts", async () => {
    const result = await refreshWhales();
    expect(mocks.refreshOstiumWhales).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ whalesSeen: 3, positionsSeen: 10 });
  });

  it("still succeeds when one source rejects", async () => {
    mocks.refreshOstiumWhales.mockRejectedValue(new Error("ostium down"));
    const result = await refreshWhales();
    expect(result).toEqual({ whalesSeen: 2, positionsSeen: 5 });
  });

  it("throws only when every source rejects", async () => {
    mocks.refreshPacificaWhales.mockRejectedValue(new Error("p"));
    mocks.refreshHyperliquidWhales.mockRejectedValue(new Error("h"));
    mocks.refreshOstiumWhales.mockRejectedValue(new Error("o"));
    await expect(refreshWhales()).rejects.toThrow();
  });
});
