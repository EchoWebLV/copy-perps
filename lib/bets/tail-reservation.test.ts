import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: mocks.execute,
  },
}));

import { releaseTailReservation, reserveTailOnMarket } from "./tail-reservation";

describe("tail reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the atomic reservation returns a row", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    mocks.execute.mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] });

    await expect(reserveTailOnMarket("user-1", "ETH")).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("returns false when the atomic reservation returns no rows", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    mocks.execute.mockResolvedValueOnce({ rows: [] });

    await expect(reserveTailOnMarket("user-1", "ETH")).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("releases an existing reservation", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });

    await expect(releaseTailReservation("user-1", "ETH")).resolves.toBeUndefined();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
