import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
const xai = vi.fn((model: string) => ({ provider: "xai", model }));

vi.mock("ai", () => ({
  generateObject,
}));

vi.mock("@ai-sdk/xai", () => ({
  xai,
}));

const baseArgs = {
  displayName: "Whale One",
  source: "pacifica" as const,
  market: "BTC",
  side: "long" as const,
  leverage: 10,
  entryPrice: 100,
  currentMark: 106,
  notionalUsd: 25_000,
  openedAtMs: 1_779_543_000_000,
};

describe("whale analysis helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns when a long follower enters 6.0% above the source entry", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 100,
        currentMark: 106,
      }),
    ).toBe(
      "Current mark is 6.0% above the whale entry. Followers enter at the live price, not the whale entry.",
    );
  });

  it("warns when the current mark is 6.0% below the source entry", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "short",
        sourceEntry: 100,
        currentMark: 94,
      }),
    ).toBe(
      "Current mark is 6.0% below the whale entry. Followers enter at the live price, not the whale entry.",
    );
  });

  it("does not warn when the current mark is unavailable", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 100,
        currentMark: null,
      }),
    ).toBeNull();
  });

  it("does not warn when the current mark is zero", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 100,
        currentMark: 0,
      }),
    ).toBeNull();
  });

  it("does not warn when the current mark is negative", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 100,
        currentMark: -5,
      }),
    ).toBeNull();
  });

  it("does not warn when the entry gap is under 1%", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 100,
        currentMark: 100.9,
      }),
    ).toBeNull();
  });

  it("does not warn when the source entry is invalid", async () => {
    const { whaleEntryGapWarning } = await import("./analysis");

    expect(
      whaleEntryGapWarning({
        side: "long",
        sourceEntry: 0,
        currentMark: 106,
      }),
    ).toBeNull();
  });

  it("builds a prompt with position context and the private intent caveat", async () => {
    const { buildWhaleAnalysisPrompt } = await import("./analysis");

    const prompt = buildWhaleAnalysisPrompt(baseArgs);

    expect(prompt).toContain("Whale One");
    expect(prompt).toContain("Source: pacifica");
    expect(prompt).toContain("Market: BTC");
    expect(prompt).toContain("Side: long");
    expect(prompt).toContain("Leverage: 10x");
    expect(prompt).toContain("Entry: 100");
    expect(prompt).toContain("Current mark: 106");
    expect(prompt).toContain("Notional USD: 25000");
    expect(prompt).toContain("Opened at ms: 1779543000000");
    expect(prompt).toContain("Do not claim to know private intent");
  });

  it("has a deterministic fallback", async () => {
    const { fallbackWhaleAnalysis } = await import("./analysis");

    expect(fallbackWhaleAnalysis(baseArgs)).toEqual({
      summary: "Whale One is long BTC at 10x.",
      thesis:
        "The position is live and recently verified, but no AI analysis is cached yet.",
      risk:
        "Followers enter at the current market price and may not match the whale's original entry.",
      confidence: 0.25,
    });
  });

  it("returns the AI object with metadata and entry gap warning", async () => {
    generateObject.mockResolvedValue({
      object: {
        summary: "Whale One is long BTC.",
        thesis: "Momentum context supports the position.",
        risk: "Invalidation risk is elevated.",
        confidence: 0.7,
      },
    });
    const { generateWhaleAnalysis, WhaleAnalysisSchema } = await import(
      "./analysis"
    );

    const result = await generateWhaleAnalysis(baseArgs);

    expect(result).toMatchObject({
      summary: "Whale One is long BTC.",
      thesis: "Momentum context supports the position.",
      risk: "Invalidation risk is elevated.",
      confidence: 0.7,
      entryGapWarning:
        "Current mark is 6.0% above the whale entry. Followers enter at the live price, not the whale entry.",
      model: "grok-4.3",
    });
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(xai).toHaveBeenCalledWith("grok-4.3");
    expect(generateObject).toHaveBeenCalledWith({
      model: { provider: "xai", model: "grok-4.3" },
      schema: WhaleAnalysisSchema,
      prompt: expect.stringContaining("Whale One"),
    });
  });

  it("returns fallback analysis with metadata when AI generation fails", async () => {
    generateObject.mockRejectedValue(new Error("xAI down"));
    const { generateWhaleAnalysis } = await import("./analysis");

    const result = await generateWhaleAnalysis(baseArgs);

    expect(result).toMatchObject({
      summary: "Whale One is long BTC at 10x.",
      confidence: 0.25,
      entryGapWarning:
        "Current mark is 6.0% above the whale entry. Followers enter at the live price, not the whale entry.",
      model: "fallback",
    });
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });
});
