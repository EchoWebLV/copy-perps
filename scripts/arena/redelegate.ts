// scripts/arena/redelegate.ts
//
// Resets the MagicBlock sponsored-commit quota (10 commits per delegated
// account — PINS.md "commit quota" entry) by undelegating the market + bots
// and re-delegating them. Run when commits fail with the magic program's
// 0xa0000000 "sponsored commit limit exceeded".
//
//   npx tsx --env-file=.env.local scripts/arena/redelegate.ts
//
// The arena pauses (bots frozen) for the few seconds between undelegation
// finalizing and re-delegation landing. Paper-only state: no money risk.
// Permanent fix SHIPPED (PINS.md "magic_fee_vault commits"): commit_state
// pays its own bundles via the delegated crank payer, so the quota no
// longer applies once the new program is deployed + the payer is funded —
// keep this script only as an emergency delegation-reset tool.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";

const ER_ENDPOINT = process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const BOTS = (process.env.ARENA_BOTS || "scalper-v1,rider-v1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Market follows ARENA_MARKET_ID like every other arena script. To reset the
// ORIGINAL wedged generation explicitly:
//   ARENA_MARKET_ID=0 ARENA_BOTS=scalper-v1,rider-v1 npx tsx ... redelegate.ts
const MARKET_ID = Number.parseInt(
  process.env.ARENA_MARKET_ID?.trim() || "0",
  10,
);

const personaId = (name: string): Buffer => {
  const buf = Buffer.alloc(16);
  buf.write(name, "utf8");
  return buf;
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

async function main() {
  const er = new web3.Connection(ER_ENDPOINT, "processed");
  const base = new web3.Connection(baseRpcUrl(), "confirmed");
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
  const provider = new anchor.AnchorProvider(er, new anchor.Wallet(admin), {
    commitment: "processed",
  });
  const program = new Program(idl as anchor.Idl, provider);

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [marketPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([MARKET_ID])],
    program.programId,
  );
  const botMetas = BOTS.map((name) => ({
    pubkey: web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bot"), personaId(name)],
      program.programId,
    )[0],
    isSigner: false,
    isWritable: true,
  }));
  const all = [marketPda, ...botMetas.map((m) => m.pubkey)];

  // Skip undelegation if already on base layer (partial prior run).
  const marketOwner = (await base.getAccountInfo(marketPda))?.owner;
  if (marketOwner?.equals(DELEGATION_PROGRAM_ID)) {
    console.log("undelegating via ER (commit_and_undelegate)...");
    const tx = await program.methods
      .undelegateAll(MARKET_ID)
      .accountsPartial({
        config: configPda,
        admin: admin.publicKey,
        marketState: marketPda,
      })
      .remainingAccounts(botMetas)
      .transaction();
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const sig = await er.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    console.log("undelegate_all sent on ER:", sig);
  } else {
    console.log("market already on base layer — skipping undelegate");
  }

  // Poll base layer until every account's owner flips back to the program.
  process.stdout.write("waiting for base-layer ownership flip");
  for (let i = 0; i < 60; i++) {
    const owners = await Promise.all(
      all.map(async (pk) => (await base.getAccountInfo(pk))?.owner.toBase58()),
    );
    if (owners.every((o) => o === program.programId.toBase58())) {
      console.log("\nall accounts undelegated (owner = arena program)");
      break;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
    if (i === 59) throw new Error("undelegation did not finalize in 120s");
  }

  console.log("re-delegating via init-devnet.ts (idempotent)...");
  const { execSync } = await import("node:child_process");
  execSync("npx tsx --env-file=.env.local scripts/arena/init-devnet.ts", {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "inherit",
  });
  console.log("redelegate done — sponsored-commit quota reset (10 per account)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
