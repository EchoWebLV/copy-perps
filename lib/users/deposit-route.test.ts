import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  buildDepositTx: vi.fn(),
  ensureGasWalletReady: vi.fn(),
  getFlashV2Venue: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/pacifica/deposit", () => ({
  buildDepositTx: mocks.buildDepositTx,
  InsufficientWalletUsdcError: class extends Error {},
}));
vi.mock("@/lib/bets/funding", () => ({ PACIFICA_MIN_DEPOSIT_USDC: 10 }));
vi.mock("@/lib/wallets/gas", () => ({
  ensureGasWalletReady: mocks.ensureGasWalletReady,
  GasWalletExhaustedError: class extends Error {},
}));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));

import { POST } from "../../app/api/users/me/deposit/route";

function post(body: object) {
  return new Request("http://local.test/api/users/me/deposit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/users/me/deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    // Valid base58 pubkey (the Pacifica branch builds a PublicKey from it).
    mocks.ensureUser.mockResolvedValue({
      solanaPubkey: "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr",
    });
    mocks.ensureGasWalletReady.mockResolvedValue(undefined);
    mocks.getFlashV2Venue.mockReturnValue(null);
  });

  it("flag-off: uses the Pacifica deposit path unchanged", async () => {
    mocks.buildDepositTx.mockResolvedValue({ transactionB64: "PACIFICA_TX" });
    const res = await POST(post({ amountUsdc: 25 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ depositTransaction: "PACIFICA_TX" });
    expect(mocks.ensureGasWalletReady).toHaveBeenCalledTimes(1);
    expect(mocks.buildDepositTx).toHaveBeenCalledTimes(1);
  });

  it("flag-on (onboarded): returns the deposit plan and never touches the Gas Wallet", async () => {
    mocks.getFlashV2Venue.mockReturnValue({
      ensureOnboarded: vi.fn(async () => []),
      deposit: vi.fn(async () => ({ tx: { serialize: () => new Uint8Array([7]) }, layer: "base" })),
    });
    const res = await POST(post({ amountUsdc: 25 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ phase: "deposit", layer: "base" });
    expect(body.depositTransaction).toBe(Buffer.from([7]).toString("base64"));
    expect(mocks.ensureGasWalletReady).not.toHaveBeenCalled();
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
  });

  it("flag-on (fresh basket): returns the onboard phase steps", async () => {
    mocks.getFlashV2Venue.mockReturnValue({
      ensureOnboarded: vi.fn(async () => [
        { name: "init-basket", unsigned: { tx: { serialize: () => new Uint8Array([1]) }, layer: "base" } },
      ]),
      deposit: vi.fn(),
    });
    const res = await POST(post({ amountUsdc: 25 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phase).toBe("onboard");
    expect(body.steps[0]).toMatchObject({ name: "init-basket", layer: "base" });
  });

  it("flag-off: rejects below the Pacifica $10 floor before any deposit work", async () => {
    const res = await POST(post({ amountUsdc: 5 }));
    expect(res.status).toBe(400);
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
    expect(mocks.ensureGasWalletReady).not.toHaveBeenCalled();
  });

  it("flag-on: allows a $1 deposit (no inherited Pacifica $10 floor)", async () => {
    const deposit = vi.fn(async () => ({
      tx: { serialize: () => new Uint8Array([9]) },
      layer: "base",
    }));
    mocks.getFlashV2Venue.mockReturnValue({
      ensureOnboarded: vi.fn(async () => []),
      deposit,
    });
    const res = await POST(post({ amountUsdc: 1 }));
    expect(res.status).toBe(200);
    expect(deposit).toHaveBeenCalledTimes(1);
  });

  it("flag-on: rejects below the $1 flash-v2 floor", async () => {
    const deposit = vi.fn();
    mocks.getFlashV2Venue.mockReturnValue({
      ensureOnboarded: vi.fn(async () => []),
      deposit,
    });
    const res = await POST(post({ amountUsdc: 0.5 }));
    expect(res.status).toBe(400);
    expect(deposit).not.toHaveBeenCalled();
  });
});
