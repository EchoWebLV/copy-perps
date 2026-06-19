import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrices, getPositions, getBasketPubkey } from "./query";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status, json: async () => body })));
}

describe("query", () => {
  it("maps the prices payload to a symbol→number record", async () => {
    mockFetch([{ symbol: "SOL", price: "150.5" }, { symbol: "BTC", price: "60000" }]);
    const marks = await getPrices();
    expect(marks.SOL).toBe(150.5);
    expect(marks.BTC).toBe(60000);
  });
  it("reads positions from the owner snapshot", async () => {
    mockFetch({ basketPubkey: "Bskt111", positions: [{ symbol: "SOL", side: "long" }] });
    const pos = await getPositions("owner1");
    expect(pos).toHaveLength(1);
    expect(pos[0]!.symbol).toBe("SOL");
  });
  it("returns null basketPubkey for an un-onboarded owner", async () => {
    mockFetch({ basketPubkey: null });
    expect(await getBasketPubkey("owner1")).toBeNull();
  });
  it("returns the basketPubkey for an onboarded owner", async () => {
    mockFetch({ basketPubkey: "Bskt111" });
    expect(await getBasketPubkey("owner1")).toBe("Bskt111");
  });
});
