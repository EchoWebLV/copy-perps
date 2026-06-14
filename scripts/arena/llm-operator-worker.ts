// scripts/arena/llm-operator-worker.ts
//
// The LLM oracle-bot operator loop. Every tick, for each registry bot:
//   read its on-chain LlmBot state → build the market brief → ask the model →
//   run the TS safety-floor pre-check → submit an operator-signed apply_decision
//   to the ER if it survives. This is lib/arena/llm/loop.ts runBotDecision wired
//   to real deps (ER reads + writes + the real model). The on-chain program
//   re-enforces the floor; the operator only chooses timing/direction.
//
//   ARENA_ER_ENDPOINT=https://devnet.magicblock.app \
//   npx tsx --env-file=.env.local scripts/arena/llm-operator-worker.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { runBotDecision, type LlmLoopDeps } from "../../lib/arena/llm/loop";
import { createLlmClient } from "../../lib/arena/llm/client";
import { buildApplyDecisionIx, llmBotPda } from "../../lib/arena/llm/submit";
import { renderPromptFor, buildSharedBrief, type SharedBrief } from "../../lib/arena/llm/brief";
import { DEMO_BRIEF } from "../../lib/arena/llm/demo-brief";
import { ORACLE_BOTS } from "../../lib/arena/llm/registry";
import { decodeLlmBot } from "../../lib/arena/decode";
import { getCandles } from "../../lib/data/candles";
import { getMarketSentimentSnapshot } from "../../lib/data/market-sentiment";

const ER = process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
const PROGRAM = new PublicKey(process.env.ARENA_PROGRAM_ID || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC");
const FEED = new PublicKey(process.env.ARENA_FEED || "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const MARKET_ID = Number.parseInt(process.env.ARENA_MARKET_ID || "0", 10);
const TICK_MS = Number.parseInt(process.env.ARENA_LLM_TICK_MS || "240000", 10); // 4 min (= cooldown)

const operator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(path.join(homedir(), ".config/solana/arena-operator-devnet.json"), "utf8"))),
);
const conn = new Connection(ER, "confirmed");

/** Real market brief (live candles + OI/long-short/funding), DEMO_BRIEF fallback. */
async function freshBrief(): Promise<SharedBrief> {
  try {
    const brief = await buildSharedBrief({
      nowIso: () => new Date().toISOString(),
      candles: (asset) => getCandles(asset, "1h", 40),
      sentimentSnapshot: () => getMarketSentimentSnapshot(["BTC", "ETH", "SOL"]),
    });
    if (brief.markets.some((m) => m.price != null)) return brief;
  } catch (e) {
    console.warn("[worker] real brief failed, using demo brief:", (e as Error).message);
  }
  return DEMO_BRIEF;
}

function depsFor(bot: (typeof ORACLE_BOTS)[number], brief: SharedBrief): LlmLoopDeps {
  const client = createLlmClient({ provider: bot.provider, modelId: bot.modelId });
  return {
    now: () => Math.floor(Date.now() / 1000),
    getBotState: async () => {
      const info = await conn.getAccountInfo(llmBotPda(PROGRAM, bot.persona), "confirmed");
      return info ? decodeLlmBot(new Uint8Array(info.data)) : null;
    },
    buildBrief: async (b) => renderPromptFor({ systemBlock: bot.systemBlock, bot: b, brief }),
    decide: (prompt) => client.decide(prompt),
    submit: async ({ persona, marketId, args }) => {
      const ix = buildApplyDecisionIx({ programId: PROGRAM, persona, operator: operator.publicKey, feed: FEED, marketId, args });
      const tx = new Transaction().add(ix);
      tx.feePayer = operator.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(operator);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    },
    persistDecision: (rec) =>
      console.log(`  [${rec.persona}] ${rec.decision.action}${rec.sent ? ` SENT ${rec.signature?.slice(0, 8)}…` : ` skip(${rec.reason})`} — ${rec.decision.reasoning.slice(0, 90)}`),
  };
}

async function tick() {
  const ts = new Date().toISOString().slice(11, 19);
  const brief = await freshBrief();
  const sol = brief.markets.find((m) => m.asset === "SOL")?.price;
  console.log(`\n[${ts}] tick — SOL $${sol ?? "n/a"}`);
  for (const bot of ORACLE_BOTS) {
    try {
      const res = await runBotDecision({ persona: bot.persona, marketId: MARKET_ID }, depsFor(bot, brief));
      console.log(`  ${bot.displayName}: ${res.status}${res.status === "sent" ? ` → ${res.signature?.slice(0, 8)}…` : ""}`);
    } catch (e) {
      console.warn(`  ${bot.displayName} failed:`, (e as Error).message);
    }
  }
}

async function main() {
  console.log(`LLM operator loop — ER ${ER}, every ${TICK_MS / 1000}s, operator ${operator.publicKey.toBase58()}`);
  console.log(`bots: ${ORACLE_BOTS.map((b) => `${b.persona}(${b.provider})`).join(", ")}`);
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
