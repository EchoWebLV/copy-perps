import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";
import type { WhaleLiveSnapshot } from "@/lib/whales/live-cache";
import {
  clearWhaleTraderStatsForTests,
  writeWhaleTraderStats,
} from "@/lib/whales/stats-cache";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  return {
    query,
    db: {
      select: vi.fn(),
    },
    getLeaderboard: vi.fn(),
    getPositionsHistory: vi.fn(),
    getPortfolio: vi.fn(),
    getWhaleLiveSnapshot: vi.fn(),
    refreshWhales: vi.fn(),
    analysisRows: [] as unknown[],
  };
});

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/pacifica/client", () => ({
  getLeaderboard: mocks.getLeaderboard,
  getPositionsHistory: mocks.getPositionsHistory,
}));

vi.mock("@/lib/hyperliquid/client", () => ({
  getPortfolio: mocks.getPortfolio,
}));

vi.mock("@/lib/whales/live-cache", () => ({
  getWhaleLiveSnapshot: mocks.getWhaleLiveSnapshot,
}));

vi.mock("@/lib/whales/refresh", () => ({
  refreshWhales: mocks.refreshWhales,
}));

vi.mock("@/lib/db/schema", () => ({
  whalePositionAnalysis: {
    positionId: "whalePositionAnalysis.positionId",
  },
}));

vi.mock("drizzle-orm", () => ({
  inArray: vi.fn((column: unknown, values: unknown[]) => ({
    inArray: [column, values],
  })),
}));

// In-memory stand-in for the Postgres-backed durable stats store. Plain
// functions (not vi.fn) so the suite's vi.resetAllMocks() doesn't wipe them.
const statsStore = vi.hoisted(() => ({ blob: {} as Record<string, unknown> }));
vi.mock("@/lib/whales/stats-store", () => ({
  loadStatsBlob: async () => ({ ...statsStore.blob }),
  saveStatsBlob: async (blob: Record<string, unknown>) => {
    statsStore.blob = { ...blob };
  },
  clearStatsBlob: async () => {
    statsStore.blob = {};
  },
}));

