import { createCipheriv, randomBytes } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeWhalePositionId } from "@/lib/whales/identity";
import type { WhaleCopyMeta } from "./whale-meta";

const mocks = vi.hoisted(() => ({
  closeCopyOrder: vi.fn(),
  getPositions: vi.fn(),
  getWhaleLivePositionsForAccount: vi.fn(),
  openBets: [] as Array<Record<string, unknown>>,
  realizedPnlForOrder: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/pacifica/client", () => ({
  getPositions: mocks.getPositions,
}));

vi.mock("@/lib/whales/live-cache", () => ({
  getWhaleLivePositionsForAccount: mocks.getWhaleLivePositionsForAccount,
}));

vi.mock("@/lib/pacifica/orders", () => ({
  closeCopyOrder: mocks.closeCopyOrder,
}));

vi.mock("@/lib/bets/copy-pnl", () => ({
  realizedPnlForOrder: mocks.realizedPnlForOrder,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => mocks.openBets),
          })),
        })),
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return {
          where: vi.fn(async () => []),
        };
      }),
    })),
  },
}));

import { runMirrorCloseSweep } from "./mirror-close";

const whaleMeta: WhaleCopyMeta = {
  sourceType: "whale",
  whaleId: "pacifica:source-1",
  source: "pacifica",
  sourceAccount: "source-1",
  sourcePositionId: makeWhalePositionId({
    source: "pacifica",
    sourceAccount: "source-1",
    market: "BTC",
    side: "long",
    openedAtMs: 1_000,
  }),
  leaderMarket: "BTC",
  leaderSide: "long",
  leverage: 10,
  autoCloseOnSourceClose: true,
  userEntryPrice: 65_100,
  sourceEntryPriceAtCopy: 65_000,
  pacificaOrderId: "open-order-1",
  closeReason: null,
};

function encryptedSeed(): string {
  const key = randomBytes(32);
  process.env.AGENT_WALLET_ENCRYPTION_KEY = key.toString("base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.alloc(32, 1)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

function openWhaleBet(meta: WhaleCopyMeta = whaleMeta) {
  return {
    betId: "bet-1",
    userId: "user-1",
    amountUsdc: 10,
    meta,
    userMainPubkey: "user-main-1",
    agentPubkey: "agent-1",
    agentSecretEnc: encryptedSeed(),
  };
}

function sourcePosition(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "BTC",
    side: "bid",
    amount: "0.5",
    created_at: 1_000,
    ...overrides,
  };
}

describe("runMirrorCloseSweep whale source closes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openBets = [];
    mocks.updates = [];
    mocks.getWhaleLivePositionsForAccount.mockResolvedValue(null);
    mocks.closeCopyOrder.mockResolvedValue({ order_id: "close-order-1" });
    mocks.realizedPnlForOrder.mockResolvedValue(2);
  });

  it("closes a Pacifica whale follower when the source position is closed", async () => {
    mocks.openBets = [openWhaleBet()];
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "source-1") {
        return [{ symbol: "BTC", side: "ask", amount: "0.5" }];
      }
      if (account === "user-main-1") {
        return [{ symbol: "BTC", side: "bid", amount: "0.25" }];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.getPositions).toHaveBeenCalledWith("source-1");
    expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTC",
        positionSide: "long",
        amountBase: "0.25",
      }),
    );
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      status: "closed",
      closeTxHash: "pacifica:close-order-1",
      proceedsUsdc: 12,
    });
    expect(mocks.updates[0]?.meta).toMatchObject({
      sourceType: "whale",
      closeReason: "source_closed",
      leaderClosedAt: expect.any(String),
    });
  });

  it("marks the whale copy already flat when the follower position is gone", async () => {
    mocks.openBets = [openWhaleBet()];
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "source-1") {
        return [];
      }
      if (account === "user-main-1") {
        return [];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.closeCopyOrder).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      status: "closed",
    });
    expect(mocks.updates[0]).not.toHaveProperty("closeTxHash");
    expect(mocks.updates[0]?.meta).toMatchObject({
      sourceType: "whale",
      closeReason: "already_flat",
      leaderClosedAt: expect.any(String),
    });
  });

  it("does not close a whale copy twice when legacy leader metadata is present", async () => {
    mocks.openBets = [
      openWhaleBet({
        ...whaleMeta,
        leaderAddress: "legacy-leader-1",
      } as WhaleCopyMeta & { leaderAddress: string }),
    ];
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "legacy-leader-1") {
        return [];
      }
      if (account === "source-1") {
        return [];
      }
      if (account === "user-main-1") {
        return [sourcePosition({ amount: "0.25" })];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.closeCopyOrder).toHaveBeenCalledTimes(1);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]?.meta).toMatchObject({
      sourceType: "whale",
      closeReason: "source_closed",
    });
  });

  it("closes when the source reopened the same market and side with a new position id", async () => {
    mocks.openBets = [openWhaleBet()];
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "source-1") {
        return [sourcePosition({ created_at: 2_000 })];
      }
      if (account === "user-main-1") {
        return [sourcePosition({ amount: "0.25" })];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.closeCopyOrder).toHaveBeenCalledTimes(1);
    expect(mocks.updates[0]?.meta).toMatchObject({
      closeReason: "source_closed",
    });
  });

  it("fetches each whale source account once for multiple followers", async () => {
    mocks.openBets = [
      openWhaleBet(),
      {
        ...openWhaleBet(),
        betId: "bet-2",
        userId: "user-2",
        userMainPubkey: "user-main-2",
      },
    ];
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "source-1") {
        return [sourcePosition()];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(0);
    expect(result.scannedLeaders).toBe(1);
    expect(mocks.getPositions).toHaveBeenCalledTimes(1);
    expect(mocks.getPositions).toHaveBeenCalledWith("source-1");
  });

  it("uses cached whale source positions when the live snapshot has the account", async () => {
    mocks.openBets = [openWhaleBet()];
    mocks.getWhaleLivePositionsForAccount.mockResolvedValue([]);
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "user-main-1") {
        return [sourcePosition({ amount: "0.25" })];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.getWhaleLivePositionsForAccount).toHaveBeenCalledWith(
      "source-1",
    );
    expect(mocks.getPositions).not.toHaveBeenCalledWith("source-1");
    expect(mocks.getPositions).toHaveBeenCalledWith("user-main-1");
    expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTC",
        positionSide: "long",
        amountBase: "0.25",
      }),
    );
  });
});
