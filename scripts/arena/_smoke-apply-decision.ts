// scripts/arena/_smoke-apply-decision.ts
// Submit ONE operator-signed apply_decision (open) to the devnet ER for a bot,
// then read the LlmBot account back off the ER to confirm the position opened.
// Proves the on-chain LLM-bot path works live.
//   PERSONA=grok-v1 ACTION=open npx tsx scripts/arena/_smoke-apply-decision.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { buildApplyDecisionIx, llmBotPda } from "../../lib/arena/llm/submit";
import { decodeLlmBot } from "../../lib/arena/decode";
import { DECISION_ACTION, DECISION_SIDE } from "../../lib/arena/llm/schema";

const ER = process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
const PROGRAM = new PublicKey("6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC");
const FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const PERSONA = process.env.PERSONA || "grok-v1";
const ACTION = process.env.ACTION || "open"; // open | close

const operator = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(path.join(homedir(), ".config/solana/arena-operator-devnet.json"), "utf8")),
  ),
);

async function main() {
  const conn = new Connection(ER, "confirmed");
  const args =
    ACTION === "close"
      ? { action: DECISION_ACTION.close, side: 0, leverage: 0, stakeFracBps: 0, stopBps: 0, tpBps: 0, confidence: 0 }
      : { action: DECISION_ACTION.open, side: DECISION_SIDE.long, leverage: 10, stakeFracBps: 1000, stopBps: 200, tpBps: 400, confidence: 80 };

  const ix = buildApplyDecisionIx({ programId: PROGRAM, persona: PERSONA, operator: operator.publicKey, feed: FEED, marketId: 0, args });
  const tx = new Transaction().add(ix);
  tx.feePayer = operator.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(operator);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  console.log(`${PERSONA} apply_decision(${ACTION}) → ${sig}`);
  await conn.confirmTransaction(sig, "confirmed");

  const pda = llmBotPda(PROGRAM, PERSONA);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) throw new Error("bot account not found on ER");
  const bot = decodeLlmBot(new Uint8Array(info.data));
  if (!bot) throw new Error("decode failed");
  console.log("  balance $", bot.balanceUsd.toFixed(2), "| tradesToday", bot.tradesToday, "| tapeHead", bot.tapeHead);
  console.log(
    "  open positions:",
    JSON.stringify(
      bot.positions.filter((p) => p.active).map((p) => ({ side: p.side, entry: +p.entryPrice.toFixed(2), stop: +p.stopPrice.toFixed(2), tp: +p.tpPrice.toFixed(2), stake: +p.stakeUsd.toFixed(2), lev: p.leverage })),
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
