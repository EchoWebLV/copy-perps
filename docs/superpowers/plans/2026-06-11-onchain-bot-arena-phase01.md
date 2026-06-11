# On-Chain Bot Arena — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paper-trading bots whose strategy executes as Anchor program code inside a MagicBlock Ephemeral Rollup on devnet, reading MagicBlock's Pyth Lazer oracle feed PDAs, ticked by a lease-guarded crank.

**Architecture:** One Anchor program (`arena`) with `ArenaConfig` / `MarketState` / `Bot` accounts; pure Rust modules (candles, strategy, paper engine) mirrored by a TS reference implementation sharing JSON fixtures for decision parity; a TS crank loop (existing ticker-lease pattern) sends free `tick` txs to the ER every ~2s and commits every ~5 min.

**Tech Stack:** Anchor (pin per Phase-0 spike, default `anchor-lang 0.31.1`), `ephemeral-rollups-sdk` (pin per spike), manual `PriceUpdateV2` offset reads (no receiver-sdk dependency), TypeScript/vitest for reference + crank, devnet ER `https://devnet.magicblock.app`.

**Spec:** `docs/superpowers/specs/2026-06-11-onchain-bot-arena-design.md` (read it first).

**Scope note:** This plan covers Phase 0 (spikes, gate everything) and Phase 1 (program + crank, SOL market, 2 bots, devnet). Phases 2–4 (arena UI, copy-trading, mainnet + Grok oracle-bot) get their own plans at each phase boundary — their detail depends on what the spikes pin down.

**Shared constants (used across tasks — keep identical everywhere):**
- Prices: `u64` at 1e8 scale (Lazer exponent −8). Balances/stakes: `u64` micro-USD (1e6).
- Side: `0 = long`, `1 = short`. Tape actions: `0 OPEN_LONG, 1 OPEN_SHORT, 2 EXIT_FAVORABLE, 3 EXIT_MAX_HOLD, 4 LIQUIDATED`.
- Ring: 64 buckets × 15s. Strategy reads the most recent 12 *complete* strategy-candles (base buckets aggregated by `read_span` ∈ {1, 4}).
- Feed PDA layout (verified June 2026): `price: i64` LE at byte offset **73**, `publish_time: i64` LE at byte offset **93**.
- Devnet feed PDAs: SOLUSD `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu`, BTCUSD `71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr`, ETHUSD `5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG`.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the working branch**

```bash
cd /Users/yordanlasonov/Documents/GitHub/copy-perps
git checkout feat/flash-tail-persistence && git pull --ff-only || true
git checkout -b feat/onchain-arena
```

Expected: on branch `feat/onchain-arena`. (The handoff prerequisites — live-verify, merge, deploy, key rotation — are tracked separately and do NOT block devnet arena work; they DO block anything user-facing.)

---

### Task 1: Toolchain + pins record (Phase 0)

**Files:**
- Create: `arena-program/PINS.md`

- [ ] **Step 1: Install / verify toolchain**

```bash
rustc --version && solana --version && anchor --version || true
# If missing: install per docs.anchor-lang.com — agave/solana CLI + anchor via avm.
npx add-skill https://github.com/magicblock-labs/magicblock-dev-skill
```

- [ ] **Step 2: Clone the two canonical repos and record their pins**

```bash
mkdir -p ~/spikes && cd ~/spikes
git clone https://github.com/magicblock-labs/magicblock-engine-examples
git clone https://github.com/magicblock-labs/real-time-pricing-oracle
grep -r "ephemeral-rollups-sdk\|anchor-lang" magicblock-engine-examples/anchor-counter/programs/*/Cargo.toml real-time-pricing-oracle/program/ephemeral-oracle/programs/*/Cargo.toml
```

- [ ] **Step 3: Write `arena-program/PINS.md`** recording: rustc/solana/anchor versions, the anchor-counter `ephemeral-rollups-sdk` pin, the oracle repo pins (`anchor-lang 0.31.1` / `er-sdk 0.2.4` as of June 2026), the cloned commit SHAs, and the decision rule: **the arena uses the anchor-counter er-sdk pin if its delegation flow passes Task 2; never mix doc snippets from other versions.**

- [ ] **Step 4: Commit**

```bash
git add arena-program/PINS.md && git commit -m "chore(arena): record toolchain + SDK pins for ER work"
```

---

### Task 2: Spike A — stock anchor-counter on devnet ER (GATE)

**Files:** none in-repo (spike in `~/spikes`; results appended to `arena-program/PINS.md`)

- [ ] **Step 1: Run the stock example exactly as shipped**

```bash
cd ~/spikes/magicblock-engine-examples/anchor-counter
# Follow its README verbatim: build, deploy to devnet, then the test that
# delegates the counter, writes via the ER router, commits, undelegates.
solana airdrop 2 --url devnet || true   # repeat as needed
anchor build && anchor deploy --provider.cluster devnet
anchor test --skip-deploy --provider.cluster devnet
```

Expected: the full delegate → ER write (via `https://devnet-router.magicblock.app`) → commit → undelegate cycle passes.

- [ ] **Step 2: Record outcome in PINS.md and commit.** GATE RULE: if this cannot be made to pass (after honest debugging, not version-mixing), STOP the plan and escalate to the user — every later task assumes this flow works.

```bash
cd /Users/yordanlasonov/Documents/GitHub/copy-perps
git add arena-program/PINS.md && git commit -m "chore(arena): spike A passed — stock counter on devnet ER"
```

---

