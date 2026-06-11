// arena-program/programs/arena/src/paper.rs
use crate::state::*;
use crate::strategy::Side;

pub const ACT_OPEN_LONG: u8 = 0;
pub const ACT_OPEN_SHORT: u8 = 1;
pub const ACT_EXIT_FAVORABLE: u8 = 2;
pub const ACT_EXIT_MAX_HOLD: u8 = 3;
pub const ACT_LIQUIDATED: u8 = 4;

fn mul_div(a: u64, num: u64, den: u64) -> u64 {
    ((a as u128 * num as u128) / den as u128) as u64
}

fn push_tape(bot: &mut Bot, e: TapeEntry) {
    let h = bot.tape_head as usize % TAPE_LEN;
    bot.tape[h] = e;
    bot.tape_head = ((h + 1) % TAPE_LEN) as u16;
    bot.seq = bot.seq.saturating_add(1);
}

pub fn try_open(
    bot: &mut Bot,
    cfg: &ArenaConfig,
    market_id: u8,
    side: Side,
    price: u64,
    ts: i64,
) -> bool {
    if bot
        .positions
        .iter()
        .any(|p| p.active && p.market_id == market_id)
    {
        return false;
    }
    let Some(slot) = bot.positions.iter().position(|p| !p.active) else {
        return false;
    };
    let stake = mul_div(bot.balance_micro, bot.params.stake_frac_bps as u64, BPS);
    if stake < MIN_STAKE_MICRO {
        return false;
    }
    let lev = bot.params.leverage as u64;
    let notional = stake.saturating_mul(lev);
    let fee = mul_div(notional, cfg.fee_bps as u64, BPS);
    if bot.balance_micro < stake + fee {
        return false;
    }

    let entry = match side {
        Side::Long => price + mul_div(price, cfg.spread_bps as u64, BPS),
        Side::Short => price - mul_div(price, cfg.spread_bps as u64, BPS),
    };
    // Liquidation distance: (1/lev) of entry, less the maintenance buffer.
    let dist = mul_div(entry, BPS - cfg.maint_buffer_bps as u64, lev * BPS);
    let liq = match side {
        Side::Long => entry.saturating_sub(dist),
        Side::Short => entry + dist,
    };

    bot.balance_micro -= stake + fee;
    bot.fees_micro = bot.fees_micro.saturating_add(fee);
    bot.positions[slot] = Position {
        active: true,
        market_id,
        side: side as u8,
        entry_price: entry,
        stake_micro: stake,
        leverage: bot.params.leverage,
        opened_ts: ts,
        ticks_held: 0,
        liq_price: liq,
    };
    push_tape(
        bot,
        TapeEntry {
            ts,
            market_id,
            price: entry,
            stake_micro: stake,
            conviction: 0,
            action: if matches!(side, Side::Long) {
                ACT_OPEN_LONG
            } else {
                ACT_OPEN_SHORT
            },
        },
    );
    true
}

/// Returns true if the position was closed this call.
pub fn close(
    bot: &mut Bot,
    idx: usize,
    cfg: &ArenaConfig,
    exit_mark: u64,
    ts: i64,
    action: u8,
) -> bool {
    let pos = bot.positions[idx];
    if !pos.active {
        return false;
    }
    let long = pos.side == 0;
    let exit = if action == ACT_LIQUIDATED {
        pos.liq_price
    } else if long {
        exit_mark - mul_div(exit_mark, cfg.spread_bps as u64, BPS)
    } else {
        exit_mark + mul_div(exit_mark, cfg.spread_bps as u64, BPS)
    };
    let notional = pos.stake_micro.saturating_mul(pos.leverage as u64) as i128;
    let move_num = exit as i128 - pos.entry_price as i128;
    let mut pnl = notional * move_num / pos.entry_price as i128;
    if !long {
        pnl = -pnl
    }
    let fee = mul_div(
        pos.stake_micro.saturating_mul(pos.leverage as u64),
        cfg.fee_bps as u64,
        BPS,
    );
    let credit_i = pos.stake_micro as i128 + pnl - fee as i128;
    let credit = if action == ACT_LIQUIDATED {
        0u64
    } else {
        credit_i.max(0) as u64
    };
    bot.balance_micro = bot.balance_micro.saturating_add(credit);
    bot.fees_micro = bot.fees_micro.saturating_add(fee);
    bot.trades = bot.trades.saturating_add(1);
    if credit > pos.stake_micro {
        bot.wins = bot.wins.saturating_add(1)
    }
    bot.gross_pnl_micro = bot
        .gross_pnl_micro
        .saturating_add((credit as i128 - pos.stake_micro as i128) as i64);
    if bot.balance_micro > bot.equity_high_micro {
        bot.equity_high_micro = bot.balance_micro
    }
    bot.positions[idx].active = false;
    push_tape(
        bot,
        TapeEntry {
            ts,
            market_id: pos.market_id,
            price: exit,
            stake_micro: pos.stake_micro,
            conviction: 0,
            action,
        },
    );
    true
}

