// Smoke-test that readPerpPosition can find and price the user's open
// BTC 20x LONG position.
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const OWNER = process.env.OWNER ?? "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";
const ASSET = process.env.ASSET ?? "BTC";
const SIDE = process.env.SIDE ?? "long";

const {
  PerpetualsClient, PoolConfig, Side,
  pythPriceServiceConnection,
} = await import("flash-sdk");
const anchor = await import("@coral-xyz/anchor");
const AnchorProvider = anchor.AnchorProvider;
const web3 = await import("@solana/web3.js");

const POOL_CONFIG = PoolConfig.fromIdsByName("Crypto.1", "mainnet-beta");
const conn = new Connection(RPC, "confirmed");

class ReadOnlyWallet {
  constructor(pk) { this.publicKey = pk; }
  async signTransaction() { throw new Error("read-only"); }
  async signAllTransactions() { throw new Error("read-only"); }
}
const ownerPk = new PublicKey(OWNER);
const provider = new AnchorProvider(conn, new ReadOnlyWallet(ownerPk),
  { commitment: "confirmed", preflightCommitment: "confirmed", skipPreflight: true });
const flash = new PerpetualsClient(provider, POOL_CONFIG.programId,
  POOL_CONFIG.perpComposibilityProgramId, POOL_CONFIG.fbNftRewardProgramId,
  POOL_CONFIG.rewardDistributionProgram.programId, { prioritizationFee: 0 });

const targetCustody = POOL_CONFIG.custodies.find((c) => c.symbol === ASSET);
const sideEnum = SIDE === "long" ? Side.Long : Side.Short;
const marketPk = POOL_CONFIG.getMarketPk(targetCustody.custodyAccount, targetCustody.custodyAccount, sideEnum);
const positionPk = POOL_CONFIG.getPositionFromMarketPk(ownerPk, marketPk);
console.log("position PDA:", positionPk.toBase58());

let raw;
try {
  raw = await flash.program.account.position.fetch(positionPk);
} catch (e) {
  console.log("position not found:", e.message);
  process.exit(0);
}
console.log("isActive:", raw.isActive);
console.log("sizeAmount:", raw.sizeAmount.toString());
console.log("sizeUsd:", raw.sizeUsd.toString(), `(= $${(Number(raw.sizeUsd.toString())/1e6).toFixed(2)})`);
console.log("collateralUsd:", raw.collateralUsd.toString(), `(= $${(Number(raw.collateralUsd.toString())/1e6).toFixed(2)})`);

const targetToken = POOL_CONFIG.tokens.find((t) => t.symbol === ASSET);
const feeds = await pythPriceServiceConnection.getLatestPriceFeeds([targetToken.pythPriceId]);
const p = feeds[0].getPriceUnchecked();
const priceUsd = p.price * Math.pow(10, p.expo);
console.log(`current ${ASSET} price: $${priceUsd.toFixed(2)}`);

const sizeUi = Number(raw.sizeAmount.toString()) / 10 ** targetToken.decimals;
const currentNotional = sizeUi * priceUsd;
const entryNotional = Number(raw.sizeUsd.toString()) / 1e6;
const pnl = SIDE === "long" ? currentNotional - entryNotional : entryNotional - currentNotional;
console.log(`size ui: ${sizeUi} ${ASSET}`);
console.log(`entry notional: $${entryNotional.toFixed(2)}`);
console.log(`current notional: $${currentNotional.toFixed(2)}`);
console.log(`unrealized pnl: $${pnl.toFixed(2)}`);
console.log(`position value (collateral + pnl): $${(Number(raw.collateralUsd.toString())/1e6 + pnl).toFixed(2)}`);