### Task 3: Spike B — read the devnet SOLUSD oracle feed (GATE)

**Files:**
- Create: `scripts/arena/_spike-oracle-read.ts`

- [ ] **Step 1: Write the spike script**

```typescript
// scripts/arena/_spike-oracle-read.ts
// Reads MagicBlock's pushed Pyth Lazer SOLUSD feed PDA from the devnet ER
// and asserts the documented PriceUpdateV2 offsets parse to a sane, fresh price.
import { Connection, PublicKey } from "@solana/web3.js";

const ER_ENDPOINT = "https://devnet.magicblock.app";
const SOLUSD_FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const PRICE_OFFSET = 73; // i64 LE
const PUBLISH_TS_OFFSET = 93; // i64 LE

async function main() {
  const conn = new Connection(ER_ENDPOINT, "processed");
  const info = await conn.getAccountInfo(SOLUSD_FEED);
  if (!info) throw new Error("feed account not found on ER endpoint");
  const price = info.data.readBigInt64LE(PRICE_OFFSET);
  const publishTs = info.data.readBigInt64LE(PUBLISH_TS_OFFSET);
  const ageSec = Math.floor(Date.now() / 1000) - Number(publishTs);
  const priceUsd = Number(price) / 1e8;
  console.log({ owner: info.owner.toBase58(), priceUsd, publishTs: Number(publishTs), ageSec });
  if (priceUsd < 5 || priceUsd > 5000) throw new Error(`implausible SOL price ${priceUsd}`);
  if (ageSec > 60) throw new Error(`stale feed: ${ageSec}s old`);
  console.log("SPIKE B PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

```bash
npx tsx scripts/arena/_spike-oracle-read.ts
```

Expected: `SPIKE B PASS` with a live SOL price and `ageSec` in single digits. If offsets fail, dump `info.data.length` and the first 120 bytes hex, compare against `real-time-pricing-oracle` docs, and record the corrected offsets in PINS.md (they become the shared constants). GATE RULE: no pass → stop and escalate.

- [ ] **Step 3: Also dump the account to a test fixture for local-validator tests**

```bash
solana account ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu \
  --url https://devnet.magicblock.app --output json \
  > arena-program/tests/fixtures/solusd-feed.json
```

- [ ] **Step 4: Commit**

```bash
git add scripts/arena/_spike-oracle-read.ts arena-program/tests/fixtures/solusd-feed.json arena-program/PINS.md
git commit -m "chore(arena): spike B passed — devnet oracle feed parses at documented offsets"
```

---

### Task 4: Anchor workspace scaffold

**Files:**
- Create: `arena-program/Anchor.toml`, `arena-program/Cargo.toml`, `arena-program/programs/arena/Cargo.toml`, `arena-program/programs/arena/src/lib.rs`, `arena-program/package.json`, `arena-program/tsconfig.json`, `arena-program/tests/arena.ts`

- [ ] **Step 1: Scaffold with anchor, mirroring the anchor-counter layout at the recorded pins**

```bash
cd arena-program && anchor init --no-git arena_tmp 2>/dev/null || true
```

Then lay out the workspace by hand (anchor init in a subdir is messy): copy `Anchor.toml`, workspace `Cargo.toml`, `package.json`, and the test-validator config **from the cloned anchor-counter at the PINS.md commit**, renaming program to `arena`. Set in `programs/arena/Cargo.toml` exactly the pins from PINS.md (e.g. `anchor-lang = "=0.31.1"`, `ephemeral-rollups-sdk = { version = "=<pinned>", features = ["anchor"] }`).

- [ ] **Step 2: Minimal lib.rs that builds**

```rust
// arena-program/programs/arena/src/lib.rs
use anchor_lang::prelude::*;

declare_id!("Arena1111111111111111111111111111111111111"); // replaced after first deploy

#[program]
pub mod arena {
    use super::*;
    pub fn ping(_ctx: Context<Ping>) -> Result<()> { Ok(()) }
}

#[derive(Accounts)]
pub struct Ping {}
```

- [ ] **Step 3: Build + empty test green**

```bash
cd arena-program && anchor build && anchor test
```

Expected: build succeeds; the default mocha test calls `ping` and passes.

- [ ] **Step 4: Commit**

```bash
git add arena-program && git commit -m "feat(arena): anchor workspace scaffold at pinned toolchain"
```

---

### Task 5: TS reference strategy + shared fixtures (TDD)

**Files:**
- Create: `fixtures/arena/strategy-cases.json`
- Create: `lib/arena/strategy-reference.ts`
- Test: `lib/arena/strategy-reference.test.ts`

The reference implementation is the parity source of truth for the Rust port. **All math in `bigint`** so semantics match Rust `u64/u128` exactly.

- [ ] **Step 1: Write fixtures.** At least these cases (prices at 1e8 scale; 12 candles each unless noted):

```json
[
  { "name": "clean long breakout: last close 0.7% over prior high, pathLen 2x avg, uptrend",
    "params": { "breakoutBps": 60, "activityMultBps": 14000, "trendFilter": true },
    "candles": "<12 candles: closes drift 100.00→101.00, last close 101.90 vs prior high 101.20, last pathLen 2x prior avg>",
    "expected": "long" },
  { "name": "breakout without activity confirm is vetoed", "expected": null },
  { "name": "short breakout in downtrend", "expected": "short" },
  { "name": "long breakout against net-down trend is vetoed (trendFilter)", "expected": null },
  { "name": "breakout below threshold (0.5% < 0.6%) is vetoed", "expected": null },
  { "name": "fewer than 12 candles → null", "expected": null },
  { "name": "zero pathLen everywhere (flat tape) → null", "expected": null }
]
```

Write the candles arrays out fully — every candle `{ "o": "...", "h": "...", "l": "...", "c": "...", "pathLen": "..." }` as **decimal strings** (JSON can't hold u64). Compute the expected results by hand while authoring; the fixture IS the spec of the adapted strategy.

- [ ] **Step 2: Write the failing test**

```typescript
// lib/arena/strategy-reference.test.ts
import { describe, expect, it } from "vitest";
import cases from "../../fixtures/arena/strategy-cases.json";
import { decideRingMomentum, type StrategyCandle } from "./strategy-reference";

