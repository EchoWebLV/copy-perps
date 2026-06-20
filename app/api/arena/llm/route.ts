// app/api/arena/llm/route.ts
//
// Live view backend for /arena/llm: runs the real oracle-bot pipeline
// (shared brief → real model → on-chain safety-floor pre-check) for every bot
// in the registry and returns each bot's decision + the floor verdict. This is
// the same path the on-chain brain loop runs, minus the chain submit — so the
// page shows exactly what each model decided and whether the rules let it trade.
import { NextResponse } from "next/server";
import { createLlmClient, hasKeyFor } from "@/lib/arena/llm/client";
import { evaluateActions, type LlmFloorParams } from "@/lib/arena/llm/floor";
import { renderConstraints, renderMarketBlock } from "@/lib/arena/llm/brief";
import { DEMO_BRIEF, FLAT_BOOK } from "@/lib/arena/llm/demo-brief";
import { ORACLE_BOTS } from "@/lib/arena/llm/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Far-future "now" so the cooldown (lastDecisionTs 0) never blocks the demo.
const NOW = 2_000_000_000;
const FLAT_STATE = { halted: false, tradesToday: 0, lastDecisionTs: 0 };

export async function GET() {
  const market = renderMarketBlock(DEMO_BRIEF);

  const bots = await Promise.all(
    ORACLE_BOTS.map(async (bot) => {
      const base = {
        persona: bot.persona,
        displayName: bot.displayName,
        avatarEmoji: bot.avatarEmoji,
        provider: bot.provider,
        modelId: bot.modelId,
      };
      if (!hasKeyFor(bot.provider)) {
        return { ...base, status: "no-key" as const };
      }
      const prompt = `${bot.systemBlock}\n\n${renderConstraints(bot.params)}\n\n${market}\n\n${FLAT_BOOK}\n\nDecide: open / close / hold. Return the structured decision.`;
      const t0 = Date.now();
      const decision = await createLlmClient({ provider: bot.provider, modelId: bot.modelId }).decide(prompt);
      const latencyMs = Date.now() - t0;
      if (!decision) return { ...base, status: "error" as const, latencyMs };

      const floor: LlmFloorParams = {
        maxLeverage: bot.params.maxLeverage,
        minStopBps: bot.params.minStopBps,
        maxStopBps: bot.params.maxStopBps,
        maxStakeFracBps: bot.params.maxStakeFracBps,
        maxTradesPerDay: bot.params.maxTradesPerDay,
        decisionCooldownSecs: bot.params.decisionCooldownSecs,
        confidenceFloor: bot.params.confidenceFloor,
      };
      const outcomes = evaluateActions(decision, floor, FLAT_STATE, NOW);
      // The preview UI shows one decision/outcome per bot; surface the first
      // action (the bot's primary idea this tick) and every action's verdict.
      const decisions = decision.actions;
      return {
        ...base,
        status: "ok" as const,
        latencyMs,
        decision: decisions[0] ?? null,
        outcome: outcomes[0]?.outcome ?? null,
        decisions,
        outcomes,
      };
    }),
  );

  return NextResponse.json({
    builtAt: new Date().toISOString(),
    markets: DEMO_BRIEF.markets,
    sentiment: DEMO_BRIEF.sentiment,
    bots,
  });
}
