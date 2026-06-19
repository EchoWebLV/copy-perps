import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrices, getPositions, getBasketPubkey } from "./query";

afterEach(() => vi.unstubAllGlobals());

/** Route the mock by URL so getPositions (which also reads /prices) sees the
 *  right body per endpoint. Bodies use the REAL documented Flash v2 shapes. */
function mockRoutes(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k));
      return { status: 200, json: async () => (key ? routes[key] : null) };
    }),
  );
}

describe("query", () => {
  it("maps the /prices record (priceUi) to a symbol→number map", async () => {
    mockRoutes({ "/prices": { SOL: { priceUi: 150.5 }, BTC: { priceUi: 60000 } } });
    const marks = await getPrices();
    expect(marks.SOL).toBe(150.5);
    expect(marks.BTC).toBe(60000);
  });

  it("maps positionMetrics from the owner snapshot, mark from /prices", async () => {
    mockRoutes({
      "/owner/": {
        basketPubkey: "Bskt111",
        positionMetrics: {
          "SOL-long": {
            marketSymbol: "SOL",
            sideUi: "long",
            sizeUsdUi: 250,
            collateralUsdUi: 50,
            entryPriceUi: 140,
            liquidationPriceUi: 90,
            leverageUi: 5,
          },
        },
      },
      "/prices": { SOL: { priceUi: 150 } },
    });
    const pos = await getPositions("owner1");
    expect(pos).toHaveLength(1);
    expect(pos[0]!.symbol).toBe("SOL");
    expect(pos[0]!.side).toBe("long");
    expect(pos[0]!.sizeUsd).toBe(250);
    expect(pos[0]!.markPrice).toBe(150);
    expect(pos[0]!.positionKey).toBe("SOL-long");
  });

  it("missing /prices symbol ⇒ markPrice 0 (not entryPrice), so PnL guards treat it as unknown", async () => {
    mockRoutes({
      "/owner/": {
        basketPubkey: "Bskt111",
        positionMetrics: {
          "SOL-long": {
            marketSymbol: "SOL",
            sideUi: "long",
            sizeUsdUi: 250,
            entryPriceUi: 140,
          },
        },
      },
      "/prices": { BTC: { priceUi: 60000 } }, // SOL absent on purpose
    });
    const pos = await getPositions("owner1");
    expect(pos[0]!.entryPrice).toBe(140);
    expect(pos[0]!.markPrice).toBe(0);
  });

  it("returns [] positions when the snapshot has no positionMetrics", async () => {
    mockRoutes({ "/owner/": { basketPubkey: "Bskt111" } });
    expect(await getPositions("owner1")).toEqual([]);
  });

  it("returns null basketPubkey for an un-onboarded owner", async () => {
    mockRoutes({ "/owner/": { basketPubkey: null } });
    expect(await getBasketPubkey("owner1")).toBeNull();
  });

  it("returns the basketPubkey for an onboarded owner", async () => {
    mockRoutes({ "/owner/": { basketPubkey: "Bskt111" } });
    expect(await getBasketPubkey("owner1")).toBe("Bskt111");
  });
});