describe("ring momentum v1 reference", () => {
  for (const c of cases as any[]) {
    it(c.name, () => {
      const candles: StrategyCandle[] = c.candles.map((k: any) => ({
        o: BigInt(k.o), h: BigInt(k.h), l: BigInt(k.l), c: BigInt(k.c), pathLen: BigInt(k.pathLen),
      }));
      expect(decideRingMomentum(candles, c.params)).toBe(c.expected);
    });
  }
});
```

- [ ] **Step 3: Run, expect FAIL** (`npx vitest run lib/arena/strategy-reference.test.ts` — module not found)

- [ ] **Step 4: Implement**

```typescript
// lib/arena/strategy-reference.ts
// TS reference of the on-chain "ring momentum v1" strategy. BigInt-only math —
// this file is the parity oracle for the Rust port; change them together.
export interface StrategyCandle { o: bigint; h: bigint; l: bigint; c: bigint; pathLen: bigint; }
export interface StrategyParams { breakoutBps: number; activityMultBps: number; trendFilter: boolean; }
export const MIN_CANDLES = 12;
const BPS = 10_000n;

export function decideRingMomentum(
  candles: StrategyCandle[], params: StrategyParams,
): "long" | "short" | null {
  if (candles.length < MIN_CANDLES) return null;
  const last = candles[candles.length - 1];
  if (last.c <= 0n) return null;
  const prior = candles.slice(0, -1);
  let priorHigh = 0n, priorLow = (1n << 64n) - 1n, pathSum = 0n;
  for (const k of prior) {
    if (k.h > priorHigh) priorHigh = k.h;
    if (k.l < priorLow) priorLow = k.l;
    pathSum += k.pathLen;
  }
  if (priorHigh <= 0n || priorLow <= 0n) return null;

  // Breakout: last close clears prior range by >= breakoutBps (integer cross-multiply).
  const bo = BigInt(params.breakoutBps);
  let side: "long" | "short" | null = null;
  if (last.c * BPS >= priorHigh * (BPS + bo)) side = "long";
  else if (last.c * BPS <= priorLow * (BPS - bo)) side = "short";
  if (!side) return null;

  // Activity confirm: last pathLen * priorCount * BPS >= activityMult * pathSum.
  const mult = BigInt(params.activityMultBps);
  if (pathSum <= 0n) return null;
  if (last.pathLen * BigInt(prior.length) * BPS < mult * pathSum) return null;

  // Trend filter: net move across the window agrees with the side.
  if (params.trendFilter) {
    const first = candles[0].c;
    if (first <= 0n) return null;
    if (side === "long" && last.c <= first) return null;
    if (side === "short" && last.c >= first) return null;
  }
  return side;
}
```

- [ ] **Step 5: Run, expect PASS.** If a hand-computed `expected` disagrees with the implementation, re-derive the fixture by hand — the fixture wins unless its arithmetic was wrong.

- [ ] **Step 6: Commit**

```bash
git add fixtures/arena lib/arena/strategy-reference.ts lib/arena/strategy-reference.test.ts
git commit -m "feat(arena): ring-momentum v1 TS reference + parity fixtures"
```

---

### Task 6: Rust state structs + size tests

**Files:**
- Create: `arena-program/programs/arena/src/state.rs`
- Modify: `arena-program/programs/arena/src/lib.rs` (add `pub mod state;`)

- [ ] **Step 1: Write state.rs**

```rust
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
    pub open: u64, pub high: u64, pub low: u64, pub close: u64,
    pub start_ts: i64, pub updates: u32, pub path_len: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct MarketCfg { pub market_id: u8, pub feed: Pubkey, pub active: bool }

