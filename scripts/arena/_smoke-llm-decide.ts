// scripts/arena/_smoke-llm-decide.ts
//
// Ad-hoc LIVE smoke: run the real oracle-bot pipeline (shared brief → real model
// → on-chain safety-floor pre-check) for every bot in the registry and print what
// each model decided. Proves the bots produce schema-valid, floor-respecting
// decisions with real Claude/Grok. Does NOT touch the chain.
//
//   XAI_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/arena/_smoke-llm-decide.ts
import { createLlmClient } from "../../lib/arena/llm/client";
import { decisionSchema } from "../../lib/arena/llm/schema";
import { evaluateDecision, type LlmFloorParams } from "../../lib/arena/llm/floor";
import { renderConstraints, renderMarketBlock, type SharedBrief } from "../../lib/arena/llm/brief";
import { ORACLE_BOTS } from "../../lib/arena/llm/registry";

// A realistic static brief (no network) — euphoric SOL, hot funding, crowded longs.
const brief: SharedBrief = {
  timestampIso: "2026-06-13T16:00:00.000Z",
  markets: [
    { asset: "SOL", price: 152.4, change1hPct: 1.8, rsi14: 71, macdHist: 0.42, atr14: 3.1, volPct: 4.2, fundingRatePct: 0.012, openInterestUsd: 1_240_000_000, longPct: 63, shortPct: 37, takerBuySellRatio: 1.4, bias: "long" },
    { asset: "BTC", price: 112_300, change1hPct: 0.3, rsi14: 58, macdHist: 12.1, atr14: 480, volPct: 2.1, fundingRatePct: 0.008, openInterestUsd: 18_900_000_000, longPct: 54, shortPct: 46, takerBuySellRatio: 1.05, bias: "balanced" },
    { asset: "ETH", price: 3_980, change1hPct: -0.6, rsi14: 47, macdHist: -1.3, atr14: 36, volPct: 2.8, fundingRatePct: 0.004, openInterestUsd: 9_100_000_000, longPct: 49, shortPct: 51, takerBuySellRatio: 0.94, bias: "balanced" },
  ],
  sentiment: { score: 0.42, summary: "SOL breaking out on ETF-inflow chatter; majors steady, alt funding heating up", topics: ["SOL", "ETF", "funding"] },
};

const FLAT_BOOK = "Your book: equity ~$1000 (free $1000), peak $1000, fees paid $0.00, funding paid $0.00, trades today 0\nOpen positions:\n  (flat — no open positions)";

const now = 2_000_000_000; // far future so cooldown (lastDecisionTs 0) never blocks
const flatState = { halted: false, tradesToday: 0, lastDecisionTs: 0 };

async function main() {
  const market = renderMarketBlock(brief);
  for (const bot of ORACLE_BOTS) {
    const hasKey = bot.provider === "xai" ? !!process.env.XAI_API_KEY : !!process.env.ANTHROPIC_API_KEY;
    console.log(`\n══════ ${bot.displayName} (${bot.provider}:${bot.modelId}) ══════`);
    if (!hasKey) {
      console.log("  (no API key — skipping)");
      continue;
    }
    const prompt = `${bot.systemBlock}\n\n${renderConstraints(bot.params)}\n\n${market}\n\n${FLAT_BOOK}\n\nDecide: open / close / hold. Return the structured decision.`;
    const client = createLlmClient({ provider: bot.provider, modelId: bot.modelId });
    const t0 = Date.now();
    const decision = await client.decide(prompt);
    const ms = Date.now() - t0;
    if (!decision) {
      console.log(`  ✗ no decision (model error / invalid output) [${ms}ms]`);
      continue;
    }
    const valid = decisionSchema.safeParse(decision).success;
    console.log(`  decision [${ms}ms]: ${decision.action.toUpperCase()} ${decision.action === "open" ? `${decision.side} ${decision.asset} ${decision.leverage}x stake ${(decision.stakeFracPct * 100).toFixed(0)}% stop ${(decision.stopLossPct * 100).toFixed(1)}% tp ${(decision.takeProfitPct * 100).toFixed(1)}%` : decision.asset} (conf ${decision.confidence.toFixed(2)})`);
    console.log(`  reasoning: ${decision.reasoning}`);
    console.log(`  schema-valid: ${valid}`);
    const floor: LlmFloorParams = {
      maxLeverage: bot.params.maxLeverage,
      minStopBps: bot.params.minStopBps,
      maxStopBps: bot.params.maxStopBps,
      maxStakeFracBps: bot.params.maxStakeFracBps,
      maxTradesPerDay: bot.params.maxTradesPerDay,
      decisionCooldownSecs: bot.params.decisionCooldownSecs,
      confidenceFloor: bot.params.confidenceFloor,
    };
    const outcome = evaluateDecision(decision, floor, flatState, now);
    if (outcome.kind === "send") {
      console.log(`  → FLOOR PASS → would submit apply_decision: ${JSON.stringify(outcome.args)}`);
    } else {
      console.log(`  → FLOOR SKIP (${outcome.reason}) → no on-chain tx`);
    }
  }
  console.log("\n✓ live smoke complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
