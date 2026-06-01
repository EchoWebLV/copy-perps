import { describe, expect, it } from "vitest";
import type { HLLeaderboardRow } from "@/lib/hyperliquid/client";
import {
  filterTradeable,
  rankByWeeklyPnl,
  selectTradeableWhales,
} from "./leaderboard";

function row(
  overrides: {
    address?: string;
    accountValue?: number;
    day?: { pnl?: number; vlm?: number; roi?: number };
    week?: { pnl?: number; vlm?: number; roi?: number };
    displayName?: string | null;
  } = {},
): HLLeaderboardRow {
  const day = { pnl: 1000, roi: 0.01, vlm: 1_000_000, ...overrides.day };
  const week = { pnl: 5000, roi: 0.05, vlm: 5_000_000, ...overrides.week };
  return {
    ethAddress: overrides.address ?? "0xWHALE",
    accountValue: String(overrides.accountValue ?? 1_000_000),
    displayName: overrides.displayName ?? null,
    prize: 0,
    windowPerformances: [
      [
        "day",
        { pnl: String(day.pnl), roi: String(day.roi), vlm: String(day.vlm) },
      ],
      [
        "week",
        {
          pnl: String(week.pnl),
          roi: String(week.roi),
          vlm: String(week.vlm),
        },
      ],
      ["month", { pnl: "10000", roi: "0.1", vlm: "20000000" }],
      ["allTime", { pnl: "50000", roi: "0.5", vlm: "100000000" }],
    ],
  };
}

describe("filterTradeable", () => {
  it("keeps a mid-size directional winner", () => {
    expect(filterTradeable([row()])).toHaveLength(1);
  });

  it("drops accounts below the floor and above the ceiling", () => {
    const tooSmall = row({ address: "0xsmall", accountValue: 100_000 });
    const tooBig = row({ address: "0xbig", accountValue: 60_000_000 });
    expect(filterTradeable([tooSmall, tooBig])).toHaveLength(0);
  });

  it("drops accounts that are not up over the week", () => {
    const flat = row({ address: "0xflat", week: { pnl: 0 } });
    const down = row({ address: "0xdown", week: { pnl: -2000 } });
    expect(filterTradeable([flat, down])).toHaveLength(0);
  });

  it("drops HFT/MM bots with extreme daily turnover", () => {
    const bot = row({
      address: "0xbot",
      accountValue: 1_000_000,
      day: { vlm: 500_000_000 },
    });
    expect(filterTradeable([bot])).toHaveLength(0);
  });
});

describe("rankByWeeklyPnl", () => {
  it("orders by weekly pnl descending", () => {
    const a = row({ address: "0xa", week: { pnl: 1000 } });
    const b = row({ address: "0xb", week: { pnl: 9000 } });
    const c = row({ address: "0xc", week: { pnl: 5000 } });
    expect(rankByWeeklyPnl([a, b, c]).map((r) => r.ethAddress)).toEqual([
      "0xb",
      "0xc",
      "0xa",
    ]);
  });
});

describe("selectTradeableWhales", () => {
  it("filters, ranks by weekly pnl, lowercases, and caps at the limit", () => {
    const rows = [
      row({ address: "0xAAA", week: { pnl: 1000 } }),
      row({ address: "0xBBB", week: { pnl: 9000 } }),
      row({ address: "0xCCC", week: { pnl: 5000 } }),
      // Filtered out by the floor even though its weekly pnl is the highest.
      row({ address: "0xsmall", accountValue: 100_000, week: { pnl: 99999 } }),
    ];

    expect(selectTradeableWhales(rows, { limit: 2 })).toEqual([
      { address: "0xbbb", label: undefined },
      { address: "0xccc", label: undefined },
    ]);
  });

  it("carries through a non-empty leaderboard display name as the label", () => {
    const named = row({ address: "0xNAME", displayName: "  Whale One  " });

    expect(selectTradeableWhales([named], { limit: 1 })).toEqual([
      { address: "0xname", label: "Whale One" },
    ]);
  });
});
