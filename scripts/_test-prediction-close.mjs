// Close the open prediction position via DELETE /positions/{positionPubkey}.

import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const SECRET = process.env.WALLET_SECRET;
const POSITION = process.env.POSITION;
if (!SECRET || !POSITION) {
  console.error("set WALLET_SECRET and POSITION");
  process.exit(1);
}
const ALLOW_SUBMIT = process.env.SUBMIT === "1";

const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
const owner = kp.publicKey.toBase58();
console.log("wallet:", owner);
console.log("position:", POSITION);

const conn = new Connection(RPC, "confirmed");

const r = await fetch(
  `https://api.jup.ag/prediction/v1/positions/${POSITION}`,
  {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerPubkey: owner }),
  },
);
const txt = await r.text();
console.log(`status: ${r.status}`);
if (!r.ok) {
  console.error("body:", txt);
  process.exit(1);
}
const closed = JSON.parse(txt);
console.log("order summary:", {
  contracts: closed.order?.contracts,
  newAvgPriceUsd: closed.order?.newAvgPriceUsd,
  orderCostUsd: closed.order?.orderCostUsd,
  newPayoutUsd: closed.order?.newPayoutUsd,
  newSizeUsd: closed.order?.newSizeUsd,
});
if (!closed.transaction) { console.error("no tx"); process.exit(1); }

const txBytes = Buffer.from(closed.transaction, "base64");
const tx = VersionedTransaction.deserialize(txBytes);
tx.sign([kp]);

if (!ALLOW_SUBMIT) {
  const sim = await conn.simulateTransaction(tx, { commitment: "confirmed" });
  console.log("sim err:", sim.value.err);
  console.log("sim CU:", sim.value.unitsConsumed);
  for (const l of (sim.value.logs ?? []).slice(-10)) console.log("  " + l);
  process.exit(0);
}

const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
console.log("sig:", sig);
console.log("explorer:", `https://solscan.io/tx/${sig}`);
const conf = await conn.confirmTransaction(sig, "confirmed");
console.log("confirmed err:", conf.value.err);
