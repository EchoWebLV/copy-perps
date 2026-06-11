import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    select: mocks.select,
  },
}));

import { buildFlashTailMeta } from "@/lib/bets/flash-tail-meta";
import {
  AutopilotSessionError,
  clampBudget,
  getActiveSession,
  getLatestSession,
  listActiveSessions,
  listOpenAutopilotBets,
  recentClosedAutopilotResults,
  sessionStats,
  startSession,
  stopSession,
} from "./sessions";

const NOW = new Date("2026-06-11T12:00:00Z");

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    userId: "user-1",
    budgetUsd: 100,
    tier: "cruise",
    status: "active",
    realizedPnlUsd: 0,
    config: null,
    startedAt: NOW,
    endedAt: null,
    lastTickAt: null,
    ...overrides,
  };
}

function autopilotMeta(overrides: Record<string, unknown> = {}) {
  return {
    ...buildFlashTailMeta({
      lineage: {
        sourceKind: "autopilot",
        whaleId: null,
        botId: null,
        sourceName: "Autopilot",
        sourcePositionId: null,
      },
      market: "SOL",
      side: "long",
      leverage: 50,
      mode: "standard",
      walletAddress: "wallet-1",
      entryPriceUsd: 160,
      notionalUsd: 500,
      openFeeUsd: 0.2,
      autopilotSessionId: "sess-1",
    }),
    ...overrides,
  };
}

// Thenable select chain: any of from/innerJoin/where/orderBy/limit returns
// the chain, and awaiting the chain at any depth resolves the rows.
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (
    resolve: (rows: unknown[]) => unknown,
    reject: (err: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function updateChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  (chain as { then: unknown }).then = (
    resolve: (rows: unknown[]) => unknown,
    reject: (err: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function insertChain(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe("autopilot sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue(selectChain([]));
    mocks.update.mockReturnValue(updateChain([]));
    mocks.insert.mockReturnValue(insertChain([sessionRow()]));
  });

  it("clampBudget caps above $200, rejects below $5 and junk", () => {
    expect(clampBudget(50)).toBe(50);
    expect(clampBudget(5)).toBe(5);
    expect(clampBudget(1000)).toBe(200);
    expect(clampBudget(9.999)).toBe(9.99);
    // Sub-minimum is a user mistake — reject, never silently raise to $5.
    expect(() => clampBudget(1)).toThrow(AutopilotSessionError);
    expect(() => clampBudget(1)).toThrow(/at least \$5/);
    expect(() => clampBudget(Number.NaN)).toThrow(AutopilotSessionError);
  });

  it("startSession inserts an active session", async () => {
    const session = await startSession({
      userId: "user-1",
      budgetUsd: 100,
      tier: "cruise",
    });
    expect(session.id).toBe("sess-1");
    expect(session.tier).toBe("cruise");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("startSession denies when an active session exists", async () => {
    mocks.select.mockReturnValue(selectChain([sessionRow()]));
    await expect(
      startSession({ userId: "user-1", budgetUsd: 100, tier: "cruise" }),
    ).rejects.toMatchObject({ code: "active-session-exists" });
  });

  it("startSession rejects an unknown tier", async () => {
    await expect(
      startSession({ userId: "user-1", budgetUsd: 100, tier: "yolo" }),
    ).rejects.toMatchObject({ code: "invalid-tier" });
  });

  it("startSession maps a unique-violation race to active-session-exists", async () => {
    // Pre-check sees nothing (selectChain([]) default), but the insert
    // loses the race against the partial unique index — Postgres 23505.
    mocks.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("duplicate key value"), { code: "23505" }),
          ),
      }),
    });
    await expect(
      startSession({ userId: "user-1", budgetUsd: 100, tier: "cruise" }),
    ).rejects.toMatchObject({ code: "active-session-exists" });
  });

  it("getLatestSession returns ended sessions too", async () => {
    mocks.select.mockReturnValue(
      selectChain([sessionRow({ status: "exhausted", endedAt: NOW })]),
    );
    const session = await getLatestSession("user-1");
    expect(session?.status).toBe("exhausted");
  });

  it("getActiveSession maps the row", async () => {
    mocks.select.mockReturnValue(selectChain([sessionRow()]));
    const session = await getActiveSession("user-1");
    expect(session?.status).toBe("active");
  });

  it("stopSession CAS-updates active -> stopped", async () => {
    mocks.update.mockReturnValue(
      updateChain([sessionRow({ status: "stopped", endedAt: NOW })]),
    );
    const stopped = await stopSession({ sessionId: "sess-1", userId: "user-1" });
    expect(stopped?.status).toBe("stopped");
  });

  it("listActiveSessions joins user identity", async () => {
    mocks.select.mockReturnValue(
      selectChain([
        { session: sessionRow(), privyId: "privy-1", solanaPubkey: "wallet-1" },
      ]),
    );
    const sessions = await listActiveSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].privyUserId).toBe("privy-1");
    expect(sessions[0].walletAddress).toBe("wallet-1");
  });

  it("listOpenAutopilotBets parses meta and drops non-autopilot rows", async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          id: "bet-1",
          amountUsdc: 10,
          createdAt: NOW,
          meta: autopilotMeta(),
        },
        {
          id: "bet-2",
          amountUsdc: 5,
          createdAt: NOW,
          meta: { junk: true },
        },
      ]),
    );
    const open = await listOpenAutopilotBets("sess-1");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      betId: "bet-1",
      market: "SOL",
      side: "long",
      stakeUsdc: 10,
      leverage: 50,
      entryPriceUsd: 160,
    });
  });

  it("recentClosedAutopilotResults counts unknown proceeds as full loss", async () => {
    mocks.select.mockReturnValue(
      selectChain([
        { proceedsUsdc: 12, amountUsdc: 10, closedAt: NOW, createdAt: NOW },
        { proceedsUsdc: null, amountUsdc: 10, closedAt: null, createdAt: NOW },
      ]),
    );
    const closes = await recentClosedAutopilotResults("sess-1", 5);
    expect(closes[0].pnlUsd).toBe(2);
    expect(closes[1].pnlUsd).toBe(-10);
  });

  it("sessionStats sums realized PnL from bets rows", async () => {
    // First select: open bets. Second select: closed rows.
    mocks.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { proceedsUsdc: 15, amountUsdc: 10, closedAt: NOW, createdAt: NOW },
          { proceedsUsdc: null, amountUsdc: 5, closedAt: NOW, createdAt: NOW },
        ]),
      );
    const stats = await sessionStats("sess-1");
    expect(stats.realizedPnlUsd).toBe(0); // +5 - 5
    expect(stats.closedCount).toBe(2);
    expect(stats.openBets).toEqual([]);
    expect(mocks.update).toHaveBeenCalledTimes(1); // opportunistic cache write
  });
});
