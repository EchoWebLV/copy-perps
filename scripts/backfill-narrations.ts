// scripts/backfill-narrations.ts
// One-shot: for every currently-open paper position with null narration_open,
// reconstruct narrator args from the row and patch in xAI prose. This is a
// dev-only convenience so the UI shows reasoning on positions that existed
// before the narrator wiring landed.
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { narrateOpenSafe, narrateOpenFallback } from "../lib/bots/narrator";

interface OpenRow {
  id: string;
  bot_id: string;
  persona_voice_key: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entry_mark: number;
  trigger_meta: Record<string, unknown> | null;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT p.id, p.bot_id, b.persona_voice_key, p.asset, p.side, p.leverage,
           p.entry_mark, p.trigger_meta
    FROM paper_positions p
    JOIN bots b ON b.id = p.bot_id
    WHERE p.status = 'open' AND p.narration_open IS NULL
  `) as OpenRow[];

  console.log(`Backfilling ${rows.length} open positions...`);
  for (const r of rows) {
    const xai = await narrateOpenSafe({
      personaKey: r.persona_voice_key,
      asset: r.asset,
      side: r.side,
      leverage: r.leverage,
      entryMark: Number(r.entry_mark),
      trigger: r.trigger_meta ?? {},
    });
    const text =
      xai ??
      narrateOpenFallback({
        asset: r.asset,
        side: r.side,
        leverage: r.leverage,
        entryMark: Number(r.entry_mark),
      });
    const source = xai ? "xAI" : "fallback";
    await sql`UPDATE paper_positions SET narration_open = ${text} WHERE id = ${r.id}`;
    console.log(`  ✓ [${source}] ${r.bot_id} ${r.side} ${r.asset} → "${text.slice(0, 90)}"`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
