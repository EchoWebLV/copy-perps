import { describe, expect, it } from "vitest";
import type { bets } from "@/lib/db/schema";
import { enrichBet } from "./enrich";

type BetRow = typeof bets.$inferSelect;

function bet(patch: Partial<BetRow>): BetRow {
  return {
    id: "bet-1",
    userId: "user-1",
    signalId: null,
    type: "copy",
    amountUsdc: 5,
    feeUsdc: null,
    txHash: null,
    status: "closed",
    meta: {
      leaderMarket: "MON",
      leaderSide: "short",
      leverage: 3,
      sourceAccount: "0xf28e1b06e00e8774c612e31ab3ac35d5a720085f",
    },
    closedAt: new Date("2026-05-25T17:45:00.000Z"),
    closeTxHash: "pacifica:123",
    proceedsUsdc: 9.95,
    sharedAt: null,
    createdAt: new Date("2026-05-25T17:37:00.000Z"),
    ...patch,
  } as BetRow;
}

describe("enrichBet", () => {
  it("adds display metadata for closed copy trades", async () => {
    const enriched = await enrichBet(bet({}), "wallet-1");
    expect(enriched).toMatchObject({
      id: "bet-1",
      type: "copy",
      status: "closed",
      asset: "MON",
      ticker: "MON",
      side: "short",
      leverage: 3,
      notionalUsd: 15,
      whaleAddress: "0xf28e1b06e00e8774c612e31ab3ac35d5a720085f",
    });
    expect(enriched.pnlUsdc).toBeCloseTo(4.95);
    expect(enriched.pnlPct).toBeCloseTo(99);
  });
});
