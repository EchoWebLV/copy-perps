// Convert any jupUSD residue in the wallet back to USDC.
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const SECRET = process.env.WALLET_SECRET;
if (!SECRET) { console.error("set WALLET_SECRET"); process.exit(1); }

const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
const owner = kp.publicKey.toBase58();
console.log("wallet:", owner);

const conn = new Connection(RPC, "confirmed");
const accs = await conn.getParsedTokenAccountsByOwner(kp.publicKey, {
  programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
});
let jupUsd = 0n;
for (const a of accs.value) {
  const i = a.account.data.parsed.info;
  if (i.mint === "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD") {
    jupUsd = BigInt(i.tokenAmount.amount);
  }
}
console.log("jupUSD atomic:", jupUsd.toString());
if (jupUsd === 0n) { console.log("nothing to swap"); process.exit(0); }

const qs = new URLSearchParams({
  inputMint: "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: jupUsd.toString(),
  slippageBps: "50",
});
const quote = await (await fetch(`https://lite-api.jup.ag/swap/v1/quote?${qs}`)).json();
console.log(`quote: in=${quote.inAmount} out=${quote.outAmount} impact=${quote.priceImpactPct}`);

const swap = await (await fetch("https://lite-api.jup.ag/swap/v1/swap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: owner,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: "high", maxLamports: 1_000_000 } },
  }),
})).json();

const txBytes = Buffer.from(swap.swapTransaction, "base64");
const tx = VersionedTransaction.deserialize(txBytes);
tx.sign([kp]);
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
console.log("sig:", sig);
console.log("explorer:", `https://solscan.io/tx/${sig}`);
const conf = await conn.confirmTransaction(sig, "confirmed");
console.log("confirmed err:", conf.value.err);
