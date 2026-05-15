// scripts/probe-strategies.ts
// Calls each surviving bot's evaluateEntry for every allowed market and
// prints what fires + what skips + why. Helps diagnose why a bot isn't
// trading.
import "dotenv/config";
import { listBots, getStrategy } from "@/lib/bots";
import { getMarksSnapshot } from "@/lib/data/marks";
import { getRecentLiquidations } from "@/lib/hyperliquid/client";
import { getFundingRates } from "@/lib/data/cex-funding";

async function main() {
  const [marks, liquidations, funding] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
  ]);
  const signals = { liquidations, funding };

  for (const bot of listBots()) {
    const strategy = getStrategy(bot.strategyKey);
    if (!strategy) {
      console.log(`[${bot.id}] NO STRATEGY`);
      continue;
    }
    console.log(`\n=== ${bot.name} (${bot.id}) — markets: ${strategy.markets.join(", ")} ===`);
    for (const asset of strategy.markets) {
      const mark = marks.get(asset);
      if (mark == null) {
        console.log(`  ${asset.padEnd(6)} MARK MISSING`);
        continue;
      }
      try {
        const decision = await strategy.evaluateEntry({ asset, mark }, signals);
        if (decision) {
          console.log(
            `  ${asset.padEnd(6)} ✓ ${decision.side} ${decision.leverage}x conviction=${decision.conviction.toFixed(2)} trigger=${JSON.stringify(decision.triggerMeta)}`,
          );
        } else {
          console.log(`  ${asset.padEnd(6)} — no signal`);
        }
      } catch (e) {
        console.log(`  ${asset.padEnd(6)} ✗ ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
