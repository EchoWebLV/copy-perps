import { describe, expect, it, vi } from "vitest";
import {
  createCopyEngineState,
  MAX_COPY_AGE_MS,
  resolveCopyLeverage,
  tickCopyEngine,
  type CopyEngineDeps,
} from "./engine";
import type { AutoCloseBetRow, CopySubscriptionRow } from "./store";
import type { SourcePosition } from "./types";
import { buildFlashTailMeta } from "@/lib/bets/flash-tail-meta";

const NOW = new Date("2026-06-12T12:00:00Z");

function sub(overrides: Partial<CopySubscriptionRow> = {}): CopySubscriptionRow {
  return {
    id: "sub-1",
    userId: "user-1",
    privyUserId: "privy-1",
    walletAddress: "FollowerWallet111",
    targetKind: "arena-bot",
    targetKey: "degen-v1",
    targetLabel: "Degen",
    stakeUsdc: 5,
    leverageMode: "mirror",
    fixedLeverage: null,
    autoClose: true,
    maxConcurrent: 1,
    dailyCapUsd: 50,
    maxEntryGapBps: 100,
    status: "active",
    createdAt: NOW,
    lastCopyAt: null,
    ...overrides,
  };
}

function botPosition(overrides: Partial<SourcePosition> = {}): SourcePosition {
  return {
    key: `arena:degen-v1:${NOW.getTime() - 5_000}`,
    market: "SOL",
    side: "long",
    entryPriceUsd: 66.8,
    leverage: 50,
    openedTsMs: NOW.getTime() - 5_000,
    ...overrides,
  };
}

function autoCloseBet(overrides: {
  sourcePositionId?: string | null;
  botId?: string;
} = {}): AutoCloseBetRow {
  return {
    betId: "bet-9",
    userId: "user-1",
    privyUserId: "privy-1",
    meta: buildFlashTailMeta({
      lineage: {
        sourceKind: "bot",
        botId: overrides.botId ?? "arena:degen-v1",
        whaleId: null,
        sourceName: "Degen",
        sourcePositionId:
          overrides.sourcePositionId === undefined
            ? "arena:degen-v1:123"
            : overrides.sourcePositionId,
      },
      market: "SOL",
      side: "long",
      leverage: 50,
      mode: "standard",
      walletAddress: "FollowerWallet111",
      entryPriceUsd: 66.8,
      notionalUsd: 250,
      openFeeUsd: 0.15,
      autoCloseOnSourceClose: true,
    }),
  };
}

function makeDeps(overrides: Partial<CopyEngineDeps> = {}): CopyEngineDeps {
  return {
    listActiveSubscriptions: vi.fn(async () => []),
    listOpenAutoCloseBets: vi.fn(async () => []),
    fetchSourcePositions: vi.fn(async () => []),
    getMark: vi.fn(async () => 66.81),
    openTrade: vi.fn(async () => ({
      transactionB64: "open-tx",
      entryPriceUsd: 66.81,
      notionalUsd: 250,
      openFeeUsd: 0.15,
    })),
    closeTrade: vi.fn(async () => ({
      transactionB64: "close-tx",
      receiveUsd: 4.9,
    })),
    sendTransaction: vi.fn(async () => ({ signature: "sig-1" })),
    getWalletPositions: vi.fn(async () => []),
    recordOpen: vi.fn(async () => "bet-1"),
    confirmOpen: vi.fn(async () => true),
    confirmClose: vi.fn(async () => true),
    hasCopiedSourcePosition: vi.fn(async () => false),
    countOpenCopies: vi.fn(async () => 0),
    spentLast24hUsd: vi.fn(async () => 0),
    touchLastCopy: vi.fn(async () => undefined),
    dryRun: false,
    now: () => NOW,
    ...overrides,
  };
}

