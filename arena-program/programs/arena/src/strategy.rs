// arena-program/programs/arena/src/strategy.rs
//
// Rust port of the "ring momentum v1" strategy. The parity oracle is
// lib/arena/strategy-reference.ts — the two implementations must agree on
// every fixture in fixtures/arena/strategy-cases.json. Change them together,
// never independently.
use crate::candles::StratCandle;
use crate::state::{StrategyParams, BPS, MIN_STRAT_CANDLES};

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum Side {
    Long,
    Short,
}

pub fn decide_ring_momentum(candles: &[StratCandle], p: &StrategyParams) -> Option<Side> {
    // Domain: breakout_bps < 10_000 (the TS reference also rejects < 0, which
    // u16 cannot represent). At >= 10_000 the short comparison
    // (prior_low * (BPS - bo)) underflows — both implementations fail closed.
    if p.breakout_bps >= 10_000 {
        return None;
    }
    if candles.len() < MIN_STRAT_CANDLES {
        return None;
    }
    let last = &candles[candles.len() - 1];
    if last.c == 0 {
        return None;
    }
    let prior = &candles[..candles.len() - 1];
    let prior_high = prior.iter().map(|k| k.h).max()?;
    let prior_low = prior.iter().map(|k| k.l).min()?;
    let path_sum: u128 = prior.iter().map(|k| k.path_len as u128).sum();
    if prior_high == 0 || prior_low == 0 {
        return None;
    }

    // Breakout: last close clears the prior range by >= breakout_bps
    // (integer cross-multiply — no division, mirrors the TS reference).
    let bo = p.breakout_bps as u128;
    let lc = last.c as u128;
    let side = if lc * BPS as u128 >= prior_high as u128 * (BPS as u128 + bo) {
        Side::Long
    } else if lc * BPS as u128 <= prior_low as u128 * (BPS as u128 - bo) {
        Side::Short
    } else {
        return None;
    };

    // Activity confirm: last pathLen >= multiplier x prior average, cross-multiplied.
    if path_sum == 0 {
        return None;
    }
    let mult = p.activity_mult_bps as u128;
    if (last.path_len as u128) * (prior.len() as u128) * (BPS as u128) < mult * path_sum {
        return None;
    }

    // Trend filter, kept for brain.ts fidelity — only bites on malformed candles.
    if p.trend_filter {
        let first = candles[0].c;
        if first == 0 {
            return None;
        }
        match side {
            Side::Long if last.c <= first => return None,
            Side::Short if last.c >= first => return None,
            _ => {}
        }
    }
    Some(side)
}

#[cfg(test)]
mod parity {
    use super::*;
    use crate::candles::StratCandle;
    use crate::state::StrategyParams;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct FixtureCandle {
        o: String,
        h: String,
        l: String,
        c: String,
        #[serde(rename = "pathLen")]
        path_len: String,
    }

    #[derive(Deserialize)]
    struct FixtureParams {
        #[serde(rename = "breakoutBps")]
        breakout_bps: u16,
        #[serde(rename = "activityMultBps")]
        activity_mult_bps: u16,
        #[serde(rename = "trendFilter")]
        trend_filter: bool,
    }

    #[derive(Deserialize)]
    struct FixtureCase {
        name: String,
        params: FixtureParams,
        candles: Vec<FixtureCandle>,
        expected: Option<String>,
    }

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/arena/strategy-cases.json"
    );

    #[test]
    fn matches_ts_reference_on_every_fixture() {
        let raw = std::fs::read_to_string(FIXTURES).expect("read strategy-cases.json");
        let cases: Vec<FixtureCase> = serde_json::from_str(&raw).expect("parse fixtures");
        assert!(cases.len() >= 9, "expected the full nine-case fixture set");

        for case in &cases {
            let candles: Vec<StratCandle> = case
                .candles
                .iter()
                .map(|k| StratCandle {
                    o: k.o.parse().expect("o u64"),
                    h: k.h.parse().expect("h u64"),
                    l: k.l.parse().expect("l u64"),
                    c: k.c.parse().expect("c u64"),
                    path_len: k.path_len.parse().expect("pathLen u64"),
                })
                .collect();
            let params = StrategyParams {
                read_span: 1,
                breakout_bps: case.params.breakout_bps,
                activity_mult_bps: case.params.activity_mult_bps,
                trend_filter: case.params.trend_filter,
                stake_frac_bps: 0,
                leverage: 1,
                max_hold_ticks: 0,
                exit_favorable_bps: 0,
            };
            let expected = match case.expected.as_deref() {
                Some("long") => Some(Side::Long),
                Some("short") => Some(Side::Short),
                None => None,
                Some(other) => panic!("unknown expected side {other:?} in {}", case.name),
            };
            assert_eq!(
                decide_ring_momentum(&candles, &params),
                expected,
                "fixture diverged: {}",
                case.name
            );
        }
    }

    #[test]
    fn fails_closed_outside_breakout_bps_domain() {
        // Mirror of the TS-only domain test: a fixture that fires long at
        // breakout_bps=60 must fail closed at breakout_bps >= 10_000 (where
        // the short comparison would underflow u64 semantics).
        let raw = std::fs::read_to_string(FIXTURES).expect("read strategy-cases.json");
        let cases: Vec<FixtureCase> = serde_json::from_str(&raw).expect("parse fixtures");
        let long_case = cases
            .iter()
            .find(|c| c.expected.as_deref() == Some("long"))
            .expect("a long fixture exists");
        let candles: Vec<StratCandle> = long_case
            .candles
            .iter()
            .map(|k| StratCandle {
                o: k.o.parse().unwrap(),
                h: k.h.parse().unwrap(),
                l: k.l.parse().unwrap(),
                c: k.c.parse().unwrap(),
                path_len: k.path_len.parse().unwrap(),
            })
            .collect();
        for bo in [10_000u16, 10_001, u16::MAX] {
            let params = StrategyParams {
                read_span: 1,
                breakout_bps: bo,
                activity_mult_bps: long_case.params.activity_mult_bps,
                trend_filter: long_case.params.trend_filter,
                stake_frac_bps: 0,
                leverage: 1,
                max_hold_ticks: 0,
                exit_favorable_bps: 0,
            };
            assert_eq!(decide_ring_momentum(&candles, &params), None, "bo={bo}");
        }
    }
}
