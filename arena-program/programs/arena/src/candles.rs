// arena-program/programs/arena/src/candles.rs
use crate::state::{Bucket, MarketState, RING_LEN};

pub fn fold_price(ms: &mut MarketState, price: u64, publish_ts: i64, bucket_secs: i64) {
    let head = ms.head as usize;
    let cur = &mut ms.ring[head];
    if cur.updates == 0 {
        *cur = Bucket {
            open: price,
            high: price,
            low: price,
            close: price,
            start_ts: bucket_start(publish_ts, bucket_secs),
            updates: 1,
            path_len: 0,
            _pad: [0; 4],
        };
    } else if publish_ts < cur.start_ts + bucket_secs {
        let delta = price.abs_diff(cur.close);
        cur.path_len = cur.path_len.saturating_add(delta);
        if price > cur.high {
            cur.high = price
        }
        if price < cur.low {
            cur.low = price
        }
        cur.close = price;
        cur.updates = cur.updates.saturating_add(1);
    } else {
        // Roll forward, seeding any skipped buckets flat at the last close.
        let mut start = cur.start_ts;
        let prev_close = cur.close;
        let target = bucket_start(publish_ts, bucket_secs);
        // Gap clamp (review Issue 1): without it, a multi-day publish_ts gap
        // runs the loop once per skipped bucket, blows the ER compute cap and
        // bricks tick stickily (every retry faces a bigger gap). Writes more
        // than RING_LEN buckets back would be overwritten before they could
        // ever be read, so fast-forwarding the cursor is semantics-free: the
        // loop runs at most RING_LEN times, fully reseeding the ring flat at
        // prev_close. Both operands are bucket-aligned, so the clamped start
        // stays on the bucket grid.
        start = start.max(target - RING_LEN as i64 * bucket_secs);
        let mut head_now = ms.head as usize;
        while start < target {
            start += bucket_secs;
            head_now = (head_now + 1) % RING_LEN;
            ms.ring[head_now] = Bucket {
                open: prev_close,
                high: prev_close,
                low: prev_close,
                close: prev_close,
                start_ts: start,
                updates: 0,
                path_len: 0,
                _pad: [0; 4],
            };
        }
        ms.head = head_now as u16;
        let b = &mut ms.ring[head_now];
        let delta = price.abs_diff(prev_close);
        b.path_len = delta;
        b.updates = 1;
        if price > b.high {
            b.high = price
        }
        if price < b.low {
            b.low = price
        }
        b.close = price;
    }
    ms.last_price = price;
    ms.last_publish_ts = publish_ts;
}

fn bucket_start(ts: i64, bucket_secs: i64) -> i64 {
    ts - ts.rem_euclid(bucket_secs)
}

/// Newest-last complete strategy candles, aggregated by `span` base buckets.
pub struct StratCandle {
    pub o: u64,
    pub h: u64,
    pub l: u64,
    pub c: u64,
    pub path_len: u64,
}

