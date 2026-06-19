import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSessionKey: vi.fn(),
  executeSessionOpen: vi.fn(),
  executeSessionClose: vi.fn(),
}));

vi.mock("@/lib/flash-v2/session-store", () => ({
  getActiveSessionKey: mocks.getActiveSessionKey,
}));
vi.mock("@/lib/flash-v2/session-trade", () => ({
  executeSessionOpen: mocks.executeSessionOpen,
  executeSessionClose: mocks.executeSessionClose,
}));

import { openSelfFlashV2, closeSelfFlashV2 } from "./self-flash-v2";

const fakeTx = { serialize: () => new Uint8Array([5]) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function venue(over: Record<string, unknown> = {}): any {
  return {
    ensureOnboarded: vi.fn(async () => []),
    openPosition: vi.fn(),
    closePosition: vi.fn(),
    getPositions: vi.fn(),
    ...over,
  };
}

const openArgs = {
  userId: "u",
  owner: "O",
  market: "SOL",
  side: "long" as const,
  stakeUsdc: 1,
  leverage: 5,
};

describe("openSelfFlashV2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enable-session when there is no active session (never executes)", async () => {
    mocks.getActiveSessionKey.mockResolvedValue(null);
    const r = await openSelfFlashV2({ venue: venue(), ...openArgs });
    expect(r).toEqual({ kind: "enable-session" });
    expect(mocks.executeSessionOpen).not.toHaveBeenCalled();
  });

  it("onboard steps when the basket is not set up (never executes)", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    const v = venue({
      ensureOnboarded: vi.fn(async () => [
        { name: "init-basket", unsigned: { tx: fakeTx, layer: "base" } },
      ]),
    });
    const r = await openSelfFlashV2({ venue: v, ...openArgs });
    expect(r.kind).toBe("onboard");
    if (r.kind !== "onboard") throw new Error("unreachable");
    expect(r.steps[0]).toMatchObject({ name: "init-basket", layer: "base" });
    expect(r.steps[0].transactionB64).toBe(Buffer.from([5]).toString("base64"));
    expect(mocks.executeSessionOpen).not.toHaveBeenCalled();
  });

  it("session-signs the open when set up + onboarded", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionOpen.mockResolvedValue({
      signature: "SIG",
      quote: { entryPriceUi: 150 },
    });
    const r = await openSelfFlashV2({ venue: venue(), ...openArgs });
    expect(r).toEqual({ kind: "opened", signature: "SIG", quote: { entryPriceUi: 150 } });
    expect(mocks.executeSessionOpen).toHaveBeenCalledTimes(1);
  });

  it("propagates an on-chain open failure (so the route reports no funds spent)", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionOpen.mockRejectedValue(new Error("ER open reverted"));
    await expect(openSelfFlashV2({ venue: venue(), ...openArgs })).rejects.toThrow(
      "ER open reverted",
    );
  });
});

describe("closeSelfFlashV2", () => {
  const closeArgs = { userId: "u", owner: "O", market: "SOL", side: "long" as const };
  beforeEach(() => vi.clearAllMocks());

  it("no-session when the session expired/never enabled", async () => {
    mocks.getActiveSessionKey.mockResolvedValue(null);
    const r = await closeSelfFlashV2({ venue: venue(), ...closeArgs });
    expect(r).toEqual({ kind: "no-session" });
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
  });

  it("not-found when no matching live position (route falls through to Pacifica)", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionClose.mockResolvedValue({ found: false });
    const r = await closeSelfFlashV2({ venue: venue(), ...closeArgs });
    expect(r).toEqual({ kind: "not-found" });
  });

  it("closed with the session signature + est pnl", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionClose.mockResolvedValue({
      found: true,
      signature: "CSIG",
      estPnlUsd: 0.42,
    });
    const r = await closeSelfFlashV2({ venue: venue(), ...closeArgs });
    expect(r).toEqual({ kind: "closed", signature: "CSIG", estPnlUsd: 0.42 });
  });
});
