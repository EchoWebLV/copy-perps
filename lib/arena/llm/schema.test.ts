import { describe, expect, it } from "vitest";
import { ARENA_ASSETS, actionSchema, decisionSchema, toBps, toConfidence100 } from "./schema";

const valid = {
  action: "open",
  side: "long",
  asset: "SOL",
  leverage: 5,
  stakeFracPct: 0.1,
  stopLossPct: 0.02,
  takeProfitPct: 0.04,
  confidence: 0.7,
  reasoning: "SOL reclaimed $150 with cooling funding",
} as const;

const action = {
  action: "open",
  side: "long",
  asset: "BTC",
  leverage: 10,
  stakeFracPct: 0.1,
  stopLossPct: 0.02,
  takeProfitPct: 0.04,
  confidence: 0.7,
  reasoning: "reclaim",
} as const;

it("covers the six target majors", () => {
  expect([...ARENA_ASSETS]).toEqual(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"]);
});

describe("actionSchema", () => {
  it("parses a valid action", () => {
    expect(actionSchema.parse(valid)).toMatchObject({ action: "open", asset: "SOL" });
  });

  it("rejects an unknown action", () => {
    expect(actionSchema.safeParse({ ...valid, action: "yolo" }).success).toBe(false);
  });

  it("rejects a stop loss above the 10% bound", () => {
    expect(actionSchema.safeParse({ ...valid, stopLossPct: 0.2 }).success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    expect(actionSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });

  it("accepts thorough reasoning but rejects an essay", () => {
    expect(actionSchema.safeParse({ ...valid, reasoning: "x".repeat(600) }).success).toBe(true);
    expect(actionSchema.safeParse({ ...valid, reasoning: "x".repeat(601) }).success).toBe(false);
  });

  it("rejects a non-integer leverage", () => {
    expect(actionSchema.safeParse({ ...valid, leverage: 5.5 }).success).toBe(false);
  });

  it("validates each action against the per-trade schema", () => {
    expect(actionSchema.safeParse({ ...action, leverage: 0 }).success).toBe(false);
  });
});

describe("decisionSchema", () => {
  it("parses a multi-action decision (open 2, close 1)", () => {
    const d = decisionSchema.parse({
      actions: [
        { ...action, asset: "BTC" },
        { ...action, asset: "ETH" },
        { ...action, action: "close", asset: "SOL" },
      ],
    });
    expect(d.actions).toHaveLength(3);
    expect(d.actions[0].asset).toBe("BTC");
  });

  it("accepts an empty action list (a do-nothing tick)", () => {
    expect(decisionSchema.parse({ actions: [] }).actions).toHaveLength(0);
  });

  it("rejects more than four actions (the position-slot cap)", () => {
    const five = Array.from({ length: 5 }, () => action);
    expect(decisionSchema.safeParse({ actions: five }).success).toBe(false);
  });
});

describe("encoding helpers", () => {
  it("toBps rounds a fraction to basis points", () => {
    expect(toBps(0.02)).toBe(200);
    expect(toBps(0.1)).toBe(1000);
    expect(toBps(0.0006)).toBe(6);
  });
  it("toConfidence100 maps 0..1 to 0..100", () => {
    expect(toConfidence100(0.8)).toBe(80);
    expect(toConfidence100(0.555)).toBe(56);
  });
});