pub fn complete_candles(ms: &MarketState, span: usize, want: usize) -> Vec<StratCandle> {
    let need = span * want;
    let mut base: Vec<&Bucket> = Vec::with_capacity(need);
    // Walk backwards from head-1 (head is in-progress), collecting initialized buckets.
    for i in 1..=need.min(RING_LEN - 1) {
        let idx = (ms.head as usize + RING_LEN - i) % RING_LEN;
        let b = &ms.ring[idx];
        if b.start_ts == 0 {
            break; // never initialized
        }
        base.push(b);
    }
    base.reverse();
    if base.len() < need {
        return Vec::new();
    }
    base.chunks(span)
        .map(|g| StratCandle {
            o: g[0].open,
            h: g.iter().map(|b| b.high).max().unwrap(),
            l: g.iter().map(|b| b.low).min().unwrap(),
            c: g[g.len() - 1].close,
            path_len: g.iter().map(|b| b.path_len).sum(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Bucket, MarketState, RING_LEN};

    const BUCKET_SECS: i64 = 15;

    fn fresh_ms() -> MarketState {
        MarketState {
            market_id: 0,
            last_price: 0,
            last_publish_ts: 0,
            head: 0,
            ring: [Bucket::default(); RING_LEN],
            bump: 0,
            _pad: [0; 4],
        }
    }

    fn mk_bucket(o: u64, h: u64, l: u64, c: u64, start_ts: i64, path_len: u64) -> Bucket {
        Bucket { open: o, high: h, low: l, close: c, start_ts, updates: 1, path_len, _pad: [0; 4] }
    }

    #[test]
    fn first_fold_initializes_bucket() {
        let mut ms = fresh_ms();
        fold_price(&mut ms, 100, 1000, BUCKET_SECS);
        let b = &ms.ring[0];
        assert_eq!(b.open, 100);
        assert_eq!(b.high, 100);
        assert_eq!(b.low, 100);
        assert_eq!(b.close, 100);
        assert_eq!(b.start_ts, 990); // 1000 - 1000 % 15
        assert_eq!(b.updates, 1);
        assert_eq!(b.path_len, 0);
        assert_eq!(ms.head, 0);
        assert_eq!(ms.last_price, 100);
        assert_eq!(ms.last_publish_ts, 1000);
    }

    #[test]
    fn same_bucket_fold_updates_hlc_pathlen_updates() {
        let mut ms = fresh_ms();
        fold_price(&mut ms, 100, 1000, BUCKET_SECS);
        fold_price(&mut ms, 105, 1003, BUCKET_SECS); // still < 990 + 15
        let b = &ms.ring[0];
        assert_eq!(b.open, 100);
        assert_eq!(b.high, 105);
        assert_eq!(b.low, 100);
        assert_eq!(b.close, 105);
        assert_eq!(b.path_len, 5);
        assert_eq!(b.updates, 2);

        fold_price(&mut ms, 98, 1004, BUCKET_SECS);
        let b = &ms.ring[0];
        assert_eq!(b.high, 105);
        assert_eq!(b.low, 98);
        assert_eq!(b.close, 98);
        assert_eq!(b.path_len, 12); // 5 + |98 - 105|
        assert_eq!(b.updates, 3);
        assert_eq!(ms.head, 0);
        assert_eq!(ms.last_price, 98);
    }

    #[test]
    fn next_bucket_ts_rolls_head() {
        let mut ms = fresh_ms();
        fold_price(&mut ms, 100, 1000, BUCKET_SECS); // bucket [990, 1005)
        fold_price(&mut ms, 110, 1006, BUCKET_SECS); // bucket [1005, 1020)
        assert_eq!(ms.head, 1);
        let prev = &ms.ring[0];
        assert_eq!(prev.close, 100); // untouched
        let b = &ms.ring[1];
        assert_eq!(b.open, 100); // seeded from prev close
        assert_eq!(b.high, 110);
        assert_eq!(b.low, 100);
        assert_eq!(b.close, 110);
        assert_eq!(b.start_ts, 1005);
        assert_eq!(b.updates, 1);
        assert_eq!(b.path_len, 10);
    }

    #[test]
    fn gap_buckets_seeded_flat_from_prev_close() {
        let mut ms = fresh_ms();
        fold_price(&mut ms, 100, 1000, BUCKET_SECS); // bucket [990, 1005)
        fold_price(&mut ms, 90, 1036, BUCKET_SECS); // bucket [1035, 1050) — skips 2
        assert_eq!(ms.head, 3);
        for (idx, start) in [(1usize, 1005i64), (2, 1020)] {
            let g = &ms.ring[idx];
            assert_eq!(g.open, 100);
            assert_eq!(g.high, 100);
            assert_eq!(g.low, 100);
            assert_eq!(g.close, 100);
            assert_eq!(g.start_ts, start);
            assert_eq!(g.updates, 0);
            assert_eq!(g.path_len, 0);
        }
        let b = &ms.ring[3];
        assert_eq!(b.open, 100);
        assert_eq!(b.high, 100);
        assert_eq!(b.low, 90);
        assert_eq!(b.close, 90);
        assert_eq!(b.start_ts, 1035);
        assert_eq!(b.updates, 1);
        assert_eq!(b.path_len, 10);
    }

    #[test]
    fn multi_day_gap_clamps_to_ring_len_and_recovers() {
        let mut ms = fresh_ms();
        fold_price(&mut ms, 100, 1000, BUCKET_SECS); // bucket [990, 1005), head 0

        // 10-day gap: 57_600 skipped buckets. Unclamped this loops 57k times
        // (ER compute death); clamped it must run exactly RING_LEN times.
        let ts2 = 1000 + 10 * 24 * 3600; // 865_000
        fold_price(&mut ms, 90, ts2, BUCKET_SECS);
        let target = ts2 - ts2.rem_euclid(BUCKET_SECS); // 864_990

        // RING_LEN iterations wrap the head all the way around: head is back
        // at 0 and points at the bucket holding the new price.
        assert_eq!(ms.head, 0);
        let b = &ms.ring[ms.head as usize];
        assert_eq!(b.start_ts, target);
        assert_eq!(b.open, 100); // seeded from prev close
        assert_eq!(b.high, 100);
        assert_eq!(b.low, 90);
        assert_eq!(b.close, 90);
        assert_eq!(b.updates, 1);
        assert_eq!(b.path_len, 10);
        assert_eq!(ms.last_price, 90);
        assert_eq!(ms.last_publish_ts, ts2);

        // Every other slot was reseeded flat at the prev close with
        // contiguous, bucket-aligned start_ts walking back from target —
        // the pre-gap [990, 1005) bucket is gone.
        for i in 1..RING_LEN {
            let idx = (ms.head as usize + RING_LEN - i) % RING_LEN;
            let g = &ms.ring[idx];
            assert_eq!(g.start_ts, target - i as i64 * BUCKET_SECS);
            assert_eq!(g.open, 100);
            assert_eq!(g.high, 100);
            assert_eq!(g.low, 100);
            assert_eq!(g.close, 100);
            assert_eq!(g.updates, 0);
            assert_eq!(g.path_len, 0);
        }

        // A subsequent normal fold lands in the same bucket...
        fold_price(&mut ms, 95, ts2 + 2, BUCKET_SECS); // 865_002 < 865_005
        assert_eq!(ms.head, 0);
        let b = &ms.ring[0];
        assert_eq!(b.close, 95);
        assert_eq!(b.updates, 2);
        assert_eq!(b.path_len, 15); // 10 + |95 - 90|

        // ...and the next bucket boundary rolls the head by exactly one.
        fold_price(&mut ms, 96, ts2 + 5, BUCKET_SECS); // 865_005 ⇒ next bucket
        assert_eq!(ms.head, 1);
        let nb = &ms.ring[1];
        assert_eq!(nb.start_ts, target + BUCKET_SECS);
        assert_eq!(nb.open, 95);
        assert_eq!(nb.close, 96);
        assert_eq!(nb.updates, 1);
        assert_eq!(nb.path_len, 1);
    }

    #[test]
    fn complete_candles_span1_excludes_in_progress_newest_last() {
        let mut ms = fresh_ms();
        ms.ring[0] = mk_bucket(100, 105, 95, 101, 990, 10);
        ms.ring[1] = mk_bucket(101, 106, 96, 102, 1005, 11);
        ms.ring[2] = mk_bucket(102, 107, 97, 103, 1020, 12);
        ms.ring[3] = mk_bucket(103, 108, 98, 104, 1035, 13);
        ms.ring[4] = mk_bucket(104, 999, 1, 555, 1050, 99); // in-progress head
        ms.head = 4;

        let out = complete_candles(&ms, 1, 4);
        assert_eq!(out.len(), 4);
        // Newest-last: ring[3] is the final candle; head (ring[4]) excluded.
        assert_eq!(out[0].o, 100);
        assert_eq!(out[0].c, 101);
        assert_eq!(out[3].o, 103);
        assert_eq!(out[3].h, 108);
        assert_eq!(out[3].l, 98);
        assert_eq!(out[3].c, 104);
        assert_eq!(out[3].path_len, 13);
        assert!(out.iter().all(|k| k.c != 555));
    }

    #[test]
    fn complete_candles_aggregates_span_groups() {
        let mut ms = fresh_ms();
        ms.ring[0] = mk_bucket(100, 105, 95, 101, 990, 10);
        ms.ring[1] = mk_bucket(101, 120, 96, 102, 1005, 11);
        ms.ring[2] = mk_bucket(102, 107, 80, 103, 1020, 12);
        ms.ring[3] = mk_bucket(103, 108, 98, 104, 1035, 13);
        ms.ring[4] = mk_bucket(104, 999, 1, 555, 1050, 99); // in-progress head
        ms.head = 4;

        let out = complete_candles(&ms, 2, 2);
        assert_eq!(out.len(), 2);
        // Group 1 = ring[0..2]: o first, h max, l min, c last, pathLen sum.
        assert_eq!(out[0].o, 100);
        assert_eq!(out[0].h, 120);
        assert_eq!(out[0].l, 95);
        assert_eq!(out[0].c, 102);
        assert_eq!(out[0].path_len, 21);
        // Group 2 = ring[2..4].
        assert_eq!(out[1].o, 102);
        assert_eq!(out[1].h, 108);
        assert_eq!(out[1].l, 80);
        assert_eq!(out[1].c, 104);
        assert_eq!(out[1].path_len, 25);
    }

    #[test]
    fn complete_candles_empty_when_insufficient() {
        let mut ms = fresh_ms();
        fold_price(&mut ms, 100, 1000, BUCKET_SECS); // only the in-progress bucket exists
        assert!(complete_candles(&ms, 1, 1).is_empty());

        // 3 complete buckets cannot satisfy span 2 x want 2 = 4.
        let mut ms = fresh_ms();
        ms.ring[0] = mk_bucket(100, 105, 95, 101, 990, 10);
        ms.ring[1] = mk_bucket(101, 106, 96, 102, 1005, 11);
        ms.ring[2] = mk_bucket(102, 107, 97, 103, 1020, 12);
        ms.ring[3] = mk_bucket(103, 108, 98, 104, 1035, 13); // in-progress head
        ms.head = 3;
        assert!(complete_candles(&ms, 2, 2).is_empty());
    }

    #[test]
    fn complete_candles_wraps_around_ring() {
        let mut ms = fresh_ms();
        ms.ring[62] = mk_bucket(100, 105, 95, 101, 990, 10);
        ms.ring[63] = mk_bucket(101, 106, 96, 102, 1005, 11);
        ms.ring[0] = mk_bucket(102, 107, 97, 103, 1020, 12);
        ms.ring[1] = mk_bucket(103, 999, 1, 555, 1035, 99); // in-progress head
        ms.head = 1;

        let out = complete_candles(&ms, 1, 3);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].c, 101); // ring[62] oldest
        assert_eq!(out[1].c, 102);
        assert_eq!(out[2].c, 103); // ring[0] newest
    }
}
