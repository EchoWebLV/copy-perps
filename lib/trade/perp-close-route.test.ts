import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getFlashV2Venue: vi.fn(),
  closeSelfFlashV2: vi.fn(),
  getAgentWallet: vi.fn(),
  getPositions: vi.fn(),
  closeCopyOrder: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));
vi.mock("@/lib/bets/self-flash-v2", () => ({ closeSelfFlashV2: mocks.closeSelfFlashV2 }));
vi.mock("@/lib/wallets/agent", () => ({ getAgentWallet: mocks.getAgentWallet }));
vi.mock("@/lib/pacifica/client", () => ({ getPositions: mocks.getPositions }));
vi.mock("@/lib/pacifica/orders", () => ({ closeCopyOrder: mocks.closeCopyOrder }));

import { POST } from "../../app/api/trade/perp/close/route";

function post(body: object) {
  return new Request("http://local.test/api/trade/perp/close", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const OWNER = "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr";

describe("POST /api/trade/perp/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: OWNER });
    mocks.getFlashV2Venue.mockReturnValue(null);
  });

  function body(extra: object = {}) {
    return { market: "SOL", side: "long", walletAddress: OWNER, ...extra };
  }

  it("flag-off: routes to the Pacifica branch (flash-v2 close never called)", async () => {
    mocks.getAgentWallet.mockResolvedValue(null); // 409 inside Pacifica branch
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.getAgentWallet).toHaveBeenCalledTimes(1);
    expect(mocks.closeSelfFlashV2).not.toHaveBeenCalled();
  });

  it("flag-on (closed): session-signs the close and skips Pacifica", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.closeSelfFlashV2.mockResolvedValue({
      kind: "closed",
      signature: "CSIG",
      estPnlUsd: 10,
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      phase: "closed",
      txSig: "CSIG",
      estPnlUsd: 10,
    });
    expect(mocks.getAgentWallet).not.toHaveBeenCalled();
  });

  it("flag-on (no-session): 409 enable-session so the client re-enables then retries", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.closeSelfFlashV2.mockResolvedValue({ kind: "no-session" });
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ phase: "enable-session" });
    expect(mocks.getAgentWallet).not.toHaveBeenCalled();
  });

  it("flag-on (not found): falls through to Pacifica so a Pacifica position never strands", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.closeSelfFlashV2.mockResolvedValue({ kind: "not-found" });
    mocks.getAgentWallet.mockResolvedValue(null); // 409 inside Pacifica branch
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(mocks.closeSelfFlashV2).toHaveBeenCalledTimes(1);
    expect(mocks.getAgentWallet).toHaveBeenCalledTimes(1); // proves fall-through
  });

  it("flag-on: a venue read failure maps to 502 and never touches Pacifica", async () => {
    mocks.getFlashV2Venue.mockReturnValue({ id: "venue" });
    mocks.closeSelfFlashV2.mockRejectedValue(new Error("indexer 500"));
    const res = await POST(post(body()));
    expect(res.status).toBe(502);
    expect(mocks.getAgentWallet).not.toHaveBeenCalled();
  });
});
