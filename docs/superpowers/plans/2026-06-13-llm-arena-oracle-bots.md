# LLM Arena — Oracle Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-driven "oracle bots" (Claude + Grok) to the on-chain ER arena: an off-chain brain decides open/close, an operator-signed `apply_decision` instruction enforces a hard safety floor in immutable program code and computes paper PnL with realistic fees, all fully tested.

**Architecture:** A separate zero-copy `LlmBot` account (the live `Bot` layout is locked — do not touch it) holds paper state + on-chain guardrail params. `apply_decision` (signer = bot operator) reads the oracle price, enforces the floor (max-lev clamp, mandatory stop, cooldown, trade cap, daily-loss kill-switch), and applies a paper open/close with taker fee on both legs + spread + a deterministic funding holding-cost proxy. `tick` runs deterministic `maintain_llm` (stop/tp/liq/max-hold/funding) for LlmBots every ~2s. Off-chain, a lease-guarded loop builds ONE shared market brief (price/candles/indicators/funding/OI+long-short/sentiment + the bot's own book), calls the model via the AI SDK, pre-checks, and submits `apply_decision`. The floor math is implemented once in Rust + once in TS against shared JSON fixtures for parity.

**Tech Stack:** Anchor 1.0.2 + `ephemeral-rollups-sdk` 0.14.3 (Rust, zero-copy/AccountLoader), MagicBlock ER + Pyth-Lazer oracle feed; Vercel AI SDK (`ai` `generateObject`, `@ai-sdk/xai`, `@ai-sdk/anthropic`); vitest (TS) + `cargo test` (Rust); existing `lib/arena/*` + `lib/data/*`.

**Spec:** `docs/superpowers/specs/2026-06-13-llm-arena-oracle-bots-design.md` (read it first).

**Reference code already in the repo (study before writing):**
- `arena-program/programs/arena/src/state.rs` — zero-copy account patterns, Pod rules, layout-lock tests.
- `arena-program/programs/arena/src/paper.rs` — `try_open` / `close` / `maintain` fee+liq math (the model to extend).
- `arena-program/programs/arena/src/lib.rs` — `init_bot` / `tick` / delegation / `commit_state` patterns.
- `arena-program/programs/arena/src/strategy.rs` + `lib/arena/strategy-reference.ts` — the Rust↔TS parity-fixture discipline to mirror.
- LLM brain pattern: `git show arena-v3-multi-bot:lib/bots/strategies/llm-trader.ts` (schema, cooldown, clamp, persona).
- Data: `lib/data/market-sentiment.ts` (OI/long-short/funding), `lib/data/candles.ts`, `lib/data/cex-funding.ts`.
- Off-chain ER: `lib/arena/decode.ts`, `lib/arena/crank.ts`, `lib/arena/lease.ts`, `scripts/arena/tick-once.ts`.

**Shared constants (identical everywhere):** prices `u64` @ 1e8; balances/stakes `u64` micro-USD (1e6); side `0=long /1=short`; existing tape actions `0..4`; new tape actions `5 OPEN_LONG_LLM, 6 OPEN_SHORT_LLM, 7 CLOSE_LLM, 8 STOP_HIT, 9 KILL_SWITCH`; bps base `10_000`.

**Scope:** This plan delivers the LLM-bot **engine** (on-chain + off-chain) with full unit/parity/Anchor test coverage and a devnet smoke. Arena-UI polish (honesty-tier labels, reasoning tape rendering, Sortino/benchmark leaderboard) and the founder-gated mainnet upgrade + live LLM soak are explicit **follow-ups** (§ "Out of this plan"). The deterministic `Bot` and the two live bots are never touched.

---

### Task 0: Dependencies + baselines (Phase 0)

**Files:** `package.json` (modify)

- [ ] **Step 1: Confirm AI SDK deps; add Anthropic.** `ai` and `@ai-sdk/xai` are present (Grok). Add Claude:

```bash
cd /Users/yordanlasonov/Documents/GitHub/copy-perps-llm-arena
npm pkg get dependencies.ai dependencies.@ai-sdk/xai dependencies.@ai-sdk/anthropic
npm install @ai-sdk/anthropic
```

Expected: `@ai-sdk/anthropic` resolves. (The llm-trader prototype pinned a baseURL workaround for an older `@ai-sdk/anthropic`; verify the installed version posts to `/v1/messages` — if it 404s, set `createAnthropic({ baseURL: "https://api.anthropic.com/v1" })` as in the prototype. **Read the `claude-api` skill for the current Claude model id; do not hardcode from memory.**)

- [ ] **Step 2: Baselines green.**

```bash
npm test 2>&1 | tail -3          # expect ~769 passed
(cd arena-program && cargo test -p arena 2>&1 | tail -3)   # expect 30 passed
```

- [ ] **Step 3: Commit.** `git commit -am "chore(arena): add @ai-sdk/anthropic for the Claude oracle bot"`

---

### Task 1: `LlmBot` account state (Rust, TDD)

**Files:** Modify `arena-program/programs/arena/src/state.rs`

Mirror the Pod rules already documented in `state.rs` (no `bool`, widest-first, explicit `_pad`, zero implicit padding). Add, alongside the existing `Bot`:

- [ ] **Step 1: Write the failing layout test** in `state.rs` `#[cfg(test)] mod tests`:

```rust
#[test]
fn llm_bot_layout_locked() {
    assert_eq!(align_of::<LlmPosition>(), 8);
    assert_eq!(size_of::<LlmPosition>() % 8, 0);
    assert_eq!(align_of::<LlmBot>(), 8);
    assert_eq!(size_of::<LlmBot>() % 8, 0);
    assert!(8 + size_of::<LlmBot>() <= 10_240); // single-init cap
    // no implicit padding: documented size must equal the sum of field sizes
}
```

- [ ] **Step 2: Run, expect FAIL** (`cd arena-program && cargo test -p arena llm_bot_layout_locked` — type not found).

- [ ] **Step 3: Implement the structs.** Action codes:

```rust
pub const ACT_OPEN_LONG_LLM: u8 = 5;
pub const ACT_OPEN_SHORT_LLM: u8 = 6;
pub const ACT_CLOSE_LLM: u8 = 7;
pub const ACT_STOP_HIT: u8 = 8;
pub const ACT_KILL_SWITCH: u8 = 9;
```

```rust
/// LLM position = paper position + per-trade stop/tp enforced every tick. align 8, zero pad.
#[zero_copy]
#[derive(Default)]
pub struct LlmPosition {
    pub entry_price: u64,
    pub stake_micro: u64,
    pub stop_price: u64,
    pub tp_price: u64,
    pub liq_price: u64,
    pub opened_ts: i64,
    pub last_funding_ts: i64, // last tick funding was charged through
    pub ticks_held: u32,
    pub leverage: u16,
    pub active: u8, // 0/1
    pub market_id: u8,
    pub side: u8,   // 0 long / 1 short
    pub _pad: [u8; 7],
}

/// On-chain safety floor + LLM knobs. zero pad (doubles as init arg, like StrategyParams).
#[zero_copy]
#[derive(Default)]
pub struct LlmParams {
    pub max_leverage: u16,
    pub min_stop_bps: u16,
    pub max_stop_bps: u16,
    pub max_stake_frac_bps: u16,
    pub max_trades_per_day: u16,
    pub daily_loss_limit_bps: u16,
    pub funding_bps_per_hour: u16, // deterministic holding-cost proxy
    pub decision_cooldown_secs: u32,
    pub confidence_floor: u8,      // 0..100
    pub risk_sizing: u8,           // 0 = LLM stake_frac; 1 = risk-based (off by default)
    pub _pad: [u8; 2],
}
// Manual AnchorSerialize/Deserialize via bytemuck like StrategyParams (zero padding required).

#[account(zero_copy)]
pub struct LlmBot {
    pub operator: Pubkey,
    pub balance_micro: u64,
    pub gross_pnl_micro: i64,
    pub fees_micro: u64,
    pub funding_paid_micro: u64,
    pub equity_high_micro: u64,
    pub day_start_equity_micro: u64,
    pub seq: u64,
    pub day_start_ts: i64,
    pub last_decision_ts: i64,
    pub positions: [LlmPosition; MAX_POSITIONS],
    pub tape: [TapeEntry; TAPE_LEN],
    pub params: LlmParams,
    pub persona_id: [u8; 16],
    pub trades: u32,
    pub wins: u32,
    pub trades_today: u16,
    pub tape_head: u16,
    pub halted: u8, // 0/1 kill-switch for the current day
    pub bump: u8,
    pub _pad: [u8; 4], // adjust to hit 8-alignment / zero implicit padding
}
```

- [ ] **Step 4: Run, expect PASS;** adjust `_pad` until `size_of % 8 == 0` and the documented byte map (add the table comment, like `Bot`) has zero implicit padding. Document offsets in a doc-comment table (the UI decodes this).

- [ ] **Step 5: Commit.** `git commit -am "feat(arena): LlmBot/LlmPosition/LlmParams zero-copy state + layout lock"`

---

### Task 2: LLM paper engine — fees both legs + funding proxy + kill-switch (Rust, TDD)

**Files:** Create `arena-program/programs/arena/src/paper_llm.rs`; modify `lib.rs` (`pub mod paper_llm;`)

Reuse the math style of `paper.rs` (`mul_div`, liq distance, fee = `notional × fee_bps`). Differences from `paper.rs`: fee charged on **open AND close**; per-position `stop_price`/`tp_price` enforced in `maintain_llm`; **funding** accrued per tick; daily kill-switch + day-roll; sizing either LLM `stake_frac` or risk-based.

- [ ] **Step 1: Write failing tests** in `paper_llm.rs` with hand-computed integer expectations (study `paper.rs::tests` for style). Cover:
  - `open_charges_fee_on_open_leg_and_sets_stop_tp_liq` (long & short).
  - `close_charges_fee_on_close_leg` (favorable close credits stake+pnl−closeFee; net of the open fee already paid).
  - `stop_hit_closes_at_stop_price` (mark crosses stored `stop_price` → `ACT_STOP_HIT`, loss bounded).
  - `tp_hit_closes_favorably` and `max_hold_closes`.
  - `liquidation_zeroes_credit`.
  - `funding_proxy_accrues_per_hour` (after N hours held, `funding_paid_micro == notional × funding_bps_per_hour/BPS × hours`; deducted from balance).
  - `risk_based_sizing_caps_loss` (with `risk_sizing=1`, computed size makes worst-case stop loss ≈ `equity × riskPct`).
  - `cooldown_blocks_second_open`, `trade_cap_blocks_open`, `kill_switch_trips_at_daily_loss_and_blocks_opens`, `day_roll_resets_trades_and_halt`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `paper_llm.rs` with these public fns (signatures fixed — used by lib.rs and mirrored in TS):

```rust
pub fn roll_day(bot: &mut LlmBot, now: i64);                       // resets day_start_*, trades_today, halted when day boundary crossed
pub fn precheck_open(bot: &LlmBot, cfg: &ArenaConfig, now: i64,
    leverage: u16, stake_frac_bps: u16, stop_bps: u16, confidence: u8) -> Result<OpenPlan, FloorReject>;
pub fn apply_open(bot: &mut LlmBot, cfg: &ArenaConfig, market_id: u8, side: Side,
    price: u64, ts: i64, plan: OpenPlan) -> bool;                  // clamps already applied in precheck
pub fn apply_close(bot: &mut LlmBot, cfg: &ArenaConfig, idx: usize, mark: u64, ts: i64, action: u8) -> bool;
pub fn maintain_llm(bot: &mut LlmBot, cfg: &ArenaConfig, market_id: u8, mark: u64, ts: i64); // funding + stop/tp/liq/max-hold + kill-switch
```

Funding accrual (deterministic proxy, symmetric cost):

```rust
// in maintain_llm, per active position in this market, before exit checks:
let hours_num = (ts - pos.last_funding_ts).max(0) as u128;
let notional = (pos.stake_micro as u128) * (pos.leverage as u128);
let funding = (notional * bot.params.funding_bps_per_hour as u128 * hours_num)
    / (BPS as u128 * 3600);
bot.balance_micro = bot.balance_micro.saturating_sub(funding as u64);
bot.funding_paid_micro = bot.funding_paid_micro.saturating_add(funding as u64);
pos.last_funding_ts = ts;
```

Kill-switch (after any close updates balance):

```rust
let equity = current_equity(bot, /* mark-to-market open positions at `mark` */);
if bot.day_start_equity_micro > 0 {
    let dd_bps = ((bot.day_start_equity_micro.saturating_sub(equity)) as u128 * BPS as u128)
        / bot.day_start_equity_micro as u128;
    if dd_bps >= bot.params.daily_loss_limit_bps as u128 { bot.halted = 1; }
}
```

- [ ] **Step 4: Run, expect PASS** (`cargo test -p arena paper_llm`). Fix Rust to match hand math; if a fixture's arithmetic was wrong, fix the fixture.

- [ ] **Step 5: Commit.** `git commit -am "feat(arena): LLM paper engine — fee both legs, funding proxy, kill-switch, sizing"`

---

### Task 3: Floor parity — TS reference + shared fixtures (TDD)

**Files:** Create `fixtures/arena/llm-floor-cases.json`, `lib/arena/llm/floor-reference.ts`, `lib/arena/llm/floor-reference.test.ts`; add a Rust parity test in `paper_llm.rs`.

Mirror the existing `strategy.rs::parity` ↔ `strategy-reference.ts` discipline. The reference covers the **deterministic, model-independent** floor: clamp/reject logic + open/close/funding/liq math, all `bigint`.

- [ ] **Step 1: Write fixtures** (decimal strings; hand-computed) for: leverage clamp, stop-bps reject (below min / above max), missing-stop reject, cooldown reject, trade-cap reject, confidence-floor→hold, fee-both-legs net, funding-after-N-hours, stop-hit loss, liquidation zero, risk-based size. Each: `{ name, params, state, action, expected: { rejected?, reason?, balanceAfterMicro?, feesAfterMicro?, fundingAfterMicro? } }`.

- [ ] **Step 2: Failing TS test** iterating the fixtures against `evaluateFloor(...)`. Run → FAIL (module missing).

- [ ] **Step 3: Implement `floor-reference.ts`** (bigint, line-for-line mirror of `paper_llm.rs` precheck + apply math).

- [ ] **Step 4: TS PASS** (`npx vitest run lib/arena/llm/floor-reference.test.ts`).

- [ ] **Step 5: Rust parity test** in `paper_llm.rs` reading `../../../fixtures/arena/llm-floor-cases.json` (via `concat!(env!("CARGO_MANIFEST_DIR"), …)`, serde dev-deps already present from `strategy.rs`), asserting identical results. `cargo test -p arena` PASS.

- [ ] **Step 6: Commit.** `git commit -am "feat(arena): LLM floor parity — TS reference + shared fixtures, Rust matches"`

---

### Task 4: On-chain instructions — `init_llm_bot`, `apply_decision`, delegation, tick branch (Anchor)

**Files:** Modify `arena-program/programs/arena/src/lib.rs`, `arena-program/tests/arena.ts`

- [ ] **Step 1: Add instructions.** Seeds `[b"llmbot", persona_id]`. New error variants (`Halted`, `Cooldown`, `TradeCapReached`, `StopRequired`, `StopOutOfRange`, `LowConfidence`, `NotOperator`, `NoSuchPosition`).
  - `init_llm_bot(persona_id, operator, params, starting_balance_micro)` — admin-gated; validate `params` domain (leverage≥1, stop bounds ordered, stake_frac≤BPS, cooldown≥0). `AccountLoader::load_init`.
  - `apply_decision(market_id, action, side, leverage, stake_frac_bps, stop_bps, tp_bps, confidence)` — **signer must equal `llm_bot.operator`** (`require_keys_eq!`). Accounts: `config`(read), `market_state`(read, seed-checked), `feed`(Unchecked, `== config.markets[market_id].feed`), `llm_bot`(mut, AccountLoader). Body: `roll_day` → read oracle (`oracle::read_feed`, stale → `Ok(())` no-op) → `paper_llm::maintain_llm` (so funding/stops are current) → match action: OPEN → `precheck_open` (reject/clamp) then `apply_open`; CLOSE → find position in market, `apply_close(..., ACT_CLOSE_LLM)`; HOLD → stamp `last_decision_ts`. Always set `last_decision_ts`.
  - `delegate_llm_bot(persona_id)` — copy `delegate_bot` exactly (validator pin via first remaining account, mandatory).
  - Extend `commit_state` / `undelegate_all` to accept LlmBot accounts in `remaining_accounts` (they already iterate generic accounts — verify the per-account-intent loop covers them; watch the ~5-account CU note).
- [ ] **Step 2: Branch `tick`.** For each `remaining_account`, detect discriminator: if `Bot` → existing path; if `LlmBot` → `paper_llm::maintain_llm` only (NO in-program decide). Helper that tries `AccountLoader::<Bot>` then `AccountLoader::<LlmBot>`.

- [ ] **Step 3: Anchor mocha tests** (`arena-program/tests/arena.ts`, extend; use the existing fixture feed + `max_age_secs` huge so the static fixture passes). Assert: init_llm_bot round-trips params; `apply_decision` from a non-operator signer fails `NotOperator`; OPEN without stop → `StopRequired`; OPEN with leverage 999 → clamped to `max_leverage` (fetch position, assert); OPEN then immediate second OPEN → `Cooldown`; OPEN, force a stop-crossing tick → position closes with `ACT_STOP_HIT`; CLOSE closes the position; a sequence that loses > `daily_loss_limit_bps` sets `halted` and the next OPEN → `Halted`.

- [ ] **Step 4: Run** `cd arena-program && anchor test` (uses the local validator + fixture feed). Expected: all green. If the ephemeral-validator harness is flaky, gate the delegation-specific assertions behind the existing `tests/delegation.ts` pattern and keep the pure-instruction asserts in `arena.ts`.

- [ ] **Step 5: Commit.** `git commit -am "feat(arena): apply_decision + init/delegate llm_bot + tick LlmBot branch"`

---

### Task 5: Indicators util (TS, TDD)

**Files:** Create `lib/data/indicators.ts`, `lib/data/indicators.test.ts`

- [ ] **Step 1: Failing tests** with known series: `ema(values, period)`, `rsi(closes, 14)`, `macd(closes)` → `{macd,signal,hist}`, `atr(candles,14)`, `realizedVol(closes)` (stdev of log returns). Use textbook fixtures (e.g. RSI of a known 15-close series ≈ value).
- [ ] **Step 2: FAIL → Step 3: implement (pure functions over `Candle[]`/`number[]`) → Step 4: PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(arena): TA indicators (ema/rsi/macd/atr/vol)"`

---

### Task 6: Decision schema (TS, TDD)

**Files:** Create `lib/arena/llm/schema.ts`, `lib/arena/llm/schema.test.ts`

- [ ] **Step 1: Failing tests:** valid decision parses; `action` outside enum rejects; `stopLossPct` out of `[0, 0.1]` rejects; `confidence` clamped to `[0,1]`; `reasoning` capped at 280 chars.
- [ ] **Step 2/3:** Zod schema (port from llm-trader.ts, extend to `action: open|close|hold`, `stakeFracPct`, mandatory `stopLossPct` on open):

```ts
export const decisionSchema = z.object({
  action: z.enum(["open", "close", "hold"]),
  side: z.enum(["long", "short"]).optional(),
  asset: z.enum(["BTC", "ETH", "SOL"]),
  leverage: z.number().int().min(1).max(50),
  stakeFracPct: z.number().min(0).max(1),
  stopLossPct: z.number().min(0).max(0.1),
  takeProfitPct: z.number().min(0).max(0.2),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(280),
});
export type LlmDecision = z.infer<typeof decisionSchema>;
```

- [ ] **Step 4: PASS. Step 5: Commit** `feat(arena): LLM decision schema`.

---

### Task 7: TS guardrail pre-check (TDD)

**Files:** Create `lib/arena/llm/guardrail.ts`, `lib/arena/llm/guardrail.test.ts`

Mirrors the on-chain floor (fail-fast / save a tx). Reuses `floor-reference.ts` (Task 3) for the math; this layer maps an `LlmDecision` + the bot's live book → `{ ok: true, clamped } | { ok: false, reason }`.

- [ ] **Step 1: Failing tests:** missing stop on open → reject; leverage over cap → clamped; confidence below floor → treated as hold; cooldown not elapsed → reject; trades-today ≥ cap → reject open; halted → reject. (Reuse fixtures from Task 3 where applicable.)
- [ ] **Step 2/3/4:** implement + PASS.
- [ ] **Step 5: Commit** `feat(arena): TS guardrail pre-check mirrors on-chain floor`.

---

### Task 8: Shared sentiment oracle (TS, TDD)

**Files:** Create `lib/arena/llm/sentiment-oracle.ts`, `lib/arena/llm/sentiment-oracle.test.ts` (port `x-search.ts` from arena-v3 first)

- [ ] **Step 1:** Port `lib/bots/x-search.ts` from `arena-v3-multi-bot` (`git show arena-v3-multi-bot:lib/bots/x-search.ts`).
- [ ] **Step 2: Failing tests (mocked x-search):** returns `{ score: number(-1..1), summary: string(≤200), topics: string[] }`; on x-search failure returns a neutral `{score:0, summary:"", topics:[]}` (never throws); output contains no raw tweet text / URLs (sanitization assertion).
- [ ] **Step 3/4:** implement (one call, structured+sanitized) + PASS.
- [ ] **Step 5: Commit** `feat(arena): shared sentiment oracle (sanitized, structured)`.

---

### Task 9: Shared market brief builder (TS, TDD)

**Files:** Create `lib/arena/llm/brief.ts`, `lib/arena/llm/brief.test.ts`

- [ ] **Step 1: Failing tests (all sources injected/mocked):**
  - brief contains, per arena market: spot price, multi-TF candle summary, indicators (from Task 5), funding, OI + long/short skew + taker flow (from `market-sentiment.ts`), the sentiment-oracle block, and an explicit ISO timestamp on the snapshot.
  - **arena fairness:** `buildBrief(bots)` produces ONE brief object; the per-bot prompt only differs by the bot's own book section — assert the market section is byte-identical across two bots.
  - **injection hygiene:** given a sentiment summary containing a URL/`@handle`, the brief's sentiment text is sanitized (no URLs/handles).
- [ ] **Step 2/3/4:** implement `buildSharedBrief(markets, deps)` + `renderPromptFor(bot, brief)` (static system block + dynamic runtime block, per spec §6) + PASS.
- [ ] **Step 5: Commit** `feat(arena): shared market brief (price/indicators/funding/OI/sentiment + own book)`.

---

### Task 10: Provider-agnostic LLM client (TS, TDD)

**Files:** Create `lib/arena/llm/client.ts`, `lib/arena/llm/client.test.ts`

- [ ] **Step 1: Failing tests (mock the AI SDK):** `LlmClient` for `provider:"xai"` and `provider:"anthropic"` both call `generateObject` with `decisionSchema` and return the validated object; a thrown SDK error → returns `null` (logged), never throws.

```ts
export type Provider = "xai" | "anthropic";
export interface LlmClient { decide(prompt: string): Promise<LlmDecision | null>; }
export function createLlmClient(p: { provider: Provider; modelId: string }): LlmClient;
```

- [ ] **Step 2/3:** implement (port the `generateObject` + provider wiring + `.env.local` ANTHROPIC fallback from llm-trader.ts; **model id from the `claude-api` skill**). **Step 4: PASS** (mocked).
- [ ] **Step 5 (optional live smoke, gated):** if `XAI_API_KEY`/`ANTHROPIC_API_KEY` exist, a `*.live.test.ts` (excluded from default `vitest run`) that makes ONE real call per provider against a tiny brief and asserts a schema-valid decision. Run manually: `npx vitest run lib/arena/llm/client.live.test.ts`.
- [ ] **Step 6: Commit** `feat(arena): provider-agnostic LLM decision client (Grok + Claude)`.

---

### Task 11: Decode `LlmBot` + submit `apply_decision` (TS, TDD)

**Files:** Modify `lib/arena/decode.ts` (add `decodeLlmBot`); create `lib/arena/llm/submit.ts`, `lib/arena/llm/submit.test.ts`

- [ ] **Step 1: Failing tests:**
  - `decodeLlmBot(buffer)` round-trips a synthesized account buffer (use the Task-1 byte map) → `{ operator, balanceMicro, positions, tape, params, tradesToday, halted, … }`.
  - `buildApplyDecisionIx({ programId, persona, market, decision, operator })` produces an instruction with the operator as signer and the correct accounts (config/market_state/feed/llm_bot PDAs) and serialized args matching the Rust arg order.
- [ ] **Step 2/3/4:** implement (follow `decode.ts` zero-copy offset style + `scripts/arena/tick-once.ts` for ix/account assembly) + PASS.
- [ ] **Step 5: Commit** `feat(arena): decode LlmBot + build apply_decision ix`.

---

### Task 12: Decision loop + lease + end-to-end mocked test (TS, TDD)

**Files:** Create `lib/arena/llm/lease.ts` (copy `lib/arena/lease.ts`, table `arena_llm_lease`), `lib/arena/llm/loop.ts`, `lib/arena/llm/loop.test.ts`

- [ ] **Step 1: Failing tests (all deps injected — no network):**
  - `startLlmBrain()` is a no-op when `DISABLE_ARENA_LLM === "true"`.
  - one loop iteration for a bot whose cooldown elapsed: builds brief → `client.decide` (mock returns an OPEN) → `guardrail` (clamps) → `submit` called with the clamped decision (assert the submitted payload).
  - a mock decision that violates the floor (e.g. no stop) → `submit` NOT called.
  - a bot still in cooldown → `client.decide` NOT called (cost guard).
  - **end-to-end:** brief(mock data) → client(mock OPEN) → guardrail → buildApplyDecisionIx → assert a well-formed operator-signed payload. This is the "the bot makes a valid on-chain decision" test.
- [ ] **Step 2/3:** implement `loop.ts` — mirror `crank.ts` structure (HOLDER id, startup delay, lease loop, lazy deps, `globalThis` start-once guard, `DISABLE_ARENA_LLM`), `CrankDeps`-style DI. Cadence per bot from `params.decision_cooldown_secs` (default ~3–5 min). Persist `{decision, guardrailsFired, reasoning, confidence, seq}` to a Postgres projection (reuse the bot-event projection table pattern). **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(arena): LLM brain loop (lease-guarded) + e2e decision test`.

---

### Task 13: Register Claude + Grok bots + init script

**Files:** Create `lib/arena/llm/registry.ts`, `lib/arena/personas` entries (port `claude-trader`/`grok-trader`), `scripts/arena/init-llm-bots.ts`

- [ ] **Step 1:** `registry.ts` maps `persona_id` → `{ name, avatar, provider, modelId, operatorEnv, params }` for `grok-v1` and `claude-v1` (params: e.g. max_leverage 15, min/max_stop_bps 50/300, max_stake_frac_bps 2000, max_trades_per_day 8, daily_loss_limit_bps 1500, funding_bps_per_hour ~2, decision_cooldown_secs 240, confidence_floor 55, risk_sizing 0). Port the two persona voices.
- [ ] **Step 2:** `scripts/arena/init-llm-bots.ts` — using the workspace IDL + `ARENA_ADMIN_KEYPAIR`: `init_llm_bot` for each (operator from `ARENA_LLM_OPERATOR_<BOT>` or one shared `ARENA_LLM_OPERATOR`), then `delegate_llm_bot` to the configured validator. Idempotent (skip existing). Add env to `.env.example`: `ARENA_LLM_OPERATOR=`, `DISABLE_ARENA_LLM=`, `ANTHROPIC_API_KEY=`, `XAI_API_KEY=`.
- [ ] **Step 3: typecheck + tests green.** `npm run typecheck && npm test 2>&1 | tail -3`.
- [ ] **Step 4: Commit** `feat(arena): register grok-v1 + claude-v1 oracle bots + init/delegate script`.

---

### Task 14: Verify it works (gates)

**Files:** none (verification); record results in `arena-program/PINS.md`

- [ ] **Step 1: Full suites green.** `npm test`, `npm run typecheck`, `(cd arena-program && cargo test -p arena)`, `(cd arena-program && anchor test)`. Record counts.
- [ ] **Step 2 (optional, if keys present): live LLM smoke.** Run the Task-10 `*.live.test.ts` — assert Claude AND Grok each return a schema-valid decision over a tiny real brief.
- [ ] **Step 3 (optional, if a devnet admin keypair + airdrop are available): devnet smoke.** Deploy the program to **devnet** under a throwaway keypair (NOT the mainnet upgrade authority), `init_config`/`init_market`(SOLUSD devnet feed)/`init_llm_bot`/delegate, then `scripts/arena/_spike-apply-decision.ts`: submit one operator-signed `apply_decision` OPEN to the ER and read the LlmBot account back showing the position + tape entry. Record the signature in PINS.md. (Mainnet upgrade + live brain soak is founder-gated — see below.)
- [ ] **Step 4: Commit** the PINS.md soak/verify notes.

---

## Out of this plan (explicit follow-ups)

- **Arena UI**: honesty-tier labels ("oracle bot — off-chain brain, on-chain tape"), reasoning-tape rendering, Sortino + buy-and-hold leaderboard. Own plan (extends `components/arena/*`).
- **Mainnet rollout**: upgrade the live program (needs the founder's admin/upgrade-authority keypair + funded wallet — PINS.md prerequisites), init+delegate `grok-v1`/`claude-v1` on mainnet, run the brain loop on Railway with prod keys, multi-hour soak + benchmark. Founder-gated.
- **P4 enhancements**: "your last N closed trades" reflection block; AI-Gateway models (GPT/Gemini/DeepSeek/Qwen); live directional funding; risk-sizing experiment.

## Self-review notes (applied)

- **Spec coverage:** §4 on-chain (Tasks 1–4), §4.5 fees+funding (Task 2), §5 brain loop (Tasks 10–13), §5.1 sentiment oracle (Task 8), §6 schema/prompt (Tasks 6, 9), §7 floor (Tasks 2–4, 7), §8 multi-LLM (Task 13 — Claude+Grok same params, model the only variable), §13 testing (every task + Task 14). §9 UI + mainnet are intentionally out-of-plan (above).
- **Type consistency:** `LlmBot`/`LlmPosition`/`LlmParams` fields, action codes 5–9, side 0/1, and `precheck_open`/`apply_open`/`apply_close`/`maintain_llm`/`roll_day` signatures are used identically across Tasks 1–4 and mirrored by `floor-reference.ts`/`guardrail.ts` (Tasks 3, 7) and `decode`/`submit` (Task 11).
- **Parity discipline:** the floor math has a single source of truth replicated in Rust + TS against `fixtures/arena/llm-floor-cases.json` (Task 3), exactly like the existing `strategy` parity.
- **Live `Bot` untouched:** all new state is in `LlmBot`; `tick` branches without altering the `Bot` path; the two mainnet bots are never re-initialized.
