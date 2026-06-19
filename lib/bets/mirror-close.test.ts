import { createCipheriv, randomBytes } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeWhalePositionId } from "@/lib/whales/identity";
import type { WhaleCopyMeta } from "./whale-meta";

const mocks = vi.hoisted(() => ({
  closeCopyOrder: vi.fn(),
  getClearinghouseState: vi.fn(),
  getPositions: vi.fn(),
  getWhaleLivePositionsForAccount: vi.fn(),
  openBets: [] as Array<Record<string, unknown>>,
  patchMonitorStatus: vi.fn(),
  realizedPnlForOrder: vi.fn(),
  getActiveSessionKey: vi.fn(),
  executeSessionClose: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  // Rows the paper_positions lookup returns for a bot (status filter applied in JS).
  paperRows: [] as Array<{ status: string }>,
  // On-chain arena flat signal for arena:<persona> bots.
  getBotPositionSignal: vi.fn(),
}));

vi.mock("@/lib/pacifica/client", () => ({
  getPositions: mocks.getPositions,
}));

vi.mock("@/lib/hyperliquid/client", () => ({
  getClearinghouseState: mocks.getClearinghouseState,
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

vi.mock("@/lib/ops/monitor-store", () => ({
  patchMonitorStatus: mocks.patchMonitorStatus,
}));

vi.mock("@/lib/flash-v2/session-store", () => ({
  getActiveSessionKey: mocks.getActiveSessionKey,
}));

vi.mock("@/lib/flash-v2/session-trade", () => ({
  executeSessionClose: mocks.executeSessionClose,
}));

// Keep personaFromBotId real (routes arena vs paper-bot); stub the chain read.
vi.mock("@/lib/arena/bot-position", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/arena/bot-position")>();
  return { ...actual, getBotPositionSignal: mocks.getBotPositionSignal };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(async () => mocks.openBets),
          })),
        })),
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.paperRows),
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
    feeUsdc: 0.25,
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
    mocks.getClearinghouseState.mockResolvedValue({
      marginSummary: {
        accountValue: "100000",
        totalNtlPos: "0",
        totalRawUsd: "100000",
        totalMarginUsed: "0",
      },
      assetPositions: [],
      withdrawable: "100000",
      time: Date.parse("2026-05-23T12:00:00.000Z"),
    });
    mocks.closeCopyOrder.mockResolvedValue({ order_id: "close-order-1" });
    mocks.patchMonitorStatus.mockResolvedValue({});
    mocks.realizedPnlForOrder.mockResolvedValue(2);
    mocks.getActiveSessionKey.mockResolvedValue(null);
    mocks.executeSessionClose.mockResolvedValue({ found: false });
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
      proceedsUsdc: 11.75,
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
      "pacifica",
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

  it("can force a source fetch when a websocket event makes the cache suspect", async () => {
    mocks.openBets = [openWhaleBet()];
    mocks.getWhaleLivePositionsForAccount.mockResolvedValue([
      {
        id: whaleMeta.sourcePositionId,
        status: "open",
      },
    ]);
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "source-1") {
        return [];
      }
      if (account === "user-main-1") {
        return [sourcePosition({ amount: "0.25" })];
      }
      return [];
    });

    const result = await runMirrorCloseSweep({ forceSourceFetch: true });

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.getWhaleLivePositionsForAccount).not.toHaveBeenCalled();
    expect(mocks.getPositions).toHaveBeenCalledWith("source-1");
    expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTC",
        positionSide: "long",
        amountBase: "0.25",
      }),
    );
    expect(mocks.patchMonitorStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        autoClose: expect.objectContaining({
          lastResult: expect.objectContaining({
            reason: "scheduled sweep",
            forceSourceFetch: true,
            closesAttempted: 1,
            closesSucceeded: 1,
          }),
        }),
      }),
    );
  });

  it("closes a Hyperliquid whale follower when the source position is closed", async () => {
    const meta: WhaleCopyMeta = {
      ...whaleMeta,
      whaleId: "hyperliquid:0xabc",
      source: "hyperliquid",
      sourceAccount: "0xabc",
      sourcePositionId: "hyperliquid:0xabc:ETH:long:2000000000",
      leaderMarket: "ETH",
      leaderSide: "long",
    };
    mocks.openBets = [openWhaleBet(meta)];
    mocks.getWhaleLivePositionsForAccount.mockResolvedValue(null);
    mocks.getPositions.mockImplementation(async (account: string) => {
      if (account === "user-main-1") {
        return [{ symbol: "ETH", side: "bid", amount: "0.25" }];
      }
      return [];
    });

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.getClearinghouseState).toHaveBeenCalledWith("0xabc");
    expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        positionSide: "long",
        amountBase: "0.25",
      }),
    );
    expect(mocks.updates[0]?.meta).toMatchObject({
      sourceType: "whale",
      source: "hyperliquid",
      closeReason: "source_closed",
    });
  });

  it("closes a flash-v2 whale follower via the session key when the source closed", async () => {
    mocks.openBets = [
      {
        ...openWhaleBet({ ...whaleMeta, venue: "flash-v2" } as WhaleCopyMeta),
        agentPubkey: null,
        agentSecretEnc: null, // flash-v2 follower has no Pacifica agent
      },
    ];
    mocks.getActiveSessionKey.mockResolvedValue({
      sessionPubkey: "S",
      sessionTokenPda: "T",
      keypair: { secretKey: new Uint8Array(64) },
    });
    mocks.executeSessionClose.mockResolvedValue({
      found: true,
      signature: "FSIG",
      estPnlUsd: 3,
    });
    mocks.getPositions.mockImplementation(async () => []); // source closed

    const result = await runMirrorCloseSweep();

    expect(result.closesAttempted).toBe(1);
    expect(result.closesSucceeded).toBe(1);
    // Session close, not the Pacifica close path.
    expect(mocks.executeSessionClose).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "user-main-1", market: "BTC", side: "long" }),
    );
    expect(mocks.closeCopyOrder).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      status: "closed",
      closeTxHash: "flashv2:FSIG",
      proceedsUsdc: 12.75, // stake 10 + estPnl 3 - openFee 0.25
    });
    expect(mocks.updates[0]?.meta).toMatchObject({
      venue: "flash-v2",
      closeReason: "source_closed",
      leaderClosedAt: expect.any(String),
    });
  });

  it("isolates a thrown getActiveSessionKey (corrupt seed) as a per-bet error, sweep continues", async () => {
    mocks.openBets = [
      {
        ...openWhaleBet({ ...whaleMeta, venue: "flash-v2" } as WhaleCopyMeta),
        agentPubkey: null,
        agentSecretEnc: null,
      },
    ];
    mocks.getActiveSessionKey.mockRejectedValue(new Error("auth-tag mismatch"));
    mocks.getPositions.mockImplementation(async () => []); // source closed

    const result = await runMirrorCloseSweep();

    // Per-bet error, NOT an unhandled rejection that aborts the sweep.
    expect(result.closesAttempted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("session load failed");
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
    expect(mocks.patchMonitorStatus).toHaveBeenCalled(); // sweep completed
  });

  it("flash-v2 close with unknown PnL leaves proceedsUsdc unset (no NaN persisted)", async () => {
    mocks.openBets = [
      {
        ...openWhaleBet({ ...whaleMeta, venue: "flash-v2" } as WhaleCopyMeta),
        agentPubkey: null,
        agentSecretEnc: null,
      },
    ];
    mocks.getActiveSessionKey.mockResolvedValue({
      sessionPubkey: "S",
      sessionTokenPda: "T",
      keypair: { secretKey: new Uint8Array(64) },
    });
    mocks.executeSessionClose.mockResolvedValue({
      found: true,
      signature: "FSIG",
      estPnlUsd: null,
    });
    mocks.getPositions.mockImplementation(async () => []); // source closed

    const result = await runMirrorCloseSweep();

    expect(result.closesSucceeded).toBe(1);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({ status: "closed", closeTxHash: "flashv2:FSIG" });
    expect(mocks.updates[0]).not.toHaveProperty("proceedsUsdc");
  });

  it("silently skips a Pacifica follower with no agent wallet (flag-off fidelity)", async () => {
    mocks.openBets = [
      {
        betId: "bet-noagent",
        userId: "user-1",
        amountUsdc: 10,
        feeUsdc: 0.25,
        meta: { leaderAddress: "leader-x", leaderMarket: "BTC", leaderSide: "long", leverage: 10 },
        userMainPubkey: "user-main-1",
        agentPubkey: null,
        agentSecretEnc: null,
      },
    ];
    mocks.getPositions.mockImplementation(async () => []); // leader closed

    const result = await runMirrorCloseSweep();

    // Old innerJoin dropped such rows silently — preserve that: no attempt, no error.
    expect(result.closesAttempted).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it("skips a flash-v2 follower (never user-signs) when the session is inactive", async () => {
    mocks.openBets = [
      {
        ...openWhaleBet({ ...whaleMeta, venue: "flash-v2" } as WhaleCopyMeta),
        agentPubkey: null,
        agentSecretEnc: null,
      },
    ];
    mocks.getActiveSessionKey.mockResolvedValue(null); // expired / not enabled
    mocks.getPositions.mockImplementation(async () => []); // source closed

    const result = await runMirrorCloseSweep();

    // Skipped: not counted as an attempt, surfaced as an error, bet left open.
    expect(result.closesAttempted).toBe(0);
    expect(result.closesSucceeded).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      betId: "bet-1",
      message: expect.stringContaining("session inactive"),
    });
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
    expect(mocks.closeCopyOrder).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });
});

