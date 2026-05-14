// Phoenix Eternal REST API response shapes. Sourced from
// https://docs.phoenix.trade/api/* (specifically /trader/{authority}/state
// and /exchange/markets). Field names mirror the API exactly so we can
// cast responses without an intermediate mapper.

export interface PhoenixMarketInfo {
  symbol: string;            // "SOL", "BTC", "ETH", ...
  baseDecimals: number;
  quoteDecimals: number;
  minOrderSize: number;
  tickSize: number;
  maxLeverage: number;       // per the active tier (no positions = top tier)
}

export interface PhoenixOpenPosition {
  market: string;
  side: "long" | "short";
  baseAmount: number;        // signed, in base-asset units
  notionalUsd: number;
  entryPrice: number;
  liquidationPrice: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  leverage: number;
  positionPubkey: string;
  openedAtSlot: number;
}

export interface PhoenixTraderState {
  authority: string;
  collateralUsdc: number;
  effectiveCollateralUsdc: number;
  positions: PhoenixOpenPosition[];
  hasActiveTrader: boolean;  // false if account was never opened on Phoenix
  slot: number;
}

export interface PhoenixTradeRow {
  market: string;
  side: "long" | "short";
  baseAmount: number;
  priceUsd: number;
  feeUsd: number;
  realizedPnlUsd: number;
  filledAt: string;          // ISO8601
}

// Response shape for /v1/ix/place-isolated-market-order. The exact JSON
// keys are confirmed at implementation time by running the endpoint in
// dev; this type names the conceptual fields we know must be present.
export interface PhoenixIxResponse {
  instructions: Array<{
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;            // base64
  }>;
  addressLookupTables: string[]; // ALT account addresses (Phoenix uses them)
  computeUnitsEstimate?: number;
}
