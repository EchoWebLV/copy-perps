// One-shot cleanup: paper positions with stake_usd <= 0 are legacy rows
// from before Phase 2.5 (when stake-sizing was added). They can't ever
// affect equity (PnL is multiplied by stake), but they pollute the feed
// with phantom "-63% loss" displays. Mark them 'expired' so they leave
// the open set and stop showing up in cards.
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    UPDATE paper_positions
    SET status = 'expired',
        exit_ts = now(),
        exit_mark = entry_mark,
        paper_pnl_usd = 0
    WHERE status = 'open' AND stake_usd <= 0
    RETURNING id, bot_id, asset, side
  `) as Array<{ id: string; bot_id: string; asset: string; side: string }>;
  for (const r of rows) {
    console.log(`expired: ${r.bot_id} ${r.side} ${r.asset}`);
  }
  console.log(`\nTotal: ${rows.length} legacy positions marked expired`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
