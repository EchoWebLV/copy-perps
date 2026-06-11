// lib/arena/crank-deps.ts
//
// Real chain wiring for the arena crank (Task 14): ER connection, anchor
// client over the runtime-loaded IDL, tick/commit_state tx builders, and the
// Neon crank lease. This module is ONLY ever loaded via the lazy
// `await import("./crank-deps")` in lib/arena/crank.ts — it pulls in
// @coral-xyz/anchor and @/lib/db (which throws without DATABASE_URL), so a
// static import would break `vitest run lib/arena`, typecheck-only runs and
// any client bundle (same reason lib/autopilot lazy-loads its chain deps).
//
// Env (see scripts/arena/crank-worker.ts header):
//   ARENA_PROGRAM_ID         — required; deployed arena program id
//   ARENA_ER_ENDPOINT        — default https://devnet.magicblock.app
//   ARENA_CRANK_KEYPAIR_PATH — keypair file, default ~/.config/solana/id.json
//                              (base-layer wallet works as ER fee payer,
//                              PINS.md Spike A; mirrors init-devnet.ts's
//                              ARENA_ADMIN_KEYPAIR_PATH)
//   ARENA_BOTS               — comma-separated persona names, default
//                              "scalper-v1,rider-v1"
//   ARENA_ER_VALIDATOR       — ER validator identity for the magic-fee-vault
//                              derivation in commit_state, default
//                              MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57
//                              (devnet.magicblock.app — PINS.md Task 13)
//
// Send pattern proven by scripts/arena/tick-once.ts + tests/delegation.ts:
// ER blockhash, skipPreflight true, poll getSignatureStatus (no websockets —
// long-lived worker must not leak subscription handles).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import {
  acquireArenaCrankLease,
  ensureArenaLeaseTable,
} from "@/lib/arena/lease";
import type { CrankDeps, CrankMarket, TickPlanEntry } from "./crank";

// Oracle feed per market id. Market 0 = SOL/USD pushed by MagicBlock's devnet
// oracle (PINS.md Spike B — PDA is cluster-independent). BTC/ETH markets get
// their feeds added here when init-devnet grows them.
const FEEDS: Record<number, web3.PublicKey> = {
  0: new web3.PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"),
};

// magicblock-delegation-program-api 3.0.0 id (PINS.md Task 12 gotchas — NOT
// the older …teabpTabdBah). Derivations below mirror the SDK's
// delegationRecordPdaFromDelegatedAccount / magicFeeVaultPdaFromValidator
// (the SDK package only lives in arena-program/node_modules, so the two
// PDAs are derived by hand here; seeds verified against the SDK source).
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
// Devnet ER validator identity (PINS.md Task 13: devnet.magicblock.app ==
// devnet-as.magicblock.app == MAS1…zk57). The magic fee vault is scoped to
// this validator, so a different ER deployment needs ARENA_ER_VALIDATOR set.
const DEFAULT_ER_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

const MARKET_ID = 0;
const DEFAULT_BOTS = "scalper-v1,rider-v1";
// Worst-case wait for an ER signature status before declaring the tick lost.
// The devnet ER confirms in well under a second; the 5s cap only bites while
// the program is mid-upgrade, and the crank loop retries next sweep anyway.
// Gap kept tight — this poll sits inside every tick sweep, so it directly
// stretches the ~2s cadence (500ms cost ~1 update per 15s bucket, measured).
const CONFIRM_POLLS = 25;
const CONFIRM_POLL_GAP_MS = 200;

// Persona ids are utf8 bytes zero-padded (or truncated) to 16 — the PDA seed
// is these exact bytes, so the encoding is part of the on-chain identity
// (same helper as scripts/arena/init-devnet.ts).
function personaId(name: string): Buffer {
  const buf = Buffer.alloc(16);
  buf.write(name, "utf8");
  return buf;
}

function loadCrankKeypair(): web3.Keypair {
  // Railway worker: the secret key rides in an env var (JSON byte array) —
  // there is no keypair file to mount. Local dev: file path, solana-CLI style.
  const inline = process.env.ARENA_CRANK_KEYPAIR?.trim();
  if (inline) {
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
  }
  const p =
    process.env.ARENA_CRANK_KEYPAIR_PATH ||
    path.join(homedir(), ".config/solana/id.json");
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))),
  );
}

