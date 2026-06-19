// scripts/flash-v2/smoke-session.ts
//
// Manual devnet smoke for the Flash v2 SESSION-KEY path. Drives:
//   onboard -> deposit -> createSessionV2 -> session-signed open -> close -> revoke
// using a local funded keypair as the user wallet (authority) and an ephemeral
// session keypair the "server" would custody. Run:
//
//   FLASH_V2_CLUSTER=devnet \
//   FLASH_V2_USDC_MINT=<devnet-usdc-mint> \
//   FLASH_V2_KEYPAIR=~/.config/solana/flash-v2-devnet.json \
//   npx tsx --env-file=.env.local scripts/flash-v2/smoke-session.ts
//
// Do NOT run against mainnet. This resolves the session notes §9 unknowns
// (createSessionV2 account auto-resolution, ER RPC URL, on-chain readback,
// session-signed trade landing). Record the resulting signatures in
// docs/superpowers/flash-v2-session-surface-notes.md when executed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { flashV2Venue } from "../../lib/flash-v2/venue";
import { getConnection } from "../../lib/flash-v2/rpc";
import { FLASH_V2_USDC_MINT, DEFAULT_SESSION_TTL_SECONDS } from "../../lib/flash-v2/constants";
import {
  buildCreateSessionTx,
  buildRevokeSessionTx,
  signTradeWithSession,
  submitErTx,
} from "../../lib/flash-v2/session";
import type { UnsignedTx } from "../../lib/flash-v2/types";

function loadKeypair(): Keypair {
  const p =
    process.env.FLASH_V2_KEYPAIR ??
    path.join(homedir(), ".config/solana/flash-v2-devnet.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

/** Sign a Flash-built versioned tx with `kp` and submit to its layer (base/ER). */
async function submitVersioned(u: UnsignedTx, kp: Keypair): Promise<string> {
  const conn = getConnection(u.layer);
  const tx = u.tx as VersionedTransaction;
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Add the authority signature to a base-chain legacy tx and submit. */
async function submitLegacyBase(tx: Transaction, authority: Keypair): Promise<string> {
  const conn = getConnection("base");
  tx.partialSign(authority); // session signer already co-signed createSessionV2
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const authority = loadKeypair();
  const owner = authority.publicKey.toBase58();
  const venue = flashV2Venue();
  console.log(`owner ${owner}`);

  // 1. Onboard + fund the basket (base chain), signed by the user wallet.
  for (const s of await venue.ensureOnboarded(owner)) {
    console.log(`onboard ${s.name} -> ${await submitVersioned(s.unsigned, authority)}`);
  }
  const dep = await venue.deposit({ owner, amountUsdc: 5, tokenMint: FLASH_V2_USDC_MINT });
  console.log(`deposit -> ${await submitVersioned(dep, authority)}`);

  // 2. Create a session (base chain). Server custodies sessionKp; the user
  //    wallet authorizes by signing authority+feePayer.
  const sessionKp = Keypair.generate();
  const signer = sessionKp.publicKey.toBase58();
  const validUntilSec = Math.floor(Date.now() / 1000) + DEFAULT_SESSION_TTL_SECONDS;
  const { tx: createTx, sessionToken } = await buildCreateSessionTx({
    authority: owner,
    sessionSigner: sessionKp,
    validUntilSec,
    connection: getConnection("base"),
  });
  console.log(`create-session ${sessionToken} -> ${await submitLegacyBase(createTx, authority)}`);

  const onChain = await getConnection("base").getAccountInfo(new PublicKey(sessionToken));
  if (!onChain) {
    console.warn(
      "WARNING: session token account not found after createSessionV2 — the PDA seed " +
        "derivation or account set is wrong. Stop and re-check session notes §3/§9.",
    );
  } else {
    console.log(`session token live on base (owner ${onChain.owner.toBase58()})`);
  }

  // 3. Server-driven open: sign with the SESSION key, submit to the ER.
  const session = { signer, sessionToken };
  const open = await venue.openPosition({
    owner,
    symbol: "SOL",
    collateralUsd: 5,
    leverage: 2,
    side: "long",
    orderType: "market",
    session,
  });
  const openSig = await submitErTx(
    signTradeWithSession(open.unsigned.tx as VersionedTransaction, sessionKp.secretKey),
  );
  console.log(`session-open -> ${openSig} (quote ${JSON.stringify(open.quote)})`);

  const positions = await venue.getPositions(owner);
  console.log(`positions: ${JSON.stringify(positions)}`);
  const pos = positions[0];
  if (!pos) {
    console.warn(
      "WARNING: no positions after a session-signed open — the trade did NOT land. " +
        "Likely a silent owner-signing fallback (bad signer/sessionToken) or wrong ER RPC. " +
        "CLOSE LEG SKIPPED.",
    );
  } else {
    const close = await venue.closePosition({
      owner,
      symbol: pos.symbol,
      side: pos.side,
      closeUsd: pos.sizeUsd,
      session,
    });
    const closeSig = await submitErTx(
      signTradeWithSession(close.unsigned.tx as VersionedTransaction, sessionKp.secretKey),
    );
    console.log(`session-close -> ${closeSig}`);
  }

  // 4. Revoke the session (base chain), signed by the user wallet.
  const revokeTx = await buildRevokeSessionTx({
    authority: owner,
    sessionSigner: signer,
    connection: getConnection("base"),
  });
  console.log(`revoke-session -> ${await submitLegacyBase(revokeTx, authority)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
