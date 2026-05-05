// Usage: TREASURY_PRIVATE_KEY=<bs58> npm run refuel:gas
//
// Manual operator script. Reads Gas Wallet's SOL balance; if below the
// refuel trigger, swaps a fixed amount of Treasury USDC -> SOL via
// Jupiter and transfers the resulting SOL to Gas Wallet.
//
// TREASURY_PRIVATE_KEY is required at invocation time (NOT stored in
// .env.local). It's only used by this script and wiped from the process
// when it exits.
//
// Confirms before signing.

import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import readline from "node:readline";

const REFUEL_TRIGGER_SOL = 1.0;
const REFUEL_AMOUNT_USDC = 200;
const RPC = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
if (!RPC) throw new Error("NEXT_PUBLIC_HELIUS_RPC_URL is required");

const gasSecret = process.env.GAS_WALLET_PRIVATE_KEY;
if (!gasSecret) throw new Error("GAS_WALLET_PRIVATE_KEY is required");
const gasKp = Keypair.fromSecretKey(bs58.decode(gasSecret));

const treasurySecret = process.env.TREASURY_PRIVATE_KEY;
if (!treasurySecret) {
  throw new Error(
    "TREASURY_PRIVATE_KEY is required (paste at invocation; not stored)",
  );
}
const treasuryKp = Keypair.fromSecretKey(bs58.decode(treasurySecret));

const conn = new Connection(RPC, "confirmed");

const lamports = await conn.getBalance(gasKp.publicKey, "confirmed");
const sol = lamports / 1_000_000_000;
console.log(`Gas Wallet (${gasKp.publicKey.toBase58()}): ${sol.toFixed(4)} SOL`);

if (sol >= REFUEL_TRIGGER_SOL) {
  console.log(`Above trigger (${REFUEL_TRIGGER_SOL} SOL); nothing to do.`);
  process.exit(0);
}

console.log(
  `Below trigger. Swap $${REFUEL_AMOUNT_USDC} USDC from Treasury (${treasuryKp.publicKey.toBase58()}) → SOL and transfer to Gas Wallet?`,
);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const confirm = await new Promise((r) => rl.question("Type 'yes' to proceed: ", r));
rl.close();
if (confirm.trim() !== "yes") {
  console.log("Aborted.");
  process.exit(1);
}

// 1. Quote USDC → SOL via Jupiter.
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const wsolMint = "So11111111111111111111111111111111111111112";
const inAmount = REFUEL_AMOUNT_USDC * 1_000_000;

const quoteRes = await fetch(
  `https://lite-api.jup.ag/swap/v1/quote?inputMint=${usdcMint}&outputMint=${wsolMint}&amount=${inAmount}&slippageBps=50`,
);
if (!quoteRes.ok) throw new Error(`quote: ${quoteRes.status} ${await quoteRes.text()}`);
const quote = await quoteRes.json();
console.log(
  `Quote: ${REFUEL_AMOUNT_USDC} USDC → ${(Number(quote.outAmount) / 1e9).toFixed(4)} SOL`,
);

// 2. Build swap tx (Treasury is signer + fee payer here — Treasury holds the USDC).
const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: treasuryKp.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  }),
});
if (!swapRes.ok) throw new Error(`swap: ${swapRes.status} ${await swapRes.text()}`);
const { swapTransaction } = await swapRes.json();

const swapTx = VersionedTransaction.deserialize(
  Buffer.from(swapTransaction, "base64"),
);
swapTx.sign([treasuryKp]);
const swapSig = await conn.sendRawTransaction(swapTx.serialize(), {
  skipPreflight: false,
});
console.log(`Swap submitted: ${swapSig}`);
await conn.confirmTransaction(swapSig, "confirmed");
console.log("Swap confirmed.");

// 3. Treasury now holds the SOL. Transfer it to Gas Wallet, leaving a small float behind.
const treasuryLamports = await conn.getBalance(treasuryKp.publicKey, "confirmed");
const transferLamports = treasuryLamports - 5_000_000; // keep 0.005 SOL float in Treasury
if (transferLamports <= 0) throw new Error("Treasury SOL too low after swap");

const { blockhash } = await conn.getLatestBlockhash("confirmed");
const transferIx = SystemProgram.transfer({
  fromPubkey: treasuryKp.publicKey,
  toPubkey: gasKp.publicKey,
  lamports: transferLamports,
});
const message = new TransactionMessage({
  payerKey: treasuryKp.publicKey,
  recentBlockhash: blockhash,
  instructions: [transferIx],
}).compileToV0Message();
const transferTx = new VersionedTransaction(message);
transferTx.sign([treasuryKp]);
const transferSig = await conn.sendRawTransaction(transferTx.serialize());
console.log(`Transfer submitted: ${transferSig}`);
await conn.confirmTransaction(transferSig, "confirmed");
const newBal = (await conn.getBalance(gasKp.publicKey, "confirmed")) / 1e9;
console.log(`Done. New Gas Wallet balance: ${newBal.toFixed(4)} SOL`);

