// Pacifica REST + WS response shapes. Sourced from
// https://api.pacifica.fi/api/v1 and the official Python SDK.
// Field names mirror the API exactly so casts work without an
// intermediate mapper.

export interface PacificaMarketInfo {
  symbol: string;              // "SOL", "BTC", "ETH", ...
  base_asset: string;
  tick_size: string;           // decimal string
  min_tick: string;
  max_tick: string;
  lot_size: string;
  max_leverage: number;        // flat per-market cap (e.g. 50 for BTC)
  isolated_only: boolean;
  min_order_size: string;
  max_order_size: string;
  funding_rate: string;
  next_funding_rate: string;
  created_at: number;
  instrument_type: string;     // e.g. "perpetual"
}

export interface PacificaLeaderboardEntry {
  address: string;
  username: string | null;
  pnl_1d: string;
  pnl_7d: string;
  pnl_30d: string;
  pnl_all_time: string;
  equity_current: string;
  oi_current: string;
  volume_1d: string;
  volume_7d: string;
  volume_30d: string;
  volume_all_time: string;
}

export interface PacificaPosition {
  symbol: string;
  side: "bid" | "ask";         // bid = long, ask = short
  amount: string;
  entry_price: string;
  margin: string;              // "0" for cross-margin positions
  funding: string;             // accumulated funding payments (signed decimal)
  isolated: boolean;
  liquidation_price: string;   // can be negative when far from liquidation
  created_at: number;
  updated_at: number;
  // Note: Pacifica does NOT surface per-position `id`, `leverage`, or
  // computed unrealized PnL via this endpoint. Identify positions by
  // (account, symbol, side). Leverage is account-level (cross) or
  // implied by margin/notional (isolated).
}

// Row shape returned by GET /positions/history?account=... — one row
// per fill (an order may produce several maker/taker fills). The pnl
// field is the realized PnL contribution of THAT FILL specifically;
// to get per-order PnL group rows by order_id and sum.
export interface PacificaPositionHistoryRow {
  history_id: number;
  order_id: number;
  client_order_id: string | null;
  symbol: string;
  amount: string;
  price: string;
  entry_price: string;
  fee: string;                 // negative = rebate, positive = paid
  spot_fee: string | null;
  pnl: string;                 // realized PnL of this fill (decimal string)
  event_type: string;          // "fulfill_maker", "fulfill_taker", etc.
  side: string;                // "open_long" | "close_long" | "open_short" | "close_short" | ...
  created_at: number;          // ms epoch
  cause: string;
}

export interface PacificaAccountInfo {
  balance: string;
  fee_level: number;
  maker_fee: string;
  taker_fee: string;
  account_equity: string;
  cross_account_equity: string;
  spot_market_value: string;
  spot_collateral: string;
  available_to_spend: string;
  available_to_withdraw: string;
  pending_balance: string;
  pending_interest: string;
  total_margin_used: string;
  cross_mmr: string;
  positions_count: number;
  orders_count: number;
  stop_orders_count: number;
  spot_balances: unknown[];
  updated_at: number;
}

export interface PacificaOrderFill {
  order_id: string;
  client_order_id: string | null;
  symbol: string;
  side: "bid" | "ask";
  filled_amount: string;
  avg_fill_price: string;
  fee: string;
  status: string;
  created_at: number;
}

export interface PacificaSignedRequest<P> {
  account: string;
  agent_wallet?: string;
  signature: string;
  timestamp: number;
  expiry_window: number;
  // ...payload fields flatten in here
  payload: P;
}
