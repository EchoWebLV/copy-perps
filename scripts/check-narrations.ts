// scripts/check-narrations.ts
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT bot_id, asset, side, status, narration_open, narration_close, entry_ts, exit_ts
    FROM paper_positions
    ORDER BY COALESCE(exit_ts, entry_ts) DESC
    LIMIT 20
  `;
  for (const r of rows) {
    const stamp =
      (r.status === "closed" ? r.exit_ts : r.entry_ts)?.toString().slice(0, 19) ?? "—";
    const tag = r.status === "closed" ? "CLOSE" : "OPEN ";
    const text = r.status === "closed" ? r.narration_close : r.narration_open;
    console.log(
      `${stamp} ${tag} ${r.bot_id.padEnd(28)} ${r.side.padEnd(5)} ${r.asset.padEnd(5)} ${text ? `"${text.slice(0, 80)}"` : "(null)"}`,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
