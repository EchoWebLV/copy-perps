// lib/flash-v2/types.ts
import type { VersionedTransaction } from "@solana/web3.js";

export type Side = "long" | "short";
export type OrderType = "market" | "limit";

/** Layer a tx must be submitted on (GOTCHAS: mixing fails). */
export type RpcLayer = "base" | "er";

export interface UnsignedTx {
  tx: VersionedTransaction;
  layer: RpcLayer;
}

export interface Quote {
  entryPriceUi?: number;
  liquidationPriceUi?: number;
  feeUsdUi?: number;
  /** Documented API typo — kept verbatim, do not rename. */
  youRecieveUsdUi?: number | null;
}

export interface VenuePosition {
  positionKey: string;
  symbol: string;
  side: Side;
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  leverage: number;
}

export interface VenueBalance {
  availableUsdc: number;
  ledgerDeposits: number;
  basketDebits: number;
  basketPendingCredits: number;
}

export interface VenueMarket {
  symbol: string;
  maxLeverage: number;
}

export interface OnboardStep {
  name: "init-basket" | "init-deposit-ledger" | "delegate-basket";
  unsigned: UnsignedTx;
}
