import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT bot_id, asset, side, stake_usd, leverage, entry_mark, entry_ts, id
    FROM paper_positions
    WHERE status = 'open' AND stake_usd <= 0
    ORDER BY entry_ts
  `;
  for (const r of rows) {
    console.log(
      `${r.bot_id.padEnd(28)} ${r.side} ${r.asset.padEnd(5)} stake=$${r.stake_usd} ${r.leverage}x entry=$${r.entry_mark} at ${r.entry_ts}`,
    );
  }
  console.log(`\nTotal: ${rows.length} zero-stake open positions`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
