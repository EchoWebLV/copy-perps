// arena-program/programs/arena/src/state.rs
use anchor_lang::prelude::*;

pub const RING_LEN: usize = 64;
pub const TAPE_LEN: usize = 64;
pub const MAX_POSITIONS: usize = 4;
pub const MAX_MARKETS: usize = 8;
pub const BPS: u64 = 10_000;
pub const MIN_STAKE_MICRO: u64 = 1_000_000; // $1
pub const MIN_STRAT_CANDLES: usize = 12;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Bucket {
    pub open: u64,
    pub high: u64,
    pub low: u64,
    pub close: u64,
    pub start_ts: i64,
    pub updates: u32,
    pub path_len: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct MarketCfg {
    pub market_id: u8,
    pub feed: Pubkey,
    pub active: bool,
}

#[account]
#[derive(InitSpace)]
pub struct ArenaConfig {
    pub admin: Pubkey,
    pub fee_bps: u16,          // taker fee on notional, default 6
    pub spread_bps: u16,       // entry/exit haircut, default 5
    pub maint_buffer_bps: u16, // default 500 (5% of the 1/lev distance)
    pub max_age_secs: i64,     // oracle staleness guard, default 10
    pub bucket_secs: i64,      // default 15
    pub markets: [MarketCfg; MAX_MARKETS],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub market_id: u8,
    pub last_price: u64,
    pub last_publish_ts: i64,
    pub head: u16, // index of the in-progress bucket
    pub ring: [Bucket; RING_LEN],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Position {
    pub active: bool,
    pub market_id: u8,
    pub side: u8,
    pub entry_price: u64,
    pub stake_micro: u64,
    pub leverage: u16,
    pub opened_ts: i64,
    pub ticks_held: u32,
    pub liq_price: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct TapeEntry {
    pub ts: i64,
    pub market_id: u8,
    pub action: u8,
    pub price: u64,
    pub stake_micro: u64,
    pub conviction: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct StrategyParams {
    pub read_span: u8, // 1 or 4 base buckets per strategy candle
    pub breakout_bps: u16,
    pub activity_mult_bps: u16,
    pub trend_filter: bool,
    pub stake_frac_bps: u16,
    pub leverage: u16,
    pub max_hold_ticks: u32,
    pub exit_favorable_bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct Bot {
    pub persona_id: [u8; 16],
    pub params: StrategyParams,
    pub balance_micro: u64,
    pub positions: [Position; MAX_POSITIONS],
    pub trades: u32,
    pub wins: u32,
    pub gross_pnl_micro: i64,
    pub fees_micro: u64,
    pub equity_high_micro: u64,
    pub seq: u64,
    pub tape_head: u16,
    pub tape: [TapeEntry; TAPE_LEN],
    pub bump: u8,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accounts_fit_single_init() {
        // 8-byte discriminator + InitSpace must stay under the 10,240-byte CPI init cap.
        assert!(8 + ArenaConfig::INIT_SPACE <= 10_240);
        assert!(8 + MarketState::INIT_SPACE <= 10_240);
        assert!(8 + Bot::INIT_SPACE <= 10_240);
    }
}