#[account]
#[derive(InitSpace)]
pub struct ArenaConfig {
    pub admin: Pubkey,
    pub fee_bps: u16,           // taker fee on notional, default 6
    pub spread_bps: u16,        // entry/exit haircut, default 5
    pub maint_buffer_bps: u16,  // default 500 (5% of the 1/lev distance)
    pub max_age_secs: i64,      // oracle staleness guard, default 10
    pub bucket_secs: i64,       // default 15
    pub markets: [MarketCfg; MAX_MARKETS],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub market_id: u8,
    pub last_price: u64,
    pub last_publish_ts: i64,
    pub head: u16,                       // index of the in-progress bucket
    pub ring: [Bucket; RING_LEN],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Position {
    pub active: bool, pub market_id: u8, pub side: u8,
    pub entry_price: u64, pub stake_micro: u64, pub leverage: u16,
    pub opened_ts: i64, pub ticks_held: u32, pub liq_price: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct TapeEntry {
    pub ts: i64, pub market_id: u8, pub action: u8,
    pub price: u64, pub stake_micro: u64, pub conviction: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct StrategyParams {
    pub read_span: u8,          // 1 or 4 base buckets per strategy candle
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
    pub trades: u32, pub wins: u32,
    pub gross_pnl_micro: i64, pub fees_micro: u64,
    pub equity_high_micro: u64,
    pub seq: u64,
    pub tape_head: u16,
    pub tape: [TapeEntry; TAPE_LEN],
    pub bump: u8,
}
```

- [ ] **Step 2: Size test (rust unit test in the same file)**

```rust
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
```

- [ ] **Step 3: Run + commit**

```bash
cd arena-program && cargo test -p arena && cd ..
git add arena-program && git commit -m "feat(arena): account state structs with single-init size guarantee"
```

---

### Task 7: Candle ring fold (Rust, TDD)

**Files:**
- Create: `arena-program/programs/arena/src/candles.rs`
- Modify: `arena-program/programs/arena/src/lib.rs` (add `pub mod candles;`)

- [ ] **Step 1: Failing tests first** — in `candles.rs` `#[cfg(test)]`: (a) first fold initializes the bucket o=h=l=c=price, pathLen 0, updates 1; (b) same-bucket fold updates h/l/c, pathLen += |Δ|, updates += 1; (c) fold with ts in the next bucket rolls head forward and seeds the new bucket from the previous close (gap buckets are seeded flat); (d) `complete_candles(read_span)` excludes the in-progress bucket, aggregates span groups (o of first, h max, l min, c of last, pathLen sum), returns newest-last.

- [ ] **Step 2: Implement**

```rust
// arena-program/programs/arena/src/candles.rs
use crate::state::{Bucket, MarketState, RING_LEN};

pub fn fold_price(ms: &mut MarketState, price: u64, publish_ts: i64, bucket_secs: i64) {
    let head = ms.head as usize;
    let cur = &mut ms.ring[head];
    if cur.updates == 0 {
        *cur = Bucket { open: price, high: price, low: price, close: price,
                        start_ts: bucket_start(publish_ts, bucket_secs), updates: 1, path_len: 0 };
    } else if publish_ts < cur.start_ts + bucket_secs {
        let delta = price.abs_diff(cur.close);
        cur.path_len = cur.path_len.saturating_add(delta);
        if price > cur.high { cur.high = price }
        if price < cur.low { cur.low = price }
        cur.close = price;
        cur.updates = cur.updates.saturating_add(1);
    } else {
        // Roll forward, seeding any skipped buckets flat at the last close.
        let mut start = cur.start_ts;
        let prev_close = cur.close;
        let target = bucket_start(publish_ts, bucket_secs);
        let mut head_now = ms.head as usize;
        while start < target {
            start += bucket_secs;
            head_now = (head_now + 1) % RING_LEN;
            ms.ring[head_now] = Bucket { open: prev_close, high: prev_close, low: prev_close,
                close: prev_close, start_ts: start, updates: 0, path_len: 0 };
        }
        ms.head = head_now as u16;
        let b = &mut ms.ring[head_now];
        let delta = price.abs_diff(prev_close);
        b.path_len = delta; b.updates = 1;
        if price > b.high { b.high = price }
        if price < b.low { b.low = price }
        b.close = price;
    }
    ms.last_price = price;
    ms.last_publish_ts = publish_ts;
}

fn bucket_start(ts: i64, bucket_secs: i64) -> i64 { ts - ts.rem_euclid(bucket_secs) }

/// Newest-last complete strategy candles, aggregated by `span` base buckets.
pub struct StratCandle { pub o: u64, pub h: u64, pub l: u64, pub c: u64, pub path_len: u64 }

pub fn complete_candles(ms: &MarketState, span: usize, want: usize) -> Vec<StratCandle> {
    let need = span * want;
    let mut base: Vec<&Bucket> = Vec::with_capacity(need);
    // Walk backwards from head-1 (head is in-progress), collecting initialized buckets.
    for i in 1..=need.min(RING_LEN - 1) {
        let idx = (ms.head as usize + RING_LEN - i) % RING_LEN;
        let b = &ms.ring[idx];
        if b.start_ts == 0 { break } // never initialized
        base.push(b);
    }
    base.reverse();
    if base.len() < need { return Vec::new() }
    base.chunks(span).map(|g| StratCandle {
        o: g[0].open,
        h: g.iter().map(|b| b.high).max().unwrap(),
        l: g.iter().map(|b| b.low).min().unwrap(),
        c: g[g.len() - 1].close,
        path_len: g.iter().map(|b| b.path_len).sum(),
    }).collect()
}
```

(Note: `Vec` in test/program context — for the on-chain path the call sites use fixed `want = MIN_STRAT_CANDLES`; if heap use proves a compute problem on the ER, refactor to a fixed array — measured in Task 13, not preemptively.)

- [ ] **Step 3: `cargo test -p arena` → PASS, then commit** (`feat(arena): candle ring fold + aggregation`)

---

### Task 8: Rust strategy + fixture parity (TDD)

**Files:**
- Create: `arena-program/programs/arena/src/strategy.rs`
- Modify: `arena-program/programs/arena/src/lib.rs`, `arena-program/programs/arena/Cargo.toml` (dev-deps `serde`, `serde_json`)

- [ ] **Step 1: Failing parity test** — a `#[cfg(test)]` test that reads `../../fixtures/arena/strategy-cases.json` (path relative to crate: `../../../fixtures/arena/strategy-cases.json`; resolve with `concat!(env!("CARGO_MANIFEST_DIR"), ...)`), deserializes candles (decimal strings → u64), runs `decide_ring_momentum`, and asserts the expected side for EVERY case. Run → fails (module missing).

- [ ] **Step 2: Implement the strategy as a line-for-line mirror of the TS reference**

```rust
// arena-program/programs/arena/src/strategy.rs
use crate::candles::StratCandle;
use crate::state::{StrategyParams, BPS, MIN_STRAT_CANDLES};

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum Side { Long, Short }

pub fn decide_ring_momentum(candles: &[StratCandle], p: &StrategyParams) -> Option<Side> {
    if candles.len() < MIN_STRAT_CANDLES { return None }
    let last = &candles[candles.len() - 1];
    if last.c == 0 { return None }
    let prior = &candles[..candles.len() - 1];
    let prior_high = prior.iter().map(|k| k.h).max()?;
    let prior_low = prior.iter().map(|k| k.l).min()?;
    let path_sum: u128 = prior.iter().map(|k| k.path_len as u128).sum();
    if prior_high == 0 || prior_low == 0 { return None }

    let bo = p.breakout_bps as u128;
    let lc = last.c as u128;
    let side = if lc * BPS as u128 >= prior_high as u128 * (BPS as u128 + bo) { Side::Long }
        else if lc * BPS as u128 <= prior_low as u128 * (BPS as u128 - bo) { Side::Short }
        else { return None };

    if path_sum == 0 { return None }
    let mult = p.activity_mult_bps as u128;
    if (last.path_len as u128) * (prior.len() as u128) * (BPS as u128) < mult * path_sum { return None }

    if p.trend_filter {
        let first = candles[0].c;
        if first == 0 { return None }
        match side {
            Side::Long if last.c <= first => return None,
            Side::Short if last.c >= first => return None,
            _ => {}
        }
    }
    Some(side)
}
```

- [ ] **Step 3: `cargo test -p arena` → all fixture cases PASS.** Any divergence from the TS expectations is a port bug — fix Rust, never the fixture (unless the fixture's hand math was wrong, in which case fix BOTH the fixture and re-run the TS suite).

- [ ] **Step 4: Commit** (`feat(arena): on-chain strategy passes TS parity fixtures`)

---

### Task 9: Paper engine (Rust, TDD)

**Files:**
- Create: `arena-program/programs/arena/src/paper.rs`
- Modify: `arena-program/programs/arena/src/lib.rs`

- [ ] **Step 1: Failing tests** covering, with hand-computed integer expectations: open deducts stake+fee and sets a correct liq price (long AND short); favorable exit credits stake+pnl−fee and increments wins; max-hold exit; liquidation zeroes the stake credit; loss clamped at stake on a gap through liq; stake floor + insufficient balance + no-free-slot + already-in-market all skip; tape entries appended with correct action codes and `seq` incremented.

- [ ] **Step 2: Implement**

```rust
// arena-program/programs/arena/src/paper.rs
use crate::state::*;
use crate::strategy::Side;

pub const ACT_OPEN_LONG: u8 = 0; pub const ACT_OPEN_SHORT: u8 = 1;
pub const ACT_EXIT_FAVORABLE: u8 = 2; pub const ACT_EXIT_MAX_HOLD: u8 = 3;
pub const ACT_LIQUIDATED: u8 = 4;

fn mul_div(a: u64, num: u64, den: u64) -> u64 { ((a as u128 * num as u128) / den as u128) as u64 }

fn push_tape(bot: &mut Bot, e: TapeEntry) {
    let h = bot.tape_head as usize % TAPE_LEN;
    bot.tape[h] = e;
    bot.tape_head = ((h + 1) % TAPE_LEN) as u16;
    bot.seq = bot.seq.saturating_add(1);
}

pub fn try_open(bot: &mut Bot, cfg: &ArenaConfig, market_id: u8, side: Side, price: u64, ts: i64) -> bool {
    if bot.positions.iter().any(|p| p.active && p.market_id == market_id) { return false }
    let Some(slot) = bot.positions.iter().position(|p| !p.active) else { return false };
    let stake = mul_div(bot.balance_micro, bot.params.stake_frac_bps as u64, BPS);
    if stake < MIN_STAKE_MICRO { return false }
    let lev = bot.params.leverage as u64;
    let notional = stake.saturating_mul(lev);
    let fee = mul_div(notional, cfg.fee_bps as u64, BPS);
    if bot.balance_micro < stake + fee { return false }

    let entry = match side {
        Side::Long => price + mul_div(price, cfg.spread_bps as u64, BPS),
        Side::Short => price - mul_div(price, cfg.spread_bps as u64, BPS),
    };
    // Liquidation distance: (1/lev) of entry, less the maintenance buffer.
    let dist = mul_div(entry, BPS - cfg.maint_buffer_bps as u64, lev * BPS);
    let liq = match side { Side::Long => entry.saturating_sub(dist), Side::Short => entry + dist };

    bot.balance_micro -= stake + fee;
    bot.fees_micro = bot.fees_micro.saturating_add(fee);
    bot.positions[slot] = Position {
        active: true, market_id, side: side as u8, entry_price: entry,
        stake_micro: stake, leverage: bot.params.leverage,
        opened_ts: ts, ticks_held: 0, liq_price: liq,
    };
    push_tape(bot, TapeEntry { ts, market_id, price: entry, stake_micro: stake, conviction: 0,
        action: if matches!(side, Side::Long) { ACT_OPEN_LONG } else { ACT_OPEN_SHORT } });
    true
}

/// Returns true if the position was closed this call.
pub fn close(bot: &mut Bot, idx: usize, cfg: &ArenaConfig, exit_mark: u64, ts: i64, action: u8) -> bool {
    let pos = bot.positions[idx];
    if !pos.active { return false }
    let long = pos.side == 0;
    let exit = if action == ACT_LIQUIDATED { pos.liq_price }
        else if long { exit_mark - mul_div(exit_mark, cfg.spread_bps as u64, BPS) }
        else { exit_mark + mul_div(exit_mark, cfg.spread_bps as u64, BPS) };
    let notional = pos.stake_micro.saturating_mul(pos.leverage as u64) as i128;
    let move_num = exit as i128 - pos.entry_price as i128;
    let mut pnl = notional * move_num / pos.entry_price as i128;
    if !long { pnl = -pnl }
    let fee = mul_div(pos.stake_micro.saturating_mul(pos.leverage as u64), cfg.fee_bps as u64, BPS);
    let credit_i = pos.stake_micro as i128 + pnl - fee as i128;
    let credit = if action == ACT_LIQUIDATED { 0u64 } else { credit_i.max(0) as u64 };
    bot.balance_micro = bot.balance_micro.saturating_add(credit);
    bot.fees_micro = bot.fees_micro.saturating_add(fee);
    bot.trades = bot.trades.saturating_add(1);
    if credit > pos.stake_micro { bot.wins = bot.wins.saturating_add(1) }
    bot.gross_pnl_micro = bot.gross_pnl_micro.saturating_add((credit as i128 - pos.stake_micro as i128) as i64);
    if bot.balance_micro > bot.equity_high_micro { bot.equity_high_micro = bot.balance_micro }
    bot.positions[idx].active = false;
    push_tape(bot, TapeEntry { ts, market_id: pos.market_id, price: exit,
        stake_micro: pos.stake_micro, conviction: 0, action });
    true
}

/// Per-tick maintenance for positions in `market_id`: liq check, favorable exit, max hold.
pub fn maintain(bot: &mut Bot, cfg: &ArenaConfig, market_id: u8, mark: u64, ts: i64) {
    for idx in 0..MAX_POSITIONS {
        let pos = bot.positions[idx];
        if !pos.active || pos.market_id != market_id { continue }
        let long = pos.side == 0;
        let liquidated = if long { mark <= pos.liq_price } else { mark >= pos.liq_price };
        if liquidated { close(bot, idx, cfg, mark, ts, ACT_LIQUIDATED); continue }
        // Favorable move >= exit_favorable_bps (cross-multiplied).
        let fav = if long { mark > pos.entry_price } else { mark < pos.entry_price };
        let diff = mark.abs_diff(pos.entry_price) as u128;
        if fav && diff * BPS as u128 >= pos.entry_price as u128 * bot.params.exit_favorable_bps as u128 {
            close(bot, idx, cfg, mark, ts, ACT_EXIT_FAVORABLE); continue;
        }
        bot.positions[idx].ticks_held = pos.ticks_held.saturating_add(1);
        if bot.positions[idx].ticks_held >= bot.params.max_hold_ticks {
            close(bot, idx, cfg, mark, ts, ACT_EXIT_MAX_HOLD);
        }
    }
}
```

- [ ] **Step 3: `cargo test -p arena` → PASS; commit** (`feat(arena): paper fill engine with liq/exit semantics`)

---

### Task 10: Init instructions + local validator test

**Files:**
- Create: `arena-program/programs/arena/src/oracle.rs`
- Modify: `arena-program/programs/arena/src/lib.rs`, `arena-program/tests/arena.ts`, `arena-program/Anchor.toml`

- [ ] **Step 1: oracle.rs — offset reader with layout constants from PINS.md**

```rust
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
```

- [ ] **Step 2: lib.rs instructions** — `init_config(fee_bps, spread_bps, maint_buffer_bps, max_age_secs, bucket_secs)` (PDA seed `[b"config"]`, admin = payer), `init_market(market_id, feed: Pubkey)` (PDA seed `[b"market", market_id]`, writes the `MarketCfg` slot, admin-gated), `init_bot(persona_id, params, starting_balance_micro)` (PDA seed `[b"bot", persona_id]`, admin-gated, validates `read_span ∈ {1,4}`, `leverage ≥ 1`, `stake_frac_bps ≤ 10000`). Standard Anchor `#[derive(Accounts)]` with `init`, `payer`, `space = 8 + T::INIT_SPACE`.

- [ ] **Step 3: Anchor.toml test fixture** — load the dumped devnet feed account at its real address into the local validator:

```toml
[[test.validator.account]]
address = "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"
filename = "tests/fixtures/solusd-feed.json"
```

- [ ] **Step 4: Mocha test** (`arena-program/tests/arena.ts`): init config (with `max_age_secs = 10_000_000_000` so the static fixture passes staleness in local tests), init SOL market pointing at the fixture address, init two bots (scalper: span 1 / breakout 60 / activity 14000 / stake 1000 bps / lev 100 / maxHold 90 / exit 100; rider: span 4 / breakout 80 / lev 20 / maxHold 240 / exit 150; both balance $1,000 = 1_000_000_000 micro). Assert fetched accounts round-trip the params.

- [ ] **Step 5: `anchor test` → PASS; commit** (`feat(arena): init instructions + oracle offset reader`)

---

### Task 11: `tick` instruction

**Files:**
- Modify: `arena-program/programs/arena/src/lib.rs`, `arena-program/tests/arena.ts`

- [ ] **Step 1: Implement `tick(market_id)`**

```rust
// in #[program] mod arena — accounts: config (seed check), market_state (mut, seed check),
// feed (UncheckedAccount, address MUST equal config.markets[market_id].feed),
// remaining_accounts = Bot accounts (mut).
pub fn tick<'info>(ctx: Context<'_, '_, '_, 'info, Tick<'info>>, market_id: u8) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let mcfg = cfg.markets.iter().find(|m| m.active && m.market_id == market_id)
        .ok_or(ArenaError::UnknownMarket)?;
    require_keys_eq!(ctx.accounts.feed.key(), mcfg.feed, ArenaError::WrongFeed);

    let now = Clock::get()?.unix_timestamp;
    let data = ctx.accounts.feed.try_borrow_data()?;
    let Some(read) = crate::oracle::read_feed(&data, now, cfg.max_age_secs) else {
        return Ok(()); // stale/malformed feed: no-op success — the arena pauses honestly
    };
    drop(data);

    let ms = &mut ctx.accounts.market_state;
    crate::candles::fold_price(ms, read.price, read.publish_ts, cfg.bucket_secs);

    for acc in ctx.remaining_accounts {
        let mut bot: Account<Bot> = Account::try_from(acc)?;
        crate::paper::maintain(&mut bot, cfg, market_id, read.price, now);
        let span = bot.params.read_span as usize;
        let candles = crate::candles::complete_candles(ms, span, MIN_STRAT_CANDLES);
        if let Some(side) = crate::strategy::decide_ring_momentum(&candles, &bot.params) {
            crate::paper::try_open(&mut bot, cfg, market_id, side, read.price, now);
        }
        bot.exit(&crate::ID)?; // serialize changes back (remaining_accounts are manual)
    }
    Ok(())
}
```

- [ ] **Step 2: Mocha tests**: (a) tick with the wrong feed account → fails with `WrongFeed`; (b) tick with huge `max_age_secs` config → succeeds and the fetched MarketState shows `last_price > 0` and one initialized bucket; (c) tick twice → `updates` grows or head rolls (fixture price is static so no entries fire — assert tape unchanged, `seq` unchanged). (Staleness no-op behavior is covered by the `oracle.rs` unit tests — don't duplicate it at the instruction level; the config is `init`-once.)

- [ ] **Step 3: `anchor test` → PASS; commit** (`feat(arena): tick — oracle read, fold, maintain, decide, open`)

---

### Task 12: Delegation lifecycle

**Files:**
- Modify: `arena-program/programs/arena/src/lib.rs`, `arena-program/tests/arena.ts`, `arena-program/package.json`

- [ ] **Step 1: Add `delegate_market` / `delegate_bot` / `commit_state` / `undelegate_*` instructions**, copying the exact macro usage (`#[ephemeral]` / delegate ix / commit helper) **from the anchor-counter example at the PINS.md pin** — the API surface differs across er-sdk versions, so the cloned example at the recorded commit is the only authority. Pin the ER validator pubkey in the delegate call (spec gotcha). Admin-gated.

- [ ] **Step 2: Local ephemeral-validator test** — mirror anchor-counter's test harness (`@magicblock-labs/ephemeral-validator` on localhost:7799): delegate MarketState + bots, send `tick` through the ephemeral connection, assert state visible via the ephemeral endpoint, then commit + undelegate and assert base-layer state matches.

- [ ] **Step 3: `anchor test` (with the ephemeral harness) → PASS; commit** (`feat(arena): ER delegation lifecycle`)

---

### Task 13: Devnet deploy + smoke

**Files:**
- Create: `scripts/arena/init-devnet.ts`, `scripts/arena/tick-once.ts`
- Modify: `arena-program/PINS.md` (record program id), `.env.example` (arena vars)

- [x] **Step 1: Deploy to devnet** (`anchor deploy --provider.cluster devnet`; update `declare_id!` + `Anchor.toml`, rebuild, redeploy). Record the program id in PINS.md. *(Done 2026-06-11: no `declare_id!` rewrite needed — the Task-4 keypair id `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC` deployed as-is via `solana program deploy --use-rpc` on Helius devnet; 2.767 SOL. Details in PINS.md "Task 13".)*

- [x] **Step 2: `scripts/arena/init-devnet.ts`** — using the workspace IDL + an admin keypair from `ARENA_ADMIN_KEYPAIR` (JSON array env): init config (fee 6 / spread 5 / maint 500 / max_age 10 / bucket 15), init SOL market with the real SOLUSD feed address, init the two bots from Task 10's params, then delegate market + bots to the devnet ER (validator pubkey pinned). Idempotent: skip every account that already exists. *(Shipped with `ARENA_ADMIN_KEYPAIR_PATH` — a keypair FILE path defaulting to `~/.config/solana/id.json` — instead of a JSON-array env; simpler for the local admin wallet. Devnet personas: `scalper-v1` / `rider-v1`, utf8 zero-padded to 16 bytes.)*

- [x] **Step 3: `scripts/arena/tick-once.ts`** — build one `tick(0)` tx with `[marketState, feed]` + bots as remaining accounts, send via `new Connection(process.env.ARENA_ER_ENDPOINT)` with `skipPreflight: true` and the ER blockhash; print the resulting MarketState (decode `last_price`, head bucket) read back from the ER endpoint.

- [x] **Step 4: Run both; expected: tick lands, `last_price` is a live SOL price.** *(lastPrice $66.69, live; three ticks recorded in PINS.md.)*

```bash
npx tsx --env-file=.env.local scripts/arena/init-devnet.ts
npx tsx --env-file=.env.local scripts/arena/tick-once.ts
```

- [x] **Step 5: Add to `.env.example`**: `ARENA_PROGRAM_ID=`, `ARENA_ER_ENDPOINT=https://devnet.magicblock.app`, `ARENA_ADMIN_KEYPAIR=`, `ARENA_CRANK_KEYPAIR=`, `ARENA_CRANK_INTERVAL_MS=2000`, `ARENA_COMMIT_INTERVAL_MS=300000`, `DISABLE_ARENA_CRANK=`. Commit (`feat(arena): devnet deploy + init/smoke scripts`).

---

### Task 14: Crank service

**Files:**
- Create: `lib/arena/lease.ts`, `lib/arena/crank.ts`, `scripts/arena/crank-worker.ts`
- Test: `lib/arena/crank.test.ts`
- (Decision 2026-06-11, binding: the crank runs on a NEW dedicated Railway worker service —
  do NOT touch `instrumentation.ts` or piggyback the prod web service. The lease guard stays
  mandatory anyway: dev runs and the worker share one Neon DB.)

- [ ] **Step 1: `lib/arena/lease.ts`** — copy `lib/autopilot/ticker-lease.ts` exactly, renaming table to `arena_crank_lease` and functions to `ensureArenaLeaseTable` / `acquireArenaCrankLease`. (Same TTL, same CAS upsert. Deliberate duplication: the two leases must be independently droppable.)

- [ ] **Step 2: Failing vitest for the pure parts of the crank** — `lib/arena/crank.test.ts` covering `shouldCommit(lastCommitMs, nowMs, intervalMs)` and `buildTickPlan(markets, bots)` (groups bot pubkeys per market, caps remaining accounts at 10) with stubbed values; and that `startArenaCrank()` is a no-op when `DISABLE_ARENA_CRANK === "true"` (mirror the autopilot ticker test approach — check `lib/autopilot/` tests for the established stubbing pattern and follow it).

- [ ] **Step 3: Implement `lib/arena/crank.ts`** — mirror `lib/autopilot/ticker.ts` structure verbatim (HOLDER id, startup delay, lease loop, lazy dep loading, `globalThis` start-once guard, `DISABLE_ARENA_CRANK` kill switch), with the tick body: for each active market, send `tick(marketId)` to the ER connection (`skipPreflight: true`, ER blockhash, `ARENA_CRANK_KEYPAIR` signer); every `ARENA_COMMIT_INTERVAL_MS`, send `commit_state`. Log one line per N ticks, every error, and every commit signature. All chain deps injected via a `CrankDeps` type (same DI style as `EngineDeps`) so the vitest never touches a connection.

- [ ] **Step 4: Create the worker entry** — `scripts/arena/crank-worker.ts`: calls `startArenaCrank()` and keeps the process alive; honors `DISABLE_ARENA_CRANK`. Add npm script `"arena:crank": "tsx scripts/arena/crank-worker.ts"`. File header documents the Railway setup (new worker service in the existing project, start command `npm run arena:crank`, env: `ARENA_PROGRAM_ID`, `ARENA_ER_ENDPOINT`, `ARENA_CRANK_KEYPAIR`, `ARENA_CRANK_INTERVAL_MS`, `ARENA_COMMIT_INTERVAL_MS`, `DATABASE_URL`); deploying the worker is a Phase-2+ ops step, not this task. Run `npx vitest run lib/arena` + `npm run typecheck` → PASS.

- [ ] **Step 5: Commit** (`feat(arena): lease-guarded crank ticking the ER`)

---

### Task 15: Devnet soak + Phase 1 exit checklist

**Files:**
- Modify: `arena-program/PINS.md` (soak notes)

- [ ] **Step 1: Run the crank locally against devnet** (`DISABLE_ARENA_CRANK` unset, `.env.local` arena vars set) for ≥ 2 hours. Watch: ticks landing every ~2s, buckets rolling every 15s, commits every 5 min visible on devnet Solscan, and — when SOL actually moves — entries/exits appearing in the tape.

- [ ] **Step 2: Exit checklist (all must be true to call Phase 1 done):**
  - `cargo test -p arena` and the anchor test suite green; `npx vitest run` green; `npm run typecheck` green.
  - A bot opened AND closed at least one paper position on devnet from real price action (force with a temporarily aggressive `breakout_bps=5` bot if SOL is flat; remove it after).
  - A commit signature on devnet Solscan whose committed Bot account state matches the ER-read state.
  - Tick compute fits: no compute-budget errors in ~2h of crank logs with 2 bots (re-check spec §13 item 4 before adding more bots).
  - Soak notes + any deviations recorded in PINS.md.

- [ ] **Step 3: Commit, then STOP** — Phase 2 (arena UI) gets its own plan informed by what the soak taught us.

---

## Self-review notes (already applied)

- Spec coverage: Phase 0 spikes (Tasks 1–3), program accounts/instructions (6, 10–12), strategy adaptation + parity (5, 8), paper model incl. fees/liq (9), crank + lease + kill switch (14), devnet rollout (13, 15). UI/copy/mainnet/Grok are explicitly Phase 2–4 plans.
- Types consistent across tasks: `StrategyParams` fields, action codes, offsets, and the `0=long/1=short` convention appear identically in Tasks 5–11.
- Known intentional deviation: er-sdk delegation API (Task 12) defers to the pinned example rather than inlining code — the API genuinely varies by version and inventing it here would be worse than pointing at the pinned source of truth.
