// Opt-in live smoke: makes ONE real call per provider that has a key, asserting
// the model returns a schema-valid LlmDecision over a tiny brief. Skips cleanly
// when keys are absent (so the default `vitest run` / CI never hits the network
// or spends tokens). Run with keys set:  npx vitest run lib/arena/llm/client.live.test.ts
import { describe, expect, it } from "vitest";
import { createLlmClient, hasKeyFor } from "./client";
import { decisionSchema } from "./schema";

const BRIEF = `You are a crypto perp trading bot. Snapshot @ 2026-06-13T12:00:00Z:
SOL $152.40, 1h +1.8%, funding +0.011%/h, OI $1.2B, top traders 58% long.
Decide whether to open/close/hold. Return the structured decision.`;

describe.skipIf(!hasKeyFor("xai"))("LIVE Grok decision", () => {
  it("returns a schema-valid decision", async () => {
    const out = await createLlmClient({ provider: "xai" }).decide(BRIEF);
    expect(out).not.toBeNull();
    expect(decisionSchema.safeParse(out).success).toBe(true);
  }, 60_000);
});

describe.skipIf(!hasKeyFor("anthropic"))("LIVE Claude decision", () => {
  it("returns a schema-valid decision", async () => {
    const out = await createLlmClient({ provider: "anthropic" }).decide(BRIEF);
    expect(out).not.toBeNull();
    expect(decisionSchema.safeParse(out).success).toBe(true);
  }, 60_000);
});
