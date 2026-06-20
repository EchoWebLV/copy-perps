import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
// Isolate the test to the generateObject seam: provider construction returns a
// dummy model and never touches keys/network.
vi.mock("@ai-sdk/xai", () => ({ createXai: () => () => ({ id: "xai-mock" }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => () => ({ id: "anthropic-mock" }) }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => ({ id: "openai-mock" }) }));
import { generateObject } from "ai";
import { createLlmClient, DEFAULT_MODELS } from "./client";
import type { LlmDecision } from "./schema";

const decision: LlmDecision = {
  actions: [
    {
      action: "open",
      side: "long",
      asset: "SOL",
      leverage: 5,
      stakeFracPct: 0.1,
      stopLossPct: 0.02,
      takeProfitPct: 0.04,
      confidence: 0.7,
      reasoning: "clean reclaim",
    },
  ],
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

  it("drives openai with minimal reasoning + low verbosity + a tight token cap (cost lever)", async () => {
    mockGen.mockResolvedValue({ object: decision } as never);
    await createLlmClient({ provider: "openai", modelId: "gpt-5" }).decide("brief");
    expect(mockGen).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 800,
        providerOptions: { openai: { reasoningEffort: "minimal", textVerbosity: "low" } },
      }),
    );
  });

  it("does not attach openai reasoning options for non-openai providers", async () => {
    mockGen.mockResolvedValue({ object: decision } as never);
    await createLlmClient({ provider: "xai" }).decide("brief");
    const arg = mockGen.mock.calls[0]![0] as { maxOutputTokens: number; providerOptions?: { openai?: unknown } };
    expect(arg.maxOutputTokens).toBe(800);
    expect(arg.providerOptions?.openai).toBeUndefined();
  });

  it("returns null for a malformed / invalid decision", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGen.mockResolvedValue({ object: { not: "a decision" } } as never);
    const client = createLlmClient({ provider: "anthropic" });
    await expect(client.decide("brief")).resolves.toBeNull();
    warnSpy.mockRestore();
  });
});
