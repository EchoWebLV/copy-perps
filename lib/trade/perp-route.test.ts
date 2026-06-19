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
    planFlashV2Open: vi.fn(),
    FlashV2PositionConflictError,
    getMarketBySymbol: vi.fn(),
  };
});

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));
vi.mock("@/lib/flash-v2/self-trade", () => ({
  planFlashV2Open: mocks.planFlashV2Open,
  FlashV2PositionConflictError: mocks.FlashV2PositionConflictError,
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
  });

  function body(extra: object = {}) {
    return { market: "SOL", side: "long", stakeUsdc: 25, leverage: 5, walletAddress: OWNER, ...extra };
  }

  it("flag-off: routes to the Pacifica branch (flash-v2 open never called)", async () => {
    mocks.getMarketBySymbol.mockResolvedValue(null); // 409 inside Pacifica branch
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.getMarketBySymbol).toHaveBeenCalledTimes(1);
    expect(mocks.planFlashV2Open).not.toHaveBeenCalled();
  });

  it("flag-on: returns the flash-v2 open plan and skips the Pacifica path", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.planFlashV2Open.mockResolvedValue({
      phase: "open",
      transactionB64: "TX",
      layer: "er",
      quote: { entryPriceUi: 100 },
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ phase: "open", layer: "er", transactionB64: "TX" });
    expect(mocks.planFlashV2Open).toHaveBeenCalledWith(
      expect.objectContaining({ owner: OWNER, market: "SOL", side: "long", stakeUsdc: 25, leverage: 5 }),
    );
    expect(mocks.getMarketBySymbol).not.toHaveBeenCalled();
  });

  it("flag-on: a duplicate position maps to 409", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.planFlashV2Open.mockRejectedValue(new mocks.FlashV2PositionConflictError("SOL"));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
  });

  it("flag-on: a builder failure maps to 502 and never touches Pacifica", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.planFlashV2Open.mockRejectedValue(new Error("builder 500"));
    const res = await POST(post(body()));
    expect(res.status).toBe(502);
    expect(mocks.getMarketBySymbol).not.toHaveBeenCalled();
  });

  it("flag-on: rejects out-of-range leverage before any venue work", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    const res = await POST(post(body({ leverage: 250 })));
    expect(res.status).toBe(400);
    expect(mocks.planFlashV2Open).not.toHaveBeenCalled();
  });
});
