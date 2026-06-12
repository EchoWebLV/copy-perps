// scripts/arena/init-devnet.ts
//
// Task 13: one-time (idempotent) devnet bootstrap for the arena program —
// init config + SOL market + the two launch bots on the base layer, then
// delegate the market and bots to the devnet Ephemeral Rollup.
//
// Run from the repo root:
//   npx tsx --env-file=.env.local scripts/arena/init-devnet.ts
//
// Env:
//   ARENA_ADMIN_KEYPAIR_PATH — admin keypair file (default ~/.config/solana/id.json)
//   ARENA_DEVNET_RPC         — base-layer RPC override; otherwise a Helius
//                              devnet URL is derived from HELIUS_API_KEY /
//                              NEXT_PUBLIC_HELIUS_RPC_URL (api.devnet.solana.com
//                              is degraded — PINS.md Spike A)
//
// Idempotent: every account that already exists is skipped, every PDA already
// owned by the delegation program is skipped — safe to re-run after a partial
// failure. Requires a prior `~/.avm/bin/anchor-1.0.2 build` (reads the
// workspace IDL from arena-program/target/idl/arena.json at runtime; the
// file is gitignored, which is also why this script does not import it
// statically).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";

// Devnet SOL/USD feed pushed by MagicBlock's oracle (PINS.md Spike B; PDA is
// cluster-independent, verified live with age 0s).
const SOL_FEED = new web3.PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);
// ER validator identity used as the delegation pin (spec gotcha: never
// delegate without pinning). Default = devnet.magicblock.app == devnet-as
// (verified 2026-06-11). For mainnet pass ARENA_ER_VALIDATOR explicitly —
// regional identities are pinned in PINS.md "Phase 1.5 mainnet runbook"
// (Asia happens to share the devnet key; pin deliberately anyway).
const ER_VALIDATOR = new web3.PublicKey(
  process.env.ARENA_ER_VALIDATOR?.trim() ||
    "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);
// magicblock-delegation-program-api 3.0.0 (the er-sdk 0.14.3 dependency) —
// NOT the older ...teabpTabdBah id from stale docs (PINS.md Task 12 gotcha).
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

// Persona ids are utf8 bytes zero-padded (or truncated) to 16 — the PDA seed
// is these exact bytes, so the encoding is part of the on-chain identity.
export const personaId = (name: string): number[] => {
  const buf = Buffer.alloc(16);
  buf.write(name, "utf8");
  return Array.from(buf);
};

// u8 market PDA seed byte. Env-overridable (ARENA_MARKET_ID) so a fresh
// market can be stood up without touching a wedged one — market 0 is the
// original delegation stuck in the 2026-06-12 undelegation incident
// (PINS.md); market 1 is its live successor.
const MARKET_ID = (() => {
  const raw = process.env.ARENA_MARKET_ID?.trim() || "0";
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id < 0 || id > 255) {
    throw new Error(`ARENA_MARKET_ID must be a u8, got "${raw}"`);
  }
  return id;
})();
const START_BALANCE = new BN(1_000_000_000); // $1,000 in micro-USD

// Strategy params per persona name. The roster actually initialized comes
// from ARENA_BOTS (comma-separated names, default the v1 pair) — every name
// must have an entry here. v2 personas are byte-for-byte the same strategies
// as v1 on fresh PDAs (wedge sidestep — see MARKET_ID note above).
const SCALPER_PARAMS: Record<string, number> = {
  readSpan: 1,
  breakoutBps: 60,
  activityMultBps: 14000,
  trendFilter: 1, // u8 0/1 — bool is not Pod (state.rs)
  stakeFracBps: 1000,
  leverage: 100,
  maxHoldTicks: 90,
  exitFavorableBps: 100,
};
const RIDER_PARAMS: Record<string, number> = {
  readSpan: 4,
  breakoutBps: 80,
  activityMultBps: 14000,
  trendFilter: 1,
  stakeFracBps: 1000,
  leverage: 20,
  maxHoldTicks: 240,
  exitFavorableBps: 150,
};
const BOT_PARAMS: Record<string, Record<string, number>> = {
  "scalper-v1": SCALPER_PARAMS,
  "rider-v1": RIDER_PARAMS,
  "scalper-v2": SCALPER_PARAMS,
  "rider-v2": RIDER_PARAMS,
};

const BOTS: { name: string; params: Record<string, number> }[] = (
  process.env.ARENA_BOTS || "scalper-v1,rider-v1"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((name) => {
    const params = BOT_PARAMS[name];
    if (!params) {
      throw new Error(
        `no strategy params for persona "${name}" — add it to BOT_PARAMS in init-devnet.ts`,
      );
    }
    return { name, params };
  });

function baseRpcUrl(): string {
  if (process.env.ARENA_DEVNET_RPC) return process.env.ARENA_DEVNET_RPC;
  const key =
    process.env.HELIUS_API_KEY ||
    new URL(process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://x.invalid")
      .searchParams.get("api-key");
  if (!key) {
    throw new Error(
      "set ARENA_DEVNET_RPC, or HELIUS_API_KEY / NEXT_PUBLIC_HELIUS_RPC_URL (run with --env-file=.env.local)",
    );
  }
  return `https://devnet.helius-rpc.com/?api-key=${key}`;
}

function loadAdmin(): web3.Keypair {
  const p =
    process.env.ARENA_ADMIN_KEYPAIR_PATH ||
    path.join(homedir(), ".config/solana/id.json");
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))),
  );
}

