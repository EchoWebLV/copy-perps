import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: mocks.execute,
  },
}));

import {
  blockTailReservation,
  releaseTailReservation,
  reserveTailOnMarket,
} from "./tail-reservation";

describe("tail reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the atomic reservation returns a row", async () => {
    mocks.execute.mockResolvedValueOnce([]);
    mocks.execute.mockResolvedValueOnce([{ user_id: "user-1" }]);

    await expect(reserveTailOnMarket("user-1", "ETH")).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("returns false when the atomic reservation returns no rows", async () => {
    mocks.execute.mockResolvedValueOnce([]);
    mocks.execute.mockResolvedValueOnce([]);

    await expect(reserveTailOnMarket("user-1", "ETH")).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("releases an existing reservation", async () => {
    mocks.execute.mockResolvedValue([]);

    await expect(releaseTailReservation("user-1", "ETH")).resolves.toBeUndefined();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("blocks a reservation until manual review", async () => {
    mocks.execute.mockResolvedValue([]);

    await expect(blockTailReservation("user-1", "ETH")).resolves.toBeUndefined();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const blockQuery = mocks.execute.mock.calls[1][0] as {
      queryChunks: Array<{ value?: string[] }>;
    };
    const sqlText = blockQuery.queryChunks
      .flatMap((chunk) => chunk.value ?? [])
      .join(" ");
    expect(sqlText).toContain("infinity");
  });
});