function whale(
  overrides: Partial<WhaleLiveSnapshot["whales"][number]> = {},
): WhaleLiveSnapshot["whales"][number] {
  const now = new Date("2026-05-23T12:00:00.000Z");
  return {
    id: "whale-1",
    source: "pacifica",
    sourceAccount: "acct-1",
    displayName: "Alpha",
    avatarUrl: "https://example.com/alpha.png",
    status: "active",
    tags: ["leader"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function position(
  overrides: Partial<WhaleLiveSnapshot["positions"][number]> = {},
): WhaleLiveSnapshot["positions"][number] {
  return {
    id: "pos-1",
    whaleId: "whale-1",
    source: "pacifica",
    sourceAccount: "acct-1",
    market: "BTC",
    side: "long",
    leverage: 10,
    amountBase: 0.5,
    notionalUsd: 450_000,
    entryPrice: 60_000,
    currentMark: 63_000,
    unrealizedPnlPct: 12.6,
    openedAt: new Date("2026-05-23T11:00:00.000Z"),
    closedAt: null,
    status: "open",
    raw: {},
    lastSeenAt: new Date("2026-05-23T11:59:30.000Z"),
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<WhaleLiveSnapshot> = {},
): WhaleLiveSnapshot {
  return {
    source: "pacifica",
    observedAt: new Date("2026-05-23T11:59:50.000Z"),
    accounts: ["acct-1"],
    whales: [whale()],
    positions: [position()],
    ...overrides,
  };
}

describe("whale signals", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));
    await clearWhaleTraderStatsForTests();

    mocks.analysisRows = [];
    mocks.getLeaderboard.mockResolvedValue([]);
    mocks.getPositionsHistory.mockResolvedValue([]);
    mocks.getPortfolio.mockResolvedValue([]);
    mocks.getWhaleLiveSnapshot.mockResolvedValue(snapshot());
    mocks.refreshWhales.mockResolvedValue({
      whalesSeen: 1,
      positionsSeen: 1,
    });
    mocks.query.from.mockReturnValue(mocks.query);
    mocks.query.where.mockReturnValue(mocks.query);
    mocks.query.limit.mockImplementation(async () => mocks.analysisRows);
    mocks.db.select.mockReturnValue(mocks.query);
  });

  it("maps cached live positions with heat and fallback analysis", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        whales: [
          whale(),
          whale({
            id: "whale-2",
            sourceAccount: "acct-2",
            displayName: "Beta",
          }),
        ],
        accounts: ["acct-1", "acct-2"],
        positions: [
          position(),
          position({
            id: "pos-2",
            whaleId: "whale-2",
            sourceAccount: "acct-2",
            market: "ETH",
            side: "short",
            leverage: 5,
            amountBase: 2,
            notionalUsd: 50_000,
            entryPrice: 3_200,
            currentMark: null,
            unrealizedPnlPct: null,
            openedAt: new Date("2026-05-23T10:00:00.000Z"),
            lastSeenAt: new Date("2026-05-23T11:59:10.000Z"),
            raw: { copyableOnPacifica: false },
          }),
          position({
            id: "stale-pos",
            lastSeenAt: new Date("2026-05-23T11:56:00.000Z"),
          }),
        ],
      }),
    );
    mocks.analysisRows = [
      {
        positionId: "pos-1",
        summary: "Momentum long",
        thesis: "Breakout continuation",
        risk: "Invalidates under VWAP",
        entryGapWarning: null,
        confidence: 0.72,
      },
    ];

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const signals = await buildWhalePositionSignals(2);

    expect(mocks.query.limit).toHaveBeenCalledWith(2);
    expect(signals.map((signal) => signal.payload.positionId)).toEqual([
      "pos-1",
      "pos-2",
    ]);
    expect(signals[0]).toEqual({
      id: "whale_position:pos-1",
      type: "whale_position",
      heatScore: 913,
      createdAt: "2026-05-23T12:00:00.000Z",
      chips: [],
      payload: {
        positionId: "pos-1",
        whaleId: "whale-1",
        source: "pacifica",
        sourceAccount: "acct-1",
        displayName: "Alpha",
        avatarUrl: "https://example.com/alpha.png",
        market: "BTC",
        side: "long",
        leverage: 10,
        maxLeverage: 10,
        amountBase: 0.5,
        notionalUsd: 450_000,
        entryPrice: 60_000,
        currentMark: 63_000,
        unrealizedPnlPct: 12.6,
        openedAtMs: 1779534000000,
        openedAtKnown: true,
        lastSeenAtMs: 1779537570000,
        stale: false,
        copyableOnPacifica: true,
        analysis: {
          summary: "Momentum long",
          thesis: "Breakout continuation",
          risk: "Invalidates under VWAP",
          entryGapWarning: null,
          confidence: 0.72,
        },
      },
    });
    expect(signals[1]).toMatchObject({
      id: "whale_position:pos-2",
      heatScore: 650,
      payload: {
        positionId: "pos-2",
        whaleId: "whale-2",
        market: "ETH",
        stale: false,
        copyableOnPacifica: false,
        analysis: {
          summary: "Beta is carrying a 5x short on ETH with about $50K live.",
          thesis:
            "Current mark is unavailable, so the useful signal is exposure: a live short on ETH, not confirmed momentum from price.",
          risk:
            "5x leverage makes entry timing matter. Followers enter at the live mark, may not share the whale's margin, and can be forced out before the whale closes.",
          entryGapWarning: null,
          confidence: 0.25,
        },
      },
    });
  });

  it("passes Pacifica market max leverage through whale position payloads", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        positions: [
          position({
            raw: { pacificaMaxLeverage: 50 },
          }),
        ],
      }),
    );

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const signals = await buildWhalePositionSignals();

    expect(signals[0]?.payload.maxLeverage).toBe(50);
  });

  it("hides non-copyable markets by default but includes them when asked", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        positions: [position(), position({ id: "near-pos", market: "NEAR" })],
      }),
    );

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const tailableOnly = await buildWhalePositionSignals();
    expect(tailableOnly.map((signal) => signal.payload.market)).toEqual(["BTC"]);

    const everything = await buildWhalePositionSignals(100, {
      includeNonCopyable: true,
    });
    expect(
      [...everything.map((signal) => signal.payload.market)].sort(),
    ).toEqual(["BTC", "NEAR"]);
  });

  it("groups position signals into sorted trader signals", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        whales: [
          whale(),
          whale({
            id: "whale-2",
            source: "hyperliquid",
            sourceAccount: "acct-2",
            displayName: "Beta",
            avatarUrl: null,
            tags: [],
          }),
        ],
        accounts: ["acct-1", "acct-2"],
        positions: [
          position({
            unrealizedPnlPct: 12,
          }),
          position({
            id: "pos-2",
            market: "ETH",
            side: "short",
            leverage: 5,
            amountBase: 1,
            notionalUsd: 10_000,
            entryPrice: 3_000,
            currentMark: 2_900,
            unrealizedPnlPct: 4,
            openedAt: new Date("2026-05-23T10:00:00.000Z"),
            lastSeenAt: new Date("2026-05-23T11:59:15.000Z"),
          }),
          position({
            id: "pos-3",
            whaleId: "whale-2",
            source: "hyperliquid",
            sourceAccount: "acct-2",
            market: "SOL",
            side: "long",
            leverage: 3,
            amountBase: 20,
            notionalUsd: 20_000,
            entryPrice: 150,
            currentMark: 155,
            unrealizedPnlPct: 3,
            openedAt: new Date("2026-05-23T09:00:00.000Z"),
            lastSeenAt: new Date("2026-05-23T11:59:00.000Z"),
          }),
        ],
      }),
    );
    mocks.getLeaderboard.mockResolvedValue([
      {
        address: "acct-1",
        username: "Alpha",
        pnl_1d: "1234.56",
        pnl_7d: "-50",
        pnl_30d: "9000",
        pnl_all_time: "42000",
        equity_current: "250000",
        oi_current: "460000",
        volume_1d: "1500000",
        volume_7d: "7000000",
        volume_30d: "25000000",
        volume_all_time: "100000000",
      },
    ]);
    mocks.getPositionsHistory.mockResolvedValue([
      {
        history_id: 1,
        order_id: 1,
        client_order_id: null,
        symbol: "SOL",
        amount: "1",
        price: "100",
        entry_price: "90",
        fee: "2",
        spot_fee: null,
        pnl: "10",
        event_type: "fulfill_taker",
        side: "close_long",
        created_at: Date.parse("2026-05-22T12:00:00.000Z"),
        cause: "filled",
      },
    ]);

    const { buildWhaleTraderSignals } = await import("./whale-signals");

    const signals = await buildWhaleTraderSignals();

    expect(signals.map((signal) => signal.id)).toEqual([
      "whale_trader:whale-1",
      "whale_trader:whale-2",
    ]);
    expect(signals[0]).toMatchObject({
      type: "whale_trader",
      heatScore: 962,
      createdAt: "2026-05-23T12:00:00.000Z",
      chips: [],
      payload: {
        whaleId: "whale-1",
        source: "pacifica",
        sourceAccount: "acct-1",
        displayName: "Alpha",
        avatarUrl: "https://example.com/alpha.png",
        tags: ["leader"],
        openPositionsCount: 2,
        lastSeenAt: "2026-05-23T11:59:30.000Z",
        stale: false,
        stats: {
          equityUsdc: 250000,
          openInterestUsdc: 460000,
          pnl1dUsdc: 1234.56,
          pnl7dUsdc: -50,
          pnl30dUsdc: 9000,
          pnlAllTimeUsdc: 42000,
          pnlCurve: [
            { t: Date.parse("2026-05-22T12:00:00.000Z") - 1, v: 41992 },
            { t: Date.parse("2026-05-22T12:00:00.000Z"), v: 42000 },
          ],
          winRatePct1d: null,
          totalCloses1d: 0,
          volume1dUsdc: 1500000,
        },
      },
    });
    expect(signals[0]?.payload.bestPosition?.positionId).toBe("pos-1");
    expect(
      signals[0]?.payload.openPositions.map((position) => position.positionId),
    ).toEqual(["pos-1", "pos-2"]);
    expect(
      signals[1]?.payload.openPositions.map((position) => position.positionId),
    ).toEqual(["pos-3"]);
    mocks.getPortfolio.mockResolvedValueOnce([
      [
        "day",
        {
          accountValueHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "50000"]],
          pnlHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "250"]],
          vlm: "90000",
        },
      ],
      [
        "week",
        {
          accountValueHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "50000"]],
          pnlHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "700"]],
          vlm: "300000",
        },
      ],
      [
        "month",
        {
          accountValueHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "50000"]],
          pnlHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "1200"]],
          vlm: "800000",
        },
      ],
      [
        "allTime",
        {
          accountValueHistory: [
            [Date.parse("2026-05-22T12:00:00.000Z"), "49000"],
            [Date.parse("2026-05-23T12:00:00.000Z"), "50000"],
          ],
          pnlHistory: [
            [Date.parse("2026-05-22T12:00:00.000Z"), "900"],
            [Date.parse("2026-05-23T12:00:00.000Z"), "1500"],
          ],
          vlm: "1000000",
        },
      ],
    ]);

    const withHlStats = await buildWhaleTraderSignals();

    expect(mocks.getPortfolio).toHaveBeenCalledWith("acct-2");
    expect(withHlStats[1]).toMatchObject({
      heatScore: 648,
      payload: {
        whaleId: "whale-2",
        openPositionsCount: 1,
        lastSeenAt: "2026-05-23T11:59:00.000Z",
        stale: false,
        stats: {
          equityUsdc: 50000,
          openInterestUsdc: 20000,
          pnl1dUsdc: 250,
          pnl7dUsdc: 700,
          pnl30dUsdc: 1200,
          pnlAllTimeUsdc: 1500,
          pnlCurve: [
            { t: Date.parse("2026-05-22T12:00:00.000Z"), v: 900 },
            { t: Date.parse("2026-05-23T12:00:00.000Z"), v: 1500 },
          ],
          volume1dUsdc: 90000,
        },
      },
    });
  });

  it("uses live open P/L for Hyperliquid roster stats when portfolio history is unavailable", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        whales: [
          whale({
            id: "hl-whale",
            source: "hyperliquid",
            sourceAccount: "0x023a",
            displayName: "HL 0x023a",
            avatarUrl: null,
            tags: ["hyperliquid"],
          }),
        ],
        accounts: ["0x023a"],
        positions: [
          position({
            id: "hl-pos-1",
            whaleId: "hl-whale",
            source: "hyperliquid",
            sourceAccount: "0x023a",
            market: "BTC",
            side: "long",
            leverage: 10,
            notionalUsd: 100_000,
            unrealizedPnlPct: 25,
          }),
          position({
            id: "hl-pos-2",
            whaleId: "hl-whale",
            source: "hyperliquid",
            sourceAccount: "0x023a",
            market: "ETH",
            side: "short",
            leverage: 5,
            notionalUsd: 50_000,
            unrealizedPnlPct: -10,
          }),
        ],
      }),
    );
    mocks.getPortfolio.mockRejectedValue(new Error("rate limited"));

    const { buildWhaleTraderSignals } = await import("./whale-signals");

    const signals = await buildWhaleTraderSignals();

    expect(signals[0]).toMatchObject({
      payload: {
        whaleId: "hl-whale",
        stats: {
          statsSource: "live_positions",
          pnlAllTimeUsdc: 1500,
          pnl1dUsdc: 0,
          pnl7dUsdc: 0,
          pnl30dUsdc: 0,
          pnlCurve: [],
        },
      },
    });
  });

  it("caches Hyperliquid portfolio history so a rate-limited refresh keeps the P&L curve", async () => {
    const { buildWhaleTraderSignals, clearWhaleSignalCachesForTests } =
      await import("./whale-signals");
    clearWhaleSignalCachesForTests();

    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        whales: [
          whale({
            id: "hl-cached",
            source: "hyperliquid",
            sourceAccount: "0xc0ffee",
            displayName: "HL 0xc0ffee",
            avatarUrl: null,
            tags: ["hyperliquid"],
          }),
        ],
        accounts: ["0xc0ffee"],
        positions: [
          position({
            id: "hl-cached-pos",
            whaleId: "hl-cached",
            source: "hyperliquid",
            sourceAccount: "0xc0ffee",
            market: "BTC",
            side: "long",
            leverage: 10,
            notionalUsd: 100_000,
            unrealizedPnlPct: 25,
          }),
        ],
      }),
    );

    // Portfolio history resolves on the first refresh only. A later refresh
    // that hits Hyperliquid's rate limit falls back to the base `[]` mock — the
    // cache must keep serving the last good curve instead of going UNAVAILABLE.
    mocks.getPortfolio.mockResolvedValueOnce([
      [
        "allTime",
        {
          accountValueHistory: [
            [Date.parse("2026-05-22T12:00:00.000Z"), "49000"],
            [Date.parse("2026-05-23T12:00:00.000Z"), "50000"],
          ],
          pnlHistory: [
            [Date.parse("2026-05-22T12:00:00.000Z"), "900"],
            [Date.parse("2026-05-23T12:00:00.000Z"), "1500"],
          ],
          vlm: "1000000",
        },
      ],
    ]);

    const first = await buildWhaleTraderSignals();
    const second = await buildWhaleTraderSignals();

    expect(mocks.getPortfolio).toHaveBeenCalledTimes(1);
    expect(first[0]?.payload.stats.statsSource).toBe("portfolio");
    expect(second[0]?.payload.stats).toMatchObject({
      statsSource: "portfolio",
      pnlAllTimeUsdc: 1500,
    });
    expect(second[0]?.payload.stats.pnlCurve.length).toBeGreaterThan(0);
  });

  it("keeps the cached Hyperliquid P&L curve past the old five-minute window", async () => {
    const { buildWhaleTraderSignals, clearWhaleSignalCachesForTests } =
      await import("./whale-signals");
    clearWhaleSignalCachesForTests();

    const hlSnapshot = (observedIso: string) =>
      snapshot({
        source: "hyperliquid",
        observedAt: new Date(observedIso),
        accounts: ["0xdecaf"],
        whales: [
          whale({
            id: "hl-ttl",
            source: "hyperliquid",
            sourceAccount: "0xdecaf",
            displayName: "HL 0xdecaf",
            avatarUrl: null,
            tags: ["hyperliquid"],
          }),
        ],
        positions: [
          position({
            id: "hl-ttl-pos",
            whaleId: "hl-ttl",
            source: "hyperliquid",
            sourceAccount: "0xdecaf",
            market: "BTC",
            side: "long",
            leverage: 10,
            notionalUsd: 100_000,
            unrealizedPnlPct: 25,
            openedAt: new Date(observedIso),
            lastSeenAt: new Date(observedIso),
          }),
        ],
      });

    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      hlSnapshot("2026-05-23T11:59:55.000Z"),
    );
    mocks.getPortfolio.mockResolvedValueOnce([
      [
        "allTime",
        {
          accountValueHistory: [
            [Date.parse("2026-05-23T12:00:00.000Z"), "50000"],
          ],
          pnlHistory: [[Date.parse("2026-05-23T12:00:00.000Z"), "1500"]],
          vlm: "1000000",
        },
      ],
    ]);

    const first = await buildWhaleTraderSignals();
    expect(first[0]?.payload.stats.statsSource).toBe("portfolio");

    // Six minutes later — past the previous 5-minute TTL. The snapshot is kept
    // fresh, so the only thing that could flip the curve to "UNAVAILABLE" is the
    // portfolio cache expiring. With the longer TTL it must stay a cache hit.
    vi.setSystemTime(new Date("2026-05-23T12:06:00.000Z"));
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      hlSnapshot("2026-05-23T12:05:55.000Z"),
    );

    const later = await buildWhaleTraderSignals();

    expect(mocks.getPortfolio).toHaveBeenCalledTimes(1);
    expect(later[0]?.payload.stats.statsSource).toBe("portfolio");
    expect(later[0]?.payload.stats.pnlAllTimeUsdc).toBe(1500);
  });

  it("caches trader signals for roster API callers", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(snapshot());
    mocks.getLeaderboard.mockResolvedValue([
      {
        address: "acct-1",
        username: "Alpha",
        pnl_1d: "10",
        pnl_7d: "20",
        pnl_30d: "30",
        pnl_all_time: "40",
        equity_current: "500",
        oi_current: "450",
        volume_1d: "1000",
        volume_7d: "2000",
        volume_30d: "3000",
        volume_all_time: "4000",
      },
    ]);

    const {
      buildCachedWhaleTraderSignals,
      clearWhaleSignalCachesForTests,
    } = await import("./whale-signals");

    clearWhaleSignalCachesForTests();
    const first = await buildCachedWhaleTraderSignals();
    const second = await buildCachedWhaleTraderSignals();

    expect(first.map((signal) => signal.id)).toEqual(["whale_trader:whale-1"]);
    expect(second).toEqual(first);
    expect(mocks.getLeaderboard).toHaveBeenCalledTimes(1);
    expect(mocks.getPositionsHistory).toHaveBeenCalledTimes(1);
  });

  it("serves a local roster snapshot while the first enriched roster is still building", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(snapshot());
    mocks.getLeaderboard.mockImplementation(() => new Promise(() => {}));

    const {
      buildCachedWhaleTraderSignals,
      clearWhaleSignalCachesForTests,
    } = await import("./whale-signals");

    clearWhaleSignalCachesForTests();

    try {
      const result = await Promise.race<WhaleTraderSignal[] | "blocked">([
        buildCachedWhaleTraderSignals(),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), 50);
        }),
      ]);

      expect(result).not.toBe("blocked");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "whale_trader:whale-1",
        payload: {
          whaleId: "whale-1",
          openPositionsCount: 1,
          stats: {
            equityUsdc: 0,
            openInterestUsdc: 0,
            pnlAllTimeUsdc: 0,
            pnlCurve: [],
          },
        },
      });
      expect(mocks.getLeaderboard).toHaveBeenCalledTimes(1);
    } finally {
      clearWhaleSignalCachesForTests();
    }
  });

  it("hydrates last-good roster stats on cold start instead of showing zeros", async () => {
    await writeWhaleTraderStats({
      "whale-1": {
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
      },
    });

    mocks.getWhaleLiveSnapshot.mockResolvedValue(snapshot());
    // Hang the enriched build so the within-budget cold-start local fallback is
    // what gets served.
    mocks.getLeaderboard.mockImplementation(() => new Promise(() => {}));

    const { buildCachedWhaleTraderSignals, clearWhaleSignalCachesForTests } =
      await import("./whale-signals");
    clearWhaleSignalCachesForTests();

    try {
      const result = await buildCachedWhaleTraderSignals();

      expect(result[0]?.payload.stats.pnlAllTimeUsdc).toBe(42_000);
      expect(result[0]?.payload.stats.equityUsdc).toBe(250_000);
      expect(result[0]?.payload.stats.pnlCurve).toEqual([{ t: 1, v: 42_000 }]);
    } finally {
      clearWhaleSignalCachesForTests();
    }
  });

  it("retries roster enrichment quickly after an empty cold-start result", async () => {
    const {
      buildCachedWhaleTraderSignals,
      clearWhaleSignalCachesForTests,
    } = await import("./whale-signals");

    clearWhaleSignalCachesForTests();

    try {
      mocks.getWhaleLiveSnapshot.mockResolvedValue(null);
      const first = await buildCachedWhaleTraderSignals();

      mocks.getWhaleLiveSnapshot.mockResolvedValue(snapshot());
      vi.setSystemTime(new Date("2026-05-23T12:00:02.000Z"));
      const second = await buildCachedWhaleTraderSignals();

      expect(first).toEqual([]);
      expect(second.map((signal) => signal.payload.whaleId)).toEqual([
        "whale-1",
      ]);
    } finally {
      clearWhaleSignalCachesForTests();
    }
  });

  it("includes active whales without open positions in trader signals", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        accounts: ["idle-acct"],
        whales: [
          whale({
            id: "idle-whale",
            sourceAccount: "idle-acct",
            displayName: "Idle Alpha",
            avatarUrl: null,
            tags: ["steady", "watchlist"],
          }),
        ],
        positions: [],
      }),
    );

    const { buildWhaleTraderSignals } = await import("./whale-signals");

    const signals = await buildWhaleTraderSignals();

    expect(signals).toEqual([
      {
        id: "whale_trader:idle-whale",
        type: "whale_trader",
        heatScore: 100,
        createdAt: "2026-05-23T12:00:00.000Z",
        chips: [],
        payload: {
          whaleId: "idle-whale",
          source: "pacifica",
          sourceAccount: "idle-acct",
          displayName: "Idle Alpha",
          avatarUrl: null,
          tags: ["steady", "watchlist"],
          openPositionsCount: 0,
          bestPosition: null,
          stats: {
            equityUsdc: 0,
            openInterestUsdc: 0,
            pnl1dUsdc: 0,
            pnl7dUsdc: 0,
            pnl30dUsdc: 0,
            pnlAllTimeUsdc: 0,
            pnlCurve: [
              { t: Date.parse("2026-04-23T12:00:00.000Z"), v: 0 },
              { t: Date.parse("2026-05-16T12:00:00.000Z"), v: 0 },
              { t: Date.parse("2026-05-22T12:00:00.000Z"), v: 0 },
              { t: Date.parse("2026-05-23T12:00:00.000Z"), v: 0 },
            ],
            winRatePct1d: null,
            totalCloses1d: 0,
            volume1dUsdc: 0,
          },
          lastSeenAt: null,
          openPositions: [],
          stale: true,
        },
      },
    ]);
  });

  it("filters hidden whales, retired whales, and stale positions", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        accounts: ["hidden-acct", "retired-acct", "active-acct"],
        whales: [
          whale({
            id: "hidden-whale",
            sourceAccount: "hidden-acct",
            displayName: "Hidden",
            avatarUrl: null,
            status: "hidden",
            tags: [],
          }),
          whale({
            id: "retired-whale",
            source: "hyperliquid",
            sourceAccount: "retired-acct",
            displayName: "Retired",
            avatarUrl: null,
            status: "retired",
            tags: [],
          }),
          whale({
            id: "active-whale",
            sourceAccount: "active-acct",
            displayName: "Active",
            avatarUrl: null,
            tags: ["copyable"],
          }),
        ],
        positions: [
          position({
            id: "hidden-pos",
            whaleId: "hidden-whale",
            sourceAccount: "hidden-acct",
          }),
          position({
            id: "retired-pos",
            whaleId: "retired-whale",
            source: "hyperliquid",
            sourceAccount: "retired-acct",
          }),
          position({
            id: "active-pos",
            whaleId: "active-whale",
            sourceAccount: "active-acct",
            market: "SOL",
            notionalUsd: 20_000,
            lastSeenAt: new Date("2026-05-23T11:59:00.000Z"),
          }),
          position({
            id: "active-stale-pos",
            whaleId: "active-whale",
            sourceAccount: "active-acct",
            lastSeenAt: new Date("2026-05-23T11:56:00.000Z"),
          }),
        ],
      }),
    );

    const { buildWhalePositionSignals, buildWhaleTraderSignals } = await import(
      "./whale-signals"
    );

    const positions = await buildWhalePositionSignals();
    const traders = await buildWhaleTraderSignals();

    expect(positions.map((item) => item.payload.positionId)).toEqual([
      "active-pos",
    ]);
    expect(traders.map((trader) => trader.payload.whaleId)).toEqual([
      "active-whale",
    ]);
    expect(traders[0]?.payload.tags).toEqual(["copyable"]);
    expect(
      traders[0]?.payload.openPositions.map((item) => item.positionId),
    ).toEqual(["active-pos"]);
  });

  it("refreshes the live cache on demand when the cache is missing", async () => {
    mocks.getWhaleLiveSnapshot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(snapshot());

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const signals = await buildWhalePositionSignals();

    expect(mocks.refreshWhales).toHaveBeenCalledTimes(1);
    expect(signals.map((item) => item.payload.positionId)).toEqual(["pos-1"]);
  });

  it("waits for a complete source snapshot when the fresh cache has only Pacifica", async () => {
    mocks.getWhaleLiveSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(
        snapshot({
          source: "multi",
          accounts: ["acct-1", "0xabc"],
          whales: [
            whale(),
            whale({
              id: "hyperliquid:0xabc",
              source: "hyperliquid",
              sourceAccount: "0xabc",
              displayName: "HL Alpha",
              avatarUrl: null,
              tags: ["hyperliquid"],
            }),
          ],
          positions: [
            position(),
            position({
              id: "hyperliquid-pos",
              whaleId: "hyperliquid:0xabc",
              source: "hyperliquid",
              sourceAccount: "0xabc",
              market: "SOL",
              side: "short",
              notionalUsd: 80_000,
              lastSeenAt: new Date("2026-05-23T11:59:45.000Z"),
            }),
          ],
        }),
      );

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const signals = await buildWhalePositionSignals();

    expect(mocks.refreshWhales).toHaveBeenCalledTimes(1);
    expect(signals.map((item) => item.payload.source)).toEqual([
      "hyperliquid",
      "pacifica",
    ]);
  });

  it("does not block live positions when a missing-cache refresh is slow", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(null);
    mocks.refreshWhales.mockImplementation(
      () => new Promise(() => undefined),
    );

    const {
      buildWhalePositionSignals,
      clearWhaleSignalCachesForTests,
    } = await import("./whale-signals");

    try {
      const result = await Promise.race<WhalePositionSignal[] | "blocked">([
        buildWhalePositionSignals(),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), 50);
        }),
      ]);

      expect(result).not.toBe("blocked");
      expect(result).toEqual([]);
      expect(mocks.refreshWhales).toHaveBeenCalledTimes(1);
    } finally {
      clearWhaleSignalCachesForTests();
    }
  });

  it("serves stale live cache immediately while refreshing in the background", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        observedAt: new Date("2026-05-23T11:55:00.000Z"),
      }),
    );
    mocks.refreshWhales.mockImplementation(
      () => new Promise(() => undefined),
    );

    const {
      buildWhalePositionSignals,
      clearWhaleSignalCachesForTests,
    } = await import("./whale-signals");

    try {
      const result = await Promise.race([
        buildWhalePositionSignals(),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), 25);
        }),
      ]);

      expect(mocks.refreshWhales).toHaveBeenCalledTimes(1);
      expect(result).not.toBe("blocked");
      expect(Array.isArray(result)).toBe(true);
      expect(
        Array.isArray(result)
          ? result.map((item) => item.payload.positionId)
          : [],
      ).toEqual(["pos-1"]);
    } finally {
      clearWhaleSignalCachesForTests();
    }
  });

  it("keeps stale cached positions visible while the source refresh recovers", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        observedAt: new Date("2026-05-23T11:55:00.000Z"),
        positions: [
          position({
            lastSeenAt: new Date("2026-05-23T11:55:00.000Z"),
          }),
        ],
      }),
    );
    mocks.refreshWhales.mockImplementation(
      () => new Promise(() => undefined),
    );

    const {
      buildWhalePositionSignals,
      buildWhaleTraderSignals,
      clearWhaleSignalCachesForTests,
    } = await import("./whale-signals");

    try {
      const positions = await buildWhalePositionSignals();
      const traders = await buildWhaleTraderSignals();

      expect(positions.map((item) => item.payload.positionId)).toEqual([
        "pos-1",
      ]);
      expect(positions[0]?.payload.stale).toBe(true);
      expect(traders[0]).toMatchObject({
        payload: {
          openPositionsCount: 1,
          stale: true,
          openPositions: [
            {
              positionId: "pos-1",
              stale: true,
            },
          ],
        },
      });
    } finally {
      clearWhaleSignalCachesForTests();
    }
  });

  it("keeps recently opened positions visible when their source is temporarily stale", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        source: "multi",
        observedAt: new Date("2026-05-23T11:59:50.000Z"),
        accounts: ["acct-1", "0xabc"],
        whales: [
          whale(),
          whale({
            id: "hyperliquid:0xabc",
            source: "hyperliquid",
            sourceAccount: "0xabc",
            displayName: "HL Alpha",
            avatarUrl: null,
            tags: ["hyperliquid"],
          }),
        ],
        positions: [
          position(),
          position({
            id: "recent-stale-hl",
            whaleId: "hyperliquid:0xabc",
            source: "hyperliquid",
            sourceAccount: "0xabc",
            market: "SOL",
            side: "short",
            openedAt: new Date("2026-05-23T11:35:00.000Z"),
            lastSeenAt: new Date("2026-05-23T11:54:00.000Z"),
          }),
          position({
            id: "old-stale-hl",
            whaleId: "hyperliquid:0xabc",
            source: "hyperliquid",
            sourceAccount: "0xabc",
            market: "ETH",
            openedAt: new Date("2026-05-23T09:00:00.000Z"),
            lastSeenAt: new Date("2026-05-23T11:54:00.000Z"),
          }),
        ],
      }),
    );

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const positions = await buildWhalePositionSignals();

    expect(positions.map((item) => item.payload.positionId)).toEqual([
      "pos-1",
      "recent-stale-hl",
    ]);
    expect(positions[1]?.payload.stale).toBe(true);
  });

  it("marks observed Hyperliquid open times as unknown holding age", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        source: "multi",
        whales: [
          whale({
            id: "hyperliquid:0xabc",
            source: "hyperliquid",
            sourceAccount: "0xabc",
            displayName: "HL Alpha",
            avatarUrl: null,
            tags: ["hyperliquid"],
          }),
        ],
        positions: [
          position({
            id: "observed-hl",
            whaleId: "hyperliquid:0xabc",
            source: "hyperliquid",
            sourceAccount: "0xabc",
            raw: { openedAtSource: "observed" },
            openedAt: new Date("2026-05-23T11:59:30.000Z"),
            lastSeenAt: new Date("2026-05-23T11:59:30.000Z"),
          }),
        ],
      }),
    );

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const positions = await buildWhalePositionSignals();

    expect(positions[0]?.payload.positionId).toBe("observed-hl");
    expect(positions[0]?.payload.openedAtKnown).toBe(false);
  });

  it("returns no whale signals when the live cache is empty", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(null);

    const { buildWhalePositionSignals, buildWhaleTraderSignals } = await import(
      "./whale-signals"
    );

    await expect(buildWhalePositionSignals()).resolves.toEqual([]);
    await expect(buildWhaleTraderSignals()).resolves.toEqual([]);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });
});
