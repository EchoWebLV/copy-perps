import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  OraclePrice,
  Side,
  Privilege,
  uiDecimalsToNative,
  pythPriceServiceConnection,
  createBackupOracleInstruction,
} from "flash-sdk";
import {
  POOL_CONFIG,
  getConnection,
  makeFlashClient,
  type FlashPerpSymbol,
} from "./client";

const COLLATERAL_SYMBOL = "USDC";
const SLIPPAGE_BPS = 800; // 0.8% — matches Flash's own UI default
const MIN_USDC = 5;
const MAX_USDC = 1000;
const MAX_LEVERAGE = 20;

async function fetchOraclePrice(pythPriceId: string): Promise<OraclePrice> {
  const feeds = await pythPriceServiceConnection.getLatestPriceFeeds([
    pythPriceId,
  ]);
  if (!feeds || feeds.length === 0) {
    throw new Error(`Pyth: no feed for ${pythPriceId}`);
  }
  const p = feeds[0].getPriceUnchecked();
  return new OraclePrice({
    price: new BN(p.price),
    exponent: new BN(p.expo),
    confidence: new BN(p.conf),
    timestamp: new BN(p.publishTime),
  });
}

function priceToUsd(p: OraclePrice): number {
  // Pyth exponents are negative (e.g. SOL price 12345678 with expo -6 = $12.345678).
  const expo = p.exponent.toNumber();
  return p.price.toNumber() * Math.pow(10, expo);
}

export interface BuildOpenPerpResult {
  transaction: string;
  baseAssetAmount: string;
  notionalUsd: number;
  marketIndex: number;
  direction: "long" | "short";
  isFirstTimeUser: boolean;
}

export async function buildOpenPerpTx(params: {
  userPubkey: PublicKey;
  asset: string;
  marketIndex: number;
  direction: "long" | "short";
  marginUsdc: number;
  whaleLeverage: number;
}): Promise<BuildOpenPerpResult> {
  if (params.marginUsdc < MIN_USDC || params.marginUsdc > MAX_USDC) {
    throw new Error(`amount must be between $${MIN_USDC} and $${MAX_USDC}`);
  }

  const flash = makeFlashClient(params.userPubkey);
  const targetSym = params.asset.toUpperCase() as FlashPerpSymbol;

  const targetToken = POOL_CONFIG.tokens.find((t) => t.symbol === targetSym);
  const usdcToken = POOL_CONFIG.tokens.find(
    (t) => t.symbol === COLLATERAL_SYMBOL,
  );
  if (!targetToken || !usdcToken) {
    throw new Error(`pool config missing ${targetSym} or USDC`);
  }

  const targetPrice = await fetchOraclePrice(targetToken.pythPriceId);
  const targetPriceUsd = priceToUsd(targetPrice);
  if (!targetPriceUsd || !Number.isFinite(targetPriceUsd)) {
    throw new Error(`bad oracle price for ${targetSym}: ${targetPriceUsd}`);
  }

  const side = params.direction === "long" ? Side.Long : Side.Short;
  const priceWithSlippage = flash.getPriceAfterSlippage(
    true,
    new BN(SLIPPAGE_BPS),
    targetPrice,
    side as unknown as Side,
  );

  const collateralWithFee = uiDecimalsToNative(
    params.marginUsdc.toString(),
    usdcToken.decimals,
  );

  const leverage = Math.max(1, Math.min(MAX_LEVERAGE, params.whaleLeverage));
  const notionalUsd = params.marginUsdc * leverage;
  const sizeBaseUnits = notionalUsd / targetPriceUsd;
  const size = uiDecimalsToNative(
    sizeBaseUnits.toFixed(targetToken.decimals),
    targetToken.decimals,
  );
  if (size.lten(0)) throw new Error("computed size is non-positive");

  const openData = await flash.openPosition(
    targetSym,
    COLLATERAL_SYMBOL,
    priceWithSlippage,
    collateralWithFee,
    size,
    side as unknown as Side,
    POOL_CONFIG,
    Privilege.None as unknown as Privilege,
  );

  const backupOracleIxs = await createBackupOracleInstruction(
    POOL_CONFIG.poolAddress.toBase58(),
  );

  // Flash's openPosition is heavy — needs ~600k CU per their own UI.
  const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
  const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 50,
  });

  const ixs: TransactionInstruction[] = [
    cuLimit,
    cuPrice,
    ...backupOracleIxs,
    ...openData.instructions,
  ];

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const altsResult = await flash.getOrLoadAddressLookupTable(POOL_CONFIG);

  const message = new TransactionMessage({
    payerKey: params.userPubkey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(altsResult.addressLookupTables);

  const tx = new VersionedTransaction(message);

  // Pre-sign with any ephemeral signers the SDK created (temp accounts,
  // PDAs, etc.). Privy will add the user's signature on top, preserving
  // these partial sigs.
  if (openData.additionalSigners?.length) {
    tx.sign(openData.additionalSigners);
  }

  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    baseAssetAmount: size.toString(),
    notionalUsd,
    marketIndex: params.marketIndex,
    direction: params.direction,
    // Flash doesn't have a "first time user" account-init step like Drift
    // did — positions are opened directly. Always false for the response.
    isFirstTimeUser: false,
  };
}

