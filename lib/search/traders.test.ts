import { describe, expect, it } from "vitest";
import { filterTraders, classifyQuery } from "./traders";

const ROSTER = [
  { id: "w1", kind: "whale", name: "Iron Wolf", markets: ["ETH"] },
  { id: "b1", kind: "bot", name: "Scalper", markets: ["SOL"], desc: "15s momentum" },
];

describe("classifyQuery", () => {
  it("detects a solana address", () => {
    expect(classifyQuery("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("wallet");
  });
  it("treats words as text", () => {
    expect(classifyQuery("iron")).toBe("text");
  });
});

describe("filterTraders", () => {
  it("matches by name, case-insensitive", () => {
    expect(filterTraders(ROSTER, "iron").map(t => t.id)).toEqual(["w1"]);
  });
  it("matches by market symbol", () => {
    expect(filterTraders(ROSTER, "sol").map(t => t.id)).toEqual(["b1"]);
  });
  it("matches by description", () => {
    expect(filterTraders(ROSTER, "momentum").map(t => t.id)).toEqual(["b1"]);
  });
  it("returns everything for empty query", () => {
    expect(filterTraders(ROSTER, " ").length).toBe(2);
  });
});
