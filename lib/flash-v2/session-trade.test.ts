import { describe, expect, it, vi } from "vitest";
import { executeSessionClose, executeSessionOpen } from "./session-trade";
import { FlashV2PositionConflictError } from "./self-trade";
import { FlashV2TxFailedError } from "./errors";

// Default confirm injected so tests never hit the ER RPC.
const confirmOk = async () => "confirmed" as const;
const confirmFail = async () => "failed" as const;
const confirmPending = async () => "pending" as const;
// No-op blockhash refresh so tests never hit the ER RPC (prod refreshes for real).
const refreshNoop = async () => {};

const fakeTx = { id: "tx" } as never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const session: any = {
  sessionPubkey: "SPUB",
  sessionTokenPda: "STOK",
  keypair: { secretKey: new Uint8Array([9]) },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function venue(over: Record<string, unknown> = {}): any {
  return {
    openPosition: vi.fn(async () => ({ unsigned: { tx: fakeTx, layer: "er" }, quote: { feeUsdUi: 1 } })),
    closePosition: vi.fn(async () => ({ unsigned: { tx: fakeTx, layer: "er" } })),
    getPositions: vi.fn(async () => []),
    ...over,
  };
}

describe("executeSessionOpen", () => {
  it("session-signs and submits to the ER, returning the sig + quote", async () => {
    const sign = vi.fn((tx) => tx);
    const submit = vi.fn(async () => "SIG");
    const v = venue();
    const out = await executeSessionOpen({
      venue: v,
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      stakeUsdc: 25,
      leverage: 5,
      deps: { refreshBlockhash: refreshNoop, sign, submit, confirm: confirmOk },
    });
    expect(out).toEqual({ signature: "SIG", quote: { feeUsdUi: 1 } });
    expect(v.openPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "O",
        symbol: "SOL",
        collateralUsd: 25,
        leverage: 5,
        side: "long",
        orderType: "market",
        session: { signer: "SPUB", sessionToken: "STOK" },
      }),
    );
    expect(sign).toHaveBeenCalledWith(fakeTx, session.keypair.secretKey);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("throws a conflict (and never opens/submits) when a same-market position already exists on-chain", async () => {
    const sign = vi.fn((tx) => tx);
    const submit = vi.fn(async () => "SIG");
    // An on-chain SOL position with no matching bet row (orphan/self-directed):
    // the DB-only tail guard can't see it, but this on-chain precheck must.
    const v = venue({
      getPositions: vi.fn(async () => [
        { symbol: "SOL", side: "short", sizeUsd: 50, entryPrice: 100, markPrice: 100 },
      ]),
    });
    await expect(
      executeSessionOpen({
        venue: v,
        session,
        owner: "O",
        market: "SOL",
        side: "long",
        stakeUsdc: 25,
        leverage: 5,
        deps: { refreshBlockhash: refreshNoop, sign, submit, confirm: confirmOk },
      }),
    ).rejects.toBeInstanceOf(FlashV2PositionConflictError);
    expect(v.openPosition).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("throws FlashV2TxFailedError when the ER open confirms with an error (no ghost confirmed bet)", async () => {
    const submit = vi.fn(async () => "SIG");
    await expect(
      executeSessionOpen({
        venue: venue(),
        session,
        owner: "O",
        market: "SOL",
        side: "long",
        stakeUsdc: 25,
        leverage: 5,
        deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit, confirm: confirmFail },
      }),
    ).rejects.toBeInstanceOf(FlashV2TxFailedError);
    expect(submit).toHaveBeenCalledOnce(); // it did submit, then the ER reported failure
  });

  it("on a pending open, records only after the position is seen on-chain", async () => {
    const submit = vi.fn(async () => "SIG");
    const getPositions = vi
      .fn()
      .mockResolvedValueOnce([]) // conflict precheck: clear
      .mockResolvedValueOnce([
        { symbol: "SOL", side: "long", sizeUsd: 50, entryPrice: 100, markPrice: 100 },
      ]); // post-submit ground truth: it landed
    const out = await executeSessionOpen({
      venue: venue({ getPositions }),
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      stakeUsdc: 25,
      leverage: 5,
      deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit, confirm: confirmPending },
    });
    expect(out).toEqual({ signature: "SIG", quote: { feeUsdUi: 1 } });
    expect(getPositions).toHaveBeenCalledTimes(2);
  });

  it("on a pending open whose position never appears, throws (no ghost confirmed bet)", async () => {
    const getPositions = vi
      .fn()
      .mockResolvedValueOnce([]) // precheck clear
      .mockResolvedValueOnce([]); // post-submit: still nothing ⇒ it never landed
    await expect(
      executeSessionOpen({
        venue: venue({ getPositions }),
        session,
        owner: "O",
        market: "SOL",
        side: "long",
        stakeUsdc: 25,
        leverage: 5,
        deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit: vi.fn(async () => "SIG"), confirm: confirmPending },
      }),
    ).rejects.toBeInstanceOf(FlashV2TxFailedError);
  });
});

