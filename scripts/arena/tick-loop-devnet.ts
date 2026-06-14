// scripts/arena/tick-loop-devnet.ts
//
// Standalone DEVNET tick loop for the LLM arena. Sends tick(marketId) to the
// devnet ER every ~2s so MagicBlock's fresh oracle price gets folded into the
// market's MarketState (the account the UI reads for mark/PnL and that
// maintain_llm uses for stop/liq/tp). The 4 LLM bots ride along as remaining
// accounts so their per-tick maintenance runs.
//
// WHY NOT crank-worker.ts: that path is lease-guarded against the shared Neon
// table, and the single lease is also held by the PROD MAINNET arena-crank.
// Running it here would fight prod. This loop is lease-free and devnet-only.
//
// No commit_state: the UI reads ER state directly, so ticking the ER is enough
// to make prices flow for the live demo. (Base-layer persistence is a separate
// concern handled by the real crank when this graduates to a product.)
//
//   ARENA_MARKET_ID=1 npx tsx --env-file=.env.local scripts/arena/tick-loop-devnet.ts

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { decodeMarketState } from "@/lib/arena/decode";

const PROGRAM_ID = process.env.ARENA_PROGRAM_ID || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC";
const ER_ENDPOINT = process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
const MARKET_ID = Number.parseInt(process.env.ARENA_MARKET_ID || "1", 10);
const FEED = new web3.PublicKey(process.env.ARENA_FEED || "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const TICK_GAP_MS = Number.parseInt(process.env.ARENA_CRANK_INTERVAL_MS || "2000", 10);
const BOTS = (process.env.ARENA_LLM_BOTS_TICK || "claude-v1,grok-v1,gpt-v1,vader-v1")
  .split(",").map((s) => s.trim()).filter(Boolean);

function personaId(name: string): Buffer {
  const b = Buffer.alloc(16);
  b.write(name, "utf8");
  return b;
}
function loadKeypair(): web3.Keypair {
  const inline = process.env.ARENA_CRANK_KEYPAIR?.trim();
  if (inline) return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
  const p = process.env.ARENA_CRANK_KEYPAIR_PATH || path.join(homedir(), ".config/solana/id.json");
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}
function loadIdl(): anchor.Idl {
  const idlPath = path.resolve(__dirname, "../../arena-program/target/idl/arena.json");
  return JSON.parse(readFileSync(idlPath, "utf8"));
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const payer = loadKeypair();
  const er = new web3.Connection(ER_ENDPOINT, "confirmed");
  const idl = loadIdl();
  idl.address = PROGRAM_ID;
  const program = new Program(idl, new anchor.AnchorProvider(er, new anchor.Wallet(payer), { commitment: "confirmed" }));

  const config = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const marketState = web3.PublicKey.findProgramAddressSync([Buffer.from("market"), Buffer.from([MARKET_ID])], program.programId)[0];
  const botMetas = BOTS.map((name) => ({
    pubkey: web3.PublicKey.findProgramAddressSync([Buffer.from("llmbot"), personaId(name)], program.programId)[0],
    isSigner: false,
    isWritable: true,
  }));

  console.log(`[tick-loop] ER ${ER_ENDPOINT} market ${MARKET_ID} payer ${payer.publicKey.toBase58()}`);
  console.log(`[tick-loop] marketState ${marketState.toBase58()} bots ${BOTS.join(",")}`);

  let n = 0;
  for (;;) {
    try {
      const tx = await program.methods
        .tick(MARKET_ID)
        .accountsPartial({ config, marketState, feed: FEED })
        .remainingAccounts(botMetas)
        .transaction();
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
      tx.sign(payer);
      const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      // brief confirm poll
      let ok = false;
      for (let i = 0; i < 15; i++) {
        const st = (await er.getSignatureStatus(sig)).value;
        if (st?.err) { console.warn(`[tick-loop] tick err ${JSON.stringify(st.err)}`); break; }
        if (st?.confirmationStatus) { ok = true; break; }
        await sleep(150);
      }
      n += 1;
      if (ok && n % 5 === 1) {
        const info = await er.getAccountInfo(marketState).catch(() => null);
        const m = info ? decodeMarketState(new Uint8Array(info.data)) : null;
        const age = m ? Math.round(Date.now() / 1000 - m.lastPublishTsMs / 1000) : NaN;
        console.log(`[tick-loop] tick #${n} ok — MarketState ${MARKET_ID} $${m?.lastPrice?.toFixed(4)} age ${age}s`);
      }
    } catch (e) {
      console.warn(`[tick-loop] sweep failed:`, (e as Error).message);
    }
    await sleep(TICK_GAP_MS);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
