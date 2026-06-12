// scripts/arena/fund-crank-payer.ts
//
// Tops up the DELEGATED crank-payer PDA's ER-side lamport balance — the
// reservoir commit_state spends from since the magic_fee_vault migration
// (PINS.md "magic_fee_vault commits"). Lamports cannot be sent straight to a
// delegated account; this shuttles them through the Ephemeral SPL Token
// program's sponsored-lamports flow (`lamportsDelegatedTransferIx`,
// discriminator 20): a BASE-LAYER tx creates a one-shot lamports PDA from a
// fresh 32-byte salt, funds it from the admin wallet and delegates it; the
// ER consumes it and credits the crank payer's delegated balance.
//
// WHEN TO RUN: the crank payer's ER balance is low — symptom is commit_state
// failing on the ER with an insufficient-funds error on the bundle payer
// (each commit drips lamports from the crank payer). Check the balance any
// time with:  solana balance <crank-payer-pda> --url $ARENA_ER_ENDPOINT
// (this script prints the PDA and its ER balance before/after).
//
// Run from the repo root:
//   npx tsx --env-file=.env.local scripts/arena/fund-crank-payer.ts
//
// Env:
//   ARENA_FUND_LAMPORTS      — amount to shuttle, default 200000000 (0.2 SOL)
//   ARENA_ADMIN_KEYPAIR_PATH — payer keypair file (default ~/.config/solana/id.json)
//   ARENA_DEVNET_RPC         — base-layer RPC override; otherwise a Helius
//                              devnet URL is derived from HELIUS_API_KEY /
//                              NEXT_PUBLIC_HELIUS_RPC_URL
//   ARENA_ER_ENDPOINT        — ER RPC for the balance readback, default
//                              https://devnet.magicblock.app
//
// Preconditions: the crank payer PDA exists AND is delegated (the shuttle
// reads the destination's delegation record — init-devnet.ts does both).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";

// The SDK only lives in arena-program/node_modules — a tree the web build
// never installs (Railway runs the root npm ci only), so a static import
// breaks `next build`'s typecheck there. require() through a computed path
// keeps tsc out of it; signatures pinned here, verified against the SDK's
// ephemeralAta.d.ts.
function loadSdk(): {
  deriveLamportsPda(
    payer: web3.PublicKey,
    destination: web3.PublicKey,
    salt: Uint8Array,
  ): [web3.PublicKey, number];
  lamportsDelegatedTransferIx(
    payer: web3.PublicKey,
    destination: web3.PublicKey,
    amount: bigint,
    salt: Uint8Array,
  ): web3.TransactionInstruction;
} {
  const sdkPath = path.join(
    __dirname,
    "../../arena-program/node_modules/@magicblock-labs/ephemeral-rollups-sdk/lib/index.js",
  );
  try {
    return require(sdkPath);
  } catch {
    throw new Error(
      "ephemeral-rollups-sdk not found — run `npm install` inside arena-program/ first",
    );
  }
}
const { deriveLamportsPda, lamportsDelegatedTransferIx } = loadSdk();

// magicblock-delegation-program-api 3.0.0 (PINS.md Task 12 gotcha — NOT the
// older ...teabpTabdBah id).
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const DEFAULT_AMOUNT_LAMPORTS = 200_000_000n; // 0.2 SOL

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

function loadProgramId(): web3.PublicKey {
  const idlPath = path.resolve(
    __dirname,
    "../../arena-program/target/idl/arena.json",
  );
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as anchor.Idl;
  return new web3.PublicKey(idl.address);
}

async function main() {
  const base = new web3.Connection(baseRpcUrl(), "confirmed");
  const er = new web3.Connection(
    process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app",
    "confirmed",
  );
  const admin = loadAdmin();
  const amount = BigInt(
    process.env.ARENA_FUND_LAMPORTS || DEFAULT_AMOUNT_LAMPORTS,
  );

  const programId = loadProgramId();
  const [crankPayerPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("crank-payer")],
    programId,
  );
  console.log(
    `crank payer ${crankPayerPda.toBase58()} | admin ${admin.publicKey.toBase58()} | amount ${amount} lamports`,
  );

  // The shuttle routes via the destination's delegation record — a
  // non-delegated destination fails on-chain, so fail fast here instead
  // (lamports-topup.md gotcha). For a base-layer-owned crank payer a plain
  // SystemProgram.transfer before (re)delegation is the right tool.
  const info = await base.getAccountInfo(crankPayerPda);
  if (!info) {
    throw new Error(
      "crank payer PDA does not exist — run scripts/arena/init-devnet.ts first",
    );
  }
  if (!info.owner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error(
      `crank payer is not delegated (owner ${info.owner.toBase58()}) — ` +
        "delegate it first (init-devnet.ts), or top up with a plain transfer pre-delegation",
    );
  }

  // Payer covers the shuttled amount + fees + the lamports PDA's transient
  // rent (lamports-topup.md: "payer pays gas + the topped-up amount").
  const adminBalance = await base.getBalance(admin.publicKey);
  if (BigInt(adminBalance) < amount + 10_000_000n) {
    throw new Error(
      `admin balance ${adminBalance} lamports cannot cover ${amount} + fees`,
    );
  }

  const erBefore = await er.getBalance(crankPayerPda);

  // Fresh 32-byte salt per call: the lamports PDA derives from
  // [b"lamports", payer, destination, salt] and a reused triple collides
  // with the already-consumed PDA from a previous run.
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const [lamportsPda] = deriveLamportsPda(
    admin.publicKey,
    crankPayerPda,
    salt,
  );
  const ix = lamportsDelegatedTransferIx(
    admin.publicKey,
    crankPayerPda,
    amount,
    salt,
  );
  const tx = new web3.Transaction().add(ix);
  tx.feePayer = admin.publicKey;

  // CRITICAL: base layer, not the ER (the ix creates + delegates accounts).
  const sig = await web3.sendAndConfirmTransaction(base, tx, [admin], {
    commitment: "confirmed",
    skipPreflight: true,
  });
  console.log(`shuttle sent (lamports PDA ${lamportsPda.toBase58()}): ${sig}`);

  // The ER credits the destination when its validator ingests the delegated
  // lamports PDA — usually seconds; poll for the readback.
  for (let i = 0; i < 30; i++) {
    const erAfter = await er.getBalance(crankPayerPda);
    if (erAfter > erBefore) {
      console.log(
        `crank payer ER balance: ${erBefore} -> ${erAfter} (+${erAfter - erBefore})`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(
    `ER balance still ${erBefore} after 60s — the credit may land late; ` +
      `re-check with: solana balance ${crankPayerPda.toBase58()} --url <ER endpoint>`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
