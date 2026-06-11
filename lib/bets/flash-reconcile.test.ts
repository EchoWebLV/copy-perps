import { describe, expect, it, vi } from "vitest";
import {
  runFlashReconcileSweep,
  usdcDeltaForOwner,
  type ReconcileDeps,
} from "./flash-reconcile";
import type { FlashTailMeta } from "./flash-tail-meta";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = new Date("2026-06-11T12:00:00Z");

function txMeta(owner: string, preUi: number, postUi: number) {
  return {
    err: null,
    preTokenBalances: [
      {
        owner,
        mint: USDC,
        uiTokenAmount: { uiAmount: preUi },
      },
    ],
    postTokenBalances: [
      {
        owner,
        mint: USDC,
        uiTokenAmount: { uiAmount: postUi },
      },
    ],
  };
}

function tailMeta(overrides: Partial<FlashTailMeta> = {}): FlashTailMeta {
  return {
    sourceType: "flash-tail",
    venue: "flash",
    sourceKind: "whale",
    whaleId: "whale-1",
    botId: null,
    sourceName: "Big Whale",
    sourcePositionId: "pos-1",
    market: "SOL",
    side: "long",
    leverage: 20,
    mode: "standard",
    walletAddress: "w1",
    entryPriceUsd: 160,
    notionalUsd: 20,
    openFeeUsd: 0.01,
    openSignature: "sig-open",
    closeSignature: null,
    closeReason: null,
    proceedsSource: null,
    reconciledAt: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReconcileDeps> = {}) {
  return {
    listBetsToReconcile: vi.fn().mockResolvedValue([]),
    listLivenessCandidates: vi.fn().mockResolvedValue([]),
    reapStalePending: vi.fn().mockResolvedValue(0),
    getTx: vi.fn().mockResolvedValue(null),
    getLivePositions: vi.fn().mockResolvedValue([]),
    applyChainTruth: vi.fn().mockResolvedValue(undefined),
    markClosedExternal: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe("usdcDeltaForOwner", () => {
  it("computes the owner's USDC delta", () => {
    expect(usdcDeltaForOwner(txMeta("w1", 10, 11.24), "w1")).toBeCloseTo(1.24);
    expect(usdcDeltaForOwner(txMeta("w1", 10, 8.99), "w1")).toBeCloseTo(-1.01);
  });

  it("ignores other owners and other mints", () => {
    expect(usdcDeltaForOwner(txMeta("other", 10, 20), "w1")).toBeNull();
    const meta = txMeta("w1", 10, 20);
    meta.preTokenBalances[0].mint = "SomeOtherMint";
    meta.postTokenBalances[0].mint = "SomeOtherMint";
    expect(usdcDeltaForOwner(meta, "w1")).toBeNull();
  });
});

describe("runFlashReconcileSweep", () => {
  it("upgrades a quote-estimate close to chain truth", async () => {
    const bet = {
      id: "bet-1",
      userId: "user-1",
      status: "closed",
      amountUsdc: 1,
      createdAt: new Date("2026-06-11T11:00:00Z"),
      meta: tailMeta({
        closeSignature: "sig-close",
        closeReason: "manual" as const,
        proceedsSource: "quote-estimate" as const,
      }),
    };
    const deps = makeDeps({
      listBetsToReconcile: vi.fn().mockResolvedValue([bet]),
      getTx: vi.fn().mockResolvedValue({ meta: txMeta("w1", 10, 11.24) }),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.getTx).toHaveBeenCalledWith("sig-close");
    expect(deps.applyChainTruth).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: "bet-1",
        action: "close",
        txSig: "sig-close",
        usdcDelta: expect.closeTo(1.24, 5),
        txFailed: false,
      }),
    );
    expect(result.checked).toBe(1);
  });

  it("flags an on-chain-failed tx instead of writing proceeds", async () => {
    const deps = makeDeps({
      listBetsToReconcile: vi.fn().mockResolvedValue([
        {
          id: "bet-2",
          userId: "user-1",
          status: "confirmed",
          amountUsdc: 1,
          createdAt: new Date("2026-06-11T11:58:00Z"),
          meta: tailMeta({
            sourceKind: "bot" as const,
            whaleId: null,
            botId: "pulse",
            sourceName: "Pulse",
            sourcePositionId: null,
          }),
        },
      ]),
      getTx: vi.fn().mockResolvedValue({ meta: { err: { custom: 1 } } }),
    });

    await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.applyChainTruth).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: "bet-2",
        action: "open",
        txFailed: true,
        usdcDelta: null,
      }),
    );
  });

  it("fails an open whose signature is still unfindable past the age cutoff", async () => {
    const bet = {
      id: "bet-3",
      userId: "user-1",
      status: "confirmed",
      amountUsdc: 1,
      // Way past the cutoff — the open tx never landed.
      createdAt: new Date("2026-06-11T11:00:00Z"),
      meta: tailMeta(),
    };
    const deps = makeDeps({
      listBetsToReconcile: vi.fn().mockResolvedValue([bet]),
      getTx: vi.fn().mockResolvedValue(null),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.applyChainTruth).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: "bet-3",
        action: "open",
        txSig: "sig-open",
        txFailed: true,
        usdcDelta: null,
      }),
    );
    expect(result.checked).toBe(1);
  });

  it("keeps retrying a young open whose signature is not yet visible", async () => {
    const bet = {
      id: "bet-4",
      userId: "user-1",
      status: "confirmed",
      amountUsdc: 1,
      createdAt: new Date("2026-06-11T11:59:00Z"),
      meta: tailMeta(),
    };
    const deps = makeDeps({
      listBetsToReconcile: vi.fn().mockResolvedValue([bet]),
      getTx: vi.fn().mockResolvedValue(null),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.applyChainTruth).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });
});