function openBotBet(over: Record<string, unknown> = {}) {
  return {
    betId: "bot-bet-1",
    userId: "user-1",
    amountUsdc: 20,
    feeUsdc: 0.1,
    meta: {
      venue: "flash-v2",
      botId: "arena:claude",
      leaderMarket: "SOL",
      leaderSide: "long",
      leverage: 5,
      autoCloseOnSourceClose: true,
      ...over,
    },
    userMainPubkey: "user-main-1",
    // flash-v2 followers have no agent wallet.
    agentPubkey: null,
    agentSecretEnc: null,
  };
}

describe("runMirrorCloseSweep bot source closes (positive-signal only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openBets = [];
    mocks.updates = [];
    mocks.paperRows = [];
    mocks.getBotPositionSignal.mockResolvedValue("unknown");
    mocks.getActiveSessionKey.mockResolvedValue({
      sessionPubkey: "S",
      keypair: { secretKey: new Uint8Array([1]) },
    });
    mocks.executeSessionClose.mockResolvedValue({
      found: true,
      signature: "CSIG",
      estPnlUsd: 3,
    });
  });

  it("does NOT close an arena bot tail when the on-chain signal is 'unknown'", async () => {
    mocks.openBets = [openBotBet()];
    mocks.getBotPositionSignal.mockResolvedValue("unknown");
    const result = await runMirrorCloseSweep();
    expect(result.closesAttempted).toBe(0);
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it("does NOT close while the arena bot still holds a position ('active')", async () => {
    mocks.openBets = [openBotBet()];
    mocks.getBotPositionSignal.mockResolvedValue("active");
    const result = await runMirrorCloseSweep();
    expect(result.closesAttempted).toBe(0);
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
  });

  it("closes via the session when the arena bot is positively flat", async () => {
    mocks.openBets = [openBotBet()];
    mocks.getBotPositionSignal.mockResolvedValue("flat");
    const result = await runMirrorCloseSweep();
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.getBotPositionSignal).toHaveBeenCalledWith("arena:claude");
    expect(mocks.executeSessionClose).toHaveBeenCalledWith(
      expect.objectContaining({ market: "SOL", side: "long" }),
    );
    expect(mocks.updates[0]).toMatchObject({
      status: "closed",
      closeTxHash: "flashv2:CSIG",
    });
  });

  it("honors autoCloseOnSourceClose:false — leaves a flat bot's tail open for manual close", async () => {
    mocks.openBets = [openBotBet({ autoCloseOnSourceClose: false })];
    mocks.getBotPositionSignal.mockResolvedValue("flat");
    const result = await runMirrorCloseSweep();
    expect(result.closesAttempted).toBe(0);
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
  });

  it("paper-bot id (non-arena) still uses the paper_positions signal, not the chain", async () => {
    mocks.openBets = [openBotBet({ botId: "paper-7" })];
    mocks.paperRows = [{ status: "closed" }]; // positively flat
    const result = await runMirrorCloseSweep();
    expect(result.closesSucceeded).toBe(1);
    expect(mocks.getBotPositionSignal).not.toHaveBeenCalled();
  });
});
