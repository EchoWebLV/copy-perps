// arena-program/programs/arena/src/paper_llm.rs
//
// Paper engine for the LLM oracle-bot tier. Mirrors paper.rs's fill math but:
//   - the LLM decides open AND close (apply_open / apply_close in lib.rs),
//   - a taker fee is charged on BOTH legs (open here + close in apply_close),
//   - each position carries a stop_price + tp_price enforced every tick by
//     maintain_llm (so a dead/slow brain can never blow up a position),
//   - a deterministic symmetric funding holding-cost proxy accrues per tick,
//   - the safety FLOOR (leverage clamp, stop bounds, cooldown, trade cap,
//     confidence floor, daily-loss kill-switch) is enforced in precheck_open,
//   - sizing is either the LLM's stake_frac or risk-based (off by default).
//
// All math is integer (u64/u128/i128) and mirrored byte-for-byte by
// lib/arena/llm/floor-reference.ts against fixtures/arena/llm-floor-cases.json.

use crate::state::*;
use crate::strategy::Side;

pub const ACT_OPEN_LONG_LLM: u8 = 5;
pub const ACT_OPEN_SHORT_LLM: u8 = 6;
pub const ACT_CLOSE_LLM: u8 = 7;
pub const ACT_STOP_HIT: u8 = 8;
pub const ACT_KILL_SWITCH: u8 = 9;
// Reused from paper.rs semantics (favorable take-profit / max-hold / liquidation).
pub const ACT_EXIT_FAVORABLE: u8 = 2;
pub const ACT_EXIT_MAX_HOLD: u8 = 3;
pub const ACT_LIQUIDATED: u8 = 4;

const DAY_SECS: i64 = 86_400;

fn mul_div(a: u64, num: u64, den: u64) -> u64 {
    ((a as u128 * num as u128) / den as u128) as u64
}

fn push_tape(bot: &mut LlmBot, e: TapeEntry) {
    let h = bot.tape_head as usize % TAPE_LEN;
    bot.tape[h] = e;
    bot.tape_head = ((h + 1) % TAPE_LEN) as u16;
    bot.seq = bot.seq.saturating_add(1);
}

/// Total capital at cost: free balance + the stake locked in open positions.
/// Realized losses (closes), fees, and funding all reduce it; opening does not
/// (balance −= stake+fee, locked stake += stake). Used for the daily kill-switch.
pub fn equity_at_cost(bot: &LlmBot) -> u64 {
    let mut eq = bot.balance_micro;
    for p in bot.positions.iter() {
        if p.active != 0 {
            eq = eq.saturating_add(p.stake_micro);
        }
    }
    eq
}

/// Trip the kill-switch when the realized daily drawdown reaches the limit.
pub fn check_kill_switch(bot: &mut LlmBot) {
    if bot.day_start_equity_micro == 0 {
        return;
    }
    let eq = equity_at_cost(bot);
    if eq >= bot.day_start_equity_micro {
        return;
    }
    let dd = bot.day_start_equity_micro - eq;
    if (dd as u128) * (BPS as u128)
        >= bot.day_start_equity_micro as u128 * bot.params.daily_loss_limit_bps as u128
    {
        bot.halted = 1;
    }
}