export interface BuildClosePerpResult {
  transaction: string;
  expectedProceedsUsd: number;
  closedSide: "long" | "short";
  baseAssetAmount: string;
}

export async function buildClosePerpTx(params: {
  userPubkey: PublicKey;
  asset: string;
  side: "long" | "short";
}): Promise<BuildClosePerpResult> {
  const flash = makeFlashClient(params.userPubkey);
  const targetSym = params.asset.toUpperCase() as FlashPerpSymbol;

  const targetToken = POOL_CONFIG.tokens.find((t) => t.symbol === targetSym);
  if (!targetToken) throw new Error(`pool config missing ${targetSym}`);

  const targetPrice = await fetchOraclePrice(targetToken.pythPriceId);

  const side = params.side === "long" ? Side.Long : Side.Short;
  const priceWithSlippage = flash.getPriceAfterSlippage(
    false,
    new BN(SLIPPAGE_BPS),
    targetPrice,
    side as unknown as Side,
  );

  const closeData = await flash.closePosition(
    targetSym,
    COLLATERAL_SYMBOL,
    priceWithSlippage,
    side as unknown as Side,
    POOL_CONFIG,
    Privilege.None as unknown as Privilege,
  );

  const backupOracleIxs = await createBackupOracleInstruction(
    POOL_CONFIG.poolAddress.toBase58(),
  );

  const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
  const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 50,
  });

  const ixs: TransactionInstruction[] = [
    cuLimit,
    cuPrice,
    ...backupOracleIxs,
    ...closeData.instructions,
  ];

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const altsResult = await flash.getOrLoadAddressLookupTable(POOL_CONFIG);

  const message = new TransactionMessage({
    payerKey: params.userPubkey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(altsResult.addressLookupTables);

  const tx = new VersionedTransaction(message);
  if (closeData.additionalSigners?.length) {
    tx.sign(closeData.additionalSigners);
  }

  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    // Live PnL read from on-chain position requires a fetch + math we
    // don't currently do. Returning 0 is a placeholder; the perp close
    // confirm route doesn't write proceedsUsdc anyway, so this isn't
    // displayed downstream. Real live-PnL is a follow-up.
    expectedProceedsUsd: 0,
    closedSide: params.side,
    baseAssetAmount: "0",
  };
}

export interface PerpPositionPnl {
  baseAssetAmount: string;
  side: "long" | "short";
  unrealizedPnlUsd: number;
  positionValueUsd: number;
}

// Stub for now — Flash position-state reads need PositionAccount.fetch
// against a PDA derived from (user, market, collateral, side). Wiring
// that properly is a follow-up; for now the portfolio shows perps
// without live PnL (same as a closed bet). Returns null = no exposure.
export async function readPerpPosition(
  _userPubkey: PublicKey,
  _asset: string,
  _side: "long" | "short",
): Promise<PerpPositionPnl | null> {
  return null;
}
