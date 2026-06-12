// scripts/arena/tick-once.ts
//
// Task 13 smoke: send ONE tick(market 0) to the devnet Ephemeral Rollup and
// decode the MarketState read back through the ER. Run twice — the second run
// must show the head bucket's updates/pathLen advancing.
//
// Run from the repo root:
//   npx tsx --env-file=.env.local scripts/arena/tick-once.ts
//
// Env:
//   ARENA_ER_ENDPOINT        — ER RPC (default https://devnet.magicblock.app;
//                              devnet-as.magicblock.app is the same validator,
//                              identity MAS1Dt9...zk57 — verified 2026-06-11)
//   ARENA_ADMIN_KEYPAIR_PATH — fee-payer keypair (default ~/.config/solana/id.json;
//                              the base-layer wallet works as ER fee payer,
//                              PINS.md Spike A)
//
// ER send pattern per tests/delegation.ts: blockhash from the ER connection,
// skipPreflight true. The read decodes raw bytes with the layout tables from
// state.rs (no anchor client needed): account data = 8-byte discriminator +
// MarketState{ last_price u64 @0x00, last_publish_ts i64 @0x08,
// ring [Bucket;64] @0x10, head u16 @0xE10 } with Bucket{ open u64 @0x00,
// high @0x08, low @0x10, close @0x18, start_ts i64 @0x20, path_len u64 @0x28,
// updates u32 @0x30 } (56 B each). Prices are 1e8-scaled.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";

const SOL_FEED = new web3.PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);
// Market + roster follow the env (ARENA_MARKET_ID / ARENA_BOTS) so this smoke
// works against any market generation — defaults match the original Task 13
// deployment (market 0, v1 bots).
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
  try {
    return JSON.parse(readFileSync(idlPath, "utf8"));
  } catch {
    throw new Error(
      `IDL not found at ${idlPath} — run \`~/.avm/bin/anchor-1.0.2 build\` in arena-program/ first`,
    );
  }
}

const BUCKET_SIZE = 56;
const RING_OFFSET = 0x10;
const HEAD_OFFSET = 0xe10;

function decodeMarketState(data: Buffer) {
  const s = data.subarray(8); // skip the anchor discriminator
  const head = s.readUInt16LE(HEAD_OFFSET);
  const b = s.subarray(RING_OFFSET + head * BUCKET_SIZE);
  const px = (raw: bigint) => Number(raw) / 1e8;
  return {
    lastPrice: px(s.readBigUInt64LE(0x00)),
    lastPublishTs: Number(s.readBigInt64LE(0x08)),
    head,
    bucket: {
      open: px(b.readBigUInt64LE(0x00)),
      high: px(b.readBigUInt64LE(0x08)),
      low: px(b.readBigUInt64LE(0x10)),
      close: px(b.readBigUInt64LE(0x18)),
      startTs: Number(b.readBigInt64LE(0x20)),
      pathLen: px(b.readBigUInt64LE(0x28)),
      updates: b.readUInt32LE(0x30),
    },
  };
}

async function main() {
  const erEndpoint =
    process.env.ARENA_ER_ENDPOINT || "https://devnet.magicblock.app";
  const er = new web3.Connection(erEndpoint, "confirmed");
  const payer = loadKeypair();
  // Provider only builds the instruction; nothing is sent through it.
  const provider = new anchor.AnchorProvider(er, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const program = new Program(loadIdl(), provider);

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [marketPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([MARKET_ID])],
    program.programId,
  );
  const botMetas = BOT_NAMES.map((name) => ({
    pubkey: web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bot"), Buffer.from(personaId(name))],
      program.programId,
    )[0],
    isSigner: false,
    isWritable: true,
  }));

  const tx = await program.methods
    .tick(MARKET_ID)
    .accountsPartial({
      config: configPda,
      marketState: marketPda,
      feed: SOL_FEED,
    })
    .remainingAccounts(botMetas)
    .transaction();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(payer);

  const sig = await er.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  // Poll instead of websocket confirm: one-shot script, no handles to leak.
  let status: web3.SignatureStatus | null = null;
  for (let i = 0; i < 30; i++) {
    status = (await er.getSignatureStatus(sig)).value;
    if (status?.confirmationStatus) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!status?.confirmationStatus || status.err) {
    const logs = (
      await er.getTransaction(sig, { maxSupportedTransactionVersion: 0 })
    )?.meta?.logMessages;
    throw new Error(
      `tick ${sig} did not confirm on ${erEndpoint}: err=${JSON.stringify(status?.err ?? "timeout")}\n${(logs ?? []).join("\n")}`,
    );
  }
  console.log(`tick(${MARKET_ID}) landed on ${erEndpoint}: ${sig}`);

  const info = await er.getAccountInfo(marketPda);
  if (!info) throw new Error(`MarketState ${marketPda.toBase58()} not on ER`);
  console.log(decodeMarketState(info.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
