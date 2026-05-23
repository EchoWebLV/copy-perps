import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhaleLiveSnapshot } from "@/lib/whales/live-cache";

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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));

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

  it("maps cached live positions with heat and optional analysis", async () => {
    mocks.getWhaleLiveSnapshot.mockResolvedValue(
      snapshot({
        whales: [whale(), whale({ id: "whale-2", sourceAccount: "acct-2" })],
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
        amountBase: 0.5,
        notionalUsd: 450_000,
        entryPrice: 60_000,
        currentMark: 63_000,
        unrealizedPnlPct: 12.6,
        openedAtMs: 1779534000000,
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
        analysis: null,
      },
    });
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

  it("refreshes the live cache on demand when the snapshot is stale", async () => {
    mocks.getWhaleLiveSnapshot
      .mockResolvedValueOnce(
        snapshot({
          observedAt: new Date("2026-05-23T11:55:00.000Z"),
          positions: [
            position({
              lastSeenAt: new Date("2026-05-23T11:55:00.000Z"),
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(snapshot());

    const { buildWhalePositionSignals } = await import("./whale-signals");

    const signals = await buildWhalePositionSignals();

    expect(mocks.refreshWhales).toHaveBeenCalledTimes(1);
    expect(signals.map((item) => item.payload.positionId)).toEqual(["pos-1"]);
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
