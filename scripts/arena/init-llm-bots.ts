// scripts/arena/init-llm-bots.ts
//
// Initialize + delegate the LLM oracle bots (claude-v1, grok-v1) on the
// configured cluster. Idempotent: skips any bot whose PDA already exists.
//
// init_llm_bot + delegate_llm_bot are BASE-LAYER instructions, so this uses the
// base RPC (ARENA_BASE_RPC), not the ER endpoint. Delegation pins the ER
// validator (ARENA_ER_VALIDATOR) as the first remaining account — MANDATORY.
//
// Run from the repo root (admin = the arena config admin keypair):
//   npx tsx --env-file=.env.local scripts/arena/init-llm-bots.ts
//
// Env:
//   ARENA_BASE_RPC            — base-layer RPC (default https://api.devnet.solana.com)
//   ARENA_PROGRAM_ID          — arena program id (default the deployed id)
//   ARENA_ADMIN_KEYPAIR_PATH  — config admin keypair (default ~/.config/solana/id.json)
//   ARENA_ER_VALIDATOR        — ER validator identity pubkey to pin on delegation
//   ARENA_START_BALANCE_MICRO — starting paper balance (default 1_000_000_000 = $1,000)
//   ARENA_LLM_OPERATOR_CLAUDE / ARENA_LLM_OPERATOR_GROK — per-bot operator secret
//     key (JSON array). Falls back to ARENA_LLM_OPERATOR (one shared operator).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { ORACLE_BOTS } from "../../lib/arena/llm/registry";

const BASE_RPC = process.env.ARENA_BASE_RPC?.trim() || "https://api.devnet.solana.com";
const PROGRAM_ID = new web3.PublicKey(
  process.env.ARENA_PROGRAM_ID?.trim() || "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC",
);
const START_BALANCE = new BN(process.env.ARENA_START_BALANCE_MICRO?.trim() || "1000000000");

function loadKeypair(p: string): web3.Keypair {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

function adminKeypair(): web3.Keypair {
  return loadKeypair(
    process.env.ARENA_ADMIN_KEYPAIR_PATH || path.join(homedir(), ".config/solana/id.json"),
  );
}

function operatorPubkey(envName: string): web3.PublicKey {
  const raw = process.env[envName] || process.env.ARENA_LLM_OPERATOR;
  if (!raw) throw new Error(`missing operator key: set ${envName} or ARENA_LLM_OPERATOR`);
  return loadKeypair0(raw).publicKey;
}

function loadKeypair0(jsonArray: string): web3.Keypair {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(jsonArray)));
}

function loadIdl(): anchor.Idl {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, "../../arena-program/target/idl/arena.json"), "utf8"),
  );
}

const personaId = (name: string): number[] => {
  const buf = Buffer.alloc(16);
  buf.write(name, "utf8");
  return Array.from(buf);
};

async function main() {
  const admin = adminKeypair();
  const connection = new web3.Connection(BASE_RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
    commitment: "confirmed",
  });
  const program = new Program(loadIdl(), provider) as Program;

  const [configPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const validator = process.env.ARENA_ER_VALIDATOR?.trim();

  for (const bot of ORACLE_BOTS) {
    const id = personaId(bot.persona);
    const [llmPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("llmbot"), Buffer.from(id)],
      PROGRAM_ID,
    );

    const existing = await connection.getAccountInfo(llmPda);
    if (existing) {
      console.log(`• ${bot.persona} already exists at ${llmPda.toBase58()} — skipping init`);
    } else {
      const operator = operatorPubkey(bot.operatorEnv);
      const sig = await program.methods
        .initLlmBot(id, operator, bot.params, START_BALANCE)
        .accountsPartial({
          config: configPda,
          llmBot: llmPda,
          admin: admin.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      console.log(`✓ init ${bot.persona} (${bot.displayName} / ${bot.provider}:${bot.modelId})`);
      console.log(`   pda ${llmPda.toBase58()}  operator ${operator.toBase58()}  ${sig}`);
    }

    if (!validator) {
      console.log(`   (set ARENA_ER_VALIDATOR to delegate ${bot.persona} to the ER)`);
      continue;
    }
    // Delegate to the ER (pin the validator as the first remaining account).
    try {
      const sig = await program.methods
        .delegateLlmBot(id)
        .accountsPartial({ config: configPda, admin: admin.publicKey, llmBotState: llmPda })
        .remainingAccounts([
          { pubkey: new web3.PublicKey(validator), isSigner: false, isWritable: false },
        ])
        .rpc();
      console.log(`   delegated ${bot.persona} → ${validator}  ${sig}`);
    } catch (err) {
      console.warn(`   delegate ${bot.persona} failed (already delegated?):`, (err as Error).message);
    }
  }

  console.log("\nDone. Add the operators to the brain loop env and unset DISABLE_ARENA_LLM to start trading.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
