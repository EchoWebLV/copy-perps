// scripts/_bot-report.ts
//
// Ad-hoc READ-ONLY snapshot of paper-bot performance. Never writes.
// Run: npx tsx --env-file=.env.local scripts/_bot-report.ts

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const f = (n: number, w = 0) => Number(n).toFixed(w);

async function main() {
  const bots = (await sql`
    SELECT id, name, status, balance_usd, starting_balance_usd,
           EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS age_hours
    FROM bots ORDER BY balance_usd DESC
  `) as Array<Record<string, number & string>>;

  const stats = (await sql`
    SELECT bot_id,
      COUNT(*) FILTER (WHERE status = 'open')                                   AS open_n,
      COUNT(*) FILTER (WHERE status <> 'open')                                  AS closed_n,
      COUNT(*) FILTER (WHERE status <> 'open' AND paper_pnl_usd > 0)             AS wins,
      COALESCE(SUM(paper_pnl_usd) FILTER (WHERE status <> 'open'), 0)            AS realized,
      COUNT(*) FILTER (WHERE entry_ts > now() - interval '24 hours')            AS trades_24h,
      MAX(entry_ts)                                                             AS last_entry
    FROM paper_positions GROUP BY bot_id
  `) as Array<Record<string, number & string>>;
  const byBot = new Map(stats.map((s) => [s.bot_id, s]));

  console.log(`\n=== BREACH BOT REPORT ===  ${new Date().toISOString()}\n`);
  console.log(
    "BOT".padEnd(15) +
      "EQUITY".padStart(9) +
      "PnL$".padStart(9) +
      "PnL%".padStart(8) +
      "OPEN".padStart(6) +
      "CLOSED".padStart(8) +
      "WIN%".padStart(7) +
      "24h".padStart(6) +
      "AGE(h)".padStart(9),
  );
  console.log("-".repeat(77));
  for (const b of bots) {
    const s = byBot.get(b.id) ?? ({} as Record<string, number>);
    const pnl = Number(b.balance_usd) - Number(b.starting_balance_usd);
    const pct = (pnl / Number(b.starting_balance_usd)) * 100;
    const closed = Number(s.closed_n ?? 0);
    const wins = Number(s.wins ?? 0);
    const winPct = closed > 0 ? (wins / closed) * 100 : 0;
    console.log(
      String(b.name).padEnd(15) +
        `$${f(Number(b.balance_usd))}`.padStart(9) +
        `${pnl >= 0 ? "+" : ""}${f(pnl)}`.padStart(9) +
        `${pct >= 0 ? "+" : ""}${f(pct, 1)}%`.padStart(8) +
        String(s.open_n ?? 0).padStart(6) +
        String(closed).padStart(8) +
        (closed > 0 ? `${f(winPct)}%` : "-").padStart(7) +
        String(s.trades_24h ?? 0).padStart(6) +
        f(Number(b.age_hours), 1).padStart(9),
    );
  }

  // Totals
  const totEquity = bots.reduce((a, b) => a + Number(b.balance_usd), 0);
  const totStart = bots.reduce((a, b) => a + Number(b.starting_balance_usd), 0);
  console.log("-".repeat(77));
  console.log(
    `TOTAL (${bots.length} bots)`.padEnd(15) +
      `$${f(totEquity)}`.padStart(9) +
      `${f(totEquity - totStart)}`.padStart(9) +
      `${f(((totEquity - totStart) / totStart) * 100, 1)}%`.padStart(8),
  );

  // Recent closed trades for the freshly-shipped bots
  const fresh = ["blitz", "tilt", "pulse"];
  const recent = (await sql`
    SELECT bot_id, asset, side, leverage, stake_usd, paper_pnl_usd,
           entry_ts, exit_ts, status
    FROM paper_positions
    WHERE bot_id = ANY(${fresh})
    ORDER BY entry_ts DESC
    LIMIT 25
  `) as Array<Record<string, number & string>>;
  console.log(`\n=== RECENT TRADES — blitz / tilt / pulse (last 25) ===`);
  if (recent.length === 0) {
    console.log("(no trades yet)");
  } else {
    for (const r of recent) {
      const pnl =
        r.paper_pnl_usd == null ? "    open" : `${Number(r.paper_pnl_usd) >= 0 ? "+" : ""}${f(Number(r.paper_pnl_usd), 2)}`;
      console.log(
        String(r.bot_id).padEnd(8) +
          String(r.asset).padEnd(6) +
          String(r.side).padEnd(6) +
          `${r.leverage}x`.padEnd(5) +
          `$${f(Number(r.stake_usd))}`.padStart(7) +
          `  pnl ${pnl}`.padEnd(18) +
          `  ${String(r.status)}  ${new Date(r.entry_ts).toISOString().slice(5, 16)}`,
      );
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
