import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getAgentWallet: vi.fn(),
  getFlashV2Venue: vi.fn(),
  closeCopyFlashV2: vi.fn(),
  selectLimit: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/wallets/agent", () => ({ getAgentWallet: mocks.getAgentWallet }));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));
vi.mock("@/lib/bets/copy-flash-v2", () => ({ closeCopyFlashV2: mocks.closeCopyFlashV2 }));
vi.mock("@/lib/pacifica/orders", () => ({ closeCopyOrder: vi.fn() }));
vi.mock("@/lib/pacifica/client", () => ({ getPositions: vi.fn() }));
vi.mock("@/lib/bets/copy-pnl", () => ({ realizedPnlForOrder: vi.fn() }));
vi.mock("@/lib/db/schema", () => ({ bets: { id: "id", userId: "userId", status: "status", amountUsdc: "amountUsdc", feeUsdc: "feeUsdc", meta: "meta" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
    update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
  },
}));

import { POST } from "../../app/api/bet/copy/close/route";

const OWNER = "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr";

function post(body: object) {
  return new Request("http://local.test/api/bet/copy/close", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/bet/copy/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: OWNER });
    mocks.getFlashV2Venue.mockReturnValue(null);
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("flag-off: skips the venue peek and runs the Pacifica path (no extra query)", async () => {
    mocks.getAgentWallet.mockResolvedValue(null); // 409 in Pacifica path
    const res = await POST(post({ betId: "bet-1", walletAddress: OWNER }));
    expect(res.status).toBe(409);
    expect(mocks.getAgentWallet).toHaveBeenCalledTimes(1);
    expect(mocks.selectLimit).not.toHaveBeenCalled(); // peek skipped when flag off
    expect(mocks.closeCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on (flash-v2 bet): closes via the session and marks the bet closed", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.selectLimit.mockResolvedValue([
      {
        id: "bet-1",
        status: "confirmed",
        amountUsdc: 25,
        feeUsdc: 0.1,
        meta: { venue: "flash-v2", leaderMarket: "SOL", leaderSide: "long" },
      },
    ]);
    mocks.closeCopyFlashV2.mockResolvedValue({ kind: "closed", signature: "CSIG", estPnlUsd: 5 });
    const res = await POST(post({ betId: "bet-1", walletAddress: OWNER }));
    expect(res.status).toBe(200);
    // proceeds = stake 25 + pnl 5 - openFee 0.1
    await expect(res.json()).resolves.toMatchObject({ ok: true, txSig: "CSIG", proceedsUsdc: 29.9 });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.getAgentWallet).not.toHaveBeenCalled();
  });

  it("flag-on (flash-v2 bet, unknown PnL): closes with proceedsUsdc null (no NaN)", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.selectLimit.mockResolvedValue([
      {
        id: "bet-1",
        status: "confirmed",
        amountUsdc: 25,
        feeUsdc: 0.1,
        meta: { venue: "flash-v2", leaderMarket: "SOL", leaderSide: "long" },
      },
    ]);
    mocks.closeCopyFlashV2.mockResolvedValue({ kind: "closed", signature: "CSIG", estPnlUsd: null });
    const res = await POST(post({ betId: "bet-1", walletAddress: OWNER }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, txSig: "CSIG", proceedsUsdc: null });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
  });

  it("flag-on (flash-v2 bet, position gone): marks closed as alreadyClosed", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.selectLimit.mockResolvedValue([
      { id: "bet-1", status: "confirmed", amountUsdc: 25, feeUsdc: 0, meta: { venue: "flash-v2", leaderMarket: "SOL", leaderSide: "long" } },
    ]);
    mocks.closeCopyFlashV2.mockResolvedValue({ kind: "not-found" });
    const res = await POST(post({ betId: "bet-1", walletAddress: OWNER }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, alreadyClosed: true });
  });

  it("flag-on (flash-v2 bet, no session): 409 to re-enable auto-copy", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.selectLimit.mockResolvedValue([
      { id: "bet-1", status: "confirmed", amountUsdc: 25, feeUsdc: 0, meta: { venue: "flash-v2", leaderMarket: "SOL", leaderSide: "long" } },
    ]);
    mocks.closeCopyFlashV2.mockResolvedValue({ kind: "no-session" });
    const res = await POST(post({ betId: "bet-1", walletAddress: OWNER }));
    expect(res.status).toBe(409);
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });

  it("flag-on (pacifica bet): peek finds no flash-v2 venue, falls through to Pacifica", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.selectLimit.mockResolvedValue([
      { id: "bet-1", status: "confirmed", amountUsdc: 25, feeUsdc: 0, meta: { leaderMarket: "SOL", leaderSide: "long" } },
    ]);
    mocks.getAgentWallet.mockResolvedValue(null); // 409 in Pacifica path
    const res = await POST(post({ betId: "bet-1", walletAddress: OWNER }));
    expect(res.status).toBe(409);
    expect(mocks.closeCopyFlashV2).not.toHaveBeenCalled();
    expect(mocks.getAgentWallet).toHaveBeenCalledTimes(1); // proves fall-through
  });
});
