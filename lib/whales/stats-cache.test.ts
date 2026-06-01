import { beforeEach, describe, expect, it } from "vitest";
import type { WhaleTraderSignal } from "@/lib/types";
import {
  clearWhaleTraderStatsForTests,
  readWhaleTraderStats,
  writeWhaleTraderStats,
} from "./stats-cache";

type WhaleTraderStats = WhaleTraderSignal["payload"]["stats"];

function stats(overrides: Partial<WhaleTraderStats> = {}): WhaleTraderStats {
  return {
    equityUsdc: 250_000,
    openInterestUsdc: 460_000,
    pnl1dUsdc: 1_234.56,
    pnl7dUsdc: -50,
    pnl30dUsdc: 9_000,
    pnlAllTimeUsdc: 42_000,
    pnlCurve: [{ t: 1, v: 42_000 }],
    winRatePct1d: null,
    totalCloses1d: 0,
    volume1dUsdc: 1_500_000,
    ...overrides,
  };
}

describe("whale trader stats cache", () => {
  beforeEach(async () => {
    await clearWhaleTraderStatsForTests();
  });

  it("round-trips persisted stats keyed by whale id", async () => {
    await writeWhaleTraderStats({ "whale-1": stats() });

    const read = await readWhaleTraderStats();

    expect(read.get("whale-1")).toEqual(stats());
  });

  it("merges new stats without dropping previously persisted whales", async () => {
    await writeWhaleTraderStats({ "whale-1": stats({ pnlAllTimeUsdc: 42_000 }) });
    await writeWhaleTraderStats({ "whale-2": stats({ pnlAllTimeUsdc: 9_000 }) });

    const read = await readWhaleTraderStats();

    expect(read.get("whale-1")?.pnlAllTimeUsdc).toBe(42_000);
    expect(read.get("whale-2")?.pnlAllTimeUsdc).toBe(9_000);
  });

  it("returns an empty map when nothing has been persisted", async () => {
    const read = await readWhaleTraderStats();

    expect(read.size).toBe(0);
  });
});
