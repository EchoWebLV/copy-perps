// scripts/reset-bots.ts
// Clean slate for the paper-bot roster:
//   - delete every paper_position (open + closed + expired)
//   - reset every bot's balance back to starting_balance_usd
//   - re-activate any busted bots back to 'paper'
//
// bot_chats are user-private and NOT touched.
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const before = (await sql`
    SELECT
      (SELECT COUNT(*) FROM paper_positions) AS positions,
      (SELECT COUNT(*) FROM paper_positions WHERE status = 'open') AS open_positions,
      (SELECT COUNT(*) FROM bots WHERE status = 'busted') AS busted_bots,
      (SELECT COUNT(*) FROM bots) AS total_bots
  `) as Array<{
    positions: number;
    open_positions: number;
    busted_bots: number;
    total_bots: number;
  }>;
  console.log("BEFORE:", before[0]);

  const deleted = (await sql`DELETE FROM paper_positions RETURNING id`) as Array<{ id: string }>;
  console.log(`Deleted ${deleted.length} paper positions.`);

  const updated = (await sql`
    UPDATE bots
    SET balance_usd = starting_balance_usd,
        status = CASE WHEN status = 'busted' THEN 'paper' ELSE status END
    RETURNING id, balance_usd, status
  `) as Array<{ id: string; balance_usd: number; status: string }>;
  for (const u of updated) {
    console.log(`  ${u.id.padEnd(28)} → $${u.balance_usd} (${u.status})`);
  }

  const after = (await sql`
    SELECT
      (SELECT COUNT(*) FROM paper_positions) AS positions,
      (SELECT COUNT(*) FROM bots WHERE status = 'paper') AS paper_bots
  `) as Array<{ positions: number; paper_bots: number }>;
  console.log("AFTER:", after[0]);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
