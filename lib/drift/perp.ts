import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  BN,
  OrderType,
  PositionDirection,
  PRICE_PRECISION,
} from "@drift-labs/sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  makeDriftClientForUser,
  userHasDriftAccount,
  getConnection,
} from "./client";
import { USDC_MINT } from "@/lib/jupiter/constants";

const USDC_SPOT_MARKET_INDEX = 0;
const SUB_ACCOUNT_ID = 0;
const MAX_LEVERAGE = 20;
const MIN_USDC = 5;
const MAX_USDC = 1000;

export interface BuildOpenPerpResult {
  transaction: string; // base64 unsigned
  baseAssetAmount: string;
  notionalUsd: number;
  marketIndex: number;
  direction: "long" | "short";
  isFirstTimeUser: boolean;
}

/**
 * Build a single transaction that:
 *   - First-time users: initializes the Drift user account, deposits USDC,
 *     and places a market perp order — all in ~750 bytes (fits one tx).
 *   - Returning users: just deposits + places the order (or just places if
 *     user already has collateral and we want to keep it simple).
 *
 * For now we always re-deposit the trade's margin to keep accounting tidy
 * (one bet = one $X deposit + one position open). PnL accrues in Drift
 * collateral and can be withdrawn on close.
 */
export async function buildOpenPerpTx(params: {
  userPubkey: PublicKey;
  asset: string; // already validated against SUPPORTED_PERP_SYMBOLS upstream
  marketIndex: number;
  direction: "long" | "short";
  marginUsdc: number;
  whaleLeverage: number;
}): Promise<BuildOpenPerpResult> {
  if (params.marginUsdc < MIN_USDC || params.marginUsdc > MAX_USDC) {
    throw new Error(`amount must be between $${MIN_USDC} and $${MAX_USDC}`);
  }

  const drift = await makeDriftClientForUser(params.userPubkey);
  const isFirstTime = !(await userHasDriftAccount(params.userPubkey));

  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    params.userPubkey,
  );

  // USDC has 6 decimals → atomic = dollars × 1e6
  const depositAtomic = new BN(Math.floor(params.marginUsdc * 1_000_000));

  const ixs: TransactionInstruction[] = [];

  if (isFirstTime) {
    const { ixs: initIxs } =
      await drift.createInitializeUserAccountAndDepositCollateralIxs(
        depositAtomic,
        usdcAta,
        USDC_SPOT_MARKET_INDEX,
      );
    ixs.push(...initIxs);
  } else {
    const depositIx = await drift.getDepositInstruction(
      depositAtomic,
      USDC_SPOT_MARKET_INDEX,
      usdcAta,
      SUB_ACCOUNT_ID,
    );
    ixs.push(depositIx);
  }

  const leverage = Math.max(1, Math.min(MAX_LEVERAGE, params.whaleLeverage));
  const notionalUsd = params.marginUsdc * leverage;

  const oracleData = drift.getOracleDataForPerpMarket(params.marketIndex);
  const priceUsd = oracleData.price.toNumber() / PRICE_PRECISION.toNumber();
  if (!priceUsd || !Number.isFinite(priceUsd)) {
    throw new Error(
      `Could not read oracle price for perp market ${params.marketIndex}`,
    );
  }

  const sizeBaseUnits = notionalUsd / priceUsd;
  const baseAssetAmount = drift.convertToPerpPrecision(sizeBaseUnits);
  if (baseAssetAmount.lten(0)) {
    throw new Error("Computed base asset amount is non-positive");
  }

  const placeIx = await drift.getPlacePerpOrderIx(
    {
      orderType: OrderType.MARKET,
      marketIndex: params.marketIndex,
      direction:
        params.direction === "long"
          ? PositionDirection.LONG
          : PositionDirection.SHORT,
      baseAssetAmount,
    },
    SUB_ACCOUNT_ID,
    isFirstTime
      ? { isMakingNewAccount: true, depositMarketIndex: USDC_SPOT_MARKET_INDEX }
      : undefined,
  );
  ixs.push(placeIx);

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: params.userPubkey,
    recentBlockhash: blockhash,
  });
  ixs.forEach((ix) => tx.add(ix));

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    transaction: Buffer.from(serialized).toString("base64"),
    baseAssetAmount: baseAssetAmount.toString(),
    notionalUsd,
    marketIndex: params.marketIndex,
    direction: params.direction,
    isFirstTimeUser: isFirstTime,
  };
}
