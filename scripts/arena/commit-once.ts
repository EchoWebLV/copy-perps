// scripts/arena/commit-once.ts
//
// Force ONE commit_state for the env-configured market + roster and verify
// the whole pipeline end to end: the ER instruction emits one Magic intent
// per account (4a1b35e — multi-account bundles exceed the validator's
// base-layer compute budget, the 2026-06-12 wedge), the validator finalizes
// each intent as its own base-layer tx, and the delegated crank-payer PDA
// pays for the bundles (magic_fee_vault path — no sponsored-commit quota).
//
// Run from the repo root:
//   npx tsx --env-file=.env.local scripts/arena/commit-once.ts
//
// Env: ARENA_MARKET_ID / ARENA_BOTS / ARENA_ER_ENDPOINT / ARENA_ER_VALIDATOR /
// ARENA_ADMIN_KEYPAIR_PATH — same meanings as lib/arena/crank-deps.ts.
//
// Verification = poll base-layer getSignaturesForAddress per committed
// account until a signature NEWER than the pre-commit snapshot lands, then
// print its err status. Success looks like one fresh err-free base tx per
// account plus a crank-payer ER balance drop.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";

const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const DEFAULT_ER_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

const MARKET_ID = Number.parseInt(
  process.env.ARENA_MARKET_ID?.trim() || "0",
  10,
);
const BOT_NAMES = (process.env.ARENA_BOTS || "scalper-v1,rider-v1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
  if (!key) throw new Error("Helius env missing (run with --env-file=.env.local)");
  return `https://devnet.helius-rpc.com/?api-key=${key}`;
}

function loadKeypair(): web3.Keypair {
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
  return JSON.parse(readFileSync(idlPath, "utf8"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const erEndpoint =
    process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
  const er = new web3.Connection(erEndpoint, "confirmed");
  const base = new web3.Connection(baseRpcUrl(), "confirmed");
  const payer = loadKeypair();
  const provider = new anchor.AnchorProvider(er, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const program = new Program(loadIdl(), provider);
  const erValidator = new web3.PublicKey(
    process.env.ARENA_ER_VALIDATOR || DEFAULT_ER_VALIDATOR,
  );

  const [marketPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([MARKET_ID])],
    program.programId,
  );
  const bots = BOT_NAMES.map((name) => ({
    name,
    pubkey: web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bot"), Buffer.from(personaId(name))],
      program.programId,
    )[0],
  }));
  const [crankPayer] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("crank-payer")],
    program.programId,
  );
  const [delegationRecord] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), marketPda.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
  const [magicFeeVault] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("magic-fee-vault"), erValidator.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );

  const committed = [
    { name: `market-${MARKET_ID}`, pubkey: marketPda },
    ...bots,
  ];

  // Pre-commit snapshots: newest base signature per account + payer balance.
  const newestSig = async (pk: web3.PublicKey) =>
    (await base.getSignaturesForAddress(pk, { limit: 1 }))[0]?.signature;
  const before = new Map<string, string | undefined>();
  for (const { name, pubkey } of committed) {
    before.set(name, await newestSig(pubkey));
  }
  const payerBefore = await er.getBalance(crankPayer);
  console.log(
    `committing market ${MARKET_ID} + ${bots.length} bots | crank-payer ER balance ${payerBefore}`,
  );

  const tx = await program.methods
    .commitState(MARKET_ID)
    .accountsPartial({
      payer: payer.publicKey,
      marketState: marketPda,
      delegationRecord,
      magicFeeVault,
      crankPayer,
    })
    .remainingAccounts(
      bots.map(({ pubkey }) => ({ pubkey, isSigner: false, isWritable: true })),
    )
    .transaction();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const sig = await er.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  for (let i = 0; i < 25; i++) {
    const status = (await er.getSignatureStatus(sig)).value;
    if (status?.err) {
      const logs = (
        await er.getTransaction(sig, { maxSupportedTransactionVersion: 0 })
      )?.meta?.logMessages;
      throw new Error(
        `commit failed on ER: ${JSON.stringify(status.err)}\n${(logs ?? []).join("\n")}`,
      );
    }
    if (status?.confirmationStatus) break;
    await sleep(200);
  }
  console.log(`commit_state landed on ER: ${sig}`);

  // Each account's intent finalizes as its own base tx — poll until every
  // account shows a signature newer than its snapshot (validator executes
  // intents within seconds when healthy; 90s before we call it stuck).
  const pending = new Set(committed.map((c) => c.name));
  for (let i = 0; i < 45 && pending.size > 0; i++) {
    await sleep(2000);
    for (const { name, pubkey } of committed) {
      if (!pending.has(name)) continue;
      const sigs = await base.getSignaturesForAddress(pubkey, { limit: 5 });
      const fresh = sigs.find((s) => s.signature !== before.get(name));
      // Only count it once the newest sig differs from the snapshot head.
      if (fresh && sigs[0]?.signature !== before.get(name)) {
        console.log(
          `base finalize ${name}: ${sigs[0].signature} err=${JSON.stringify(sigs[0].err)}`,
        );
        pending.delete(name);
      }
    }
  }
  const payerAfter = await er.getBalance(crankPayer);
  console.log(
    `crank-payer ER balance ${payerBefore} -> ${payerAfter} (${payerAfter - payerBefore})`,
  );
  if (pending.size > 0) {
    throw new Error(
      `no base-layer finalize within 90s for: ${[...pending].join(", ")}`,
    );
  }
  console.log("commit-once: every account finalized on base — OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
