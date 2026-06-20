// scripts/arena/_probe-cheap-decide.ts
//
// Validate the cost-optimization levers EMPIRICALLY: run the real arena decision
// call across candidate model/knob configs and measure tokens + latency + $/call.
// Proves whether reasoningEffort='minimal' collapses gpt-5's reasoning tail in
// THIS @ai-sdk setup, and how cheap alternatives compare.
//   npx tsx --env-file=.env.local scripts/arena/_probe-cheap-decide.ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { decisionSchema } from "../../lib/arena/llm/schema";

const PROMPT = `You are an AI-driven paper-trading bot in a live on-chain perps arena. Tape: SOL $125.12, 1h +0.8%, funding slightly positive, OI rising; BTC $64k chopping; ETH flat. Decide open/close/hold for SOL/BTC/ETH with leverage and a stop. One plain-English sentence of reasoning.`;

// $/M tokens (input, output) from the 2026-06-20 research.
const PRICE: Record<string, [number, number]> = {
  "gpt-5": [1.25, 10],
  "gpt-5-nano": [0.05, 0.4],
  "gpt-4o-mini": [0.15, 0.6],
  "claude-haiku-4-5": [1.0, 5.0],
};

const oai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ant = createAnthropic({ baseURL: "https://api.anthropic.com/v1", apiKey: process.env.ANTHROPIC_API_KEY });

interface Cfg { label: string; priceId: string; run: () => Promise<any>; }
const CONFIGS: Cfg[] = [
  { label: "gpt-5 (default/medium reasoning) — BASELINE", priceId: "gpt-5",
    run: () => generateObject({ model: oai("gpt-5"), schema: decisionSchema, prompt: PROMPT, maxOutputTokens: 4000 }) },
  { label: "gpt-5 + reasoningEffort=minimal, verbosity=low", priceId: "gpt-5",
    run: () => generateObject({ model: oai("gpt-5"), schema: decisionSchema, prompt: PROMPT, maxOutputTokens: 800,
      providerOptions: { openai: { reasoningEffort: "minimal", textVerbosity: "low" } } }) },
  { label: "gpt-5 + reasoningEffort=low", priceId: "gpt-5",
    run: () => generateObject({ model: oai("gpt-5"), schema: decisionSchema, prompt: PROMPT, maxOutputTokens: 1500,
      providerOptions: { openai: { reasoningEffort: "low" } } }) },
  { label: "gpt-5-nano + reasoningEffort=minimal", priceId: "gpt-5-nano",
    run: () => generateObject({ model: oai("gpt-5-nano"), schema: decisionSchema, prompt: PROMPT, maxOutputTokens: 800,
      providerOptions: { openai: { reasoningEffort: "minimal", textVerbosity: "low" } } }) },
  { label: "gpt-4o-mini (non-reasoning)", priceId: "gpt-4o-mini",
    run: () => generateObject({ model: oai("gpt-4o-mini"), schema: decisionSchema, prompt: PROMPT, maxOutputTokens: 800 }) },
  { label: "claude-haiku-4-5 (non-reasoning)", priceId: "claude-haiku-4-5",
    run: () => generateObject({ model: ant("claude-haiku-4-5"), schema: decisionSchema, prompt: PROMPT, maxOutputTokens: 800 }) },
];

function costUsd(priceId: string, inTok: number, outTok: number): number {
  const [pi, po] = PRICE[priceId] ?? [0, 0];
  return (inTok * pi + outTok * po) / 1e6;
}

async function main() {
  const rows: string[] = [];
  for (const c of CONFIGS) {
    const t0 = Date.now();
    try {
      const { object, usage } = await c.run();
      const ms = Date.now() - t0;
      const inTok = usage?.inputTokens ?? 0;
      const outTok = usage?.outputTokens ?? 0;
      const reasoning = (usage as any)?.reasoningTokens ?? (usage as any)?.outputTokenDetails?.reasoningTokens ?? 0;
      const perCall = costUsd(c.priceId, inTok, outTok);
      // Two gpt-5-class bots calling ~764x/day each (current cadence): monthly for 2 bots.
      const monthly2bots = perCall * 764 * 2 * 30.4;
      rows.push(
        `${c.label}\n    in=${inTok} out=${outTok} (reasoning=${reasoning}) ${ms}ms | $${perCall.toFixed(6)}/call | ~$${monthly2bots.toFixed(0)}/mo for 2 bots\n    decision=${JSON.stringify(object)}`,
      );
    } catch (e) {
      rows.push(`${c.label}\n    FAILED: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  console.log("\n===== EMPIRICAL COST PROBE (per-call, current ~764 calls/day/bot cadence) =====\n");
  console.log(rows.join("\n\n"));
}

main().then(() => process.exit(0));
