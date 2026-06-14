import { describe, expect, it } from "vitest";
import { buildSentimentBrief, type FearGreed } from "./news-sentiment";

const fg = (value: number, label = "x"): FearGreed => ({
  value,
  label,
  score: Math.max(-1, Math.min(1, (value - 50) / 50)),
});

describe("buildSentimentBrief", () => {
  it("returns null when there's no signal at all", () => {
    expect(buildSentimentBrief(null, {})).toBeNull();
  });

  it("maps Fear & Greed alone to a score and topic", () => {
    const out = buildSentimentBrief(fg(18, "Extreme Fear"), {});
    expect(out).not.toBeNull();
    expect(out!.score).toBeCloseTo(-0.64); // (18-50)/50
    expect(out!.topics).toEqual(["fear-greed"]);
    expect(out!.summary).toContain("Fear & Greed 18/100 (Extreme Fear)");
  });

  it("maps community votes alone (avg up% → score)", () => {
    const out = buildSentimentBrief(null, { SOL: 78, BTC: 50 }); // avg 64% up
    expect(out).not.toBeNull();
    expect(out!.score).toBeCloseTo(0.28); // (64-50)/50
    expect(out!.topics).toEqual(["community-votes"]);
    expect(out!.summary).toContain("SOL 78% up");
  });

  it("averages both signals when present", () => {
    // FG 18 → -0.64 ; votes avg 75% up → +0.50 ; mean = -0.07
    const out = buildSentimentBrief(fg(18), { SOL: 75 });
    expect(out!.score).toBeCloseTo((-0.64 + 0.5) / 2);
    expect(out!.topics).toEqual(["fear-greed", "community-votes"]);
  });

  it("clamps an extreme reading into [-1, 1]", () => {
    const out = buildSentimentBrief(fg(100, "Extreme Greed"), { SOL: 100 });
    expect(out!.score).toBeLessThanOrEqual(1);
    expect(out!.score).toBeGreaterThanOrEqual(-1);
  });
});
