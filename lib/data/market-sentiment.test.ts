import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearMarketSentimentCache,
  getMarketSentimentSnapshot,
} from "./market-sentiment";

describe("getMarketSentimentSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _clearMarketSentimentCache();
  });

  it("builds no-key public market sentiment from Binance positioning and Hyperliquid context", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("topLongShortPositionRatio")) {
          return json([
            {
              symbol: "BTCUSDT",
              longAccount: "0.62",
              shortAccount: "0.38",
              longShortRatio: "1.6316",
              timestamp: 1_700_000_000_000,
            },
          ]);
        }
        if (url.includes("topLongShortAccountRatio")) {
          return json([
            {
              symbol: "BTCUSDT",
              longAccount: "0.58",
              shortAccount: "0.42",
              longShortRatio: "1.381",
              timestamp: 1_700_000_000_000,
            },
          ]);
        }
        if (url.includes("globalLongShortAccountRatio")) {
          return json([
            {
              symbol: "BTCUSDT",
              longAccount: "0.51",
              shortAccount: "0.49",
              longShortRatio: "1.04",
              timestamp: 1_700_000_000_000,
            },
          ]);
        }
        if (url.includes("openInterestHist")) {
          return json([
            {
              symbol: "BTCUSDT",
              sumOpenInterest: "200",
              sumOpenInterestValue: "1000000",
              timestamp: 1_700_000_000_000,
            },
          ]);
        }
        if (url.includes("takerlongshortRatio")) {
          return json([
            {
              buySellRatio: "1.20",
              buyVol: "120",
              sellVol: "100",
              timestamp: 1_700_000_000_000,
            },
          ]);
        }
        if (url.includes("premiumIndex")) {
          return json({
            symbol: "BTCUSDT",
            lastFundingRate: "0.0001",
            time: 1_700_000_000_000,
          });
        }
        if (url === "https://api.hyperliquid.xyz/info") {
          expect(init?.method).toBe("POST");
          return json([
            { universe: [{ name: "BTC", maxLeverage: 50 }] },
            [
              {
                markPx: "50000",
                openInterest: "20",
                funding: "0.0002",
                dayNtlVlm: "25000000",
              },
            ],
          ]);
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    );

    const snapshot = await getMarketSentimentSnapshot(["BTC"]);

    expect(snapshot.BTC.binance).toMatchObject({
      symbol: "BTCUSDT",
      topTraderLongPct: 62,
      topTraderShortPct: 38,
      topTraderAccountLongPct: 58,
      globalLongPct: 51,
      openInterestUsd: 1_000_000,
      takerBuySellRatio: 1.2,
      fundingRate: 0.0001,
    });
    expect(snapshot.BTC.hyperliquid).toMatchObject({
      openInterestUsd: 1_000_000,
      fundingRate: 0.0002,
      dayVolumeUsd: 25_000_000,
    });
    expect(snapshot.BTC.longPressureUsd).toBe(620_000);
    expect(snapshot.BTC.shortPressureUsd).toBe(380_000);
    expect(snapshot.BTC.bias).toBe("long");

    for (const [, init] of fetchSpy.mock.calls) {
      expect(JSON.stringify(init?.headers ?? {})).not.toContain("API");
      expect(JSON.stringify(init?.headers ?? {})).not.toContain("Authorization");
    }
  });

  it("falls back to tracked data when a market has no public positioning", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://api.hyperliquid.xyz/info") {
          return json([{ universe: [{ name: "XAU" }] }, [{ markPx: "4200", openInterest: "3" }]]);
        }
        return new Response("missing", { status: 404 });
      },
    );

    const snapshot = await getMarketSentimentSnapshot(["XAU"]);

    expect(snapshot.XAU.binance).toBeNull();
    expect(snapshot.XAU.hyperliquid?.openInterestUsd).toBe(12_600);
    expect(snapshot.XAU.longPressureUsd).toBeNull();
    expect(snapshot.XAU.shortPressureUsd).toBeNull();
    expect(snapshot.XAU.source).toBe("hyperliquid");
  });

  it("caches public sentiment snapshots briefly", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(json([]));

    await getMarketSentimentSnapshot(["ETH"]);
    await getMarketSentimentSnapshot(["ETH"]);

    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("ETHUSDT"))).toHaveLength(6);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
