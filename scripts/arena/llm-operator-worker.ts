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
import { marketForAsset } from "../../lib/arena/markets";
import { buildApplyDecisionIx, llmBotPda } from "../../lib/arena/llm/submit";
import { renderPromptFor, buildSharedBrief, type SharedBrief } from "../../lib/arena/llm/brief";
import { DEMO_BRIEF } from "../../lib/arena/llm/demo-brief";
import { ORACLE_BOTS } from "../../lib/arena/llm/registry";
import { insertArenaDecision } from "../../lib/arena/llm/decision-store";
import { decodeLlmBot, tapeNewestFirst } from "../../lib/arena/decode";
import { getCandles } from "../../lib/data/candles";
import { getMarketSentimentSnapshot } from "../../lib/data/market-sentiment";
import { getNewsSentiment } from "../../lib/data/news-sentiment";

const ER = process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
const PROGRAM = new PublicKey(process.env.ARENA_PROGRAM_ID || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC");
const FEED = new PublicKey(process.env.ARENA_FEED || "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const MARKET_ID = Number.parseInt(process.env.ARENA_MARKET_ID || "0", 10);
const TICK_MS = Number.parseInt(process.env.ARENA_LLM_TICK_MS || "240000", 10); // 4 min (= cooldown)

// Active roster: ARENA_LLM_BOTS (comma list of personas) gates which bots this
// worker drives — set it to turn a bot on/off without a code change. Unset = all.
const ACTIVE = (() => {
  const raw = process.env.ARENA_LLM_BOTS?.trim();
  if (!raw) return ORACLE_BOTS;
  const allow = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return ORACLE_BOTS.filter((b) => allow.has(b.persona));
})();

// Operator key resolution (Railway-friendly): inline JSON array env first
// (ARENA_OPERATOR_KEYPAIR — how Railway holds it, no file to mount), then a
// file path (ARENA_OPERATOR_KEYPAIR_PATH), then the local devnet default.
function loadOperator(): Keypair {
  const inline = process.env.ARENA_OPERATOR_KEYPAIR?.trim();
  if (inline) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
  const p =
    process.env.ARENA_OPERATOR_KEYPAIR_PATH ||
    path.join(homedir(), ".config/solana/arena-operator-devnet.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}
const operator = loadOperator();
const conn = new Connection(ER, "confirmed");

/** Real market brief (live candles + OI/long-short/funding), DEMO_BRIEF fallback. */
async function freshBrief(): Promise<SharedBrief> {
  try {
    const brief = await buildSharedBrief({
      nowIso: () => new Date().toISOString(),
      candles: (asset) => getCandles(asset, "1h", 40),
      sentimentSnapshot: () => getMarketSentimentSnapshot(["BTC", "ETH", "SOL"]),
      newsSentiment: () => getNewsSentiment(),
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
    buildBrief: async (b) =>
      renderPromptFor({
        systemBlock: bot.systemBlock,
        bot: b,
        brief,
        closingInstruction: bot.closingInstruction,
      }),
    decide: (prompt) => client.decide(prompt),
    submit: async ({ persona, asset, args }) => {
      // Route this action to its asset's on-chain market + oracle feed. The
      // day-roll heartbeat passes asset "SOL", which maps to market 0/FEED —
      // the same market the heartbeat has always advanced.
      const { marketId, feed } = marketForAsset(asset);
      const ix = buildApplyDecisionIx({ programId: PROGRAM, persona, operator: operator.publicKey, feed, marketId, args });
      const tx = new Transaction().add(ix);
      tx.feePayer = operator.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(operator);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    },
    // Persist the thought behind every decision (the UI's "why" layer). For a
    // sent trade, read the bot back once post-confirm to capture the on-chain
    // tape entry's tsMs — the exact join key the MagicBlock log uses to pair the
    // reasoning with the right row. Best-effort: a DB or read-back hiccup logs
    // and moves on (it never blocks or breaks the trading loop).
    persistDecision: async (rec) => {
      let tapeTsMs: number | null = null;
      if (rec.sent && rec.signature) {
        try {
          const info = await conn.getAccountInfo(
            llmBotPda(PROGRAM, rec.persona),
            "confirmed",
          );
          const b = info ? decodeLlmBot(new Uint8Array(info.data)) : null;
          tapeTsMs = b ? (tapeNewestFirst(b)[0]?.tsMs ?? null) : null;
        } catch (e) {
          console.warn(`[worker] tape read-back failed for ${rec.persona}:`, (e as Error).message);
        }
      }
      try {
        await insertArenaDecision(rec, { marketId: marketForAsset(rec.asset).marketId, tapeTsMs });
      } catch (e) {
        console.warn(`[worker] persist decision failed for ${rec.persona}:`, (e as Error).message);
      }
      console.log(`  [${rec.persona}] ${rec.decision.action} ${rec.asset}${rec.sent ? ` SENT ${rec.signature?.slice(0, 8)}…` : ` skip(${rec.reason})`} — ${rec.decision.reasoning.slice(0, 90)}`);
    },
  };
}

async function tick() {
  const ts = new Date().toISOString().slice(11, 19);
  const brief = await freshBrief();
  const sol = brief.markets.find((m) => m.asset === "SOL")?.price;
  console.log(`\n[${ts}] tick — SOL $${sol ?? "n/a"}`);
  for (const bot of ACTIVE) {
    try {
      const res = await runBotDecision({ persona: bot.persona, marketId: MARKET_ID }, depsFor(bot, brief));
      const detail =
        res.status === "acted"
          ? ` → ${res.results.map((r) => `${r.asset} ${r.signature?.slice(0, 8)}…`).join(", ")}`
          : res.status === "heartbeat"
            ? ` → heartbeat ${res.signature?.slice(0, 8)}…`
            : "";
      console.log(`  ${bot.displayName}: ${res.status}${detail}`);
    } catch (e) {
      console.warn(`  ${bot.displayName} failed:`, (e as Error).message);
    }
  }
}

async function main() {
  console.log(`LLM operator loop — ER ${ER}, every ${TICK_MS / 1000}s, operator ${operator.publicKey.toBase58()}`);
  console.log(`bots: ${ACTIVE.map((b) => `${b.persona}(${b.provider})`).join(", ")}`);
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

// Railway healthcheck: when run as a Railway service, PORT is set — serve a
// trivial 200 so the platform's /api/health probe passes (no-op locally).
if (process.env.PORT) {
  void import("node:http").then(({ createServer }) => {
    createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }).listen(Number(process.env.PORT), () =>
      console.log(`[worker] health server on :${process.env.PORT}`),
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