describe("resolveCopyLeverage", () => {
  it("mirrors source leverage when it fits the venue", () => {
    expect(
      resolveCopyLeverage({
        sub: { leverageMode: "mirror", fixedLeverage: null },
        position: { market: "SOL", leverage: 50 },
      }),
    ).toEqual({ leverage: 50, mode: "standard" });
  });

  it("uses fixed leverage when configured", () => {
    expect(
      resolveCopyLeverage({
        sub: { leverageMode: "fixed", fixedLeverage: 20 },
        position: { market: "SOL", leverage: 50 },
      }),
    ).toEqual({ leverage: 20, mode: "standard" });
  });

  it("clamps absurd mirrors to the degen ceiling", () => {
    const resolved = resolveCopyLeverage({
      sub: { leverageMode: "mirror", fixedLeverage: null },
      position: { market: "SOL", leverage: 100_000 },
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.mode).toBe("degen");
    expect(resolved!.leverage).toBeGreaterThan(100);
  });

  it("returns null without usable leverage", () => {
    expect(
      resolveCopyLeverage({
        sub: { leverageMode: "mirror", fixedLeverage: null },
        position: { market: "SOL", leverage: null },
      }),
    ).toBeNull();
  });
});

describe("tickCopyEngine open pass", () => {
  it("copies a fresh bot position on first sight (age window)", async () => {
    const deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
    });
    const state = createCopyEngineState();
    const result = await tickCopyEngine(state, deps);

    expect(result.opened).toBe(1);
    expect(deps.openTrade).toHaveBeenCalledWith({
      walletAddress: "FollowerWallet111",
      market: "SOL",
      side: "long",
      stakeUsdc: 5,
      leverage: 50,
      mode: "standard",
    });
    expect(deps.recordOpen).toHaveBeenCalledOnce();
    const meta = vi.mocked(deps.recordOpen).mock.calls[0]![0].meta;
    expect(meta.copySubscriptionId).toBe("sub-1");
    expect(meta.autoCloseOnSourceClose).toBe(true);
    expect(meta.sourcePositionId).toBe(botPosition().key);
    expect(meta.sourceKind).toBe("bot");
    expect(deps.sendTransaction).toHaveBeenCalledWith({
      privyUserId: "privy-1",
      walletAddress: "FollowerWallet111",
      transactionB64: "open-tx",
    });
    expect(deps.confirmOpen).toHaveBeenCalled();
    expect(deps.touchLastCopy).toHaveBeenCalledWith("sub-1");
  });

  it("never copies a stale bot position on first sight", async () => {
    const stale = botPosition({
      key: "arena:degen-v1:1",
      openedTsMs: NOW.getTime() - MAX_COPY_AGE_MS - 1_000,
    });
    const deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [stale]),
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.opened).toBe(0);
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("baselines a flash wallet's existing book, then copies the diff", async () => {
    const existing: SourcePosition = {
      key: "flash:W:BTC:long",
      market: "BTC",
      side: "long",
      entryPriceUsd: 100_000,
      leverage: 10,
      openedTsMs: null,
    };
    const fetches = [
      [existing],
      [
        existing,
        {
          key: "flash:W:SOL:short",
          market: "SOL",
          side: "short",
          entryPriceUsd: 66.8,
          leverage: 20,
          openedTsMs: null,
        } satisfies SourcePosition,
      ],
    ];
    let call = 0;
    const deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [
        sub({ targetKind: "flash-wallet", targetKey: "W", targetLabel: null }),
      ]),
      fetchSourcePositions: vi.fn(async () => fetches[Math.min(call++, 1)]!),
    });
    const state = createCopyEngineState();

    const first = await tickCopyEngine(state, deps);
    expect(first.opened).toBe(0); // pre-existing book is baseline

    const second = await tickCopyEngine(state, deps);
    expect(second.opened).toBe(1); // only the new SOL short
    const meta = vi.mocked(deps.recordOpen).mock.calls[0]![0].meta;
    expect(meta.sourceKind).toBe("whale");
    expect(meta.whaleId).toBe("flash:W");
    expect(meta.market).toBe("SOL");
    expect(meta.side).toBe("short");
  });

  it("enforces the guard rail order: notional, stacking, concurrency, cap, gap", async () => {
    const base = {
      listActiveSubscriptions: vi.fn(async () => [sub({ stakeUsdc: 1, leverageMode: "fixed" as const, fixedLeverage: 5 })]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
    };
    // $1 × 5x = $5 < $10 minimum
    let deps = makeDeps(base);
    let result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.skipped.some((s) => s.includes("under $10"))).toBe(true);

    // stacking: wallet already holds SOL
    deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      getWalletPositions: vi.fn(async () => [
        { market: "SOL", side: "short" as const },
      ]),
    });
    result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.opened).toBe(0);
    expect(result.skipped.some((s) => s.includes("already holds SOL"))).toBe(true);

    // concurrency
    deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      countOpenCopies: vi.fn(async () => 1),
    });
    result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.skipped.some((s) => s.includes("max concurrent"))).toBe(true);

    // daily cap
    deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub({ dailyCapUsd: 10 })]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      spentLast24hUsd: vi.fn(async () => 8),
    });
    result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.skipped.some((s) => s.includes("daily cap"))).toBe(true);

    // entry gap: mark ran 2% above entry, cap 100bps
    deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      getMark: vi.fn(async () => 66.8 * 1.02),
    });
    result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.skipped.some((s) => s.includes("entry gap"))).toBe(true);
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("attempts each source position at most once per process", async () => {
    const deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      openTrade: vi.fn(async () => {
        throw new Error("rpc exploded");
      }),
    });
    const state = createCopyEngineState();
    const first = await tickCopyEngine(state, deps);
    expect(first.errors.length).toBe(1);
    const second = await tickCopyEngine(state, deps);
    expect(second.errors.length).toBe(0); // not retried
    expect(deps.openTrade).toHaveBeenCalledOnce();
  });

  it("skips positions already copied in a previous process (bets dedup)", async () => {
    const deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      hasCopiedSourcePosition: vi.fn(async () => true),
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.opened).toBe(0);
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("dry-run plans but never trades or writes", async () => {
    const deps = makeDeps({
      listActiveSubscriptions: vi.fn(async () => [sub()]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
      dryRun: true,
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.opened).toBe(0);
    expect(result.planned.length).toBe(1);
    expect(result.planned[0]).toContain("open sub=sub-1 SOL long");
    expect(deps.openTrade).not.toHaveBeenCalled();
    expect(deps.recordOpen).not.toHaveBeenCalled();
    expect(deps.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("tickCopyEngine close pass", () => {
  it("closes a follower bet when the copied source position is gone", async () => {
    const bet = autoCloseBet({ sourcePositionId: "arena:degen-v1:123" });
    const deps = makeDeps({
      listOpenAutoCloseBets: vi.fn(async () => [bet]),
      fetchSourcePositions: vi.fn(async () => []), // bot is flat
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);

    expect(result.closed).toBe(1);
    expect(deps.closeTrade).toHaveBeenCalledWith({
      walletAddress: "FollowerWallet111",
      market: "SOL",
      side: "long",
    });
    expect(deps.confirmClose).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: "bet-9",
        closeReason: "source-closed",
        receiveUsdEstimate: 4.9,
      }),
    );
  });

  it("leaves the bet alone while the source position is still open", async () => {
    const bet = autoCloseBet({ sourcePositionId: botPosition().key });
    const deps = makeDeps({
      listOpenAutoCloseBets: vi.fn(async () => [bet]),
      fetchSourcePositions: vi.fn(async () => [botPosition()]),
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.closed).toBe(0);
    expect(deps.closeTrade).not.toHaveBeenCalled();
  });

  it("treats a failed source fetch as unknown — never closes", async () => {
    const bet = autoCloseBet();
    const deps = makeDeps({
      listOpenAutoCloseBets: vi.fn(async () => [bet]),
      fetchSourcePositions: vi.fn(async () => {
        throw new Error("ER timeout");
      }),
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.closed).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(deps.closeTrade).not.toHaveBeenCalled();
  });

  it("dry-run reports the close without sending it", async () => {
    const bet = autoCloseBet({ sourcePositionId: "arena:degen-v1:123" });
    const deps = makeDeps({
      listOpenAutoCloseBets: vi.fn(async () => [bet]),
      fetchSourcePositions: vi.fn(async () => []),
      dryRun: true,
    });
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.closed).toBe(0);
    expect(result.planned.some((p) => p.startsWith("close bet=bet-9"))).toBe(true);
    expect(deps.closeTrade).not.toHaveBeenCalled();
  });

  it("does nothing at all with an empty watch set", async () => {
    const deps = makeDeps();
    const result = await tickCopyEngine(createCopyEngineState(), deps);
    expect(result.targets).toBe(0);
    expect(deps.fetchSourcePositions).not.toHaveBeenCalled();
  });
});