/// Roll the daily window when `now` crosses into a new UTC day (or on first use).
/// Resets the trade counter, the kill-switch, and the day-start equity baseline.
pub fn roll_day(bot: &mut LlmBot, now: i64) {
    let same_day = bot.day_start_ts != 0
        && bot.day_start_ts.div_euclid(DAY_SECS) == now.div_euclid(DAY_SECS);
    if same_day {
        return;
    }
    bot.day_start_ts = now;
    bot.day_start_equity_micro = equity_at_cost(bot);
    bot.trades_today = 0;
    bot.halted = 0;
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum FloorReject {
    Halted,
    Cooldown,
    TradeCap,
    StopRequired,
    StopOutOfRange,
    LowConfidence,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct OpenPlan {
    pub stake_micro: u64,
    pub leverage: u16,
    pub stop_bps: u16,
    pub tp_bps: u16,
    pub conviction: u8,
}

/// The on-chain safety floor for an OPEN decision. Clamps leverage and stake to
/// the bot's caps, requires a stop within bounds, and rejects on cooldown / trade
/// cap / halt / low confidence. Does NOT mutate the bot (caller owns last_decision_ts).
pub fn precheck_open(
    bot: &LlmBot,
    now: i64,
    leverage: u16,
    stake_frac_bps: u16,
    stop_bps: u16,
    tp_bps: u16,
    confidence: u8,
) -> Result<OpenPlan, FloorReject> {
    let p = &bot.params;
    if bot.halted != 0 {
        return Err(FloorReject::Halted);
    }
    if now.saturating_sub(bot.last_decision_ts) < p.decision_cooldown_secs as i64 {
        return Err(FloorReject::Cooldown);
    }
    if bot.trades_today >= p.max_trades_per_day {
        return Err(FloorReject::TradeCap);
    }
    if confidence < p.confidence_floor {
        return Err(FloorReject::LowConfidence);
    }
    if stop_bps == 0 {
        return Err(FloorReject::StopRequired);
    }
    if stop_bps < p.min_stop_bps || stop_bps > p.max_stop_bps {
        return Err(FloorReject::StopOutOfRange);
    }

    let lev = leverage.clamp(1, p.max_leverage.max(1));
    let stake = if p.risk_sizing != 0 {
        // Risk budget = balance × max_stake_frac_bps (reinterpreted as risk bps).
        // stake = risk_budget × BPS / (lev × stop_bps) so worst-case stop loss
        // (notional × stop_bps/BPS) ≈ the risk budget regardless of leverage.
        let risk_budget = mul_div(bot.balance_micro, p.max_stake_frac_bps as u64, BPS);
        let denom = (lev as u64).saturating_mul(stop_bps as u64).max(1);
        mul_div(risk_budget, BPS, denom)
    } else {
        let frac = stake_frac_bps.min(p.max_stake_frac_bps);
        mul_div(bot.balance_micro, frac as u64, BPS)
    };
    let stake = stake.min(bot.balance_micro);

    Ok(OpenPlan {
        stake_micro: stake,
        leverage: lev,
        stop_bps,
        tp_bps,
        conviction: confidence,
    })
}

pub fn find_position_in_market(bot: &LlmBot, market_id: u8) -> Option<usize> {
    bot.positions
        .iter()
        .position(|p| p.active != 0 && p.market_id == market_id)
}

/// Apply a pre-checked OPEN. Returns false (no-op) if already in this market, no
/// free slot, stake below the floor, or balance can't cover stake+fee.
pub fn apply_open(
    bot: &mut LlmBot,
    cfg: &ArenaConfig,
    market_id: u8,
    side: Side,
    price: u64,
    ts: i64,
    plan: OpenPlan,
) -> bool {
    if find_position_in_market(bot, market_id).is_some() {
        return false;
    }
    let Some(slot) = bot.positions.iter().position(|p| p.active == 0) else {
        return false;
    };
    let stake = plan.stake_micro;
    if stake < MIN_STAKE_MICRO {
        return false;
    }
    let lev = plan.leverage as u64;
    let notional = stake.saturating_mul(lev);
    let fee = mul_div(notional, cfg.fee_bps as u64, BPS);
    if bot.balance_micro < stake + fee {
        return false;
    }

    let long = matches!(side, Side::Long);
    let spread = cfg.spread_bps as u64;
    let entry = if long {
        price + mul_div(price, spread, BPS)
    } else {
        price - mul_div(price, spread, BPS)
    };
    let dist = mul_div(entry, BPS - cfg.maint_buffer_bps as u64, lev * BPS);
    let liq = if long {
        entry.saturating_sub(dist)
    } else {
        entry + dist
    };
    let stop = if long {
        entry.saturating_sub(mul_div(entry, plan.stop_bps as u64, BPS))
    } else {
        entry + mul_div(entry, plan.stop_bps as u64, BPS)
    };
    let tp = if plan.tp_bps == 0 {
        0
    } else if long {
        entry + mul_div(entry, plan.tp_bps as u64, BPS)
    } else {
        entry.saturating_sub(mul_div(entry, plan.tp_bps as u64, BPS))
    };

    bot.balance_micro -= stake + fee;
    bot.fees_micro = bot.fees_micro.saturating_add(fee);
    bot.trades_today = bot.trades_today.saturating_add(1);
    bot.positions[slot] = LlmPosition {
        active: 1,
        market_id,
        side: side as u8,
        entry_price: entry,
        stake_micro: stake,
        stop_price: stop,
        tp_price: tp,
        liq_price: liq,
        leverage: plan.leverage,
        opened_ts: ts,
        last_funding_ts: ts,
        ticks_held: 0,
        _pad: [0; 7],
    };
    push_tape(
        bot,
        TapeEntry {
            ts,
            market_id,
            price: entry,
            stake_micro: stake,
            conviction: plan.conviction,
            action: if long {
                ACT_OPEN_LONG_LLM
            } else {
                ACT_OPEN_SHORT_LLM
            },
            _pad: [0; 5],
        },
    );
    true
}

/// Close a position. Taker fee on the close leg. LIQUIDATED books at liq_price
/// with zero credit; STOP_HIT books at the stop level (± spread); all other
/// closes book at the mark (± spread). Returns false if the slot is inactive.
pub fn apply_close(
    bot: &mut LlmBot,
    cfg: &ArenaConfig,
    idx: usize,
    mark: u64,
    ts: i64,
    action: u8,
) -> bool {
    let pos = bot.positions[idx];
    if pos.active == 0 {
        return false;
    }
    let long = pos.side == 0;
    let spread = cfg.spread_bps as u64;
    let exit = if action == ACT_LIQUIDATED {
        pos.liq_price
    } else if action == ACT_STOP_HIT {
        if long {
            pos.stop_price.saturating_sub(mul_div(pos.stop_price, spread, BPS))
        } else {
            pos.stop_price + mul_div(pos.stop_price, spread, BPS)
        }
    } else if long {
        mark - mul_div(mark, spread, BPS)
    } else {
        mark + mul_div(mark, spread, BPS)
    };
    let notional = pos.stake_micro.saturating_mul(pos.leverage as u64) as i128;
    let move_num = exit as i128 - pos.entry_price as i128;
    let mut pnl = notional * move_num / pos.entry_price as i128;
    if !long {
        pnl = -pnl;
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
        bot.wins = bot.wins.saturating_add(1);
    }
    bot.gross_pnl_micro = bot
        .gross_pnl_micro
        .saturating_add((credit as i128 - pos.stake_micro as i128) as i64);
    if bot.balance_micro > bot.equity_high_micro {
        bot.equity_high_micro = bot.balance_micro;
    }
    bot.positions[idx].active = 0;
    push_tape(
        bot,
        TapeEntry {
            ts,
            market_id: pos.market_id,
            price: exit,
            stake_micro: pos.stake_micro,
            conviction: 0,
            action,
            _pad: [0; 5],
        },
    );
    check_kill_switch(bot);
    true
}

/// Per-tick maintenance for LlmBot positions in `market_id`: accrue funding,
/// then enforce liquidation → stop → take-profit → max-hold, then re-check the
/// daily kill-switch. Runs every crank tick, independent of any LLM call.
pub fn maintain_llm(bot: &mut LlmBot, cfg: &ArenaConfig, market_id: u8, mark: u64, ts: i64) {
    for idx in 0..MAX_POSITIONS {
        let pos = bot.positions[idx];
        if pos.active == 0 || pos.market_id != market_id {
            continue;
        }
        // Funding holding-cost proxy (symmetric): notional × bps/hr × seconds.
        let secs = (ts - pos.last_funding_ts).max(0) as u128;
        if secs > 0 && bot.params.funding_bps_per_hour > 0 {
            let notional = pos.stake_micro as u128 * pos.leverage as u128;
            let funding = notional * bot.params.funding_bps_per_hour as u128 * secs
                / (BPS as u128 * 3600);
            bot.balance_micro = bot.balance_micro.saturating_sub(funding as u64);
            bot.funding_paid_micro = bot.funding_paid_micro.saturating_add(funding as u64);
        }
        bot.positions[idx].last_funding_ts = ts;

        let long = pos.side == 0;
        let liquidated = if long {
            mark <= pos.liq_price
        } else {
            mark >= pos.liq_price
        };
        if liquidated {
            apply_close(bot, cfg, idx, mark, ts, ACT_LIQUIDATED);
            continue;
        }
        let stopped = if long {
            mark <= pos.stop_price
        } else {
            mark >= pos.stop_price
        };
        if stopped {
            apply_close(bot, cfg, idx, mark, ts, ACT_STOP_HIT);
            continue;
        }
        if pos.tp_price != 0 {
            let tp_hit = if long {
                mark >= pos.tp_price
            } else {
                mark <= pos.tp_price
            };
            if tp_hit {
                apply_close(bot, cfg, idx, mark, ts, ACT_EXIT_FAVORABLE);
                continue;
            }
        }
        bot.positions[idx].ticks_held = pos.ticks_held.saturating_add(1);
        if bot.params.max_hold_ticks != 0
            && bot.positions[idx].ticks_held >= bot.params.max_hold_ticks
        {
            apply_close(bot, cfg, idx, mark, ts, ACT_EXIT_MAX_HOLD);
        }
    }
    check_kill_switch(bot);
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    const PRICE: u64 = 10_000_000_000; // $100.00 @ 1e8
    const START: u64 = 1_000_000_000; // $1,000 micro-USD

    fn cfg() -> ArenaConfig {
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

    fn params() -> LlmParams {
        LlmParams {
            max_hold_ticks: 1_000,
            decision_cooldown_secs: 60,
            max_leverage: 15,
            min_stop_bps: 50,
            max_stop_bps: 500,
            max_stake_frac_bps: 2_000,
            max_trades_per_day: 5,
            daily_loss_limit_bps: 1_500,
            funding_bps_per_hour: 2,
            confidence_floor: 55,
            risk_sizing: 0,
        }
    }

    fn bot(balance: u64) -> LlmBot {
        LlmBot {
            operator: Pubkey::default(),
            balance_micro: balance,
            gross_pnl_micro: 0,
            fees_micro: 0,
            funding_paid_micro: 0,
            equity_high_micro: balance,
            day_start_equity_micro: balance,
            seq: 0,
            day_start_ts: 1_000,
            last_decision_ts: 0,
            positions: [LlmPosition::default(); MAX_POSITIONS],
            tape: [TapeEntry::default(); TAPE_LEN],
            params: params(),
            persona_id: [0; 16],
            trades: 0,
            wins: 0,
            trades_today: 0,
            tape_head: 0,
            halted: 0,
            bump: 0,
            _pad: [0; 2],
        }
    }

    // leverage 10, stake_frac 1000 (10%), stop 200bps, tp 400bps, conf 80:
    //   stake = 1e9 * 1000/10000           = 100_000_000
    //   notional = 1e9 ; fee = 600_000
    //   entry = PRICE + PRICE*5/10000       = 10_005_000_000
    //   liq   = entry - entry*9500/100000   = 9_054_525_000
    //   stop  = entry - entry*200/10000     = 9_804_900_000
    //   tp    = entry + entry*400/10000     = 10_405_200_000
    fn open_default(b: &mut LlmBot) {
        let plan = precheck_open(b, 5_000, 10, 1_000, 200, 400, 80).unwrap();
        assert!(apply_open(b, &cfg(), 0, Side::Long, PRICE, 5_000, plan));
    }

    #[test]
    fn open_charges_open_fee_and_sets_stop_tp_liq() {
        let mut b = bot(START);
        open_default(&mut b);
        assert_eq!(b.balance_micro, 899_400_000);
        assert_eq!(b.fees_micro, 600_000);
        assert_eq!(b.trades_today, 1);
        let p = b.positions[0];
        assert_eq!(p.active, 1);
        assert_eq!(p.entry_price, 10_005_000_000);
        assert_eq!(p.liq_price, 9_054_525_000);
        assert_eq!(p.stop_price, 9_804_900_000);
        assert_eq!(p.tp_price, 10_405_200_000);
        assert_eq!(p.stake_micro, 100_000_000);
        assert_eq!(p.leverage, 10);
        assert_eq!(b.tape[0].action, ACT_OPEN_LONG_LLM);
        assert_eq!(b.tape[0].conviction, 80);
        assert_eq!(b.seq, 1);
    }

    // Stop hit: mark 9_800_000_000 <= stop. exit = stop - stop*5/10000 = 9_799_997_550
    //   pnl = 1e9*(exit-entry)/entry = -20_490_000 ; closeFee 600_000
    //   credit = 100_000_000 - 20_490_000 - 600_000 = 78_910_000
    #[test]
    fn stop_hit_closes_at_stop_level_bounded_loss() {
        let mut b = bot(START);
        open_default(&mut b);
        maintain_llm(&mut b, &cfg(), 0, 9_800_000_000, 5_000); // same ts ⇒ no funding
        let p = b.positions[0];
        assert_eq!(p.active, 0);
        assert_eq!(b.balance_micro, 899_400_000 + 78_910_000);
        assert_eq!(b.tape[1].action, ACT_STOP_HIT);
        assert_eq!(b.tape[1].price, 9_799_997_550);
        assert_eq!(b.gross_pnl_micro, -21_090_000); // credit(78_910_000) - stake(100_000_000)
        assert_eq!(b.fees_micro, 1_200_000);
        assert_eq!(b.trades, 1);
        assert_eq!(b.wins, 0);
    }

    // TP hit: mark 10_405_200_000 >= tp. exit = mark - mark*5/10000 = 10_399_997_400
    //   pnl = +39_480_000 ; credit = 100_000_000 + 39_480_000 - 600_000 = 138_880_000
    #[test]
    fn tp_hit_closes_favorably() {
        let mut b = bot(START);
        open_default(&mut b);
        maintain_llm(&mut b, &cfg(), 0, 10_405_200_000, 5_000);
        assert_eq!(b.positions[0].active, 0);
        assert_eq!(b.balance_micro, 899_400_000 + 138_880_000);
        assert_eq!(b.tape[1].action, ACT_EXIT_FAVORABLE);
        assert_eq!(b.tape[1].price, 10_399_997_400);
        assert_eq!(b.wins, 1);
    }

    #[test]
    fn liquidation_zeroes_credit() {
        let mut b = bot(START);
        open_default(&mut b);
        maintain_llm(&mut b, &cfg(), 0, 9_000_000_000, 5_000); // below liq
        assert_eq!(b.positions[0].active, 0);
        assert_eq!(b.balance_micro, 899_400_000);
        assert_eq!(b.tape[1].action, ACT_LIQUIDATED);
        assert_eq!(b.gross_pnl_micro, -100_000_000);
    }

    // Funding: hold 1h at mark=entry (no exit). funding = 1e9 * 2 * 3600 /(10000*3600)=200_000
    #[test]
    fn funding_proxy_accrues_per_hour() {
        let mut b = bot(START);
        open_default(&mut b);
        let entry = b.positions[0].entry_price;
        maintain_llm(&mut b, &cfg(), 0, entry, 5_000 + 3_600);
        assert_eq!(b.positions[0].active, 1); // entry: not stopped/tp/liq
        assert_eq!(b.funding_paid_micro, 200_000);
        assert_eq!(b.balance_micro, 899_400_000 - 200_000);
    }

    #[test]
    fn close_llm_books_at_mark() {
        let mut b = bot(START);
        open_default(&mut b);
        let idx = find_position_in_market(&b, 0).unwrap();
        assert!(apply_close(&mut b, &cfg(), idx, 10_005_000_000, 5_001, ACT_CLOSE_LLM));
        assert_eq!(b.positions[0].active, 0);
        assert_eq!(b.tape[1].action, ACT_CLOSE_LLM);
        assert_eq!(b.trades, 1);
    }

    #[test]
    fn max_hold_backstop_closes() {
        let mut b = bot(START);
        b.params.max_hold_ticks = 2;
        let plan = precheck_open(&b, 5_000, 10, 1_000, 200, 400, 80).unwrap();
        assert!(apply_open(&mut b, &cfg(), 0, Side::Long, PRICE, 5_000, plan));
        let entry = b.positions[0].entry_price;
        maintain_llm(&mut b, &cfg(), 0, entry, 5_000); // tick 1
        assert_eq!(b.positions[0].active, 1);
        assert_eq!(b.positions[0].ticks_held, 1);
        maintain_llm(&mut b, &cfg(), 0, entry, 5_000); // tick 2 ⇒ max hold
        assert_eq!(b.positions[0].active, 0);
        assert_eq!(b.tape[1].action, ACT_EXIT_MAX_HOLD);
    }

    #[test]
    fn precheck_clamps_leverage_and_stake() {
        let b = bot(START);
        let plan = precheck_open(&b, 5_000, 999, 5_000, 200, 0, 80).unwrap();
        assert_eq!(plan.leverage, 15); // clamped to max_leverage
        assert_eq!(plan.stake_micro, 200_000_000); // 2000bps cap, not 5000
    }

    #[test]
    fn precheck_rejects_floor_violations() {
        let mut b = bot(START);
        b.halted = 1;
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 200, 0, 80), Err(FloorReject::Halted));
        b.halted = 0;
        b.last_decision_ts = 4_990; // 5_000 - 4_990 = 10 < 60
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 200, 0, 80), Err(FloorReject::Cooldown));
        b.last_decision_ts = 0;
        b.trades_today = 5;
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 200, 0, 80), Err(FloorReject::TradeCap));
        b.trades_today = 0;
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 200, 0, 50), Err(FloorReject::LowConfidence));
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 0, 0, 80), Err(FloorReject::StopRequired));
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 10, 0, 80), Err(FloorReject::StopOutOfRange));
        assert_eq!(precheck_open(&b, 5_000, 10, 1_000, 600, 0, 80), Err(FloorReject::StopOutOfRange));
    }

    // risk_sizing: budget = 1e9 * 200/10000 = 20_000_000 ; stake = 20e6 * 10000/(10*200)=100_000_000
    #[test]
    fn risk_based_sizing_caps_loss() {
        let mut b = bot(START);
        b.params.risk_sizing = 1;
        b.params.max_stake_frac_bps = 200; // 2% risk budget
        let plan = precheck_open(&b, 5_000, 10, 0, 200, 0, 80).unwrap();
        assert_eq!(plan.stake_micro, 100_000_000);
        // worst-case stop loss ≈ notional * stop/BPS = 1e9 * 200/10000 = 20_000_000 = budget
    }

    #[test]
    fn day_roll_resets_and_kill_switch_trips() {
        let mut b = bot(START);
        b.halted = 1;
        b.trades_today = 5;
        // realized drawdown to 84% ⇒ 1600bps >= 1500 ⇒ stays/sets halted
        b.balance_micro = 840_000_000;
        check_kill_switch(&mut b);
        assert_eq!(b.halted, 1);
        // new day rolls everything (baseline = current equity_at_cost)
        roll_day(&mut b, 1_000 + DAY_SECS + 5);
        assert_eq!(b.trades_today, 0);
        assert_eq!(b.halted, 0);
        assert_eq!(b.day_start_equity_micro, 840_000_000);
        // within the same day, no reset
        b.trades_today = 3;
        roll_day(&mut b, 1_000 + DAY_SECS + 50);
        assert_eq!(b.trades_today, 3);
    }

    #[test]
    fn kill_switch_below_limit_does_not_trip() {
        let mut b = bot(START);
        b.balance_micro = 860_000_000; // 1400bps < 1500
        check_kill_switch(&mut b);
        assert_eq!(b.halted, 0);
    }
}
