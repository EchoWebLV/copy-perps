import { createCipheriv, randomBytes } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WhaleCopyMeta } from "./whale-meta";

const mocks = vi.hoisted(() => ({
  closeCopyOrder: vi.fn(),
  getPositions: vi.fn(),
  openBets: [] as Array<Record<string, unknown>>,
  realizedPnlForOrder: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/pacifica/client", () => ({
  getPositions: mocks.getPositions,
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
  sourcePositionId: "pos-1",
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

describe("runMirrorCloseSweep whale source closes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openBets = [];
    mocks.updates = [];
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
});
