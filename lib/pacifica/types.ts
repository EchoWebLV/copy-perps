// Pacifica REST + WS response shapes. Sourced from
// https://api.pacifica.fi/api/v1 and the official Python SDK.
// Field names mirror the API exactly so casts work without an
// intermediate mapper.

export interface PacificaMarketInfo {
  symbol: string;              // "SOL", "BTC", "ETH", ...
  base_decimals: number;
  quote_decimals: number;
  tick_size: string;           // decimal string
  min_amount: string;
  max_leverage_tiers: Array<{
    max_leverage: number;
    max_notional_usd: string;
  }>;
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
  id: string;                  // Pacifica position identifier
  symbol: string;
  side: "bid" | "ask";         // bid = long, ask = short
  amount: string;
  entry_price: string;
  margin: string | null;       // present only for isolated positions
  leverage: number;
  funding: string;
  isolated: boolean;
  unrealized_pnl: string;
  unrealized_pnl_percent: string;
  created_at: number;
  updated_at: number;
}

export interface PacificaAccountInfo {
  address: string;
  username: string | null;
  equity: string;
  available_balance: string;
  margin_used: string;
  positions: PacificaPosition[];
  fee_tier: string;
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
