import { describe, expect, it, vi } from "vitest";
import { executeSessionClose, executeSessionOpen } from "./session-trade";

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
      deps: { sign, submit },
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
      deps: { sign, submit },
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
      deps: { sign, submit },
    });
    expect(out).toEqual({ found: false });
    expect(v.closePosition).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
