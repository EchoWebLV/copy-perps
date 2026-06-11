// arena-program/programs/arena/src/oracle.rs
use anchor_lang::prelude::*;

pub const PRICE_OFFSET: usize = 73;      // i64 LE (verified Spike B)
pub const PUBLISH_TS_OFFSET: usize = 93; // i64 LE

pub struct OracleRead { pub price: u64, pub publish_ts: i64 }

pub fn read_feed(data: &[u8], now_ts: i64, max_age_secs: i64) -> Option<OracleRead> {
    if data.len() < PUBLISH_TS_OFFSET + 8 { return None }
    let price_i = i64::from_le_bytes(data[PRICE_OFFSET..PRICE_OFFSET + 8].try_into().ok()?);
    let publish_ts = i64::from_le_bytes(data[PUBLISH_TS_OFFSET..PUBLISH_TS_OFFSET + 8].try_into().ok()?);
    if price_i <= 0 { return None }
    if now_ts.saturating_sub(publish_ts) > max_age_secs { return None } // stale → fail closed
    Some(OracleRead { price: price_i as u64, publish_ts })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn synth(price: i64, ts: i64) -> Vec<u8> {
        let mut d = vec![0u8; 134];
        d[PRICE_OFFSET..PRICE_OFFSET + 8].copy_from_slice(&price.to_le_bytes());
        d[PUBLISH_TS_OFFSET..PUBLISH_TS_OFFSET + 8].copy_from_slice(&ts.to_le_bytes());
        d
    }
    #[test] fn fresh_price_reads() {
        let r = read_feed(&synth(150_0000_0000, 1000), 1005, 10).unwrap();
        assert_eq!(r.price, 150_0000_0000);
    }
    #[test] fn stale_rejected() { assert!(read_feed(&synth(150_0000_0000, 1000), 1011, 10).is_none()); }
    #[test] fn negative_rejected() { assert!(read_feed(&synth(-5, 1000), 1001, 10).is_none()); }
}
