import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectUserLimit = vi.fn();
  const selectBetsOrderBy = vi.fn();
  const selectUserChain = {
    from: vi.fn(() => selectUserChain),
    where: vi.fn(() => selectUserChain),
    limit: selectUserLimit,
  };
  const selectBetsChain = {
    from: vi.fn(() => selectBetsChain),
    where: vi.fn(() => selectBetsChain),
    orderBy: selectBetsOrderBy,
  };
  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));

  return {
    verifyPrivyRequest: vi.fn(),
    selectUserLimit,
    selectBetsOrderBy,
    selectUserChain,
    selectBetsChain,
    updateSet,
    updateWhere,
    dbSelect: vi.fn(),
    enrichBet: vi.fn(),
    getPositions: vi.fn(),
    getMarksSnapshot: vi.fn(),
    getBot: vi.fn(),
  };
});

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
    update: () => ({
      set: mocks.updateSet,
    }),
  },
}));
vi.mock("@/lib/positions/enrich", () => ({
  enrichBet: mocks.enrichBet,
}));
vi.mock("@/lib/pacifica/client", () => ({
  getPositions: mocks.getPositions,
}));
vi.mock("@/lib/data/marks", () => ({
  getMarksSnapshot: mocks.getMarksSnapshot,
}));
vi.mock("@/lib/bots", () => ({
  getBot: mocks.getBot,
}));

import { GET } from "../../app/api/portfolio/route";

describe("GET /api/portfolio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.dbSelect
      .mockReturnValueOnce(mocks.selectUserChain)
      .mockReturnValueOnce(mocks.selectBetsChain);
    mocks.selectUserLimit.mockResolvedValue([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: null,
      },
    ]);
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.enrichBet.mockImplementation(async (bet) => ({ id: bet.id }));
    mocks.getPositions.mockResolvedValue([]);
    mocks.getMarksSnapshot.mockResolvedValue(new Map());
    mocks.getBot.mockReturnValue(null);
  });

  it("skips malformed confirmed copy metadata without emitting invalid copy rows", async () => {
    mocks.selectBetsOrderBy.mockResolvedValue([
      {
        id: "copy-null",
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "confirmed",
        meta: null,
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
      },
      {
        id: "copy-string",
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "confirmed",
        meta: "bad-meta",
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
      },
      {
        id: "copy-missing-side",
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "confirmed",
        meta: {
          leaderMarket: "ETH",
          leverage: 5,
        },
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
      },
    ]);

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      copyRows: [],
    });
  });
});
