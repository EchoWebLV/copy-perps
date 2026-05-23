import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rows: Array<{ status: string; meta: unknown }> = [];
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(async () => rows),
  };

  return {
    rows,
    select: vi.fn(() => selectChain),
    selectChain,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.select,
  },
}));

import { hasOpenTailOnMarket } from "./copy-guard";

describe("hasOpenTailOnMarket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.length = 0;
  });

  it.each(["confirmed", "pending", "manual_review"])(
    "blocks %s copy bets on the same market",
    async (status) => {
      mocks.rows.push({
        status,
        meta: { leaderMarket: "ETH" },
      });

      await expect(hasOpenTailOnMarket("user-1", "ETH")).resolves.toBe(true);
    },
  );

  it("does not block failed or closed copy bets on the same market", async () => {
    mocks.rows.push(
      { status: "failed", meta: { leaderMarket: "ETH" } },
      { status: "closed", meta: { leaderMarket: "ETH" } },
    );

    await expect(hasOpenTailOnMarket("user-1", "ETH")).resolves.toBe(false);
  });

  it("does not block copy bets on another market", async () => {
    mocks.rows.push({
      status: "confirmed",
      meta: { leaderMarket: "BTC" },
    });

    await expect(hasOpenTailOnMarket("user-1", "ETH")).resolves.toBe(false);
  });
});