describe("executeSessionClose", () => {
  it("found: session-signs the close, returns sig + mark-price estPnl", async () => {
    const sign = vi.fn((tx) => tx);
    const submit = vi.fn(async () => "CSIG");
    const v = venue({
      getPositions: vi.fn(async () => [
        { symbol: "SOL", side: "long", sizeUsd: 100, entryPrice: 100, markPrice: 90 },
      ]),
    });
    const out = await executeSessionClose({
      venue: v,
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      deps: { refreshBlockhash: refreshNoop, sign, submit, confirm: confirmOk },
    });
    expect(out).toMatchObject({ found: true, signature: "CSIG" });
    if (!out.found) throw new Error("unreachable");
    expect(out.estPnlUsd).toBeCloseTo(-10); // long -10% of $100
    expect(v.closePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "O",
        symbol: "SOL",
        side: "long",
        closeUsd: 100,
        session: { signer: "SPUB", sessionToken: "STOK" },
      }),
    );
  });

  it("found with an unpopulated entry/mark price: estPnlUsd is null, never NaN", async () => {
    const v = venue({
      getPositions: vi.fn(async () => [
        { symbol: "SOL", side: "long", sizeUsd: 100, entryPrice: 0, markPrice: 0 },
      ]),
    });
    const out = await executeSessionClose({
      venue: v,
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit: vi.fn(async () => "S"), confirm: confirmOk },
    });
    expect(out).toMatchObject({ found: true, signature: "S", estPnlUsd: null });
  });

  it("not found: returns { found:false } and never signs or submits", async () => {
    const sign = vi.fn();
    const submit = vi.fn();
    const v = venue({ getPositions: vi.fn(async () => []) });
    const out = await executeSessionClose({
      venue: v,
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      deps: { refreshBlockhash: refreshNoop, sign, submit, confirm: confirmOk },
    });
    expect(out).toEqual({ found: false });
    expect(v.closePosition).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("throws FlashV2TxFailedError when the ER close confirms with an error (bet stays open/retryable)", async () => {
    const v = venue({
      getPositions: vi.fn(async () => [
        { symbol: "SOL", side: "long", sizeUsd: 100, entryPrice: 100, markPrice: 90 },
      ]),
    });
    await expect(
      executeSessionClose({
        venue: v,
        session,
        owner: "O",
        market: "SOL",
        side: "long",
        deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit: vi.fn(async () => "CSIG"), confirm: confirmFail },
      }),
    ).rejects.toBeInstanceOf(FlashV2TxFailedError);
  });

  it("on a pending close whose position is gone, records it (the close landed)", async () => {
    const getPositions = vi
      .fn()
      .mockResolvedValueOnce([
        { symbol: "SOL", side: "long", sizeUsd: 100, entryPrice: 100, markPrice: 90 },
      ]) // find the live position to close
      .mockResolvedValueOnce([]); // post-submit ground truth: gone ⇒ it closed
    const out = await executeSessionClose({
      venue: venue({ getPositions }),
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit: vi.fn(async () => "CSIG"), confirm: confirmPending },
    });
    expect(out).toMatchObject({ found: true, signature: "CSIG" });
    expect(getPositions).toHaveBeenCalledTimes(2);
  });

  it("on a pending close whose position is still open, throws (bet stays closeable, no orphan)", async () => {
    const stillOpen = {
      symbol: "SOL",
      side: "long",
      sizeUsd: 100,
      entryPrice: 100,
      markPrice: 90,
    };
    const getPositions = vi
      .fn()
      .mockResolvedValueOnce([stillOpen]) // find it
      .mockResolvedValueOnce([stillOpen]); // post-submit: still there ⇒ close didn't land
    await expect(
      executeSessionClose({
        venue: venue({ getPositions }),
        session,
        owner: "O",
        market: "SOL",
        side: "long",
        deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit: vi.fn(async () => "CSIG"), confirm: confirmPending },
      }),
    ).rejects.toBeInstanceOf(FlashV2TxFailedError);
  });

  it("deducts venue-provided fees + borrow from the close PnL estimate", async () => {
    const v = venue({
      getPositions: vi.fn(async () => [
        {
          symbol: "SOL",
          side: "long",
          sizeUsd: 100,
          entryPrice: 100,
          markPrice: 110,
          feesUsd: 2,
          borrowUsd: 1,
        },
      ]),
    });
    const out = await executeSessionClose({
      venue: v,
      session,
      owner: "O",
      market: "SOL",
      side: "long",
      deps: { refreshBlockhash: refreshNoop, sign: vi.fn((t) => t), submit: vi.fn(async () => "S"), confirm: confirmOk },
    });
    if (!out.found) throw new Error("unreachable");
    // long +10% of $100 = +10 gross, minus $2 fees minus $1 borrow = $7 net.
    expect(out.estPnlUsd).toBeCloseTo(7);
  });
});
