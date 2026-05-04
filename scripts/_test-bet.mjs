// End-to-end direct test:
//   reads wallet, builds Jupiter Prediction order, signs, submits.
// No Next.js / Privy in the path — this isolates whether the bug is
// in our app or in the underlying Jupiter API integration.

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const SECRET = process.env.WALLET_SECRET;
if (!SECRET) {
  console.error("set WALLET_SECRET env");
  process.exit(1);
}
const MARKET_ID = process.env.MARKET_ID ?? "POLY-561229";
const STAKE_USD = Number(process.env.STAKE_USD ?? "5.5");
const ALLOW_SUBMIT = process.env.SUBMIT === "1";

const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
const owner = kp.publicKey.toBase58();
console.log("wallet:", owner);

const conn = new Connection(RPC, "confirmed");
const sol = await conn.getBalance(kp.publicKey);
console.log(`SOL: ${(sol / 1e9).toFixed(6)}`);

const accs = await conn.getParsedTokenAccountsByOwner(kp.publicKey, {
  programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
});
let usdc = 0;
for (const a of accs.value) {
  const i = a.account.data.parsed.info;
  if (i.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
    usdc = parseFloat(i.tokenAmount.uiAmountString);
  }
}
console.log(`USDC: ${usdc}`);

if (usdc < STAKE_USD) {
  console.error(`insufficient USDC for $${STAKE_USD} stake`);
  process.exit(1);
}

console.log(`\n=== Step 1: createOrder for ${MARKET_ID} @ $${STAKE_USD} ===`);
const createBody = {
  ownerPubkey: owner,
  marketId: MARKET_ID,
  isYes: true,
  isBuy: true,
  depositAmount: String(Math.floor(STAKE_USD * 1_000_000)),
  depositMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
console.log("body:", createBody);
const createRes = await fetch(
  "https://api.jup.ag/prediction/v1/orders",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  },
);
const createTxt = await createRes.text();
console.log(`status: ${createRes.status}`);
if (!createRes.ok) {
  console.error("body:", createTxt);
  process.exit(1);
}
const created = JSON.parse(createTxt);
console.log("order summary:", {
  orderPubkey: created.order?.orderPubkey,
  positionPubkey: created.order?.positionPubkey,
  contracts: created.order?.contracts,
  newAvgPriceUsd: created.order?.newAvgPriceUsd,
  orderCostUsd: created.order?.orderCostUsd,
  estimatedTotalFeeUsd: created.order?.estimatedTotalFeeUsd,
  newPayoutUsd: created.order?.newPayoutUsd,
});
console.log("hasTransaction:", !!created.transaction);
console.log("requiredSigners:", created.requiredSigners);

if (!created.transaction) {
  console.error("no transaction returned");
  process.exit(1);
}

console.log(`\n=== Step 2: sign tx ===`);
const txBytes = Buffer.from(created.transaction, "base64");
const tx = VersionedTransaction.deserialize(txBytes);
tx.sign([kp]);
console.log("signed; signature[0]:", bs58.encode(tx.signatures[0]).slice(0, 16) + "…");

if (!ALLOW_SUBMIT) {
  console.log("\n=== Step 3: simulate (SUBMIT=1 to actually broadcast) ===");
  const sim = await conn.simulateTransaction(tx, { commitment: "confirmed" });
  console.log("sim err:", sim.value.err);
  console.log("sim CU:", sim.value.unitsConsumed);
  console.log("sim logs:");
  for (const l of sim.value.logs ?? []) console.log("  " + l);
  process.exit(0);
}

console.log(`\n=== Step 3: broadcast ===`);
const sig = await conn.sendRawTransaction(tx.serialize(), {
  skipPreflight: false,
  maxRetries: 3,
});
console.log("sig:", sig);
console.log("explorer:", `https://solscan.io/tx/${sig}`);
const conf = await conn.confirmTransaction(sig, "confirmed");
console.log("confirmed err:", conf.value.err);
