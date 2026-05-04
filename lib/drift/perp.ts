import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BN,
  OrderType,
  PositionDirection,
  PRICE_PRECISION,
  QUOTE_PRECISION,
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
    // The bundled `createInitializeUserAccountAndDepositCollateralIxs`
    // includes an `initializeSignedMsgUserOrders` instruction whose
    // discriminator the deployed Drift program currently rejects with
    // InstructionFallbackNotFound. Use the lower-level helper that only
    // emits initializeUserStats (if missing) + initializeUser.
    const [initIxs] = await drift.getInitializeUserAccountIxs(SUB_ACCOUNT_ID);
    ixs.push(...initIxs);

    const depositIx = await drift.getDepositInstruction(
      depositAtomic,
      USDC_SPOT_MARKET_INDEX,
      usdcAta,
      SUB_ACCOUNT_ID,
      false, // reduceOnly
      false, // userInitialized=false — user account is being created in this same tx
    );
    ixs.push(depositIx);
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

  console.log(
    `[drift open] firstTime=${isFirstTime} ixs=${ixs.length} discriminators:`,
  );
  ixs.forEach((ix, i) => {
    console.log(
      `  ${i}: prog=${ix.programId.toString().slice(0, 8)} disc=${ix.data.slice(0, 8).toString("hex")} keys=${ix.keys.length} dataLen=${ix.data.length}`,
    );
  });

  await simulateAndLog(tx, "open");

  return {
    transaction: Buffer.from(serialized).toString("base64"),
    baseAssetAmount: baseAssetAmount.toString(),
    notionalUsd,
    marketIndex: params.marketIndex,
    direction: params.direction,
    isFirstTimeUser: isFirstTime,
  };
}

async function simulateAndLog(tx: Transaction, label: string): Promise<void> {
  try {
    const conn = getConnection();
    const sim = await conn.simulateTransaction(tx, undefined, [
      tx.feePayer!,
    ]);
    if (sim.value.err) {
      console.error(`[drift sim:${label}] ERROR:`, JSON.stringify(sim.value.err));
      console.error(`[drift sim:${label}] LOGS:`);
      sim.value.logs?.forEach((l, i) =>
        console.error(`  ${i.toString().padStart(2)}: ${l}`),
      );
    } else {
      console.log(`[drift sim:${label}] OK · units consumed:`, sim.value.unitsConsumed);
    }
  } catch (e) {
    console.warn(`[drift sim:${label}] simulate threw:`, e);
  }
}

export interface PerpPositionPnl {
  baseAssetAmount: string;
  side: "long" | "short";
  unrealizedPnlUsd: number;
  positionValueUsd: number;
}

/**
 * Read the user's current position for a given Drift perp market and
 * compute its unrealized PnL. Returns null if the user has no open
 * exposure on that market.
 */
export async function readPerpPosition(
  userPubkey: PublicKey,
  marketIndex: number,
): Promise<PerpPositionPnl | null> {
  const drift = await makeDriftClientForUser(userPubkey);
  try {
    await drift.addUser(0);
  } catch {
    /* already subscribed, or user PDA doesn't exist on chain */
  }

  let driftUser;
  try {
    driftUser = drift.getUser(0);
  } catch {
    return null;
  }
  await driftUser.fetchAccounts();

  const position = driftUser.getPerpPosition(marketIndex);
  if (!position || position.baseAssetAmount.eqn(0)) return null;

  const upnl = driftUser.getUnrealizedPNL(true, marketIndex);
  const upnlUsd = upnl.toNumber() / QUOTE_PRECISION.toNumber();

  const oracleData = drift.getOracleDataForPerpMarket(marketIndex);
  const priceUsd = oracleData.price.toNumber() / PRICE_PRECISION.toNumber();
  const sizeBase =
    Math.abs(position.baseAssetAmount.toNumber()) /
    drift.convertToPerpPrecision(1).toNumber();
  const positionValueUsd = sizeBase * priceUsd;

  return {
    baseAssetAmount: position.baseAssetAmount.toString(),
    side: position.baseAssetAmount.isNeg() ? "short" : "long",
    unrealizedPnlUsd: upnlUsd,
    positionValueUsd,
  };
}

export interface BuildClosePerpResult {
  transaction: string;
  expectedProceedsUsd: number;
  closedSide: "long" | "short";
  baseAssetAmount: string;
}

/**
 * Build a single transaction that flattens the user's position on the
 * given market via a reduce-only market order in the opposite direction.
 *
 * Note: collateral stays inside Drift after close — withdrawing back to
 * the wallet is a separate step, intentional for now so users can roll
 * proceeds into another bet without paying ATA + tx overhead twice.
 */
export async function buildClosePerpTx(params: {
  userPubkey: PublicKey;
  marketIndex: number;
}): Promise<BuildClosePerpResult> {
  const drift = await makeDriftClientForUser(params.userPubkey);
  try {
    await drift.addUser(0);
  } catch {
    /* already subscribed */
  }

  const driftUser = drift.getUser(0);
  await driftUser.fetchAccounts();

  const position = driftUser.getPerpPosition(params.marketIndex);
  if (!position || position.baseAssetAmount.eqn(0)) {
    throw new Error("No open position to close on this market");
  }

  const closingDirection = position.baseAssetAmount.isNeg()
    ? PositionDirection.LONG
    : PositionDirection.SHORT;
  const closingSide: "long" | "short" = position.baseAssetAmount.isNeg()
    ? "short"
    : "long";

  const baseAmountToClose = position.baseAssetAmount.abs();

  const closeIx = await drift.getPlacePerpOrderIx(
    {
      orderType: OrderType.MARKET,
      marketIndex: params.marketIndex,
      direction: closingDirection,
      baseAssetAmount: baseAmountToClose,
      reduceOnly: true,
    },
    0,
  );

  const upnl = driftUser.getUnrealizedPNL(true, params.marketIndex);
  const expectedProceedsUsd = upnl.toNumber() / QUOTE_PRECISION.toNumber();

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: params.userPubkey,
    recentBlockhash: blockhash,
  });
  tx.add(closeIx);

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  await simulateAndLog(tx, "close");

  return {
    transaction: Buffer.from(serialized).toString("base64"),
    expectedProceedsUsd,
    closedSide: closingSide,
    baseAssetAmount: baseAmountToClose.toString(),
  };
}

