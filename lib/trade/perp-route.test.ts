import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FlashV2PositionConflictError extends Error {
    constructor(public market: string) {
      super(`you already have an open ${market} position - close it first`);
    }
  }
  return {
    verifyPrivyRequest: vi.fn(),
    ensureUser: vi.fn(),
    getFlashV2Venue: vi.fn(),
    openSelfFlashV2: vi.fn(),
    FlashV2PositionConflictError,
    getMarketBySymbol: vi.fn(),
    hasOpenTailOnMarket: vi.fn(),
    reserveTailOnMarket: vi.fn(),
    releaseTailReservation: vi.fn(),
  };
});

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));
vi.mock("@/lib/flash-v2/self-trade", () => ({
  FlashV2PositionConflictError: mocks.FlashV2PositionConflictError,
}));
vi.mock("@/lib/bets/self-flash-v2", () => ({ openSelfFlashV2: mocks.openSelfFlashV2 }));
vi.mock("@/lib/bets/copy-guard", () => ({ hasOpenTailOnMarket: mocks.hasOpenTailOnMarket }));
vi.mock("@/lib/bets/tail-reservation", () => ({
  reserveTailOnMarket: mocks.reserveTailOnMarket,
  releaseTailReservation: mocks.releaseTailReservation,
}));
// Pacifica-branch deps: only getMarketBySymbol is exercised (returns null → 409),
// proving the flag-off path enters the Pacifica branch without reaching execution.
vi.mock("@/lib/pacifica/markets", () => ({
  getMarketBySymbol: mocks.getMarketBySymbol,
  clampLeverageForNotional: vi.fn(),
}));
vi.mock("@/lib/bets/funding", () => ({
  InsufficientAppFundsError: class extends Error {},
  PacificaDepositPendingError: class extends Error {},
  PacificaDepositSettlingError: class extends Error {},
  PacificaFundingRateLimitError: class extends Error {},
  isPacificaFundingRateLimitError: () => false,
  planPacificaDepositTopUp: vi.fn(),
}));
vi.mock("@/lib/bets/onboard", () => ({ planOnboarding: vi.fn() }));
vi.mock("@/lib/bets/route-errors", () => ({ marketDataErrorResponse: () => null }));
vi.mock("@/lib/data/marks", () => ({ getMark: vi.fn() }));
vi.mock("@/lib/pacifica/client", () => ({ getPositions: vi.fn(async () => []) }));
vi.mock("@/lib/pacifica/orders", () => ({ openCopyOrder: vi.fn() }));
vi.mock("@/lib/pacifica/sizing", () => ({ lotSizedAmountFromNotional: vi.fn() }));
vi.mock("@/lib/wallets/agent", () => ({ getAgentWallet: vi.fn() }));

import { POST } from "../../app/api/trade/perp/route";

function post(body: object) {
  return new Request("http://local.test/api/trade/perp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const OWNER = "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr";

describe("POST /api/trade/perp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: OWNER });
    mocks.getFlashV2Venue.mockReturnValue(null);
    mocks.hasOpenTailOnMarket.mockResolvedValue(false);
    mocks.reserveTailOnMarket.mockResolvedValue(true);
    mocks.releaseTailReservation.mockResolvedValue(undefined);
  });

  function body(extra: object = {}) {
    return { market: "SOL", side: "long", stakeUsdc: 25, leverage: 5, walletAddress: OWNER, ...extra };
  }

  it("flag-off: routes to the Pacifica branch (flash-v2 open never called)", async () => {
    mocks.getMarketBySymbol.mockResolvedValue(null); // 409 inside Pacifica branch
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.getMarketBySymbol).toHaveBeenCalledTimes(1);
    expect(mocks.openSelfFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: session-signs the open and returns phase:open (skips Pacifica)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openSelfFlashV2.mockResolvedValue({
      kind: "opened",
      signature: "SIG",
      quote: { entryPriceUi: 100 },
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      phase: "open",
      txSig: "SIG",
      market: "SOL",
      side: "long",
      quote: { entryPriceUi: 100 },
    });
    expect(mocks.openSelfFlashV2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: OWNER, market: "SOL", side: "long", stakeUsdc: 25, leverage: 5 }),
    );
    expect(mocks.getMarketBySymbol).not.toHaveBeenCalled();
    // The lock is taken then released on the way out.
    expect(mocks.reserveTailOnMarket).toHaveBeenCalledWith("user-1", "SOL");
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "SOL");
  });

  it("flag-on: enable-session phase passes through (and releases the lock)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openSelfFlashV2.mockResolvedValue({ kind: "enable-session" });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ phase: "enable-session" });
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "SOL");
  });

  it("flag-on: onboard phase returns the base-layer steps", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openSelfFlashV2.mockResolvedValue({
      kind: "onboard",
      steps: [{ name: "init-basket", transactionB64: "b1", layer: "base" }],
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      phase: "onboard",
      steps: [{ name: "init-basket", transactionB64: "b1", layer: "base" }],
    });
  });

  it("flag-on: a duplicate position maps to 409 (and releases the lock)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openSelfFlashV2.mockRejectedValue(new mocks.FlashV2PositionConflictError("SOL"));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "SOL");
  });

  it("flag-on: a builder failure maps to 502 and never touches Pacifica", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openSelfFlashV2.mockRejectedValue(new Error("builder 500"));
    const res = await POST(post(body()));
    expect(res.status).toBe(502);
    expect(mocks.getMarketBySymbol).not.toHaveBeenCalled();
  });

  it("flag-on: a held reservation maps to 409 (no double open)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.reserveTailOnMarket.mockResolvedValue(false);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.openSelfFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: rejects out-of-range leverage before any venue work", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    // 250x is now allowed (degen); the cap is 500x.
    const res = await POST(post(body({ leverage: 501 })));
    expect(res.status).toBe(400);
    expect(mocks.openSelfFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: blocks a self-directed open on a market with a DB-tracked tail (no netting)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.hasOpenTailOnMarket.mockResolvedValue(true);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.hasOpenTailOnMarket).toHaveBeenCalledWith("user-1", "SOL", "flash-v2");
    expect(mocks.openSelfFlashV2).not.toHaveBeenCalled();
  });

  it("flag-off: does NOT consult the flash-v2 tail guard (Pacifica path unchanged)", async () => {
    mocks.getMarketBySymbol.mockResolvedValue(null); // 409 inside Pacifica branch
    await POST(post(body()));
    expect(mocks.hasOpenTailOnMarket).not.toHaveBeenCalled();
  });
});
