// arena-program/programs/arena/src/state.rs
//
// MarketState and Bot are Anchor zero_copy (bytemuck Pod) accounts. The Borsh
// deserialize path built the full ring/tape arrays on a single SBF stack frame
// (MarketState ~7232 B, Bot ~4608 B against the 4096 B limit — measured, see
// PINS.md "Task 10 BLOCKED"), and Boxing did not help because the overflow is
// in the callee `try_deserialize_unchecked` frame. zero_copy maps the account
// bytes in place via AccountLoader, so no deserialize frame exists at all.
//
// Pod rules shape these structs:
//   - no bool (Position.active / StrategyParams.trend_filter are u8 0/1),
//   - no implicit padding: fields ordered widest-first with explicit `_pad`
//     arrays where alignment demands.
// Every layout below is documented byte-for-byte because the Phase-2 UI
// decodes these accounts client-side, and because @coral-xyz/anchor 0.32.1
// ignores the IDL `serialization: bytemuck` flag and decodes with plain Borsh
// field order — with zero implicit padding the Borsh and repr(C) byte layouts
// coincide, so both decoders agree. Keep it that way: any field change must
// preserve "no implicit padding" (locked by the layout tests below).
use anchor_lang::prelude::*;

pub const RING_LEN: usize = 64;
pub const TAPE_LEN: usize = 64;
pub const MAX_POSITIONS: usize = 4;
pub const MAX_MARKETS: usize = 8;
pub const BPS: u64 = 10_000;
pub const MIN_STAKE_MICRO: u64 = 1_000_000; // $1
pub const MIN_STRAT_CANDLES: usize = 12;

/// One 15s OHLC bucket. 56 bytes, align 8.
///
/// | offset | size | field        |
/// |--------|------|--------------|
/// | 0x00   | 8    | open: u64    |
/// | 0x08   | 8    | high: u64    |
/// | 0x10   | 8    | low: u64     |
/// | 0x18   | 8    | close: u64   |
/// | 0x20   | 8    | start_ts: i64|
/// | 0x28   | 8    | path_len: u64|
/// | 0x30   | 4    | updates: u32 |
/// | 0x34   | 4    | _pad         |
#[zero_copy]
#[derive(Default)]
pub struct Bucket {
    pub open: u64,
    pub high: u64,
    pub low: u64,
    pub close: u64,
    pub start_ts: i64,
    pub path_len: u64,
    pub updates: u32,
    pub _pad: [u8; 4],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct MarketCfg {
    pub market_id: u8,
    pub feed: Pubkey,
    pub active: bool,
}

// ArenaConfig stays a regular Borsh account: it is small (8 + 327 bytes), its
// deserialize frame is nowhere near the SBF limit, and MarketCfg keeps bool.
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

// Lamport reservoir that pays commit_state's Magic intent bundle once
// delegated to the ER (the magic_fee_vault + delegated-fee-payer pattern —
// see lib.rs commit_state and PINS.md "magic_fee_vault commits"). The data
// payload is just the bump: what matters is that the account is a
// program-owned PDA (delegatable via the er-sdk `del` constraint, exactly
// like rewards-delegated-vrf's reward_list payer) that holds lamports.
// Borsh like ArenaConfig — 9 bytes, no SBF stack concern.
#[account]
#[derive(InitSpace)]
pub struct CrankPayer {
    pub bump: u8,
}

/// 3608 bytes, align 8. Account data = 8-byte discriminator + this.
///
/// | offset | size | field                  |
/// |--------|------|------------------------|
/// | 0x00   | 8    | last_price: u64        |
/// | 0x08   | 8    | last_publish_ts: i64   |
/// | 0x10   | 3584 | ring: [Bucket; 64]     |
/// | 0xE10  | 2    | head: u16              |
/// | 0xE12  | 1    | market_id: u8          |
/// | 0xE13  | 1    | bump: u8               |
/// | 0xE14  | 4    | _pad                   |
#[account(zero_copy)]
pub struct MarketState {
    pub last_price: u64,
    pub last_publish_ts: i64,
    pub ring: [Bucket; RING_LEN],
    pub head: u16, // index of the in-progress bucket
    pub market_id: u8,
    pub bump: u8,
    pub _pad: [u8; 4],
}

/// One paper position. 48 bytes, align 8.
///
/// | offset | size | field            |
/// |--------|------|------------------|
/// | 0x00   | 8    | entry_price: u64 |
/// | 0x08   | 8    | stake_micro: u64 |
/// | 0x10   | 8    | opened_ts: i64   |
/// | 0x18   | 8    | liq_price: u64   |
/// | 0x20   | 4    | ticks_held: u32  |
/// | 0x24   | 2    | leverage: u16    |
/// | 0x26   | 1    | active: u8 (0/1) |
/// | 0x27   | 1    | market_id: u8    |
/// | 0x28   | 1    | side: u8         |
/// | 0x29   | 7    | _pad             |
#[zero_copy]
#[derive(Default)]
pub struct Position {
    pub entry_price: u64,
    pub stake_micro: u64,
    pub opened_ts: i64,
    pub liq_price: u64,
    pub ticks_held: u32,
    pub leverage: u16,
    pub active: u8, // bool is not Pod: 0 = closed, 1 = open
    pub market_id: u8,
    pub side: u8, // 0 = long, 1 = short
    pub _pad: [u8; 7],
}

/// One tape event. 32 bytes, align 8.
///
/// | offset | size | field            |
/// |--------|------|------------------|
/// | 0x00   | 8    | ts: i64          |
/// | 0x08   | 8    | price: u64       |
/// | 0x10   | 8    | stake_micro: u64 |
/// | 0x18   | 1    | market_id: u8    |
/// | 0x19   | 1    | action: u8       |
/// | 0x1A   | 1    | conviction: u8   |
/// | 0x1B   | 5    | _pad             |
#[zero_copy]
#[derive(Default)]
pub struct TapeEntry {
    pub ts: i64,
    pub price: u64,
    pub stake_micro: u64,
    pub market_id: u8,
    pub action: u8, // 0 OPEN_LONG, 1 OPEN_SHORT, 2 EXIT_FAVORABLE, 3 EXIT_MAX_HOLD, 4 LIQUIDATED
    pub conviction: u8,
    pub _pad: [u8; 5],
}

/// Strategy knobs. 16 bytes, align 4 — deliberately ZERO padding so the Borsh
/// encoding of this struct (it doubles as the `init_bot` instruction arg) is
/// byte-identical to its repr(C) layout.
///
/// | offset | size | field                   |
/// |--------|------|-------------------------|
/// | 0x00   | 4    | max_hold_ticks: u32     |
/// | 0x04   | 2    | breakout_bps: u16       |
/// | 0x06   | 2    | activity_mult_bps: u16  |
/// | 0x08   | 2    | stake_frac_bps: u16     |
/// | 0x0A   | 2    | leverage: u16           |
/// | 0x0C   | 2    | exit_favorable_bps: u16 |
/// | 0x0E   | 1    | read_span: u8           |
/// | 0x0F   | 1    | trend_filter: u8 (0/1)  |
#[zero_copy]
#[derive(Default)]
pub struct StrategyParams {
    pub max_hold_ticks: u32,
    pub breakout_bps: u16,
    pub activity_mult_bps: u16,
    pub stake_frac_bps: u16,
    pub leverage: u16,
    pub exit_favorable_bps: u16,
    pub read_span: u8,    // 1 or 4 base buckets per strategy candle
    pub trend_filter: u8, // bool is not Pod: 0 = off, 1 = on
}

// StrategyParams doubles as the `init_bot` instruction arg, which needs Borsh.
// The derive macros can't be used here: under the idl-build feature
// #[derive(AnchorSerialize)] generates an IdlBuild impl that collides with the
// one #[zero_copy] already generates (E0119). Because the struct has ZERO
// padding (locked by zero_copy_layouts_locked), its Borsh encoding is
// byte-identical to its repr(C) memory layout, so the manual impls are just
// the raw bytes.
impl AnchorSerialize for StrategyParams {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(bytemuck::bytes_of(self))
    }
}

