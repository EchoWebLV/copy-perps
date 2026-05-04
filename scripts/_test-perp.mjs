// End-to-end direct test of the Flash perp open path using our actual
// buildOpenPerpTx wrapper. Bypasses Next.js / Privy.

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const SECRET = process.env.WALLET_SECRET;
if (!SECRET) {
  console.error("set WALLET_SECRET env");
  process.exit(1);
}
const SIDE = process.env.SIDE ?? "long";
const ASSET = process.env.ASSET ?? "SOL";
const STAKE_USD = Number(process.env.STAKE_USD ?? "5.5");
const ALLOW_SUBMIT = process.env.SUBMIT === "1";

const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
console.log("wallet:", kp.publicKey.toBase58());

// Use tsx-style runtime for our TS sources via esbuild-register? Simpler:
// load helpers via a transient ts->js bridge. Since we're already in
// node ESM, import the compiled-into-deps flash-sdk directly and replicate
// the same call our /api/bet/perp does.
const {
  PerpetualsClient,
  PoolConfig,
  Side,
  Privilege,
  OraclePrice,
  uiDecimalsToNative,
  pythPriceServiceConnection,
  createBackupOracleInstruction,
} = await import("flash-sdk");
const anchor = await import("@coral-xyz/anchor");
const AnchorProvider = anchor.AnchorProvider;
const BN = (await import("bn.js")).default;
const web3 = await import("@solana/web3.js");

const POOL_CONFIG = PoolConfig.fromIdsByName("Crypto.1", "mainnet-beta");

const conn = new Connection(RPC, "confirmed");

const sol = await conn.getBalance(kp.publicKey);
console.log(`SOL: ${(sol / 1e9).toFixed(6)}`);
const accs = await conn.getParsedTokenAccountsByOwner(kp.publicKey, {
  programId: new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
});
let usdc = 0;
for (const a of accs.value) {
  const i = a.account.data.parsed.info;
  if (i.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
    usdc = parseFloat(i.tokenAmount.uiAmountString);
  }
}
console.log(`USDC: ${usdc}`);

// Read-only wallet shim — Flash never asks us to sign during build.
class ReadOnlyWallet {
  constructor(pk) { this.publicKey = pk; }
  async signTransaction() { throw new Error("read-only"); }
  async signAllTransactions() { throw new Error("read-only"); }
}

const provider = new AnchorProvider(
  conn,
  new ReadOnlyWallet(kp.publicKey),
  { commitment: "confirmed", preflightCommitment: "confirmed", skipPreflight: true },
);

const flash = new PerpetualsClient(
  provider,
  POOL_CONFIG.programId,
  POOL_CONFIG.perpComposibilityProgramId,
  POOL_CONFIG.fbNftRewardProgramId,
  POOL_CONFIG.rewardDistributionProgram.programId,
  { prioritizationFee: 0 },
);

const targetToken = POOL_CONFIG.tokens.find((t) => t.symbol === ASSET);
const usdcToken = POOL_CONFIG.tokens.find((t) => t.symbol === "USDC");

const feeds = await pythPriceServiceConnection.getLatestPriceFeeds([targetToken.pythPriceId]);
const p = feeds[0].getPriceUnchecked();
const targetPrice = new OraclePrice({
  price: new BN(p.price),
  exponent: new BN(p.expo),
  confidence: new BN(p.conf),
  timestamp: new BN(p.publishTime),
});
const priceUsd = p.price * Math.pow(10, p.expo);
console.log(`${ASSET} price: $${priceUsd.toFixed(2)}`);

const sideEnum = SIDE === "long" ? Side.Long : Side.Short;
const priceWithSlippage = flash.getPriceAfterSlippage(true, new BN(800), targetPrice, sideEnum);

const collateralWithFee = uiDecimalsToNative(STAKE_USD.toString(), usdcToken.decimals);
const leverage = 2; // arbitrary for test
const notionalUsd = STAKE_USD * leverage;
const sizeBaseUnits = notionalUsd / priceUsd;
const size = uiDecimalsToNative(sizeBaseUnits.toFixed(targetToken.decimals), targetToken.decimals);
console.log(`size: ${size.toString()} (${sizeBaseUnits.toFixed(6)} ${ASSET}), leverage ${leverage}x`);

console.log(`\n=== Step 1: swapAndOpen ===`);
const openData = await flash.swapAndOpen(
  ASSET,
  ASSET,
  "USDC",
  collateralWithFee,
  priceWithSlippage,
  size,
  sideEnum,
  POOL_CONFIG,
  Privilege.None,
);
console.log(`instructions: ${openData.instructions.length}, additionalSigners: ${openData.additionalSigners.length}`);

const backupOracleIxs = await createBackupOracleInstruction(POOL_CONFIG.poolAddress.toBase58());
const cuLimit = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
const cuPrice = web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50 });
const ixs = [cuLimit, cuPrice, ...backupOracleIxs, ...openData.instructions];

const { blockhash } = await conn.getLatestBlockhash("confirmed");
const altsResult = await flash.getOrLoadAddressLookupTable(POOL_CONFIG);
const message = new web3.TransactionMessage({
  payerKey: kp.publicKey,
  recentBlockhash: blockhash,
  instructions: ixs,
}).compileToV0Message(altsResult.addressLookupTables);
const tx = new VersionedTransaction(message);
if (openData.additionalSigners.length) tx.sign(openData.additionalSigners);
tx.sign([kp]);

if (!ALLOW_SUBMIT) {
  console.log(`\n=== Step 2: simulate ===`);
  const sim = await conn.simulateTransaction(tx, { commitment: "confirmed" });
  console.log("sim err:", sim.value.err);
  console.log("sim CU:", sim.value.unitsConsumed);
  console.log("sim logs (last 20):");
  for (const l of (sim.value.logs ?? []).slice(-20)) console.log("  " + l);
  process.exit(0);
}

console.log(`\n=== Step 2: broadcast ===`);
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
console.log("sig:", sig);
console.log("explorer:", `https://solscan.io/tx/${sig}`);
const conf = await conn.confirmTransaction(sig, "confirmed");
console.log("confirmed err:", conf.value.err);
