import { describe, expect, it } from "vitest";
import { decisionSchema, toBps, toConfidence100 } from "./schema";

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
};

describe("decisionSchema", () => {
  it("parses a valid decision", () => {
    expect(decisionSchema.parse(valid)).toMatchObject({ action: "open", asset: "SOL" });
  });

  it("rejects an unknown action", () => {
    expect(decisionSchema.safeParse({ ...valid, action: "yolo" }).success).toBe(false);
  });

  it("rejects a stop loss above the 10% bound", () => {
    expect(decisionSchema.safeParse({ ...valid, stopLossPct: 0.2 }).success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    expect(decisionSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });

  it("accepts thorough reasoning but rejects an essay", () => {
    expect(decisionSchema.safeParse({ ...valid, reasoning: "x".repeat(600) }).success).toBe(true);
    expect(decisionSchema.safeParse({ ...valid, reasoning: "x".repeat(601) }).success).toBe(false);
  });

  it("rejects a non-integer leverage", () => {
    expect(decisionSchema.safeParse({ ...valid, leverage: 5.5 }).success).toBe(false);
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
