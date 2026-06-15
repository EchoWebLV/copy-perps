import { describe, expect, it } from "vitest";
import type { ArenaBot, ArenaPosition } from "@/lib/arena/decode";
import type { WhaleTraderSignal } from "@/lib/types";
import {
  ARENA_START_BALANCE_USD,
  FEED_ENTITY_OPTIONS,
  FEED_SORT_OPTIONS,
  type FeedEntry,
  arenaMarketTicker,
  botEquityUsd,
  botPnlPct,
  botPositionPnlPct,
  botSortValue,
  botTotalPnlPct,
  botTotalPnlUsd,
  botUnrealizedPnlUsd,
  formatCompactSignedUsd,
  formatFeedAge,
  formatSignedPct,
  primaryBotPosition,
  rankFeedEntries,
  shouldUseRosterRefresh,
  sourceChipLabel,
  whaleHeaderPnl,
  whaleSortValue,
} from "./unified-feed-model";

function makeWhale(
  overrides: Partial<WhaleTraderSignal["payload"]["stats"]> = {},
  payloadOverrides: Partial<WhaleTraderSignal["payload"]> = {},
): WhaleTraderSignal {
  return {
    id: `whale_trader:${payloadOverrides.whaleId ?? "w1"}`,
    type: "whale_trader",
    heatScore: 0,
    createdAt: new Date(0).toISOString(),
    chips: [],
    payload: {
      whaleId: "w1",
      source: "pacifica",
      sourceAccount: "Acc1",
      displayName: "Whale One",
      avatarUrl: null,
      tags: [],
      openPositionsCount: 0,
      openPositions: [],
      bestPosition: null,
      stats: {
        equityUsdc: 100_000,
        openInterestUsdc: 0,
        pnl1dUsdc: 0,
        pnl7dUsdc: 0,
        pnl30dUsdc: 0,
        pnlAllTimeUsdc: 0,
        pnlCurve: [],
        winRatePct1d: null,
        totalCloses1d: 0,
        volume1dUsdc: 0,
        statsSource: "leaderboard",
        ...overrides,
      },
      lastSeenAt: null,
      stale: false,
      ...payloadOverrides,
    },
  };
}

function makePosition(overrides: Partial<ArenaPosition> = {}): ArenaPosition {
  return {
    active: true,
    marketId: 0,
    side: "long",
    entryPrice: 100,
    stakeUsd: 50,
    leverage: 10,
    openedTsMs: 1_000,
    ticksHeld: 3,
    liqPrice: 90,
    ...overrides,
  };
}

function makeBot(overrides: Partial<ArenaBot> = {}): ArenaBot {
  return {
    balanceUsd: 950,
    grossPnlUsd: -50,
    feesUsd: 4,
    equityHighUsd: 1_020,
    seq: 12,
    positions: [],
    tape: [],
    params: {
      maxHoldTicks: 20,
      breakoutBps: 30,
      activityMultBps: 10_000,
      stakeFracBps: 500,
      leverage: 100,
      exitFavorableBps: 25,
      readSpan: 4,
      trendFilter: false,
    },
    personaName: "scalper-v1",
    trades: 0,
    wins: 0,
    tapeHead: 0,
    bump: 255,
    ...overrides,
  };
}

describe("feed control options", () => {
  it("offers All/Whales/Bots entity pills and the four sorts with no heat", () => {
    expect(FEED_ENTITY_OPTIONS.map((o) => o.label)).toEqual([
      "All",
      "Whales",
      "Bots",
    ]);
    expect(FEED_SORT_OPTIONS.map((o) => o.label)).toEqual([
      "1D",
      "7D",
      "30D",
      "Equity",
    ]);
    const keys = FEED_SORT_OPTIONS.map((o) => o.key) as string[];
    expect(keys).not.toContain("heat");
    expect(keys[0]).toBe("pnl1d");
  });
});

