import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

describe("xAI Responses helper", () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = "test-xai-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "response-1",
          output_text: " 42 ",
          usage: {
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.XAI_API_KEY;
  });

  it("calls grok-4.3 through Responses with reasoning disabled", async () => {
    const { generateXaiText } = await import("./responses");

    const text = await generateXaiText({
      systemPrompt: "Answer tersely.",
      prompt: "Meaning?",
      maxOutputTokens: 16,
    });

    expect(text).toBe("42");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-xai-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "grok-4.3",
      reasoning: { effort: "none" },
      input: [
        { role: "system", content: "Answer tersely." },
        { role: "user", content: "Meaning?" },
      ],
      max_output_tokens: 16,
    });
  });

  it("parses and validates JSON output", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: '```json\n{"summary":"ok","confidence":0.7}\n```',
              },
            ],
          },
        ],
      }),
    } as Response);
    const { generateXaiJson } = await import("./responses");

    await expect(
      generateXaiJson({
        schema: z.object({
          summary: z.string(),
          confidence: z.number(),
        }),
        prompt: "Return JSON.",
      }),
    ).resolves.toEqual({ summary: "ok", confidence: 0.7 });
  });
});
