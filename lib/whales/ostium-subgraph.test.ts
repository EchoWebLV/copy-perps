import { describe, expect, it } from "vitest";
import { buildMarketQuery, parseMarketResponse } from "./ostium-subgraph";

describe("buildMarketQuery", () => {
  it("builds a single-market query ordered by USD notional", () => {
    const q = buildMarketQuery("5", 15);
    expect(q).toContain("first: 15");
    expect(q).toContain('where: { isOpen: true, pair: "5" }');
    expect(q).toContain("orderBy: notional"); // fast/indexed, not tradeNotional
    expect(q).not.toContain("tradeNotional");
    expect(q).toContain("lastTradePrice");
  });
});

describe("parseMarketResponse", () => {
  it("returns the trades array", () => {
    const out = parseMarketResponse({
      data: { trades: [{ tradeID: "1" }, { tradeID: "2" }] },
    });
    expect(out.map((t) => t.tradeID)).toEqual(["1", "2"]);
  });

  it("tolerates a missing trades field", () => {
    expect(parseMarketResponse({ data: {} })).toEqual([]);
    expect(parseMarketResponse({})).toEqual([]);
  });

  it("throws when the response carries GraphQL errors", () => {
    expect(() =>
      parseMarketResponse({ errors: [{ message: "boom" }] }),
    ).toThrow(/Ostium subgraph/);
  });
});
