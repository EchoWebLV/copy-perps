import { describe, expect, it, vi } from "vitest";
import { runFlashReconcileSweep, usdcDeltaForOwner } from "./flash-reconcile";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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
      meta: {
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
        closeSignature: "sig-close",
        closeReason: "manual",
        proceedsSource: "quote-estimate",
        reconciledAt: null,
      },
    };
    const deps = {
      listBetsToReconcile: vi.fn().mockResolvedValue([bet]),
      reapStalePending: vi.fn().mockResolvedValue(0),
      getTx: vi.fn().mockResolvedValue({ meta: txMeta("w1", 10, 11.24) }),
      applyChainTruth: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-06-11T12:00:00Z"),
    };

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
    const deps = {
      listBetsToReconcile: vi.fn().mockResolvedValue([
        {
          id: "bet-2",
          userId: "user-1",
          status: "confirmed",
          amountUsdc: 1,
          meta: {
            sourceType: "flash-tail",
            venue: "flash",
            sourceKind: "bot",
            whaleId: null,
            botId: "pulse",
            sourceName: "Pulse",
            sourcePositionId: null,
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
          },
        },
      ]),
      reapStalePending: vi.fn().mockResolvedValue(0),
      getTx: vi.fn().mockResolvedValue({ meta: { err: { custom: 1 } } }),
      applyChainTruth: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-06-11T12:00:00Z"),
    };

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
});