// The IDL is gitignored build output, so it is read at runtime instead of
// imported statically (same deviation as init-devnet.ts / tick-once.ts).
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function buildRealCrankDeps(): Promise<CrankDeps> {
  const programId = process.env.ARENA_PROGRAM_ID;
  if (!programId) {
    throw new Error("ARENA_PROGRAM_ID not set (see .env.example)");
  }
  const erEndpoint =
    process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
  const botNames = (process.env.ARENA_BOTS || DEFAULT_BOTS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (botNames.length === 0) {
    throw new Error("ARENA_BOTS resolved to zero personas");
  }

  const payer = loadCrankKeypair();
  const er = new web3.Connection(erEndpoint, "confirmed");

  const idl = loadIdl();
  // The env program id is canonical (the IDL is local build output and could
  // carry a stale declared address after a rebuild).
  if (idl.address !== programId) {
    console.warn(
      `[arena] IDL address ${idl.address} != ARENA_PROGRAM_ID ${programId} — using the env value`,
    );
    idl.address = programId;
  }
  // Provider only builds instructions; sends go raw through `er` below.
  const provider = new anchor.AnchorProvider(er, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const marketPda = (marketId: number) =>
    web3.PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from([marketId])],
      program.programId,
    )[0];
  const botPubkeys = botNames.map((name) =>
    web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bot"), personaId(name)],
      program.programId,
    )[0].toBase58(),
  );
  console.log(
    `[arena] crank deps: program=${program.programId.toBase58()} er=${erEndpoint} payer=${payer.publicKey.toBase58()} bots=${botNames.join(",")}`,
  );

  const botMetas = (pubkeys: string[]) =>
    pubkeys.map((pk) => ({
      pubkey: new web3.PublicKey(pk),
      isSigner: false,
      isWritable: true,
    }));

  // tests/delegation.ts send pattern, websocket-free: sign with the crank
  // keypair against an ER blockhash, send raw with skipPreflight (delegated
  // accounts trip base-layer-style simulation), then poll for status.
  async function sendViaEr(tx: web3.Transaction): Promise<string> {
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const sig = await er.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    for (let i = 0; i < CONFIRM_POLLS; i++) {
      const status = (await er.getSignatureStatus(sig)).value;
      if (status?.err) {
        const logs = (
          await er.getTransaction(sig, { maxSupportedTransactionVersion: 0 })
        )?.meta?.logMessages;
        throw new Error(
          `tx ${sig} failed on ER: ${JSON.stringify(status.err)}\n${(logs ?? []).join("\n")}`,
        );
      }
      if (status?.confirmationStatus) return sig;
      await sleep(CONFIRM_POLL_GAP_MS);
    }
    throw new Error(
      `tx ${sig} not confirmed on ${erEndpoint} within ${(CONFIRM_POLLS * CONFIRM_POLL_GAP_MS) / 1000}s`,
    );
  }

  const listMarkets = async (): Promise<CrankMarket[]> => [
    // Env-driven single market for now; BTC/ETH arrive with their FEEDS rows.
    { marketId: MARKET_ID, botPubkeys },
  ];

  const sendTick = async (entry: TickPlanEntry): Promise<string> => {
    const feed = FEEDS[entry.marketId];
    if (!feed) {
      throw new Error(`no oracle feed configured for market ${entry.marketId}`);
    }
    const tx = await program.methods
      .tick(entry.marketId)
      .accountsPartial({
        config: configPda,
        marketState: marketPda(entry.marketId),
        feed,
      })
      .remainingAccounts(botMetas(entry.botPubkeys))
      .transaction();
    return sendViaEr(tx);
  };

  // commit_state is permissionless by design (it can only persist delegated
  // state, never mutate it), so the crank keypair works as payer even though
  // it is not the admin. magic_program/magic_context resolve from the IDL's
  // baked addresses. Since the magic_fee_vault migration (PINS.md
  // "magic_fee_vault commits") the intent bundle is paid by the delegated
  // crank-payer PDA — the crank keypair only pays the ER tx fee — so commits
  // are no longer capped at 10 per delegated account. Three extra accounts
  // ride along: the market's delegation record (validator source of truth),
  // the validator's fee vault, and the crank-payer PDA.
  const erValidator = new web3.PublicKey(
    process.env.ARENA_ER_VALIDATOR || DEFAULT_ER_VALIDATOR,
  );
  const [crankPayerPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("crank-payer")],
    program.programId,
  );
  const [marketDelegationRecord] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), marketPda(MARKET_ID).toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
  const [magicFeeVault] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("magic-fee-vault"), erValidator.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );

  const sendCommit = async (): Promise<string> => {
    const tx = await program.methods
      .commitState(MARKET_ID)
      .accountsPartial({
        payer: payer.publicKey,
        marketState: marketPda(MARKET_ID),
        delegationRecord: marketDelegationRecord,
        magicFeeVault,
        crankPayer: crankPayerPda,
      })
      .remainingAccounts(botMetas(botPubkeys))
      .transaction();
    return sendViaEr(tx);
  };

  return {
    ensureArenaLeaseTable,
    acquireArenaCrankLease,
    listMarkets,
    sendTick,
    sendCommit,
  };
}
