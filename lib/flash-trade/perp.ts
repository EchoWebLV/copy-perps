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
  // Gasless overrides — when set, fee payer is the gas wallet, and any
  // appendInstructions are added before the message is compiled.
  gaslessFeePayer?: PublicKey;
  appendInstructions?: TransactionInstruction[];
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

  // Crypto.1's perp markets are self-collateralized — the SOL/Long
  // market expects SOL collateral, BTC/Long expects BTC, etc. Calling
  // openPosition with USDC collateral against a SOL/Long market lookups
  // up market PDA (SOL, USDC, Long) which doesn't exist (Anchor 0xbc4
  // AccountNotInitialized). Use swapAndOpen so Flash swaps USDC->target
  // inside the tx and uses the target asset as collateral.
  const openData = await flash.swapAndOpen(
    targetSym,
    targetSym,
    COLLATERAL_SYMBOL,
    collateralWithFee,
    priceWithSlippage,
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
    ...(params.appendInstructions ?? []),
  ];

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const altsResult = await flash.getOrLoadAddressLookupTable(POOL_CONFIG);

  const payerKey = params.gaslessFeePayer ?? params.userPubkey;
  const message = new TransactionMessage({
    payerKey,
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
  gaslessFeePayer?: PublicKey;
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

  // Mirror the swapAndOpen path: position uses target as collateral, so
  // closing with closeAndSwap converts back to USDC for the user in the
  // same tx. Calling plain closePosition with collateral=USDC would hit
  // the same uninitialised-market error as the open side.
  const closeData = await flash.closeAndSwap(
    targetSym,
    COLLATERAL_SYMBOL,
    targetSym,
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

  const payerKey = params.gaslessFeePayer ?? params.userPubkey;
  const message = new TransactionMessage({
    payerKey,
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

export async function readPerpPosition(
  userPubkey: PublicKey,
  asset: string,
  side: "long" | "short",
): Promise<PerpPositionPnl | null> {
  const targetSym = asset.toUpperCase() as FlashPerpSymbol;
  const targetToken = POOL_CONFIG.tokens.find((t) => t.symbol === targetSym);
  const targetCustody = POOL_CONFIG.custodies.find(
    (c) => c.symbol === targetSym,
  );
  if (!targetToken || !targetCustody) return null;

  // Crypto.1 markets are self-collateralized — collateral custody = target.
  const sideEnum = (side === "long" ? Side.Long : Side.Short) as unknown as Side;
  const marketPk = POOL_CONFIG.getMarketPk(
    targetCustody.custodyAccount,
    targetCustody.custodyAccount,
    sideEnum,
  );
  const positionPk = POOL_CONFIG.getPositionFromMarketPk(userPubkey, marketPk);

  const flash = makeFlashClient(userPubkey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try {
    raw = await flash.program.account.position.fetch(positionPk);
  } catch {
    return null; // position PDA doesn't exist => no open position
  }
  if (!raw || raw.isActive === false) return null;

  const targetPrice = await fetchOraclePrice(targetToken.pythPriceId);
  const currentPriceUsd = priceToUsd(targetPrice);
  if (!currentPriceUsd || !Number.isFinite(currentPriceUsd)) return null;

  // sizeAmount: target-asset native units. Convert to UI units, multiply
  // by the live oracle price to get current notional in USD. PnL is the
  // delta vs. entry notional (sizeUsd is in micro-USD).
  const sizeAmountNative = BigInt(raw.sizeAmount.toString());
  if (sizeAmountNative === 0n) return null;
  const sizeUi = Number(sizeAmountNative) / 10 ** targetToken.decimals;
  const currentNotionalUsd = sizeUi * currentPriceUsd;
  const entryNotionalUsd = Number(raw.sizeUsd.toString()) / 1_000_000;
  const collateralUsd = Number(raw.collateralUsd.toString()) / 1_000_000;

  const pnlUsd =
    side === "long"
      ? currentNotionalUsd - entryNotionalUsd
      : entryNotionalUsd - currentNotionalUsd;
  const positionValueUsd = collateralUsd + pnlUsd;

  return {
    baseAssetAmount: raw.sizeAmount.toString(),
    side,
    unrealizedPnlUsd: pnlUsd,
    positionValueUsd,
  };
}
