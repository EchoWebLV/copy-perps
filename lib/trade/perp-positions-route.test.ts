import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getFlashV2Venue: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/flash-v2/resolve", () => ({ getFlashV2Venue: mocks.getFlashV2Venue }));

import { POST } from "../../app/api/trade/perp/positions/route";

const OWNER = "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr";

function post(body: object) {
  return new Request("http://local.test/api/trade/perp/positions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const venuePos = {
  positionKey: "vkey-1",
  symbol: "SOL",
  side: "long",
  sizeUsd: 100,
  collateralUsd: 20,
  entryPrice: 100,
  markPrice: 110,
  liquidationPrice: 80,
  leverage: 5,
};

describe("POST /api/trade/perp/positions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({ id: "user-1", solanaPubkey: OWNER });
    mocks.getFlashV2Venue.mockReturnValue({
      getPositions: vi.fn(async () => [venuePos]),
    });
  });

  it("401 without auth", async () => {
    mocks.verifyPrivyRequest.mockResolvedValue(null);
    expect((await POST(post({ walletAddress: OWNER }))).status).toBe(401);
  });

  it("404 when the flag is off (client polls v1 /positions instead)", async () => {
    mocks.getFlashV2Venue.mockReturnValue(null);
    expect((await POST(post({ walletAddress: OWNER }))).status).toBe(404);
  });

  it("400 without a wallet address", async () => {
    expect((await POST(post({}))).status).toBe(400);
  });

  it("maps venue positions to the strip shape", async () => {
    const res = await POST(post({ walletAddress: OWNER }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0]).toMatchObject({
      symbol: "SOL",
      side: "long",
      positionPubkey: "flashv2:SOL:long",
      entryPriceUsd: 100,
      markPriceUsd: 110,
      leverage: 5,
    });
    expect(body.positions[0].pnlUsd).toBeCloseTo(10);
  });

  it("502 when the venue read throws", async () => {
    mocks.getFlashV2Venue.mockReturnValue({
      getPositions: vi.fn(async () => {
        throw new Error("indexer down");
      }),
    });
    expect((await POST(post({ walletAddress: OWNER }))).status).toBe(502);
  });
});