describe("runFlashReconcileSweep external-close liveness pass", () => {
  const verifiedBet = (id: string, overrides: Partial<FlashTailMeta> = {}) => ({
    id,
    userId: "user-1",
    status: "confirmed",
    amountUsdc: 5,
    createdAt: new Date("2026-06-11T11:00:00Z"),
    meta: tailMeta({ reconciledAt: "2026-06-11T11:05:00.000Z", ...overrides }),
  });

  it("expires a confirmed bet whose Flash position is gone", async () => {
    const bet = verifiedBet("bet-z");
    const deps = makeDeps({
      listLivenessCandidates: vi.fn().mockResolvedValue([bet]),
      // Same market, opposite side — not a match for the bet's (SOL, long).
      getLivePositions: vi.fn().mockResolvedValue([
        { market: "SOL", side: "short" },
      ]),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.listLivenessCandidates).toHaveBeenCalledWith(
      new Date("2026-06-11T11:45:00.000Z"),
    );
    expect(deps.getLivePositions).toHaveBeenCalledWith("w1");
    expect(deps.markClosedExternal).toHaveBeenCalledWith({
      betId: "bet-z",
      meta: bet.meta,
      nowIso: "2026-06-11T12:00:00.000Z",
    });
    expect(result.externalized).toBe(1);
  });

  it("leaves a bet alone while its (market, side) position is live", async () => {
    const deps = makeDeps({
      listLivenessCandidates: vi.fn().mockResolvedValue([verifiedBet("bet-z")]),
      getLivePositions: vi.fn().mockResolvedValue([
        { market: "SOL", side: "long" },
      ]),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.markClosedExternal).not.toHaveBeenCalled();
    expect(result.externalized).toBe(0);
  });

  it("does not expire bets when the live-position read fails", async () => {
    const deps = makeDeps({
      listLivenessCandidates: vi.fn().mockResolvedValue([verifiedBet("bet-z")]),
      getLivePositions: vi.fn().mockRejectedValue(new Error("rpc down")),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.markClosedExternal).not.toHaveBeenCalled();
    expect(result.externalized).toBe(0);
  });

  it("fetches live positions once per wallet", async () => {
    const deps = makeDeps({
      listLivenessCandidates: vi.fn().mockResolvedValue([
        verifiedBet("bet-a"),
        verifiedBet("bet-b", { market: "ETH" }),
      ]),
      getLivePositions: vi.fn().mockResolvedValue([]),
    });

    const result = await runFlashReconcileSweep({ timeBoxMs: 10_000, deps });

    expect(deps.getLivePositions).toHaveBeenCalledTimes(1);
    expect(result.externalized).toBe(2);
  });
});
