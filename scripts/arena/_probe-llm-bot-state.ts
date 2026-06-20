// scripts/arena/_probe-llm-bot-state.ts
//
// Read-only: dump the live on-chain LlmBot state for each registry bot from the
// ER, focused on the halt / daily-loss-reset fields.
//   npx tsx --env-file=.env.local scripts/arena/_probe-llm-bot-state.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { llmBotPda } from "../../lib/arena/llm/submit";
import { decodeLlmBot, tapeNewestFirst, arenaAction } from "../../lib/arena/decode";
import { ORACLE_BOTS } from "../../lib/arena/llm/registry";

const ER = process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
const PROGRAM = new PublicKey(process.env.ARENA_PROGRAM_ID || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC");
const conn = new Connection(ER, "confirmed");
const nowMs = Date.now();

function ago(ms: number): string {
  if (!ms) return "never";
  const s = Math.round((nowMs - ms) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${(s / 3600).toFixed(1)}h ago`;
  return `${(s / 86400).toFixed(1)}d ago`;
}

async function main() {
  console.log(`ER ${ER}\nprogram ${PROGRAM.toBase58()}\nnow ${new Date(nowMs).toISOString()}\n`);
  for (const bot of ORACLE_BOTS) {
    const pda = llmBotPda(PROGRAM, bot.persona);
    const info = await conn.getAccountInfo(pda, "confirmed");
    if (!info) {
      console.log(`── ${bot.persona} (${bot.displayName}): NO ACCOUNT at ${pda.toBase58()}\n`);
      continue;
    }
    const b = decodeLlmBot(new Uint8Array(info.data));
    if (!b) {
      console.log(`── ${bot.persona}: decode failed (len ${info.data.length})\n`);
      continue;
    }
    const open = b.positions.filter((p) => p.active);
    const equity = b.balanceUsd + open.reduce((a, p) => a + p.stakeUsd, 0);
    const dayLossPct = b.dayStartEquityUsd
      ? ((equity - b.dayStartEquityUsd) / b.dayStartEquityUsd) * 100
      : 0;
    console.log(`── ${bot.persona} (${bot.displayName})  pda ${pda.toBase58()}`);
    console.log(`   HALTED=${b.halted}   tradesToday=${b.tradesToday}   trades=${b.trades} wins=${b.wins}`);
    console.log(`   balance $${b.balanceUsd.toFixed(2)}  equity $${equity.toFixed(2)}  peak $${b.equityHighUsd.toFixed(2)}  grossPnl $${b.grossPnlUsd.toFixed(2)}`);
    console.log(`   dayStartEquity $${b.dayStartEquityUsd.toFixed(2)}  intraday P/L ${dayLossPct.toFixed(2)}%  (limit ${(b.params.dailyLossLimitBps / 100).toFixed(0)}%)`);
    console.log(`   dayStartTs ${b.dayStartTsMs ? new Date(b.dayStartTsMs).toISOString() : "0"} (${ago(b.dayStartTsMs)})`);
    console.log(`   lastDecisionTs ${b.lastDecisionTsMs ? new Date(b.lastDecisionTsMs).toISOString() : "0"} (${ago(b.lastDecisionTsMs)})`);
    console.log(`   open positions: ${open.length ? open.map((p) => `${p.side} mkt${p.marketId} ${p.leverage}x entry $${p.entryPrice.toFixed(2)} stake $${p.stakeUsd.toFixed(0)} stop $${p.stopPrice.toFixed(2)}`).join("; ") : "(flat)"}`);
    const tape = tapeNewestFirst(b).slice(0, 6);
    console.log(`   recent tape: ${tape.map((t) => `${arenaAction(t.action).label}@$${t.price.toFixed(2)} ${ago(t.tsMs)}`).join(" | ") || "(empty)"}`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
