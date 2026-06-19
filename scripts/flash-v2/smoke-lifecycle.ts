// scripts/flash-v2/smoke-lifecycle.ts
//
// Manual devnet smoke for the Flash v2 venue foundation. Drives:
//   onboard (basket/ledger/delegate) -> deposit -> open -> close
// signing each returned unsigned tx with a local keypair and submitting to the
// correct layer (base vs ER). Run:
//
//   FLASH_V2_CLUSTER=devnet \
//   FLASH_V2_USDC_MINT=<devnet-usdc-mint> \
//   FLASH_V2_KEYPAIR=~/.config/solana/flash-v2-devnet.json \
//   npx tsx --env-file=.env.local scripts/flash-v2/smoke-lifecycle.ts
//
// Do NOT run against mainnet. Record the resulting signatures in
// docs/superpowers/flash-v2-surface-notes.md when executed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { flashV2Venue } from "../../lib/flash-v2/venue";
import { getConnection } from "../../lib/flash-v2/rpc";
import { FLASH_V2_USDC_MINT } from "../../lib/flash-v2/constants";
import type { UnsignedTx } from "../../lib/flash-v2/types";

function loadKeypair(): Keypair {
  const p =
    process.env.FLASH_V2_KEYPAIR ??
    path.join(homedir(), ".config/solana/flash-v2-devnet.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function signSubmit(u: UnsignedTx, kp: Keypair): Promise<string> {
  const conn = getConnection(u.layer);
  const tx = u.tx as VersionedTransaction;
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const kp = loadKeypair();
  const owner = kp.publicKey.toBase58();
  const venue = flashV2Venue();
  console.log(`owner ${owner}`);

  const steps = await venue.ensureOnboarded(owner);
  for (const s of steps) {
    console.log(`onboard ${s.name} -> ${await signSubmit(s.unsigned, kp)}`);
  }

  const dep = await venue.deposit({ owner, amountUsdc: 5, tokenMint: FLASH_V2_USDC_MINT });
  console.log(`deposit -> ${await signSubmit(dep, kp)}`);

  const open = await venue.openPosition({
    owner,
    symbol: "SOL",
    collateralUsd: 5,
    leverage: 2,
    side: "long",
    orderType: "market",
  });
  console.log(`open -> ${await signSubmit(open.unsigned, kp)} (quote ${JSON.stringify(open.quote)})`);

  const positions = await venue.getPositions(owner);
  console.log(`positions: ${JSON.stringify(positions)}`);
  const pos = positions[0];
  if (!pos) {
    console.warn(
      "WARNING: no positions returned after open — CLOSE LEG SKIPPED. " +
        "Verify the /owner/{owner} positionMetrics shape against the live API.",
    );
  }
  if (pos) {
    const close = await venue.closePosition({
      owner,
      symbol: pos.symbol,
      side: pos.side,
      closeUsd: pos.sizeUsd,
    });
    console.log(`close -> ${await signSubmit(close.unsigned, kp)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