impl AnchorDeserialize for StrategyParams {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let mut buf = [0u8; core::mem::size_of::<Self>()];
        reader.read_exact(&mut buf)?;
        Ok(bytemuck::pod_read_unaligned(&buf))
    }
}

/// 2328 bytes, align 8. Account data = 8-byte discriminator + this.
///
/// | offset | size | field                       |
/// |--------|------|-----------------------------|
/// | 0x00   | 8    | balance_micro: u64          |
/// | 0x08   | 8    | gross_pnl_micro: i64        |
/// | 0x10   | 8    | fees_micro: u64             |
/// | 0x18   | 8    | equity_high_micro: u64      |
/// | 0x20   | 8    | seq: u64                    |
/// | 0x28   | 192  | positions: [Position; 4]    |
/// | 0xE8   | 2048 | tape: [TapeEntry; 64]       |
/// | 0x8E8  | 16   | params: StrategyParams      |
/// | 0x8F8  | 16   | persona_id: [u8; 16]        |
/// | 0x908  | 4    | trades: u32                 |
/// | 0x90C  | 4    | wins: u32                   |
/// | 0x910  | 2    | tape_head: u16              |
/// | 0x912  | 1    | bump: u8                    |
/// | 0x913  | 5    | _pad                        |
#[account(zero_copy)]
pub struct Bot {
    pub balance_micro: u64,
    pub gross_pnl_micro: i64,
    pub fees_micro: u64,
    pub equity_high_micro: u64,
    pub seq: u64,
    pub positions: [Position; MAX_POSITIONS],
    pub tape: [TapeEntry; TAPE_LEN],
    pub params: StrategyParams,
    pub persona_id: [u8; 16],
    pub trades: u32,
    pub wins: u32,
    pub tape_head: u16,
    pub bump: u8,
    pub _pad: [u8; 5],
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{align_of, size_of};

    #[test]
    fn accounts_fit_single_init() {
        // 8-byte discriminator + size_of must stay under the 10,240-byte CPI init cap.
        assert!(8 + ArenaConfig::INIT_SPACE <= 10_240);
        assert!(8 + size_of::<MarketState>() <= 10_240);
        assert!(8 + size_of::<Bot>() <= 10_240);
    }

    // Locks the documented byte layouts above. If any of these change, the
    // Phase-2 UI client-side decoders and the doc tables MUST change with them.
    #[test]
    fn zero_copy_layouts_locked() {
        assert_eq!(size_of::<Bucket>(), 56);
        assert_eq!(align_of::<Bucket>(), 8);
        assert_eq!(size_of::<Position>(), 48);
        assert_eq!(align_of::<Position>(), 8);
        assert_eq!(size_of::<TapeEntry>(), 32);
        assert_eq!(align_of::<TapeEntry>(), 8);
        assert_eq!(size_of::<StrategyParams>(), 16);
        assert_eq!(align_of::<StrategyParams>(), 4);
        assert_eq!(size_of::<MarketState>(), 3608);
        assert_eq!(align_of::<MarketState>(), 8);
        assert_eq!(size_of::<Bot>(), 2328);
        assert_eq!(align_of::<Bot>(), 8);
    }
}
