// scripts/arena/_unwedge-llm-bot.ts
//
// One-shot: submit an operator-signed HOLD heartbeat (apply_decision action=0)
// for an LlmBot so the program runs roll_day() — which resets trades_today,
// rebaselines the daily-loss baseline, and CLEARS a stale `halted` flag once the
// UTC day has advanced. This is the manual unwedge for a bot stuck HALTED
// because it only ever HOLDs (a hold submits no tx, so roll_day never runs).
//
// Run it where the MAINNET operator key lives (Railway), so the key never
// touches local disk:
//   railway run --service arena-llm-operator -- npx tsx scripts/arena/_unwedge-llm-bot.ts gpt-v1
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { buildApplyDecisionIx, llmBotPda } from "../../lib/arena/llm/submit";
import { decodeLlmBot } from "../../lib/arena/decode";
import type { ApplyDecisionArgs } from "../../lib/arena/llm/floor";

const persona = process.argv[2] ?? "gpt-v1";
const ER = process.env.ARENA_ER_ENDPOINT || "https://eu.magicblock.app";
const PROGRAM = new PublicKey(process.env.ARENA_PROGRAM_ID || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC");
const FEED = new PublicKey(process.env.ARENA_FEED || "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const MARKET_ID = Number.parseInt(process.env.ARENA_MARKET_ID || "0", 10);

// MAINNET-safety: refuse the devnet-keypair-file fallback. The unwedge MUST use
// the operator the live bots were initialized with (Railway's inline key).
function loadOperator(): Keypair {
  const inline = process.env.ARENA_OPERATOR_KEYPAIR?.trim();
  if (!inline) {
    throw new Error("ARENA_OPERATOR_KEYPAIR not set — run this via `railway run --service arena-llm-operator` so the live operator key is injected.");
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
}

// action=0 HOLD → the program treats it as a heartbeat (lib.rs apply_decision:
// `_ => {}`), but roll_day() runs first. Every other arg is ignored for HOLD.
const HEARTBEAT: ApplyDecisionArgs = { action: 0, side: 0, leverage: 0, stakeFracBps: 0, stopBps: 0, tpBps: 0, confidence: 0 };

async function readBot(conn: Connection): Promise<ReturnType<typeof decodeLlmBot>> {
  const info = await conn.getAccountInfo(llmBotPda(PROGRAM, persona), "confirmed");
  return info ? decodeLlmBot(new Uint8Array(info.data)) : null;
}

async function main() {
  const operator = loadOperator();
  const conn = new Connection(ER, "confirmed");
  console.log(`unwedge ${persona} — ER ${ER}, operator ${operator.publicKey.toBase58()}`);

  const before = await readBot(conn);
  if (!before) throw new Error(`no LlmBot account for ${persona}`);
  console.log(`BEFORE: halted=${before.halted} tradesToday=${before.tradesToday} dayStartTs=${new Date(before.dayStartTsMs).toISOString()}`);
  if (!before.halted) {
    console.log("Bot is not halted — nothing to unwedge. (Heartbeat still safe, but skipping.)");
    return;
  }

  const ix = buildApplyDecisionIx({ programId: PROGRAM, persona, operator: operator.publicKey, feed: FEED, marketId: MARKET_ID, args: HEARTBEAT });
  const tx = new Transaction().add(ix);
  tx.feePayer = operator.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(operator);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`heartbeat sent: ${sig}`);

  const after = await readBot(conn);
  console.log(`AFTER:  halted=${after?.halted} tradesToday=${after?.tradesToday} dayStartTs=${after ? new Date(after.dayStartTsMs).toISOString() : "?"}`);
  if (after && !after.halted) console.log("✅ unwedged — halt cleared, day rolled. The bot can open again next tick.");
  else console.log("⚠️ still halted — feed may have been stale (no-op) or day did not roll; retry.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
