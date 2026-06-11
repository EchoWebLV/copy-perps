import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  confirmFlashTailOpen: vi.fn(),
  confirmFlashTailClose: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));
vi.mock("@/lib/bets/flash-tail", () => ({
  confirmFlashTailOpen: mocks.confirmFlashTailOpen,
  confirmFlashTailClose: mocks.confirmFlashTailClose,
}));

import { POST as CONFIRM_OPEN } from "../../app/api/flash/perp/confirm/route";
import { POST as CONFIRM_CLOSE } from "../../app/api/flash/perp/close/confirm/route";

function postRequest(path: string, body: unknown) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

describe("flash-tail confirm routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: "wallet-1" });
    mocks.confirmFlashTailOpen.mockResolvedValue(true);
    mocks.confirmFlashTailClose.mockResolvedValue(true);
  });

  it("confirms an open", async () => {
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", {
        betId: "bet-1",
        signature: "sig-open",
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.confirmFlashTailOpen).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-open",
    });
  });

  it("rejects a confirm without betId or signature", async () => {
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", { betId: "bet-1" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.confirmFlashTailOpen).not.toHaveBeenCalled();
  });

  it("404s when the bet is not confirmable", async () => {
    mocks.confirmFlashTailOpen.mockResolvedValue(false);
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", {
        betId: "bet-x",
        signature: "sig",
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("confirms a close with the receive estimate", async () => {
    const response = await CONFIRM_CLOSE(
      postRequest("/api/flash/perp/close/confirm", {
        betId: "bet-1",
        signature: "sig-close",
        receiveUsd: 1.24,
        walletAddress: "wallet-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.confirmFlashTailClose).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-close",
      receiveUsdEstimate: 1.24,
    });
  });

  it("requires auth", async () => {
    mocks.verifyPrivyRequest.mockResolvedValue(null);
    const response = await CONFIRM_OPEN(
      postRequest("/api/flash/perp/confirm", {
        betId: "bet-1",
        signature: "sig",
      }),
    );
    expect(response.status).toBe(401);
  });
});