function loadIdl(): anchor.Idl {
  const idlPath = path.resolve(
    __dirname,
    "../../arena-program/target/idl/arena.json",
  );
  try {
    return JSON.parse(readFileSync(idlPath, "utf8"));
  } catch {
    throw new Error(
      `IDL not found at ${idlPath} — run \`~/.avm/bin/anchor-1.0.2 build\` in arena-program/ first`,
    );
  }
}

async function main() {
  const connection = new web3.Connection(baseRpcUrl(), "confirmed");
  const admin = loadAdmin();
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" },
  );
  const program = new Program(loadIdl(), provider);
  console.log(
    `program ${program.programId.toBase58()} | admin ${admin.publicKey.toBase58()}`,
  );

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [marketPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([MARKET_ID])],
    program.programId,
  );

  // --- init config ---------------------------------------------------------
  if (await connection.getAccountInfo(configPda)) {
    console.log(`config ${configPda.toBase58()} exists — skip`);
  } else {
    // fee 6 bps, spread 5 bps, maint buffer 500 bps, max oracle age 10s
    // (the real freshness guard — unlike the huge window the static-fixture
    // local tests need), bucket 15s.
    const sig = await program.methods
      .initConfig(6, 5, 500, new BN(10), new BN(15))
      .accountsPartial({
        config: configPda,
        payer: admin.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`init_config ${configPda.toBase58()}: ${sig}`);
  }

  // --- init SOL market ------------------------------------------------------
  if (await connection.getAccountInfo(marketPda)) {
    console.log(`market ${marketPda.toBase58()} exists — skip`);
  } else {
    const sig = await program.methods
      .initMarket(MARKET_ID, SOL_FEED)
      .accountsPartial({
        config: configPda,
        marketState: marketPda,
        admin: admin.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`init_market ${marketPda.toBase58()}: ${sig}`);
  }

  // --- init bots ------------------------------------------------------------
  const botPdas: { name: string; id: number[]; pda: web3.PublicKey }[] = [];
  for (const bot of BOTS) {
    const id = personaId(bot.name);
    const [pda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bot"), Buffer.from(id)],
      program.programId,
    );
    botPdas.push({ name: bot.name, id, pda });
    if (await connection.getAccountInfo(pda)) {
      console.log(`bot ${bot.name} ${pda.toBase58()} exists — skip`);
      continue;
    }
    const sig = await program.methods
      .initBot(id, bot.params, START_BALANCE)
      .accountsPartial({
        config: configPda,
        bot: pda,
        admin: admin.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`init_bot ${bot.name} ${pda.toBase58()}: ${sig}`);
  }

  // --- init crank payer ------------------------------------------------------
  // Lamport reservoir that pays commit_state's Magic intent bundle once
  // delegated (magic_fee_vault pattern, PINS.md "magic_fee_vault commits").
  // Top up AFTER delegation with scripts/arena/fund-crank-payer.ts.
  const [crankPayerPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("crank-payer")],
    program.programId,
  );
  if (await connection.getAccountInfo(crankPayerPda)) {
    console.log(`crank payer ${crankPayerPda.toBase58()} exists — skip`);
  } else {
    const sig = await program.methods
      .initCrankPayer()
      .accountsPartial({
        config: configPda,
        crankPayer: crankPayerPda,
        admin: admin.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`init_crank_payer ${crankPayerPda.toBase58()}: ${sig}`);
  }

  // --- delegate market + bots + crank payer to the devnet ER ----------------
  // Validator pinned via the first remaining account (spec gotcha: never
  // delegate without pinning). skipPreflight like tests/delegation.ts — the
  // delegate CPI reassigns ownership mid-tx, which trips simulation.
  const validatorMeta = [
    { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
  ];
  const delegated = async (pda: web3.PublicKey) =>
    (await connection.getAccountInfo(pda))?.owner.equals(
      DELEGATION_PROGRAM_ID,
    ) ?? false;

  if (await delegated(marketPda)) {
    console.log(`market already delegated — skip`);
  } else {
    const sig = await program.methods
      .delegateMarket(MARKET_ID)
      .accountsPartial({
        config: configPda,
        admin: admin.publicKey,
        marketState: marketPda,
      })
      .remainingAccounts(validatorMeta)
      .rpc({ skipPreflight: true });
    console.log(`delegate_market: ${sig}`);
  }

  for (const { name, id, pda } of botPdas) {
    if (await delegated(pda)) {
      console.log(`bot ${name} already delegated — skip`);
      continue;
    }
    const sig = await program.methods
      .delegateBot(id)
      .accountsPartial({
        config: configPda,
        admin: admin.publicKey,
        botState: pda,
      })
      .remainingAccounts(validatorMeta)
      .rpc({ skipPreflight: true });
    console.log(`delegate_bot ${name}: ${sig}`);
  }

  if (await delegated(crankPayerPda)) {
    console.log(`crank payer already delegated — skip`);
  } else {
    const sig = await program.methods
      .delegateCrankPayer()
      .accountsPartial({
        config: configPda,
        admin: admin.publicKey,
        crankPayer: crankPayerPda,
      })
      .remainingAccounts(validatorMeta)
      .rpc({ skipPreflight: true });
    console.log(`delegate_crank_payer: ${sig}`);
  }

  for (const pda of [marketPda, ...botPdas.map((b) => b.pda), crankPayerPda]) {
    const owner = (await connection.getAccountInfo(pda))?.owner.toBase58();
    console.log(
      `${pda.toBase58()} owner ${owner} ${owner === DELEGATION_PROGRAM_ID.toBase58() ? "(delegated)" : "(NOT DELEGATED)"}`,
    );
  }
  console.log("init-devnet done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
