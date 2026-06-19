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

import { closeCopyFlashV2, openCopyFlashV2 } from "./copy-flash-v2";

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
  stakeUsdc: 25,
  leverage: 5,
};

describe("openCopyFlashV2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enable-session when there is no active session (never executes)", async () => {
    mocks.getActiveSessionKey.mockResolvedValue(null);
    const r = await openCopyFlashV2({ venue: venue(), ...openArgs });
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
    const r = await openCopyFlashV2({ venue: v, ...openArgs });
    expect(r.kind).toBe("onboard");
    if (r.kind !== "onboard") throw new Error("unreachable");
    expect(r.steps[0]).toMatchObject({ name: "init-basket", layer: "base" });
    expect(r.steps[0].transactionB64).toBe(Buffer.from([5]).toString("base64"));
    expect(mocks.executeSessionOpen).not.toHaveBeenCalled();
  });

  it("opened: returns the signature + quote when session + onboarded", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionOpen.mockResolvedValue({ signature: "SIG", quote: { feeUsdUi: 1 } });
    const r = await openCopyFlashV2({ venue: venue(), ...openArgs });
    expect(r).toEqual({ kind: "opened", signature: "SIG", quote: { feeUsdUi: 1 } });
  });
});

describe("closeCopyFlashV2", () => {
  const closeArgs = { userId: "u", owner: "O", market: "SOL", side: "long" as const };
  beforeEach(() => vi.clearAllMocks());

  it("no-session when there is no active session", async () => {
    mocks.getActiveSessionKey.mockResolvedValue(null);
    const r = await closeCopyFlashV2({ venue: venue(), ...closeArgs });
    expect(r).toEqual({ kind: "no-session" });
    expect(mocks.executeSessionClose).not.toHaveBeenCalled();
  });

  it("not-found when the position is already gone", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionClose.mockResolvedValue({ found: false });
    const r = await closeCopyFlashV2({ venue: venue(), ...closeArgs });
    expect(r).toEqual({ kind: "not-found" });
  });

  it("closed: returns the signature + estPnl", async () => {
    mocks.getActiveSessionKey.mockResolvedValue({ sessionPubkey: "S" });
    mocks.executeSessionClose.mockResolvedValue({ found: true, signature: "CSIG", estPnlUsd: -3 });
    const r = await closeCopyFlashV2({ venue: venue(), ...closeArgs });
    expect(r).toEqual({ kind: "closed", signature: "CSIG", estPnlUsd: -3 });
  });
});
