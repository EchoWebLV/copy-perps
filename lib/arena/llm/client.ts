// lib/arena/llm/client.ts
//
// Provider-agnostic decision client for the LLM oracle bots. Uses the Vercel AI
// SDK's generateObject so every provider returns a schema-validated LlmDecision
// (no prose parsing). Grok via @ai-sdk/xai, Claude via @ai-sdk/anthropic; more
// models (GPT/Gemini/DeepSeek/Qwen) can be added later via the Vercel AI Gateway
// behind this same interface. A failed/invalid generation returns null (logged),
// never throws — the loop treats null as "do nothing this tick".

import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { createXai } from "@ai-sdk/xai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { decisionSchema, type LlmDecision } from "./schema";

export type LlmProvider = "xai" | "anthropic";

// Default model ids (configurable per bot in the registry). grok-4.3 matches the
// existing xAI wiring; claude-opus-4-8 is the current Opus. Cadence is ~3-5 min,
// so frontier models are affordable.
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  xai: "grok-4.3",
  anthropic: "claude-opus-4-8",
};

// Reads a key from process.env, falling back to .env.local (the dev server only
// reads .env files at boot; the crank/brain may start after a key was added).
function keyFromEnv(name: string): string | undefined {
  const fromProc = process.env[name];
  if (fromProc && fromProc.length > 0) return fromProc;
  try {
    const m = readFileSync(".env.local", "utf-8").match(new RegExp(`^${name}=(.+)$`, "m"));
    const v = m?.[1]?.trim();
    if (!v) return undefined;
    return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  } catch {
    return undefined;
  }
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly modelId: string;
  decide(prompt: string): Promise<LlmDecision | null>;
}

export function createLlmClient(cfg: { provider: LlmProvider; modelId?: string }): LlmClient {
  const modelId = cfg.modelId ?? DEFAULT_MODELS[cfg.provider];
  return {
    provider: cfg.provider,
    modelId,
    async decide(prompt: string): Promise<LlmDecision | null> {
      try {
        const model =
          cfg.provider === "xai"
            ? createXai({ apiKey: keyFromEnv("XAI_API_KEY") })(modelId)
            : createAnthropic({ apiKey: keyFromEnv("ANTHROPIC_API_KEY") })(modelId);
        const { object } = await generateObject({
          model,
          schema: decisionSchema,
          prompt,
          maxOutputTokens: 600,
        });
        // Belt-and-suspenders: generateObject already validates against the
        // schema, but re-parse defensively so a malformed object can never
        // reach the guardrail/submit path. Invalid → null (do nothing).
        const parsed = decisionSchema.safeParse(object);
        if (!parsed.success) {
          console.warn(`[llm-arena] ${cfg.provider}/${modelId} returned an invalid decision`);
          return null;
        }
        return parsed.data;
      } catch (err) {
        console.warn(`[llm-arena] ${cfg.provider}/${modelId} decide failed:`, err);
        return null;
      }
    },
  };
}

export function hasKeyFor(provider: LlmProvider): boolean {
  return Boolean(keyFromEnv(provider === "xai" ? "XAI_API_KEY" : "ANTHROPIC_API_KEY"));
}
