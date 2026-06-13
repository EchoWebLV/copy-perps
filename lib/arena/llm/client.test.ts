import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
// Isolate the test to the generateObject seam: provider construction returns a
// dummy model and never touches keys/network.
vi.mock("@ai-sdk/xai", () => ({ createXai: () => () => ({ id: "xai-mock" }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => () => ({ id: "anthropic-mock" }) }));
import { generateObject } from "ai";
import { createLlmClient, DEFAULT_MODELS } from "./client";
import type { LlmDecision } from "./schema";

const decision: LlmDecision = {
  action: "open",
  side: "long",
  asset: "SOL",
  leverage: 5,
  stakeFracPct: 0.1,
  stopLossPct: 0.02,
  takeProfitPct: 0.04,
  confidence: 0.7,
  reasoning: "clean reclaim",
};

const mockGen = vi.mocked(generateObject);

describe("createLlmClient", () => {
  beforeEach(() => mockGen.mockReset());

  it("returns the schema-validated object for xai", async () => {
    mockGen.mockResolvedValue({ object: decision } as never);
    const client = createLlmClient({ provider: "xai" });
    expect(client.modelId).toBe(DEFAULT_MODELS.xai);
    await expect(client.decide("brief")).resolves.toEqual(decision);
    expect(mockGen).toHaveBeenCalledOnce();
  });

  it("returns the object for anthropic and uses the given model id", async () => {
    mockGen.mockResolvedValue({ object: decision } as never);
    const client = createLlmClient({ provider: "anthropic", modelId: "claude-opus-4-8" });
    expect(client.modelId).toBe("claude-opus-4-8");
    await expect(client.decide("brief")).resolves.toEqual(decision);
  });

  it("returns null for a malformed / invalid decision", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGen.mockResolvedValue({ object: { not: "a decision" } } as never);
    const client = createLlmClient({ provider: "anthropic" });
    await expect(client.decide("brief")).resolves.toBeNull();
    warnSpy.mockRestore();
  });
});
