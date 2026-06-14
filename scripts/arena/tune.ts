// scripts/arena/tune.ts
//
// Pushes scripts/arena/bot-tuning.ts (TUNING) to the live on-chain bots via the
// admin-gated update_llm_params instruction. One command tunes every bot.
//
//   npm run arena:tune           # MAINNET (default) — the live gwak.gg bots
//   npm run arena:tune:devnet    # devnet demo
//
// Signed by the arena config admin (ARENA_ADMIN_KEYPAIR_PATH, default id.json).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { TUNING, type BotTuning } from "./bot-tuning";

const ER = process.env.ARENA_ER_ENDPOINT || "https://eu.magicblock.app";
const PROGRAM_ID = new web3.PublicKey(
  process.env.ARENA_PROGRAM_ID || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC",
);

function loadKeypair(p: string): web3.Keypair {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}
const personaId = (name: string): number[] => {
  const b = Buffer.alloc(16);
  b.write(name, "utf8");
  return Array.from(b);
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// BotTuning (friendly names) -> on-chain LlmParams (IDL camelCase).
function toParams(t: BotTuning) {
  return {
    maxHoldTicks: t.maxHoldTicks,
    decisionCooldownSecs: t.cooldownSecs,
    maxLeverage: t.maxLeverage,
    minStopBps: t.minStopBps,
    maxStopBps: t.maxStopBps,
    maxStakeFracBps: t.maxStakeBps,
    maxTradesPerDay: t.maxTradesPerDay,
    dailyLossLimitBps: t.dailyLossBps,
    fundingBpsPerHour: t.fundingBpsPerHour,
    confidenceFloor: t.confidenceFloor,
    riskSizing: t.riskSizing,
  };
}
const SHOW = ["maxLeverage", "maxStakeFracBps", "confidenceFloor", "decisionCooldownSecs", "maxTradesPerDay", "dailyLossLimitBps", "riskSizing"] as const;

async function main() {
  const admin = loadKeypair(
    process.env.ARENA_ADMIN_KEYPAIR_PATH || path.join(homedir(), ".config/solana/id.json"),
  );
  const conn = new web3.Connection(ER, "confirmed");
  const idl = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../arena-program/target/idl/arena.json"), "utf8"),
  );
  idl.address = PROGRAM_ID.toBase58();
  const program = new Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(admin), { commitment: "confirmed" }));
  const config = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];

  console.log(`\ngwak arena tune → ${ER}\n`);
  for (const [persona, tuning] of Object.entries(TUNING)) {
    const llmPda = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("llmbot"), Buffer.from(personaId(persona))], PROGRAM_ID,
    )[0];
    let before: any = null;
    try { before = await (program.account as any).llmBot.fetch(llmPda); } catch { console.log(`  ${persona}: not found on ${ER} — skipping`); continue; }
    const next = toParams(tuning);
    const diffs = SHOW.filter((k) => Number(before.params[k]) !== Number((next as any)[k]))
      .map((k) => `${k} ${before.params[k]}→${(next as any)[k]}`);
    try {
      const ix = await program.methods.updateLlmParams(next)
        .accountsPartial({ config, llmBot: llmPda, admin: admin.publicKey }).instruction();
      const tx = new web3.Transaction().add(ix);
      tx.feePayer = admin.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(admin);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      for (let i = 0; i < 25; i++) { const st = (await conn.getSignatureStatus(sig)).value; if (st?.err) throw new Error(JSON.stringify(st.err)); if (st?.confirmationStatus) break; await sleep(200); }
      console.log(`  ✓ ${persona}${diffs.length ? "  " + diffs.join(", ") : "  (no change)"}`);
    } catch (e) {
      console.log(`  ✗ ${persona} failed: ${(e as Error).message}`);
    }
  }
  console.log("\nDone.\n");
}
main().catch((e) => { console.error("ERR:", (e as Error).message || e); process.exit(1); });
