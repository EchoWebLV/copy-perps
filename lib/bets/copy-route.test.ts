import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  hasOpenTailOnMarket: vi.fn(),
  getFlashV2Venue: vi.fn(),
  openCopyFlashV2: vi.fn(),
  reserveTailOnMarket: vi.fn(),
  releaseTailReservation: vi.fn(),
  getPositions: vi.fn(),
  getMarketBySymbol: vi.fn(),
  clampLeverageForNotional: vi.fn(),
  insertReturning: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/bets/copy-guard", () => ({ hasOpenTailOnMarket: mocks.hasOpenTailOnMarket }));
vi.mock("@/lib/bets/tail-reservation", () => ({
  reserveTailOnMarket: mocks.reserveTailOnMarket,
  releaseTailReservation: mocks.releaseTailReservation,
}));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));
vi.mock("@/lib/bets/copy-flash-v2", () => ({ openCopyFlashV2: mocks.openCopyFlashV2 }));
vi.mock("@/lib/pacifica/client", () => ({ getPositions: mocks.getPositions }));
vi.mock("@/lib/pacifica/markets", () => ({
  getMarketBySymbol: mocks.getMarketBySymbol,
  clampLeverageForNotional: mocks.clampLeverageForNotional,
}));
vi.mock("@/lib/pacifica/orders", () => ({ openCopyOrder: vi.fn() }));
vi.mock("@/lib/pacifica/sizing", () => ({ lotSizedAmountFromNotional: vi.fn(() => "1") }));
vi.mock("@/lib/pacifica/deposit", () => ({ InsufficientWalletUsdcError: class extends Error {} }));
vi.mock("@/lib/bets/onboard", () => ({ planOnboarding: vi.fn() }));
vi.mock("@/lib/bets/funding", () => ({
  InsufficientAppFundsError: class extends Error {},
  PacificaDepositPendingError: class extends Error {},
  PacificaDepositSettlingError: class extends Error {},
  PacificaFundingRateLimitError: class extends Error {},
  isPacificaFundingRateLimitError: () => false,
  planPacificaDepositTopUp: vi.fn(),
}));
vi.mock("@/lib/bets/route-errors", () => ({ marketDataErrorResponse: () => null }));
vi.mock("@/lib/wallets/agent", () => ({ getAgentWallet: vi.fn() }));
vi.mock("@/lib/db/schema", () => ({ bets: {} }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }),
  },
}));

import { POST } from "../../app/api/bet/copy/route";
import { FlashV2PositionConflictError } from "@/lib/flash-v2/self-trade";

const OWNER = "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr";

function post(body: object) {
  return new Request("http://local.test/api/bet/copy", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function body(extra: object = {}) {
  return {
    leaderAddress: "LEADER",
    market: "SOL",
    side: "long",
    leverage: 5,
    stakeUsdc: 25,
    walletAddress: OWNER,
    ...extra,
  };
}

describe("POST /api/bet/copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: OWNER });
    mocks.hasOpenTailOnMarket.mockResolvedValue(false);
    mocks.reserveTailOnMarket.mockResolvedValue(true);
    mocks.releaseTailReservation.mockResolvedValue(undefined);
    // Leader still holds the matching long (bid) position.
    mocks.getPositions.mockResolvedValue([{ symbol: "SOL", side: "bid", entry_price: "100" }]);
    mocks.getFlashV2Venue.mockReturnValue(null);
  });

  it("flag-off: passes the guard a 'pacifica' venue and reaches the Pacifica path", async () => {
    mocks.clampLeverageForNotional.mockResolvedValue(10);
    mocks.getMarketBySymbol.mockResolvedValue(null); // 409 inside Pacifica path
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.hasOpenTailOnMarket).toHaveBeenCalledWith("user-1", "SOL", "pacifica");
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: keys the guard on 'flash-v2' and opens via the session helper", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openCopyFlashV2.mockResolvedValue({
      kind: "opened",
      signature: "SIG",
      quote: { feeUsdUi: 0.5 },
    });
    mocks.insertReturning.mockResolvedValue([{ id: "bet-1" }]);
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ phase: "open", betId: "bet-1", txSig: "SIG" });
    expect(mocks.hasOpenTailOnMarket).toHaveBeenCalledWith("user-1", "SOL", "flash-v2");
    expect(mocks.openCopyFlashV2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: OWNER, market: "SOL", side: "long", stakeUsdc: 25, leverage: 5 }),
    );
    expect(mocks.getMarketBySymbol).not.toHaveBeenCalled();
  });

  it("flag-on: surfaces the enable-session phase (no bet row written)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openCopyFlashV2.mockResolvedValue({ kind: "enable-session" });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ phase: "enable-session" });
    expect(mocks.insertReturning).not.toHaveBeenCalled();
  });

  it("flag-on: surfaces the onboard phase with steps (no bet row written)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openCopyFlashV2.mockResolvedValue({
      kind: "onboard",
      steps: [{ name: "init-basket", transactionB64: "TX", layer: "base" }],
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.phase).toBe("onboard");
    expect(json.steps[0]).toMatchObject({ name: "init-basket" });
    expect(mocks.insertReturning).not.toHaveBeenCalled();
  });

  it("flag-on: rejects out-of-range leverage before any venue work", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    const res = await POST(post(body({ leverage: 250 })));
    expect(res.status).toBe(400);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: a duplicate tail is rejected by the guard before opening", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.hasOpenTailOnMarket.mockResolvedValue(true);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: a busy reservation (concurrent tap) is rejected with 409 before opening", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.reserveTailOnMarket.mockResolvedValue(false);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: an on-chain position conflict maps to 409 and releases the reservation", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.openCopyFlashV2.mockRejectedValue(new FlashV2PositionConflictError("SOL"));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("SOL"),
    });
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "SOL");
  });
});
