// scripts/sync-leverage.ts
// Push the leverage spread (5x-50x across the 12-bot roster) into the
// `bots` table so the admin panel and DB rows stay in sync with the
// static strategy files. Static bots use the code's leverage at runtime,
// but admin UI reads from DB — without this sync the panel would show
// stale numbers.
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const TARGETS: Record<string, number> = {
  "liquidation-lizard": 50,
  "liquidation-lizard-jr": 15,
  "funding-phoebe": 20,
  "funding-phoebe-lite": 8,
  "mean-revert-mike": 25,
  "mean-revert-mike-patient": 5,
  "momo-max": 30,
  "momo-max-aggressive": 50,
  "vol-vector": 20,
  "vol-vector-hair-trigger": 40,
  "boomer-trend": 10,
  "boomer-trend-wide": 5,
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  for (const [botId, leverage] of Object.entries(TARGETS)) {
    // jsonb merge — only touch the leverage key, preserve other config.
    const rows = (await sql`
      UPDATE bots
      SET config = config || ${JSON.stringify({ leverage })}::jsonb
      WHERE id = ${botId}
      RETURNING id, config
    `) as Array<{ id: string; config: Record<string, unknown> }>;
    if (rows.length === 0) {
      console.log(`  ⚠ ${botId.padEnd(28)} not found`);
      continue;
    }
    const cfg = rows[0].config;
    console.log(`  ✓ ${botId.padEnd(28)} leverage=${cfg.leverage}x`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