/// Per-tick maintenance for positions in `market_id`: liq check, favorable exit, max hold.
pub fn maintain(bot: &mut Bot, cfg: &ArenaConfig, market_id: u8, mark: u64, ts: i64) {
    for idx in 0..MAX_POSITIONS {
        let pos = bot.positions[idx];
        if !pos.active || pos.market_id != market_id {
            continue;
        }
        let long = pos.side == 0;
        let liquidated = if long {
            mark <= pos.liq_price
        } else {
            mark >= pos.liq_price
        };
        if liquidated {
            close(bot, idx, cfg, mark, ts, ACT_LIQUIDATED);
            continue;
        }
        // Favorable move >= exit_favorable_bps (cross-multiplied).
        let fav = if long {
            mark > pos.entry_price
        } else {
            mark < pos.entry_price
        };
        let diff = mark.abs_diff(pos.entry_price) as u128;
        if fav && diff * BPS as u128 >= pos.entry_price as u128 * bot.params.exit_favorable_bps as u128
        {
            close(bot, idx, cfg, mark, ts, ACT_EXIT_FAVORABLE);
            continue;
        }
        bot.positions[idx].ticks_held = pos.ticks_held.saturating_add(1);
        if bot.positions[idx].ticks_held >= bot.params.max_hold_ticks {
            close(bot, idx, cfg, mark, ts, ACT_EXIT_MAX_HOLD);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    const PRICE: u64 = 10_000_000_000; // $100.00 @ 1e8
    const START_BALANCE: u64 = 1_000_000_000; // $1,000 micro-USD

    fn test_cfg() -> ArenaConfig {
        ArenaConfig {
            admin: Pubkey::default(),
            fee_bps: 6,
            spread_bps: 5,
            maint_buffer_bps: 500,
            max_age_secs: 10,
            bucket_secs: 15,
            markets: [MarketCfg::default(); MAX_MARKETS],
            bump: 0,
        }
    }

    fn test_bot(balance: u64) -> Bot {
        Bot {
            persona_id: [0; 16],
            params: StrategyParams {
                read_span: 1,
                breakout_bps: 60,
                activity_mult_bps: 14_000,
                trend_filter: true,
                stake_frac_bps: 1_000, // 10%
                leverage: 10,
                max_hold_ticks: 2,
                exit_favorable_bps: 100, // 1%
            },
            balance_micro: balance,
            positions: [Position::default(); MAX_POSITIONS],
            trades: 0,
            wins: 0,
            gross_pnl_micro: 0,
            fees_micro: 0,
            equity_high_micro: balance,
            seq: 0,
            tape_head: 0,
            tape: [TapeEntry::default(); TAPE_LEN],
            bump: 0,
        }
    }

    // Hand math, open long at PRICE:
    //   stake    = 1_000_000_000 * 1000 / 10000          = 100_000_000
    //   notional = 100_000_000 * 10                      = 1_000_000_000
    //   fee      = 1_000_000_000 * 6 / 10000             = 600_000
    //   entry    = PRICE + PRICE*5/10000                 = 10_005_000_000
    //   dist     = entry * (10000-500) / (10 * 10000)    = 950_475_000
    //   liq      = entry - dist                          = 9_054_525_000
    #[test]
    fn open_long_deducts_stake_plus_fee_and_sets_liq() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        assert_eq!(bot.balance_micro, 899_400_000); // 1e9 - 100_000_000 - 600_000
        assert_eq!(bot.fees_micro, 600_000);
        let pos = bot.positions[0];
        assert!(pos.active);
        assert_eq!(pos.market_id, 0);
        assert_eq!(pos.side, 0);
        assert_eq!(pos.entry_price, 10_005_000_000);
        assert_eq!(pos.stake_micro, 100_000_000);
        assert_eq!(pos.leverage, 10);
        assert_eq!(pos.opened_ts, 1_000);
        assert_eq!(pos.ticks_held, 0);
        assert_eq!(pos.liq_price, 9_054_525_000);
        // Tape + seq.
        assert_eq!(bot.seq, 1);
        assert_eq!(bot.tape_head, 1);
        let t = bot.tape[0];
        assert_eq!(t.action, ACT_OPEN_LONG);
        assert_eq!(t.price, 10_005_000_000);
        assert_eq!(t.stake_micro, 100_000_000);
        assert_eq!(t.ts, 1_000);
        assert_eq!(t.market_id, 0);
    }

    // Hand math, open short at PRICE:
    //   entry = PRICE - PRICE*5/10000                  = 9_995_000_000
    //   dist  = entry * 9500 / 100_000                 = 949_525_000
    //   liq   = entry + dist                           = 10_944_525_000
    #[test]
    fn open_short_sets_liq_above_entry() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Short, PRICE, 1_000));
        assert_eq!(bot.balance_micro, 899_400_000);
        let pos = bot.positions[0];
        assert_eq!(pos.side, 1);
        assert_eq!(pos.entry_price, 9_995_000_000);
        assert_eq!(pos.liq_price, 10_944_525_000);
        assert_eq!(bot.tape[0].action, ACT_OPEN_SHORT);
        assert_eq!(bot.seq, 1);
    }

    // Favorable long exit at mark = 10_105_050_000 (exactly +1% of entry):
    //   exit   = mark - mark*5/10000                   = 10_099_997_475
    //   pnl    = 1e9 * (exit - entry) / entry          = +9_495_000 (exact)
    //   fee    = 600_000
    //   credit = 100_000_000 + 9_495_000 - 600_000     = 108_895_000
    #[test]
    fn favorable_exit_credits_stake_plus_pnl_minus_fee_and_wins() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        maintain(&mut bot, &cfg, 0, 10_105_050_000, 1_010);
        assert!(!bot.positions[0].active);
        assert_eq!(bot.balance_micro, 899_400_000 + 108_895_000);
        assert_eq!(bot.trades, 1);
        assert_eq!(bot.wins, 1);
        assert_eq!(bot.gross_pnl_micro, 8_895_000); // credit - stake
        assert_eq!(bot.fees_micro, 1_200_000); // open + close
        assert_eq!(bot.equity_high_micro, 1_008_295_000);
        assert_eq!(bot.seq, 2);
        assert_eq!(bot.tape_head, 2);
        let t = bot.tape[1];
        assert_eq!(t.action, ACT_EXIT_FAVORABLE);
        assert_eq!(t.price, 10_099_997_475);
        assert_eq!(t.ts, 1_010);
    }

    // Max-hold exit at mark == entry (not favorable, above liq):
    //   exit   = entry - entry*5/10000                 = 9_999_997_500
    //   pnl    = 1e9 * (exit - entry) / entry          = -500_000 (exact)
    //   credit = 100_000_000 - 500_000 - 600_000       = 98_900_000
    #[test]
    fn max_hold_exit_after_ticks_exhausted() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE); // max_hold_ticks = 2
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        let entry = bot.positions[0].entry_price;

        maintain(&mut bot, &cfg, 0, entry, 1_002);
        assert!(bot.positions[0].active);
        assert_eq!(bot.positions[0].ticks_held, 1);

        maintain(&mut bot, &cfg, 0, entry, 1_004);
        assert!(!bot.positions[0].active);
        assert_eq!(bot.balance_micro, 899_400_000 + 98_900_000);
        assert_eq!(bot.trades, 1);
        assert_eq!(bot.wins, 0);
        assert_eq!(bot.gross_pnl_micro, -1_100_000);
        assert_eq!(bot.tape[1].action, ACT_EXIT_MAX_HOLD);
        assert_eq!(bot.tape[1].price, 9_999_997_500);
        assert_eq!(bot.seq, 2);
    }

    #[test]
    fn liquidation_long_zeroes_credit() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        // Gap well through liq (9_054_525_000): mark <= liq triggers.
        maintain(&mut bot, &cfg, 0, 9_000_000_000, 1_020);
        assert!(!bot.positions[0].active);
        assert_eq!(bot.balance_micro, 899_400_000); // zero credit back
        assert_eq!(bot.trades, 1);
        assert_eq!(bot.wins, 0);
        assert_eq!(bot.gross_pnl_micro, -100_000_000); // loss == stake, never more
        assert_eq!(bot.fees_micro, 1_200_000);
        let t = bot.tape[1];
        assert_eq!(t.action, ACT_LIQUIDATED);
        assert_eq!(t.price, 9_054_525_000); // books at liq price, not the gapped mark
        assert_eq!(bot.seq, 2);
    }

    #[test]
    fn liquidation_short_zeroes_credit() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Short, PRICE, 1_000));
        // liq = 10_944_525_000; mark >= liq triggers.
        maintain(&mut bot, &cfg, 0, 11_000_000_000, 1_020);
        assert!(!bot.positions[0].active);
        assert_eq!(bot.balance_micro, 899_400_000);
        assert_eq!(bot.gross_pnl_micro, -100_000_000);
        assert_eq!(bot.tape[1].action, ACT_LIQUIDATED);
        assert_eq!(bot.tape[1].price, 10_944_525_000);
    }

    // Non-liquidation close with an exit so deep the raw credit goes negative:
    //   exit   = 8e9 - 8e9*5/10000                     = 7_996_000_000
    //   pnl    = 1e9 * (exit - entry) / entry          = -200_799_600 (trunc)
    //   credit = max(0, 100_000_000 - 200_799_600 - 600_000) = 0
    #[test]
    fn loss_clamped_at_stake_on_gap_through_liq() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        assert!(close(&mut bot, 0, &cfg, 8_000_000_000, 1_030, ACT_EXIT_MAX_HOLD));
        assert_eq!(bot.balance_micro, 899_400_000); // credit clamped to 0
        assert_eq!(bot.gross_pnl_micro, -100_000_000); // capped at stake
        assert_eq!(bot.trades, 1);
        assert_eq!(bot.wins, 0);
    }

    #[test]
    fn stake_floor_skips_open() {
        let cfg = test_cfg();
        let mut bot = test_bot(9_000_000); // stake = 900_000 < MIN_STAKE_MICRO
        assert!(!try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        assert_eq!(bot.balance_micro, 9_000_000);
        assert_eq!(bot.seq, 0);
        assert!(bot.positions.iter().all(|p| !p.active));
    }

    #[test]
    fn insufficient_balance_skips_open() {
        let cfg = test_cfg();
        let mut bot = test_bot(100_000_000);
        bot.params.stake_frac_bps = 10_000; // stake = full balance, fee unpayable
        assert!(!try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        assert_eq!(bot.balance_micro, 100_000_000);
        assert_eq!(bot.fees_micro, 0);
        assert_eq!(bot.seq, 0);
    }

    #[test]
    fn no_free_slot_skips_open() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        for (i, p) in bot.positions.iter_mut().enumerate() {
            p.active = true;
            p.market_id = (i + 1) as u8; // other markets, so already-in-market doesn't fire
        }
        assert!(!try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        assert_eq!(bot.balance_micro, START_BALANCE);
        assert_eq!(bot.seq, 0);
    }

    #[test]
    fn already_in_market_skips_open() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        let balance_after_first = bot.balance_micro;
        assert!(!try_open(&mut bot, &cfg, 0, Side::Short, PRICE, 1_001));
        assert_eq!(bot.balance_micro, balance_after_first);
        assert_eq!(bot.seq, 1); // only the first open taped
        assert_eq!(bot.positions.iter().filter(|p| p.active).count(), 1);
    }

    #[test]
    fn close_on_inactive_position_is_noop() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        assert!(!close(&mut bot, 0, &cfg, PRICE, 1_000, ACT_EXIT_MAX_HOLD));
        assert_eq!(bot.balance_micro, START_BALANCE);
        assert_eq!(bot.trades, 0);
        assert_eq!(bot.seq, 0);
    }

    #[test]
    fn tape_wraps_and_seq_keeps_counting() {
        let cfg = test_cfg();
        let mut bot = test_bot(START_BALANCE);
        bot.tape_head = (TAPE_LEN - 1) as u16;
        bot.seq = 41;
        assert!(try_open(&mut bot, &cfg, 0, Side::Long, PRICE, 1_000));
        assert_eq!(bot.tape[TAPE_LEN - 1].action, ACT_OPEN_LONG);
        assert_eq!(bot.tape_head, 0); // wrapped
        assert_eq!(bot.seq, 42);
        maintain(&mut bot, &cfg, 0, 10_105_050_000, 1_010); // favorable exit
        assert_eq!(bot.tape[0].action, ACT_EXIT_FAVORABLE);
        assert_eq!(bot.tape_head, 1);
        assert_eq!(bot.seq, 43);
    }
}
