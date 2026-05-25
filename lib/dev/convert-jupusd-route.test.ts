import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getTokenAtomicBalance: vi.fn(),
  sellTokenForUsdc: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/solana/balance", () => ({
  getTokenAtomicBalance: mocks.getTokenAtomicBalance,
}));
vi.mock("@/lib/jupiter/swap", () => ({
  sellTokenForUsdc: mocks.sellTokenForUsdc,
}));

import { POST } from "../../app/api/dev/convert-jupusd/route";
import { JUPUSD_MINT } from "@/lib/jupiter/constants";

function convertRequest(body: unknown) {
  return new Request("http://local.test/api/dev/convert-jupusd", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dev/convert-jupusd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: "wallet-1" });
    mocks.getTokenAtomicBalance.mockResolvedValue(6_932_985n);
    mocks.sellTokenForUsdc.mockResolvedValue({
      quote: { outAmount: "6900000" },
      swap: { swapTransaction: "tx-b64" },
    });
  });

  it("builds a swap for the user's full jupUSD balance", async () => {
    const response = await POST(
      convertRequest({ walletAddress: "wallet-1" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getTokenAtomicBalance).toHaveBeenCalledWith(
      "wallet-1",
      JUPUSD_MINT,
    );
    expect(mocks.sellTokenForUsdc).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMint: JUPUSD_MINT,
        tokenAmountAtomic: 6_932_985n,
        userPublicKey: "wallet-1",
        slippageBps: 500,
        useSharedAccounts: false,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      swapTransaction: "tx-b64",
      jupUsdAmount: 6.932985,
      expectedUsdcOut: 6.9,
    });
  });

  it("returns a clear empty-state response when there is no jupUSD", async () => {
    mocks.getTokenAtomicBalance.mockResolvedValue(0n);

    const response = await POST(
      convertRequest({ walletAddress: "wallet-1" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "No jupUSD balance to convert",
    });
    expect(mocks.sellTokenForUsdc).not.toHaveBeenCalled();
  });
});
