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

  it("a flash-v2 row blocks only the flash-v2 venue, not pacifica", async () => {
    mocks.rows.push({
      status: "confirmed",
      meta: { leaderMarket: "ETH", venue: "flash-v2" },
    });

    await expect(hasOpenTailOnMarket("user-1", "ETH", "flash-v2")).resolves.toBe(true);
    await expect(hasOpenTailOnMarket("user-1", "ETH", "pacifica")).resolves.toBe(false);
  });

  it("a legacy (no venue) row counts as pacifica: blocks pacifica, not flash-v2", async () => {
    mocks.rows.push({
      status: "confirmed",
      meta: { leaderMarket: "ETH" },
    });

    await expect(hasOpenTailOnMarket("user-1", "ETH", "pacifica")).resolves.toBe(true);
    await expect(hasOpenTailOnMarket("user-1", "ETH", "flash-v2")).resolves.toBe(false);
  });

  it("cross-venue independence: a pacifica and a flash-v2 tail on the same market each block only their own venue", async () => {
    mocks.rows.push(
      { status: "confirmed", meta: { leaderMarket: "ETH", venue: "flash-v2" } },
      { status: "confirmed", meta: { leaderMarket: "ETH" } },
    );

    await expect(hasOpenTailOnMarket("user-1", "ETH", "flash-v2")).resolves.toBe(true);
    await expect(hasOpenTailOnMarket("user-1", "ETH", "pacifica")).resolves.toBe(true);
    await expect(hasOpenTailOnMarket("user-1", "BTC", "flash-v2")).resolves.toBe(false);
  });
});
