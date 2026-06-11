import { describe, expect, it, vi } from "vitest";
import type { Candle } from "@/lib/data/candles";
import { tickSession, type EngineDeps } from "./engine";
import type { ActiveSessionWithIdentity } from "./sessions";

const NOW = new Date("2026-06-11T12:00:00Z");

function makeSession(
  overrides: Partial<ActiveSessionWithIdentity> = {},
): ActiveSessionWithIdentity {
  return {
    id: "sess-1",
    userId: "user-1",
    budgetUsd: 100,
    tier: "cruise",
    status: "active",
    realizedPnlUsd: 0,
    startedAt: new Date("2026-06-11T11:00:00Z"),
    endedAt: null,
    lastTickAt: null,
    privyUserId: "privy-1",
    walletAddress: "wallet-1",
    ...overrides,
  };
}

function flat(count: number, price = 100, volume = 10): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: i * 900_000,
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volume,
  }));
}

function breakoutCandles(): Candle[] {
  return [
    ...flat(19),
    { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 30 },
  ];
}

function makeDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    getCandles: vi.fn().mockResolvedValue(flat(20)),
    getMark: vi.fn().mockResolvedValue(100),
    openTrade: vi.fn().mockResolvedValue({
      transactionB64: "open-tx",
      entryPriceUsd: 100,
      notionalUsd: 500,
      openFeeUsd: 0.2,
    }),
    closeTrade: vi.fn().mockResolvedValue({
      transactionB64: "close-tx",
      receiveUsd: 11,
    }),
    placeTrigger: vi.fn().mockResolvedValue({ transactionB64: "trigger-tx" }),
    sendTransaction: vi.fn().mockResolvedValue({ signature: "sig-1" }),
    claimTick: vi.fn().mockResolvedValue(true),
    getWalletPositions: vi.fn().mockResolvedValue([]),
    listOpenBets: vi.fn().mockResolvedValue([]),
    recentCloses: vi.fn().mockResolvedValue([]),
    recordOpen: vi.fn().mockResolvedValue("bet-1"),
    confirmOpen: vi.fn().mockResolvedValue(true),
    confirmClose: vi.fn().mockResolvedValue(true),
    sessionRealizedPnl: vi.fn().mockResolvedValue(0),
    endSession: vi.fn().mockResolvedValue(undefined),
    touchSession: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe("tickSession", () => {
  it("stands down when the tick claim is lost (double-tick guard)", async () => {
    const deps = makeDeps({ claimTick: vi.fn().mockResolvedValue(false) });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(result.skipped).toContain("tick already claimed by another process");
    expect(deps.listOpenBets).not.toHaveBeenCalled();
  });

  it("skips a market the wallet already holds via another source", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      getWalletPositions: vi
        .fn()
        .mockResolvedValue([{ market: "BTC", side: "long" }]),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.skipped).toContain(
      "BTC: wallet already holds a position (manual/tail)",
    );
    // The guard skips BTC; the breakout fires on the next market instead.
    expect(
      (deps.openTrade as ReturnType<typeof vi.fn>).mock.calls[0][0].market,
    ).toBe("ETH");
  });

  it("never sends the open tx when recording the pending row fails", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      recordOpen: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(deps.sendTransaction).not.toHaveBeenCalled();
  });


  it("opens one trade when the brain fires: record -> send -> confirm -> SL -> TP", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
    });
    const result = await tickSession(makeSession(), deps);

    expect(result.opened).toBe(1);
    expect(deps.openTrade).toHaveBeenCalledWith({
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
      stakeUsdc: 10,
      leverage: 50,
      mode: "standard",
    });
    // Bookkeeping order: record the pending row BEFORE the send.
    const recordOrder = (deps.recordOpen as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const sendOrder = (deps.sendTransaction as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(sendOrder);

    const recorded = (deps.recordOpen as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(recorded.meta.sourceKind).toBe("autopilot");
    expect(recorded.meta.sourceName).toBe("Autopilot");
    expect(recorded.meta.autopilotSessionId).toBe("sess-1");
    expect(deps.confirmOpen).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-1",
    });
    // Mandatory SL first, then TP, each sent.
    expect(deps.placeTrigger).toHaveBeenNthCalledWith(1, {
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
      kind: "sl",
      roiPct: -50,
    });
    expect(deps.placeTrigger).toHaveBeenNthCalledWith(2, {
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
      kind: "tp",
      roiPct: 100,
    });
    // 3 sends total: open + SL + TP.
    expect(deps.sendTransaction).toHaveBeenCalledTimes(3);
    expect(deps.touchSession).toHaveBeenCalledWith("sess-1");
  });

  it("opens at most one position per tick even when every market fires", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(1);
    expect(deps.openTrade).toHaveBeenCalledTimes(1);
  });

  it("skips entries when concurrency is full and never hedges a held market", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      listOpenBets: vi.fn().mockResolvedValue([
        {
          betId: "bet-a",
          market: "BTC",
          side: "long",
          stakeUsdc: 10,
          leverage: 50,
          entryPriceUsd: 100.9, // not yet at +1% from mark 101
          createdAt: new Date(NOW.getTime() - 60_000),
        },
        {
          betId: "bet-b",
          market: "ETH",
          side: "long",
          stakeUsdc: 10,
          leverage: 50,
          entryPriceUsd: 100.9,
          createdAt: new Date(NOW.getTime() - 60_000),
        },
      ]),
    });
    const result = await tickSession(makeSession(), deps); // cruise max 2
    expect(result.opened).toBe(0);
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("reserves open stakes against the budget and denies entries below the tier minimum", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      // Losses ate the budget down to $10 of loss headroom...
      sessionRealizedPnl: vi.fn().mockResolvedValue(-90),
      // ...and $9.50 of it is already at risk in an open position, so the
      // remaining $0.50 cannot fund cruise's $1 stake floor.
      listOpenBets: vi.fn().mockResolvedValue([
        {
          betId: "bet-a",
          market: "BTC",
          side: "long",
          stakeUsdc: 9.5,
          leverage: 50,
          entryPriceUsd: 100.9, // not yet at +1% from mark 101
          createdAt: new Date(NOW.getTime() - 60_000),
        },
      ]),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(deps.openTrade).not.toHaveBeenCalled();
    expect(result.skipped.some((s) => s.includes("budget"))).toBe(true);
  });

  it("exits a position past max hold and confirms the close", async () => {
    const deps = makeDeps({
      listOpenBets: vi.fn().mockResolvedValue([
        {
          betId: "bet-old",
          market: "SOL",
          side: "long",
          stakeUsdc: 10,
          leverage: 50,
          entryPriceUsd: 100,
          createdAt: new Date(NOW.getTime() - 91 * 60_000), // 91 min > 90
        },
      ]),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.exited).toBe(1);
    expect(deps.closeTrade).toHaveBeenCalledWith({
      walletAddress: "wallet-1",
      market: "SOL",
      side: "long",
    });
    expect(deps.confirmClose).toHaveBeenCalledWith({
      betId: "bet-old",
      userId: "user-1",
      signature: "sig-1",
      receiveUsdEstimate: 11,
    });
  });

  it("ends the session as exhausted when losses ate the budget", async () => {
    const deps = makeDeps({
      sessionRealizedPnl: vi.fn().mockResolvedValue(-100),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.ended).toBe("exhausted");
    expect(deps.endSession).toHaveBeenCalledWith({
      sessionId: "sess-1",
      status: "exhausted",
    });
    expect(deps.openTrade).not.toHaveBeenCalled();
  });

  it("ends the session as target at +100% realized", async () => {
    const deps = makeDeps({
      sessionRealizedPnl: vi.fn().mockResolvedValue(100),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.ended).toBe("target");
  });

  it("tilt cooldown blocks entries", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      recentCloses: vi.fn().mockResolvedValue([
        { pnlUsd: -2, closedAt: new Date(NOW.getTime() - 60_000) },
        { pnlUsd: -1, closedAt: new Date(NOW.getTime() - 120_000) },
      ]),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(result.skipped.some((s) => s.includes("tilt"))).toBe(true);
  });

  it("closes the position immediately when SL placement fails", async () => {
    const placeTrigger = vi
      .fn()
      .mockRejectedValueOnce(new Error("trigger build failed"));
    const deps = makeDeps({
      getCandles: vi.fn().mockResolvedValue(breakoutCandles()),
      getMark: vi.fn().mockResolvedValue(101),
      placeTrigger,
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(1);
    // Emergency close fired for the just-opened BTC long.
    expect(deps.closeTrade).toHaveBeenCalledWith({
      walletAddress: "wallet-1",
      market: "BTC",
      side: "long",
    });
    expect(deps.confirmClose).toHaveBeenCalled();
    // No TP attempt after the SL failure.
    expect(placeTrigger).toHaveBeenCalledTimes(1);
  });

  it("a throwing market-data dep never kills the tick", async () => {
    const deps = makeDeps({
      getCandles: vi.fn().mockRejectedValue(new Error("HL down")),
    });
    const result = await tickSession(makeSession(), deps);
    expect(result.opened).toBe(0);
    expect(deps.touchSession).toHaveBeenCalled();
  });

  it("skips a session with no wallet identity", async () => {
    const deps = makeDeps();
    const result = await tickSession(
      makeSession({ walletAddress: null }),
      deps,
    );
    expect(result.skipped).toContain("user has no wallet identity");
    expect(deps.listOpenBets).not.toHaveBeenCalled();
  });
});
