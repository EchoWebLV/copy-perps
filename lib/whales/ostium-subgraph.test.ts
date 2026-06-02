import { describe, expect, it } from "vitest";
import { buildDiscoverQuery, parseDiscoverResponse } from "./ostium-subgraph";

describe("buildDiscoverQuery", () => {
  it("emits one aliased trades sub-query per pair id", () => {
    const q = buildDiscoverQuery(["2", "5"], 15);
    expect(q).toContain("p2: trades(");
    expect(q).toContain("p5: trades(");
    expect(q).toContain("first: 15");
    expect(q).toContain('where: { isOpen: true, pair: "2" }');
    expect(q).toContain("orderBy: tradeNotional");
    expect(q).toContain("lastTradePrice");
  });
});

describe("parseDiscoverResponse", () => {
  it("flattens every alias bucket into one trade array", () => {
    const json = {
      data: {
        p2: [{ tradeID: "1" }, { tradeID: "2" }],
        p5: [{ tradeID: "3" }],
      },
    };
    const out = parseDiscoverResponse(json, ["2", "5"]);
    expect(out.map((t) => t.tradeID)).toEqual(["1", "2", "3"]);
  });

  it("tolerates missing/empty buckets", () => {
    const out = parseDiscoverResponse({ data: { p2: null } }, ["2", "5"]);
    expect(out).toEqual([]);
  });

  it("throws when the response carries GraphQL errors", () => {
    expect(() =>
      parseDiscoverResponse({ errors: [{ message: "boom" }] }, ["2"]),
    ).toThrow(/Ostium subgraph/);
  });
});
