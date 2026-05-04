// Closes the SOL Long position on the test wallet via closeAndSwap so
// the user gets USDC back. Mirrors lib/flash-trade/perp.ts buildClosePerpTx.

import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const SECRET = process.env.WALLET_SECRET;
if (!SECRET) { console.error("set WALLET_SECRET"); process.exit(1); }
const ASSET = process.env.ASSET ?? "SOL";
const SIDE = process.env.SIDE ?? "long";
const ALLOW_SUBMIT = process.env.SUBMIT === "1";

const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
console.log("wallet:", kp.publicKey.toBase58());

const {
  PerpetualsClient, PoolConfig, Side, Privilege, OraclePrice,
  pythPriceServiceConnection, createBackupOracleInstruction,
} = await import("flash-sdk");
const anchor = await import("@coral-xyz/anchor");
const AnchorProvider = anchor.AnchorProvider;
const BN = (await import("bn.js")).default;
const web3 = await import("@solana/web3.js");

const POOL_CONFIG = PoolConfig.fromIdsByName("Crypto.1", "mainnet-beta");
const conn = new Connection(RPC, "confirmed");

class ReadOnlyWallet {
  constructor(pk) { this.publicKey = pk; }
  async signTransaction() { throw new Error("read-only"); }
  async signAllTransactions() { throw new Error("read-only"); }
}
const provider = new AnchorProvider(conn, new ReadOnlyWallet(kp.publicKey),
  { commitment: "confirmed", preflightCommitment: "confirmed", skipPreflight: true });
const flash = new PerpetualsClient(provider, POOL_CONFIG.programId,
  POOL_CONFIG.perpComposibilityProgramId, POOL_CONFIG.fbNftRewardProgramId,
  POOL_CONFIG.rewardDistributionProgram.programId, { prioritizationFee: 0 });

const targetToken = POOL_CONFIG.tokens.find((t) => t.symbol === ASSET);
const feeds = await pythPriceServiceConnection.getLatestPriceFeeds([targetToken.pythPriceId]);
const p = feeds[0].getPriceUnchecked();
const targetPrice = new OraclePrice({
  price: new BN(p.price), exponent: new BN(p.expo),
  confidence: new BN(p.conf), timestamp: new BN(p.publishTime),
});
const sideEnum = SIDE === "long" ? Side.Long : Side.Short;
const priceWithSlippage = flash.getPriceAfterSlippage(false, new BN(800), targetPrice, sideEnum);

console.log(`\n=== closeAndSwap ${ASSET} ${SIDE} -> USDC ===`);
const closeData = await flash.closeAndSwap(
  ASSET, "USDC", ASSET, priceWithSlippage, sideEnum, POOL_CONFIG, Privilege.None,
);
console.log(`instructions: ${closeData.instructions.length}, signers: ${closeData.additionalSigners.length}`);

const backupOracleIxs = await createBackupOracleInstruction(POOL_CONFIG.poolAddress.toBase58());
const cuLimit = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
const cuPrice = web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50 });
const ixs = [cuLimit, cuPrice, ...backupOracleIxs, ...closeData.instructions];

const { blockhash } = await conn.getLatestBlockhash("confirmed");
const altsResult = await flash.getOrLoadAddressLookupTable(POOL_CONFIG);
const message = new web3.TransactionMessage({
  payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs,
}).compileToV0Message(altsResult.addressLookupTables);
const tx = new VersionedTransaction(message);
if (closeData.additionalSigners.length) tx.sign(closeData.additionalSigners);
tx.sign([kp]);

if (!ALLOW_SUBMIT) {
  const sim = await conn.simulateTransaction(tx, { commitment: "confirmed" });
  console.log("sim err:", sim.value.err);
  console.log("sim CU:", sim.value.unitsConsumed);
  console.log("last 8 logs:");
  for (const l of (sim.value.logs ?? []).slice(-8)) console.log("  " + l);
  process.exit(0);
}
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
console.log("sig:", sig);
console.log("explorer:", `https://solscan.io/tx/${sig}`);
const conf = await conn.confirmTransaction(sig, "confirmed");
console.log("confirmed err:", conf.value.err);
