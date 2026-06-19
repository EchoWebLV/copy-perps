import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  hasOpenTailOnMarket: vi.fn(),
  reserveTailOnMarket: vi.fn(),
  releaseTailReservation: vi.fn(),
  getFlashV2Venue: vi.fn(),
  openCopyFlashV2: vi.fn(),
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
vi.mock("@/lib/db/schema", () => ({ bets: {} }));
vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }) },
}));

import { POST } from "../../app/api/bet/bot/route";
import { FlashV2PositionConflictError } from "@/lib/flash-v2/self-trade";

const OWNER = "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr";

function post(body: object) {
  return new Request("http://local.test/api/bet/bot", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function body(extra: object = {}) {
  return {
    botId: "arena:claude",
    botName: "Claude",
    market: "SOL",
    side: "long",
    leverage: 5,
    stakeUsdc: 25,
    sourcePositionId: "arena:claude:1700000000000",
    autoCloseOnSourceClose: true,
    walletAddress: OWNER,
    ...extra,
  };
}

describe("POST /api/bet/bot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: OWNER });
    mocks.hasOpenTailOnMarket.mockResolvedValue(false);
    mocks.reserveTailOnMarket.mockResolvedValue(true);
    mocks.releaseTailReservation.mockResolvedValue(undefined);
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
  });

  it("flag-off: 404 (bot tails use the v1 /api/flash/perp rail when the flag is off)", async () => {
    mocks.getFlashV2Venue.mockReturnValue(null);
    const res = await POST(post(body()));
    expect(res.status).toBe(404);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: session-opens and writes a type=copy bet with meta.botId", async () => {
    mocks.openCopyFlashV2.mockResolvedValue({
      kind: "opened",
      signature: "SIG",
      quote: { feeUsdUi: 0.5 },
    });
    mocks.insertReturning.mockResolvedValue([{ id: "bet-1" }]);
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      phase: "open",
      betId: "bet-1",
      txSig: "SIG",
      botId: "arena:claude",
    });
    expect(mocks.openCopyFlashV2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: OWNER, market: "SOL", side: "long", stakeUsdc: 25, leverage: 5 }),
    );
  });

  it("flag-on: surfaces enable-session (no bet row written)", async () => {
    mocks.openCopyFlashV2.mockResolvedValue({ kind: "enable-session" });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ phase: "enable-session" });
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "SOL");
  });

  it("flag-on: surfaces onboard steps (no bet row written)", async () => {
    mocks.openCopyFlashV2.mockResolvedValue({
      kind: "onboard",
      steps: [{ name: "init-basket", transactionB64: "TX", layer: "base" }],
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.phase).toBe("onboard");
    expect(mocks.insertReturning).not.toHaveBeenCalled();
  });

  it("flag-on: an on-chain position conflict maps to 409 and releases the reservation", async () => {
    mocks.openCopyFlashV2.mockRejectedValue(new FlashV2PositionConflictError("SOL"));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "SOL");
    expect(mocks.insertReturning).not.toHaveBeenCalled();
  });

  it("flag-on: a busy reservation is rejected with 409 before opening", async () => {
    mocks.reserveTailOnMarket.mockResolvedValue(false);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on: a duplicate tail is rejected by the guard before reserving", async () => {
    mocks.hasOpenTailOnMarket.mockResolvedValue(true);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.reserveTailOnMarket).not.toHaveBeenCalled();
  });

  it("rejects a sub-$5 stake and out-of-range leverage with 400", async () => {
    expect((await POST(post(body({ stakeUsdc: 1 })))).status).toBe(400);
    expect((await POST(post(body({ leverage: 250 })))).status).toBe(400);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });

  it("rejects a non-finite / null stake with 400 (no NaN slips into the bounds compares)", async () => {
    // Over JSON, NaN/Infinity serialize to null (caught by the typeof gate); the
    // Number.isFinite guard is the defense-in-depth backstop for any non-JSON
    // caller, where a real NaN would otherwise pass `NaN < 5` / `NaN > 1000`.
    expect((await POST(post(body({ stakeUsdc: Number.NaN })))).status).toBe(400);
    expect((await POST(post(body({ stakeUsdc: Number.POSITIVE_INFINITY })))).status).toBe(400);
    expect((await POST(post(body({ stakeUsdc: null })))).status).toBe(400);
    expect(mocks.openCopyFlashV2).not.toHaveBeenCalled();
  });
});
