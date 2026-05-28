import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMarketSentimentSnapshot: vi.fn(),
}));

vi.mock("@/lib/data/market-sentiment", () => ({
  getMarketSentimentSnapshot: mocks.getMarketSentimentSnapshot,
}));

describe("/api/markets/sentiment", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getMarketSentimentSnapshot.mockReset();
    mocks.getMarketSentimentSnapshot.mockResolvedValue({});
  });

  it("normalizes requested markets and returns a no-store sentiment payload", async () => {
    const { GET } = await import("@/app/api/markets/sentiment/route");

    const response = await GET(
      new Request("http://localhost/api/markets/sentiment?markets=btc, eth,sol"),
    );

    expect(mocks.getMarketSentimentSnapshot).toHaveBeenCalledWith([
      "BTC",
      "ETH",
      "SOL",
    ]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ sentiment: {} });
  });

  it("rejects invalid market symbols", async () => {
    const { GET } = await import("@/app/api/markets/sentiment/route");

    const response = await GET(
      new Request("http://localhost/api/markets/sentiment?markets=BTC,../../x"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getMarketSentimentSnapshot).not.toHaveBeenCalled();
  });
});
