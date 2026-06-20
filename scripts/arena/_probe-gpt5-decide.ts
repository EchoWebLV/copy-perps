// scripts/arena/_probe-gpt5-decide.ts
//
// Ad-hoc probe: reproduce the GPT oracle-bot decision call in isolation and
// dump the FULL error that client.ts swallows (decide() catches → null).
//   npx tsx --env-file=.env.local scripts/arena/_probe-gpt5-decide.ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { decisionSchema } from "../../lib/arena/llm/schema";

const PROMPT = `You are an AI-driven paper-trading bot in a live on-chain perps arena. Tape: SOL $125.12, 1h +0.8%, funding slightly positive, OI rising. Decide open/close/hold for SOL/BTC/ETH with leverage and a stop. One plain-English sentence of reasoning.`;

function dumpErr(label: string, err: any) {
  console.log(`\n===== ${label} FAILED =====`);
  console.log("name:", err?.name);
  console.log("message:", String(err?.message).slice(0, 400));
  if (err?.statusCode) console.log("statusCode:", err.statusCode);
  if (err?.responseBody) console.log("responseBody:", String(err.responseBody).slice(0, 600));
  if (err?.text !== undefined) console.log("model text emitted:", JSON.stringify(err.text)?.slice(0, 600));
  if (err?.usage) console.log("usage:", JSON.stringify(err.usage));
  if (err?.finishReason) console.log("finishReason:", err.finishReason);
  if (err?.cause) {
    console.log("cause.name:", err.cause?.name);
    console.log("cause.message:", String(err.cause?.message).slice(0, 400));
    if (err.cause?.statusCode) console.log("cause.statusCode:", err.cause.statusCode);
    if (err.cause?.responseBody) console.log("cause.responseBody:", String(err.cause.responseBody).slice(0, 600));
  }
}

async function attempt(label: string, modelId: string, maxOutputTokens: number) {
  const key = process.env.OPENAI_API_KEY;
  console.log(`\n>>> ${label}: model=${modelId} maxOutputTokens=${maxOutputTokens} key=${key ? key.slice(0, 7) + "…(" + key.length + ")" : "MISSING"}`);
  const t0 = Date.now();
  try {
    const model = createOpenAI({ apiKey: key })(modelId);
    const { object, usage, finishReason } = await generateObject({
      model,
      schema: decisionSchema,
      prompt: PROMPT,
      maxOutputTokens,
    });
    console.log(`OK in ${Date.now() - t0}ms — finishReason=${finishReason} usage=${JSON.stringify(usage)}`);
    console.log("decision:", JSON.stringify(object));
  } catch (err) {
    console.log(`(failed in ${Date.now() - t0}ms)`);
    dumpErr(label, err);
  }
}

async function main() {
  // 1. Exactly as production does it today.
  await attempt("A) gpt-5 @ 4000 (prod config)", "gpt-5", 4000);
  // 2. Same model, much larger budget — tests the reasoning-token-exhaustion theory.
  await attempt("B) gpt-5 @ 16000", "gpt-5", 16000);
  // 3. Non-reasoning control — isolates whether the KEY/structured-output works at all.
  await attempt("C) gpt-4o @ 4000 (control)", "gpt-4o", 4000);
}

main().then(() => process.exit(0));
