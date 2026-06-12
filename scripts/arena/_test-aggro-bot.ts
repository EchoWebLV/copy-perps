// scripts/arena/_test-aggro-bot.ts
//
// Task 15 exit-checklist helper: init + delegate ONE deliberately aggressive
// bot ("test-aggro-v1", 0.05% breakout, 1.0x activity, no trend filter,
// 5x lev, ~50s max hold) so the open→close paper-trade loop can be proven
// with real price action while SOL is too quiet for the launch personas.
//
// Ad-hoc by design (underscore prefix, repo convention): run once, add
// the bot name to ARENA_BOTS, restart the crank worker; REMOVE the bot
// from ARENA_BOTS after the trade evidence is recorded in PINS.md.
//
//   npx tsx --env-file=.env.local scripts/arena/_test-aggro-bot.ts
//
// ARENA_TEST_BOT_NAME overrides the persona (default test-aggro-v2 —
// test-aggro-v1 belongs to the wedged market-0 generation).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";

// Delegation validator pin — env-overridable for mainnet (PINS.md
// "Phase 1.5 mainnet runbook"); default is the devnet identity.
const ER_VALIDATOR = new web3.PublicKey(
  process.env.ARENA_ER_VALIDATOR?.trim() ||
    "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

const NAME = process.env.ARENA_TEST_BOT_NAME?.trim() || "test-aggro-v2";
const PARAMS = {
  readSpan: 1,
  breakoutBps: 5, // 0.05% past the prior range — fires on routine noise
  activityMultBps: 10000, // 1.0x average path — almost always passes
  trendFilter: 0,
  stakeFracBps: 1000,
  leverage: 5,
  maxHoldTicks: 20, // ~50s at the crank cadence — guarantees a close
  exitFavorableBps: 10, // bank a 0.1% favorable move
};
const START_BALANCE = new BN(1_000_000_000); // $1,000 paper

const personaId = (name: string): number[] => {
  const buf = Buffer.alloc(16);
  buf.write(name, "utf8");
  return Array.from(buf);
};

function baseRpcUrl(): string {
  if (process.env.ARENA_DEVNET_RPC) return process.env.ARENA_DEVNET_RPC;
  const key =
    process.env.HELIUS_API_KEY ||
    new URL(process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://x.invalid")
      .searchParams.get("api-key");
  if (!key) throw new Error("set ARENA_DEVNET_RPC or Helius env");
  return `https://devnet.helius-rpc.com/?api-key=${key}`;
}

async function main() {
  const connection = new web3.Connection(baseRpcUrl(), "confirmed");
  const admin = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          process.env.ARENA_ADMIN_KEYPAIR_PATH ||
            path.join(homedir(), ".config/solana/id.json"),
          "utf8",
        ),
      ),
    ),
  );
  const idl = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../../arena-program/target/idl/arena.json"),
      "utf8",
    ),
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" },
  );
  const program = new Program(idl as anchor.Idl, provider);

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const id = personaId(NAME);
  const [pda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bot"), Buffer.from(id)],
    program.programId,
  );

  if (await connection.getAccountInfo(pda)) {
    console.log(`bot ${NAME} ${pda.toBase58()} exists — skip init`);
  } else {
    const sig = await program.methods
      .initBot(id, PARAMS, START_BALANCE)
      .accountsPartial({
        config: configPda,
        bot: pda,
        admin: admin.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`init_bot ${NAME} ${pda.toBase58()}: ${sig}`);
  }

  const info = await connection.getAccountInfo(pda);
  if (info?.owner.equals(DELEGATION_PROGRAM_ID)) {
    console.log(`bot ${NAME} already delegated — skip`);
  } else {
    const sig = await program.methods
      .delegateBot(id)
      .accountsPartial({
        config: configPda,
        admin: admin.publicKey,
        botState: pda,
      })
      .remainingAccounts([
        { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
      ])
      .rpc({ skipPreflight: true });
    console.log(`delegate_bot ${NAME}: ${sig}`);
  }

  const owner = (await connection.getAccountInfo(pda))?.owner.toBase58();
  console.log(
    `${pda.toBase58()} owner ${owner} ${owner === DELEGATION_PROGRAM_ID.toBase58() ? "(delegated)" : "(NOT DELEGATED)"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