describe("sort values", () => {
  it("maps whale sort keys onto the stats windows", () => {
    const whale = makeWhale({
      pnl1dUsdc: 11,
      pnl7dUsdc: 77,
      pnl30dUsdc: 303,
      equityUsdc: 9_000,
    });
    expect(whaleSortValue(whale, "pnl1d")).toBe(11);
    expect(whaleSortValue(whale, "pnl7d")).toBe(77);
    expect(whaleSortValue(whale, "pnl30d")).toBe(303);
    expect(whaleSortValue(whale, "equity")).toBe(9_000);
  });

  it("counts bot equity as cash plus active stake only", () => {
    const bot = makeBot({
      balanceUsd: 900,
      positions: [
        makePosition({ stakeUsd: 60 }),
        makePosition({ stakeUsd: 40, active: false }),
      ],
    });
    expect(botEquityUsd(bot)).toBe(960);
    expect(botSortValue(bot, "equity")).toBe(960);
  });

  it("stands gross P&L in for every bot P&L window and sinks unloaded bots", () => {
    const bot = makeBot({ grossPnlUsd: 123 });
    expect(botSortValue(bot, "pnl1d")).toBe(123);
    expect(botSortValue(bot, "pnl7d")).toBe(123);
    expect(botSortValue(bot, "pnl30d")).toBe(123);
    expect(botSortValue(null, "pnl1d")).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("rankFeedEntries", () => {
  const whaleHigh = makeWhale({ pnl1dUsdc: 500 }, { whaleId: "high" });
  const whaleLow = makeWhale({ pnl1dUsdc: -20 }, { whaleId: "low" });
  const bot = makeBot({ grossPnlUsd: 50 });
  const entries: FeedEntry[] = [
    { kind: "whale", whale: whaleLow },
    { kind: "bot", name: "scalper-v1", bot },
    { kind: "whale", whale: whaleHigh },
  ];

  it("interleaves whales and bots by the active sort value desc", () => {
    const ranked = rankFeedEntries(entries, "all", "pnl1d");
    expect(
      ranked.map((e) => (e.kind === "whale" ? e.whale.payload.whaleId : e.name)),
    ).toEqual(["high", "scalper-v1", "low"]);
  });

  it("filters to a single entity kind", () => {
    expect(
      rankFeedEntries(entries, "whales", "pnl1d").every(
        (e) => e.kind === "whale",
      ),
    ).toBe(true);
    expect(
      rankFeedEntries(entries, "bots", "pnl1d").every((e) => e.kind === "bot"),
    ).toBe(true);
  });

  it("ranks actively-trading whales above richer dormant ones", () => {
    const NOW = 1_000 * 60 * 60 * 100; // arbitrary fixed clock
    const dormantRich = makeWhale(
      { pnl1dUsdc: 9_999 },
      {
        whaleId: "dormant",
        openPositionsCount: 1,
        openPositions: [
          { openedAtMs: NOW - 48 * 60 * 60_000 } as never,
        ],
      },
    );
    const activePoor = makeWhale(
      { pnl1dUsdc: 10 },
      {
        whaleId: "active",
        openPositionsCount: 1,
        openPositions: [{ openedAtMs: NOW - 60_000 } as never],
      },
    );
    const ranked = rankFeedEntries(
      [
        { kind: "whale", whale: dormantRich },
        { kind: "whale", whale: activePoor },
      ],
      "whales",
      "pnl1d",
      NOW,
    );
    expect(
      ranked.map((e) => (e.kind === "whale" ? e.whale.payload.whaleId : "")),
    ).toEqual(["active", "dormant"]);
    // Hydration-safe first paint (nowMs 0) keeps the pure value order.
    const firstPaint = rankFeedEntries(
      [
        { kind: "whale", whale: dormantRich },
        { kind: "whale", whale: activePoor },
      ],
      "whales",
      "pnl1d",
      0,
    );
    expect(
      firstPaint.map((e) => (e.kind === "whale" ? e.whale.payload.whaleId : "")),
    ).toEqual(["dormant", "active"]);
  });

  it("does not mutate the input order", () => {
    const before = [...entries];
    rankFeedEntries(entries, "all", "equity");
    expect(entries).toEqual(before);
  });
});

describe("whaleHeaderPnl", () => {
  it("shows the active window and falls back to 1D for the equity sort", () => {
    const stats = makeWhale({
      pnl1dUsdc: 1,
      pnl7dUsdc: 7,
      pnl30dUsdc: 30,
    }).payload.stats;
    expect(whaleHeaderPnl(stats, "pnl7d")).toEqual({
      label: "P&L 7D",
      usd: 7,
      estimated: false,
    });
    expect(whaleHeaderPnl(stats, "equity")).toEqual({
      label: "P&L 1D",
      usd: 1,
      estimated: false,
    });
  });

  it("labels live-position estimates instead of presenting fake window zeros", () => {
    const stats = makeWhale({
      statsSource: "live_positions",
      pnlAllTimeUsdc: 42,
    }).payload.stats;
    expect(whaleHeaderPnl(stats, "pnl1d")).toEqual({
      label: "Live P&L",
      usd: 42,
      estimated: true,
    });
  });
});

describe("bot math", () => {
  it("computes lifetime P&L percent against the fixed start balance", () => {
    expect(ARENA_START_BALANCE_USD).toBe(1_000);
    expect(botPnlPct(makeBot({ grossPnlUsd: 125 }))).toBeCloseTo(12.5);
    expect(botPnlPct(makeBot({ grossPnlUsd: -50 }))).toBeCloseTo(-5);
  });

  it("folds unrealized P&L into live equity + whole-bot P&L (mark-to-market)", () => {
    // Opus's real shape: cash + a 10x long sitting in profit.
    const bot = makeBot({
      balanceUsd: 744.62,
      grossPnlUsd: -4.58,
      positions: [
        makePosition({ side: "long", entryPrice: 67.94, stakeUsd: 248.7, leverage: 10 }),
      ],
    });
    const mark = 75.15;
    // +10.6% underlying × 10x × $248.70 ≈ +$264 unrealized
    expect(botUnrealizedPnlUsd(bot, mark)).toBeCloseTo(263.9, 0);
    // equity = cash + margin + unrealized (the "1,257" the card now shows)
    expect(botEquityUsd(bot, mark)).toBeCloseTo(744.62 + 248.7 + 263.9, 0);
    // whole P/L reconciles exactly: start + total P/L === equity
    expect(ARENA_START_BALANCE_USD + botTotalPnlUsd(bot, mark)).toBeCloseTo(
      botEquityUsd(bot, mark),
      6,
    );
    expect(botTotalPnlUsd(bot, mark)).toBeGreaterThan(250); // up big, not −$4.58
    expect(botTotalPnlPct(bot, mark)).toBeCloseTo(botTotalPnlUsd(bot, mark) / 10, 6);
  });

  it("degrades to cash + open stake when there's no live mark", () => {
    const bot = makeBot({ balanceUsd: 744.62, positions: [makePosition({ stakeUsd: 248.7 })] });
    expect(botUnrealizedPnlUsd(bot, null)).toBe(0);
    expect(botEquityUsd(bot, null)).toBeCloseTo(744.62 + 248.7, 6);
    expect(botEquityUsd(bot)).toBeCloseTo(744.62 + 248.7, 6); // default arg = old behavior
  });

  it("computes leveraged position P&L off the live mark for both sides", () => {
    const long = makePosition({ side: "long", entryPrice: 100, leverage: 10 });
    const short = makePosition({ side: "short", entryPrice: 100, leverage: 20 });
    expect(botPositionPnlPct(long, 101)).toBeCloseTo(10);
    expect(botPositionPnlPct(short, 101)).toBeCloseTo(-20);
    expect(botPositionPnlPct(long, 99)).toBeCloseTo(-10);
  });

  it("returns null instead of inventing P&L when the mark or entry is unusable", () => {
    const pos = makePosition();
    expect(botPositionPnlPct(pos, null)).toBeNull();
    expect(botPositionPnlPct(pos, 0)).toBeNull();
    expect(botPositionPnlPct(makePosition({ entryPrice: 0 }), 100)).toBeNull();
  });

  it("picks the freshest active slot as the primary position", () => {
    const older = makePosition({ openedTsMs: 1_000 });
    const newest = makePosition({ openedTsMs: 9_000, side: "short" });
    const inactive = makePosition({ openedTsMs: 99_000, active: false });
    expect(
      primaryBotPosition(makeBot({ positions: [older, newest, inactive] })),
    ).toBe(newest);
    expect(primaryBotPosition(makeBot({ positions: [inactive] }))).toBeNull();
  });

  it("names the pinned devnet market and fails readable for unknown ids", () => {
    expect(arenaMarketTicker(0)).toBe("SOL");
    expect(arenaMarketTicker(7)).toBe("MKT7");
  });
});

describe("formatting", () => {
  it("buckets freshness ages into now/m/h/d", () => {
    expect(formatFeedAge(10_000)).toBe("now");
    expect(formatFeedAge(4 * 60_000)).toBe("4m");
    expect(formatFeedAge(3 * 3_600_000)).toBe("3h");
    expect(formatFeedAge(2 * 86_400_000)).toBe("2d");
    expect(formatFeedAge(-1)).toBe("—");
  });

  it("renders signed two-decimal percents", () => {
    expect(formatSignedPct(2.371)).toBe("+2.37%");
    expect(formatSignedPct(-0.4)).toBe("-0.40%");
    expect(formatSignedPct(0)).toBe("+0.00%");
  });

  it("compacts signed USD for the header P&L block", () => {
    expect(formatCompactSignedUsd(12_400)).toBe("+$12.4K");
    expect(formatCompactSignedUsd(-1_200_000)).toBe("-$1.2M");
    expect(formatCompactSignedUsd(950)).toBe("+$950");
    expect(formatCompactSignedUsd(-42)).toBe("-$42");
  });

  it("maps sources to short chips", () => {
    expect(sourceChipLabel("pacifica")).toBe("PAC");
    expect(sourceChipLabel("hyperliquid")).toBe("HL");
    expect(sourceChipLabel("ostium")).toBe("OST");
  });
});

describe("shouldUseRosterRefresh", () => {
  const withOpen = makeWhale(
    {},
    { whaleId: "open", openPositionsCount: 2, stale: false },
  );
  const staleFlat = makeWhale(
    {},
    { whaleId: "flat", openPositionsCount: 0, stale: true },
  );

  it("accepts any refresh when nothing is held yet", () => {
    expect(shouldUseRosterRefresh([staleFlat], [])).toBe(true);
  });

  it("never blanks a good roster with an empty response", () => {
    expect(shouldUseRosterRefresh([], [withOpen])).toBe(false);
  });

  it("rejects an all-stale zero-position refresh over live open positions", () => {
    expect(shouldUseRosterRefresh([staleFlat], [withOpen])).toBe(false);
  });

  it("accepts a refresh that still carries open positions", () => {
    expect(shouldUseRosterRefresh([withOpen], [withOpen])).toBe(true);
  });
});
