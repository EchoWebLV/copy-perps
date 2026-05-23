import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  return {
    query,
    db: {
      select: vi.fn(),
    },
    getLeaderboard: vi.fn(),
    rows: [] as unknown[],
    resultSets: [] as unknown[][],
  };
});

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/pacifica/client", () => ({
  getLeaderboard: mocks.getLeaderboard,
}));

vi.mock("@/lib/db/schema", () => ({
  whales: {
    id: "whales.id",
    source: "whales.source",
    sourceAccount: "whales.sourceAccount",
    status: "whales.status",
  },
  whalePositions: {
    id: "whalePositions.id",
    whaleId: "whalePositions.whaleId",
    status: "whalePositions.status",
    lastSeenAt: "whalePositions.lastSeenAt",
  },
  whalePositionAnalysis: {
    positionId: "whalePositionAnalysis.positionId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  desc: vi.fn((column: unknown) => ({ desc: column })),
  eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

describe("whale signals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));

    mocks.rows = [];
    mocks.resultSets = [];
    mocks.getLeaderboard.mockResolvedValue([]);
    mocks.query.from.mockReturnValue(mocks.query);
    mocks.query.innerJoin.mockReturnValue(mocks.query);
    mocks.query.leftJoin.mockReturnValue(mocks.query);
    mocks.query.where.mockReturnValue(mocks.query);
    mocks.query.orderBy.mockReturnValue(mocks.query);
    mocks.query.limit.mockImplementation(async () => {
      return mocks.resultSets.length > 0 ? mocks.resultSets.shift() : mocks.rows;
    });
    mocks.db.select.mockReturnValue(mocks.query);
  });

  it("maps open whale positions with heat, stale state, and optional analysis", async () => {
    mocks.rows = [
      {
        position: {
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
          lastSeenAt: new Date("2026-05-23T11:59:30.000Z"),
        },
        whale: {
          id: "joined-whale-1",
          source: "hyperliquid",
          sourceAccount: "joined-acct-1",
          displayName: "Alpha",
          avatarUrl: "https://example.com/alpha.png",
          status: "active",
          tags: [],
        },
        analysis: {
          summary: "Momentum long",
          thesis: "Breakout continuation",
          risk: "Invalidates under VWAP",
          entryGapWarning: null,
          confidence: 0.72,
        },
      },
      {
        position: {
          id: "pos-2",
          whaleId: "whale-2",
          source: "hyperliquid",
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
          lastSeenAt: new Date("2026-05-23T11:58:00.000Z"),
        },
        whale: {
          id: "whale-2",
          source: "hyperliquid",
          sourceAccount: "acct-2",
          displayName: "Beta",
          avatarUrl: null,
          status: "active",
          tags: [],
        },
        analysis: null,
      },
    ];

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const signals = await buildWhalePositionSignals(2);

    expect(mocks.query.limit).toHaveBeenCalledWith(2);
    expect(signals).toEqual([
      {
        id: "whale_position:pos-1",
        type: "whale_position",
        heatScore: 913,
        createdAt: "2026-05-23T12:00:00.000Z",
        chips: [],
        payload: {
          positionId: "pos-1",
          whaleId: "joined-whale-1",
          source: "hyperliquid",
          sourceAccount: "joined-acct-1",
          displayName: "Alpha",
          avatarUrl: "https://example.com/alpha.png",
          market: "BTC",
          side: "long",
          leverage: 10,
          amountBase: 0.5,
          notionalUsd: 450_000,
          entryPrice: 60_000,
          currentMark: 63_000,
          unrealizedPnlPct: 12.6,
          openedAtMs: 1779534000000,
          lastSeenAtMs: 1779537570000,
          stale: false,
          analysis: {
            summary: "Momentum long",
            thesis: "Breakout continuation",
            risk: "Invalidates under VWAP",
            entryGapWarning: null,
            confidence: 0.72,
          },
        },
      },
      {
        id: "whale_position:pos-2",
        type: "whale_position",
        heatScore: 300,
        createdAt: "2026-05-23T12:00:00.000Z",
        chips: [],
        payload: {
          positionId: "pos-2",
          whaleId: "whale-2",
          source: "hyperliquid",
          sourceAccount: "acct-2",
          displayName: "Beta",
          avatarUrl: null,
          market: "ETH",
          side: "short",
          leverage: 5,
          amountBase: 2,
          notionalUsd: 50_000,
          entryPrice: 3_200,
          currentMark: null,
          unrealizedPnlPct: null,
          openedAtMs: 1779530400000,
          lastSeenAtMs: 1779537480000,
          stale: true,
          analysis: null,
        },
      },
    ]);
  });

  it("groups position signals into sorted trader signals", async () => {
    mocks.rows = [
      {
        position: {
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
          unrealizedPnlPct: 12,
          openedAt: new Date("2026-05-23T11:00:00.000Z"),
          lastSeenAt: new Date("2026-05-23T11:59:30.000Z"),
        },
        whale: {
          id: "whale-1",
          source: "pacifica",
          sourceAccount: "acct-1",
          displayName: "Alpha",
          avatarUrl: "https://example.com/alpha.png",
          status: "active",
          tags: ["leader"],
        },
        analysis: null,
      },
      {
        position: {
          id: "pos-2",
          whaleId: "whale-1",
          source: "pacifica",
          sourceAccount: "acct-1",
          market: "ETH",
          side: "short",
          leverage: 5,
          amountBase: 1,
          notionalUsd: 10_000,
          entryPrice: 3_000,
          currentMark: 2_900,
          unrealizedPnlPct: 4,
          openedAt: new Date("2026-05-23T10:00:00.000Z"),
          lastSeenAt: new Date("2026-05-23T11:58:45.000Z"),
        },
        whale: {
          id: "whale-1",
          source: "pacifica",
          sourceAccount: "acct-1",
          displayName: "Alpha",
          avatarUrl: "https://example.com/alpha.png",
          status: "active",
          tags: ["leader"],
        },
        analysis: null,
      },
      {
        position: {
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
          lastSeenAt: new Date("2026-05-23T11:57:00.000Z"),
        },
        whale: {
          id: "whale-2",
          source: "hyperliquid",
          sourceAccount: "acct-2",
          displayName: "Beta",
          avatarUrl: null,
          status: "active",
          tags: [],
        },
        analysis: null,
      },
    ];
    mocks.resultSets = [
      mocks.rows,
      [
        {
          id: "whale-1",
          source: "pacifica",
          sourceAccount: "acct-1",
          displayName: "Alpha",
          avatarUrl: "https://example.com/alpha.png",
          tags: ["leader"],
        },
        {
          id: "whale-2",
          source: "hyperliquid",
          sourceAccount: "acct-2",
          displayName: "Beta",
          avatarUrl: null,
          tags: [],
        },
      ],
    ];
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

    const { buildWhaleTraderSignals } = await import("./whale-signals");

    const signals = await buildWhaleTraderSignals();

    expect(mocks.query.limit).toHaveBeenCalledWith(1000);
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
    expect(signals[1]).toMatchObject({
      heatScore: 298,
      payload: {
        whaleId: "whale-2",
        openPositionsCount: 1,
        lastSeenAt: "2026-05-23T11:57:00.000Z",
        stale: true,
        stats: {
          equityUsdc: 0,
          openInterestUsdc: 0,
          pnl1dUsdc: 0,
          pnl7dUsdc: 0,
          pnl30dUsdc: 0,
          pnlAllTimeUsdc: 0,
          volume1dUsdc: 0,
        },
      },
    });
  });

  it("includes active whales without open positions in trader signals", async () => {
    mocks.resultSets = [
      [],
      [
        {
          id: "idle-whale",
          source: "pacifica",
          sourceAccount: "idle-acct",
          displayName: "Idle Alpha",
          avatarUrl: null,
          tags: ["steady", "watchlist"],
        },
      ],
    ];

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

  it("filters hidden and retired whales out of position and trader signals", async () => {
    const positionRows = [
      {
        position: {
          id: "hidden-pos",
          whaleId: "hidden-whale",
          source: "pacifica",
          sourceAccount: "hidden-acct",
          market: "BTC",
          side: "long",
          leverage: 10,
          amountBase: 0.5,
          notionalUsd: 450_000,
          entryPrice: 60_000,
          currentMark: 63_000,
          unrealizedPnlPct: 12,
          openedAt: new Date("2026-05-23T11:00:00.000Z"),
          lastSeenAt: new Date("2026-05-23T11:59:30.000Z"),
        },
        whale: {
          id: "hidden-whale",
          source: "pacifica",
          sourceAccount: "hidden-acct",
          displayName: "Hidden",
          avatarUrl: null,
          status: "hidden",
          tags: [],
        },
        analysis: null,
      },
      {
        position: {
          id: "retired-pos",
          whaleId: "retired-whale",
          source: "hyperliquid",
          sourceAccount: "retired-acct",
          market: "ETH",
          side: "short",
          leverage: 5,
          amountBase: 2,
          notionalUsd: 50_000,
          entryPrice: 3_200,
          currentMark: null,
          unrealizedPnlPct: null,
          openedAt: new Date("2026-05-23T10:00:00.000Z"),
          lastSeenAt: new Date("2026-05-23T11:59:00.000Z"),
        },
        whale: {
          id: "retired-whale",
          source: "hyperliquid",
          sourceAccount: "retired-acct",
          displayName: "Retired",
          avatarUrl: null,
          status: "retired",
          tags: [],
        },
        analysis: null,
      },
      {
        position: {
          id: "active-pos",
          whaleId: "active-whale",
          source: "pacifica",
          sourceAccount: "active-acct",
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
        },
        whale: {
          id: "active-whale",
          source: "pacifica",
          sourceAccount: "active-acct",
          displayName: "Active",
          avatarUrl: null,
          status: "active",
          tags: ["copyable"],
        },
        analysis: null,
      },
    ];
    const activeWhaleRows = [
      {
        id: "active-whale",
        source: "pacifica",
        sourceAccount: "active-acct",
        displayName: "Active",
        avatarUrl: null,
        tags: ["copyable"],
      },
    ];

    const { buildWhalePositionSignals, buildWhaleTraderSignals } = await import(
      "./whale-signals"
    );

    mocks.resultSets = [positionRows];
    const positions = await buildWhalePositionSignals();
    mocks.resultSets = [positionRows, activeWhaleRows];
    const traders = await buildWhaleTraderSignals();

    expect(positions.map((position) => position.payload.whaleId)).toEqual([
      "active-whale",
    ]);
    expect(traders.map((trader) => trader.payload.whaleId)).toEqual([
      "active-whale",
    ]);
    expect(traders[0]?.payload.tags).toEqual(["copyable"]);
  });
});
