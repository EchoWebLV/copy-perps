# LLM Arena — "Oracle Bots" (off-chain brain, on-chain rules) — Design

**Date:** 2026-06-13
**Status:** Proposed (design approved in session; pending written-spec review)
**Base branch:** `feat/onchain-arena` (carries the deployed mainnet arena program + `lib/arena/*` + arena UI)
**Trigger:** "I need a bot that an LLM runs completely with some rules… a couple of LLMs trading."
This realizes **§8 V2 ("oracle bot")** of [2026-06-11-onchain-bot-arena-design.md](2026-06-11-onchain-bot-arena-design.md),
generalized from Grok-only to a multi-model head-to-head (Claude + Grok first).

## 1. Summary

The on-chain bot arena already runs **deterministic** strategy bots whose logic executes as Anchor
program code inside a MagicBlock Ephemeral Rollup (ER), priced off the MagicBlock Pyth-Lazer oracle
feed, committed to Solana base layer. This design adds a second, clearly-labeled tier: **LLM-driven
"oracle bots."**

An LLM cannot run inside an ER program. So each LLM bot's **brain runs off-chain** (a server loop),
decides when to open and close, and lands every decision on-chain via a **new operator-signed
`apply_decision` instruction**. The program reads the *same oracle price* for the fill, **enforces a
safety floor in immutable code** (max leverage, mandatory stop, cooldown, trade cap, daily-loss
kill-switch), computes the paper PnL, and appends to the on-chain decision tape. A separate
deterministic per-tick `maintain` keeps force-exiting on stop / liquidation / max-hold for the LLM
bots too — so model latency can never blow up a position.

**The product is the rules layer, not the model.** The research is unambiguous: across every
real-money LLM-trading experiment, the winners traded *less*, sized *smaller*, and *obeyed stops* —
discipline beat intelligence. Prompt-level constraints ("don't over-trade", "wait 5 minutes") are
ignored by stateless models, so every meaningful guardrail must live in deterministic code. Here that
code is the **Anchor program** — stronger than anyone else's TypeScript guardrails, because the bot
operator physically cannot exceed a limit the program rejects.

**The honest claim (locked wording):** *"The model decides; an immutable on-chain program enforces the
rules and scores the result from the MagicBlock oracle price. The operator can only choose decision
timing — it cannot fake prices, exceed the limits, or backfill the track record."* This is a **stronger
trust story than nof1's Alpha Arena**, whose guardrails were trust-me server code.

**Zero financial blast radius:** LLM bots hold paper only. No bot wallets, no custody. The only
real-money surface is a follower's own copy trade, which rides the already-shipped Flash copy rails.

## 2. Verified current state (2026-06-13)

- **Deterministic arena is LIVE ON MAINNET** (PINS.md, 2026-06-12): program
  `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC`, SOL market (id 0), bots `scalper-v1` + `rider-v1`,
  delegated to the EU validator (`eu.magicblock.app`, pin `MEUGG…YMS8e`), Railway crank ticking real
  Pyth-Lazer prints and committing to mainnet base layer; arena UI browser-verified live. **Flash
  copy-trading shipped** (copy a bot → auto-mirror → auto-close on source exit).
- **On-chain program** (`arena-program/`, anchor-lang + `ephemeral-rollups-sdk` 0.14.3): instructions
  `init_config / init_market / init_bot / tick / commit_state / undelegate_all`, full delegation
  lifecycle, crank-payer + magic-fee-vault commit path (per-account intents — the 2026-06-12 wedge fix).
- **Accounts are zero-copy and layout-locked** (`state.rs`): `Bot` is 2328 bytes, byte-for-byte
  documented, guarded by `zero_copy_layouts_locked`. The two live bots use that exact layout. → **We
  must NOT extend `Bot` in place**; the LLM bots get a separate account type (see §4).
- **Existing LLM trader** (`arena-v3-multi-bot:lib/bots/strategies/llm-trader.ts`, 396 lines): Vercel AI
  SDK `generateObject` with Claude + Grok, a structured decision schema, cooldown, leverage clamp,
  stop-out, distinct persona voices. Writes to the **Postgres** paper arena (the disabled ticker), not
  on-chain. We port its *brain pattern*, not its execution path.
- **Market-data sources already on `feat/onchain-arena`:**
  - `lib/data/market-sentiment.ts` — Binance + Hyperliquid: **open interest (USD), top-trader &
    global long/short %, taker buy/sell ratio, long/short pressure (OI × side%), bias, funding**.
    Cached 30s; served via `app/api/markets/sentiment/route.ts`.
  - `lib/data/candles.ts` — multi-timeframe OHLCV (1m→1d), Hyperliquid + Pacifica.
  - `lib/data/cex-funding.ts` — multi-venue funding (Binance/Bybit/OKX/dYdX).
  - `lib/bots/x-search.ts` (on `arena-v3-multi-bot`) — Grok native X search (used by the Pulse bot).
- **Off-chain arena lib** (`lib/arena/`): `crank.ts`, `crank-deps.ts`, `decode.ts` (zero-copy/Borsh
  decode), `lease.ts`, `personas.ts`, `solscan.ts`, `use-arena-live.ts`. Scripts in `scripts/arena/`.
- **No Anthropic/AI-Gateway dependency in `package.json` yet on the base branch** (it exists on
  `arena-v3-multi-bot`); adding `@ai-sdk/anthropic` is part of this work.

## 3. Architecture — what runs where

```
Pyth Lazer ─► MagicBlock pusher ─► oracle feed PDA (delegated in ER, ~50ms)
                                          │ read-only
 Crank (existing) ── tick(market) every ~2s ─►┤ folds candles; runs DETERMINISTIC maintain
                                          │   (stop/liq/max-hold + daily kill-switch) for ALL bots,
                                          │   incl. LlmBots; runs in-program decide only for Bots
 ┌─ Ephemeral Rollup ────────────────────────────────────────────────────────┐
 │  Arena program (6YSS…YywC + new LlmBot account + apply_decision ix):        │
 │   • Bot     (scalper-v1, rider-v1)  — deterministic, untouched              │
 │   • LlmBot  (grok-v1, claude-v1)    — operator-signed apply_decision:       │
 │             read oracle price → enforce SAFETY FLOOR → paper open/close →    │
 │             append tape (+confidence). Per-position stop/tp stored so tick   │
 │             enforces them every ~2s without an LLM call.                    │
 └───────────────┬──────────────────────────────────────────┬─────────────────┘
       commit ~5m │ (existing crank-payer + magic-fee-vault)  │ ws subscribe (router)
                  ▼                                           ▼
            Solana base layer                       Next.js arena UI (zero-copy decode)
        (unfakeable snapshots, Solscan)             + LLM brain loop (NEW, server, lease-guarded)
                                                            │
   Brain loop (per LlmBot, ~3–5 min cadence):
     build ONE shared market brief (price+candles+indicators+funding+OI/long-short+sentiment+own book)
       → Claude/Grok generateObject (decision schema) → TS pre-check → apply_decision (operator-signed)
       → reasoning/confidence → Postgres projection (UI + audit). Grok narrator unchanged for voice.
```

Trust boundaries, stated honestly: price integrity = MagicBlock oracle pusher (Pyth-sourced, not
re-verified on-chain); rule enforcement + PnL = ER validator executing the immutable program; decision
*timing & direction* = the off-chain model (operator-signed); durability = base-layer commits. The
off-chain market brief influences *when/what* the bot decides, never *how it is scored*.

## 4. On-chain program changes (`arena-program`)

### 4.1 New `LlmBot` account (own seed `b"llmbot"`, own zero-copy layout)

The deterministic `Bot` stays byte-identical and live. `LlmBot` holds the same paper core plus the
LLM/guardrail fields. Pod rules apply (no `bool`, widest-first, explicit `_pad`, zero implicit padding,
a new `llm_bot_layout_locked` test). Fields:

- **Identity / control:** `operator: Pubkey` (the only key allowed to submit decisions for this bot),
  `persona_id: [u8; 16]`.
- **Paper core (mirrors `Bot`):** `balance_micro`, `gross_pnl_micro`, `fees_micro`,
  `equity_high_micro`, `seq`, `positions: [LlmPosition; 4]`, `tape: [TapeEntry; 64]`, `trades`, `wins`,
  `tape_head`, `bump`.
- **`LlmPosition`** = `Position` **plus `stop_price: u64` and `tp_price: u64`** (the LLM's per-trade
  stop/TP, enforced deterministically every tick). New struct so the locked `Position` stays untouched.
- **Guardrail params (the safety floor, on-chain):** `max_leverage: u16`, `min_stop_bps: u16`,
  `max_stop_bps: u16`, `max_stake_frac_bps: u16`, `decision_cooldown_secs: u32`,
  `max_trades_per_day: u16`, `daily_loss_limit_bps: u16`, `confidence_floor: u8`.
- **Daily kill-switch state:** `day_start_ts: i64`, `day_start_equity_micro: u64`, `trades_today: u16`,
  `last_decision_ts: i64`, `halted: u8` (0/1, reset when the day rolls).

`init_llm_bot(persona_id, operator, params, starting_balance_micro)` validates the same domain rules as
`init_bot` plus the guardrail bounds. Account fits a single `init` (well under 10,240 B).

### 4.2 New instruction `apply_decision`

Signer = `llm_bot.operator`. Accounts: `config` (read), `market_state` (read — for the fresh
`last_price`/`last_publish_ts`), `feed` (UncheckedAccount, address == `config.markets[market_id].feed`),
`llm_bot` (mut). Arg: `{ market_id, action, side, leverage, stake_frac_bps, stop_bps, tp_bps,
confidence }` where `action ∈ {OPEN, CLOSE, HOLD}`.

Steps, all fail-closed:
1. **Day-roll**: if `now` crosses the day boundary, reset `day_start_*`, `trades_today`, `halted`.
2. **Oracle price**: read the feed with the staleness guard (or `market_state.last_price` if its
   `last_publish_ts` is fresh); stale/malformed → no-op success (the bot pauses honestly).
3. **Safety floor** (reject or clamp; **never re-prompt**):
   - `halted == 1` → reject (kill-switch tripped for the day).
   - cooldown: `now - last_decision_ts < decision_cooldown_secs` → reject.
   - `trades_today >= max_trades_per_day` → reject opens (closes always allowed).
   - `confidence < confidence_floor` → treat as HOLD.
   - OPEN without a stop, or `stop_bps ∉ [min_stop_bps, max_stop_bps]` → reject.
   - clamp `leverage → ≤ max_leverage`, `stake_frac_bps → ≤ max_stake_frac_bps`.
4. **Apply** at the verified price with spread + taker fee (same paper model as `Bot`):
   - OPEN: size from `stake_frac_bps` (clamped) of equity; set `entry`, `liq_price`, `stop_price`,
     `tp_price`; `trades_today += 1`; append `OPEN_LONG_LLM` / `OPEN_SHORT_LLM`.
   - CLOSE: close the named position at the verified price; append `CLOSE_LLM`.
   - HOLD: no-op heartbeat; stamp `last_decision_ts`.
5. Update `last_decision_ts`, equity high-water; recompute daily drawdown → if
   `(day_start_equity - equity) / day_start_equity >= daily_loss_limit_bps` set `halted = 1`.
   *Optional knob (off by default):* risk-based sizing — `size = equity × riskPct ÷ stopDistance` —
   the single biggest research win (removing deterministic sizing worsened max drawdown 48% in FinPos).
   One `params` flag enables it per bot; default honors the LLM's clamped `stake_frac_bps`.

### 4.3 `tick` change

`tick` already loops `remaining_accounts`. Add `LlmBot` handling: run `maintain` (deterministic
stop/TP via the stored `stop_price`/`tp_price`, liquidation, max-hold, day-roll, kill-switch trip) but
**skip** `decide_ring_momentum`. The crank passes both `Bot` and `LlmBot` accounts; the handler
branches on account discriminator. New tape action codes: `OPEN_LONG_LLM(5)`, `OPEN_SHORT_LLM(6)`,
`CLOSE_LLM(7)`, `STOP_HIT(8)`, `KILL_SWITCH(9)` (existing 0–4 unchanged).

### 4.4 Delegation / commit

`delegate_llm_bot` / include LlmBots in `commit_state` + `undelegate_all` `remaining_accounts` (same
per-account-intent rule that fixed the 2026-06-12 wedge; watch the ~5-account CU ceiling noted in
`commit_state`).

### 4.5 Paper fill, fees & funding (realism — the leaderboard must cost what copying costs)

The leaderboard is only honest if the simulated costs match what a follower copying the bot would
actually pay on the real execution venue (Flash / Pacifica). All costs are applied on-chain from the
oracle-verified price, so they remain unfakeable:

- **Taker fee, both legs.** `notional × fee_bps` deducted on OPEN **and** on CLOSE (perps charge entry
  and exit; liquidation/stop closes pay the close fee too). The current `paper.rs` charges the open
  leg; confirm the close leg is charged at the same rate. Pin `fee_bps` to the real copy venue —
  **Pacifica open fee = 4 bps** (`lib/bets/funding.ts:8`), Flash ≈ 5–6 bps — and record the source in
  `ArenaConfig` defaults. Erring slightly high is acceptable (conservative track record); erring low is
  not (flatters the bots vs. real copying).
- **Spread / slippage haircut.** `entry/exit = price ± price × spread_bps` (default 5 bps), a config
  knob so thinner markets can be widened later. (Already in `paper.rs`.)
- **Costs reduce the on-chain balance and accumulate in `fees_micro`** → the leaderboard surfaces
  fees-paid, and the LLM sees its own cumulative fees in its book context (§5 step 2), so over-trading
  is *felt*, not abstract. This is the single clearest Alpha-Arena lesson (one bot bled ~13% to fees).
- **Funding cost on held positions** — currently unmodeled, and material for leveraged holds.
  **Decided (user, 2026-06-13): a deterministic on-chain holding-cost proxy** — a symmetric
  `funding_bps_per_hour` config knob, accrued on each tick per the time a position has been open and
  deducted from the balance (tracked in `fees_micro` or a sibling counter). Fully on-chain and
  unfakeable (no crank-supplied funding, so the crank still cannot touch recorded PnL). It is
  intentionally NOT directionally accurate (it always costs, never credits the side receiving funding)
  — documented as a conservative holding cost. Live directional funding is a deferred P4 enhancement.

## 5. Off-chain LLM brain (`lib/arena/llm/`)

A lease-guarded loop (`llm_brain_lease`, mirrors `ticker-lease`/`crank` patterns), co-located with the
crank on Railway; kill switch `DISABLE_ARENA_LLM`. Per LlmBot, at most once per `decision_cooldown`
(default **~3–5 min** — research: less trading wins, and it bounds cost). Per cycle:

1. **Build ONE shared market brief** (identical bytes for every bot — arena fairness): for each arena
   market (SOL now; BTC/ETH later):
   - price + multi-timeframe candles (`candles.ts`) and derived **indicators** (new shared
     `lib/data/indicators.ts`: EMA/RSI/MACD/ATR/realized-σ);
   - **funding** (`cex-funding.ts`);
   - **open interest + long/short skew + taker flow + bias** (`market-sentiment.ts`);
   - **news/social sentiment** from the **shared sentiment oracle** (§5.1);
   - an explicit **timestamp** on every datum (research: temporal confusion is a real failure mode).
2. **Add the bot's own on-chain book** (read its `LlmBot` account off the ER via `decode.ts`): open
   positions, equity, today's realized PnL, drawdown, trades-today, halted flag.
3. **Call the model**: provider-agnostic `LlmClient.decide(brief, book): Promise<RawDecision>` →
   `generateObject` with the §6 schema. Grok via `lib/xai`; Claude via `@ai-sdk/anthropic`
   (read the `claude-api` skill for the current model id — do not hardcode from memory); later
   GPT/Gemini via Vercel AI Gateway as thin adapters returning the same Zod shape.
4. **TS pre-check** mirrors the on-chain floor (fail fast / save a tx), then **submit
   `apply_decision`** signed by the bot's operator key. The chain is the final authority and
   re-enforces everything.
5. **Persist** `{ action, side, leverage, stake_frac, stop, tp, confidence, reasoning, guardrailsFired,
   ts }` to a Postgres projection row keyed to the on-chain tape `seq` — for the UI's reasoning panel
   and the audit ledger. The existing Grok narrator stays unchanged for persona voice on open/close.

### 5.1 Shared sentiment oracle

One call per tick (not per bot): `lib/bots/x-search.ts` (Grok native X search) → a **sanitized,
structured** output `{ score: -1..1, summary: string(≤200), topics: string[] }`, fed *identically* to
every bot. Rationale: keeps "model is the only variable," and emitting a structured score (never raw
tweets) neutralizes the prompt-injection vector. Cached with the rest of the brief.

### 5.2 Operator keys & trust

Each LlmBot has an operator keypair (env: `ARENA_LLM_OPERATOR_<BOT>` or one shared operator with
per-bot authority recorded on-chain). The operator can only submit decisions the program already
permits; it cannot forge prices or exceed limits. Decisions are timing/direction only.

## 6. Decision schema & prompt architecture

Force structured output; never parse prose. Static system block (criteria, risk prefs, schema) kept
**separate** from the dynamic runtime block (market brief + the bot's book), so the schema stays stable
across cycles and the model doesn't overfit transient data.

```jsonc
{
  "action": "open" | "close" | "hold",
  "side": "long" | "short",
  "asset": "SOL",
  "leverage": 5,             // clamped on-chain to ≤ max_leverage
  "stakeFracPct": 0.10,      // clamped on-chain to ≤ max_stake_frac
  "stopLossPct": 0.02,       // mandatory on open; bounded on-chain
  "takeProfitPct": 0.04,
  "confidence": 0.0,         // 0..1; below floor → treated as hold
  "reasoning": "one plain-English sentence citing a real level/regime/signal"
}
```

`reasoning` is metadata for narration + audit — **never an order trigger**. Only the post-validation
path (TS pre-check → on-chain `apply_decision`) emits a trade. "Do nothing" (HOLD) is a first-class,
low-friction output — the arena rewards inactivity.

## 7. The rules layer = the product (enforced on-chain)

| Guardrail | Rule | Source |
|---|---|---|
| Schema validation | Reject any output failing Zod parse; no free-text fallback for `action`. | hallucination is the #1 crash vector |
| Max-leverage clamp | Hard per-bot ceiling; clamp, don't reject. | Alpha-Arena losers over-levered |
| Mandatory stop | Reject OPEN without a stop in `[min,max]_stop_bps`. | winners had strict SL/TP |
| Per-tick deterministic exits | Stored `stop_price`/`tp_price` + liq + max-hold enforced every ~2s, independent of any LLM call. | latency must never blow up a position |
| Trade-frequency cap | `max_trades_per_day` in code; taker fee modeled in PnL so the leaderboard *feels* overtrading. | winner ~3 trades/day; worst did 238, −13% to fees |
| Confidence floor | Below threshold → HOLD. | guards hallucination |
| Daily-loss kill-switch | Halt entries for the day at `daily_loss_limit_bps` drawdown. | every blow-up lacked one |
| Cooldown | `decision_cooldown_secs` enforced on-chain (prompt-level cooldowns are ignored by stateless models). | prompt constraints fail |
| Audit ledger | On-chain append-only tape + Postgres reasoning projection. | tamper-evident audit |

**Separation principle:** the LLM owns *judgment* (direction, conviction); the deterministic on-chain
layer owns *survival* (size cap, leverage cap, stop, frequency, kill-switch). Decouple them.

## 8. Multi-LLM arena (spectacle + rigor)

- **Constancy:** same market, same starting capital, same schema, same safety floor, same shared brief
  — **the model is the only variable** (Alpha-Arena shape). New models join as **data rows + a thin
  adapter**, no chain changes.
- **Two valid axes:** (a) different models, same prompt (the headline); (b) same model, different
  persona/risk profile (reuses the existing `*-jr`/aggressive/patient variant idea).
- **Metrics (rigor):** equity/PnL, **Sortino** (not Sharpe), trade count, fees paid, margin/heat, win
  rate, and **always a buy-and-hold SOL benchmark on the same capital/timeframe** (a leaderboard
  without it is "sophisticated loss-taking"). Note run-to-run variance is large even at temp 0; where
  we make edge claims, report mean ± std over multiple runs.
- **Spectacle:** distinct persona voices (Claude = measured/careful; Grok = bold), public blow-ups
  (paper liquidations are shareable content), copy-trading via the shipped Flash rails.

## 9. UI (extends the existing arena UI)

- **Honesty-tier label** per bot: deterministic = "on-chain strategy"; LLM = **"oracle bot —
  off-chain brain, on-chain tape."** Never imply the LLM runs in the ER.
- **Bot profile:** decision tape (codes → copy) with the LLM's `reasoning` + `confidence` from the
  projection; equity curve vs the benchmark; Sortino; Solscan link per commit; Copy button per open
  position; liveness/staleness badge (stale crank or stale brain shown, never silently frozen).
- **Leaderboard:** the model head-to-head with the metrics above.
- Existing `components/arena/*` (ArenaRoster/BotCard/BotProfile) extended; the deterministic section is
  untouched.

## 10. Personas

Reuse the existing `claude-trader` and `grok-trader` persona voices (`arena-v3-multi-bot:lib/bots/
personas/*`), ported to `lib/arena/personas.ts`. The *decision* model call (§5–6) is separate from the
*narration* call (existing Grok narrator). On-chain `persona_id` maps to display fields off-chain.

## 11. Framing rules (locked, all comms)

- Never "trustless." Use §1's locked claim; the verify page states the crank + validator + oracle-pusher
  trust surface, and that the off-chain brain decides timing/direction while the program scores.
- "Entry gap," never "slippage" (carried from the arena spec) on copy positions.
- LLM bots labeled "oracle bot — off-chain brain, on-chain tape" everywhere; never imply in-ER LLM.
- Paper is labeled paper everywhere; copy CTAs price the entry gap honestly.

## 12. Error handling

- **Brain loop down** → no new decisions; the deterministic `maintain` still exits/liquidates on the
  crank; UI shows a brain-staleness badge. No state corruption.
- **Model API error / malformed output** → skip this cycle (no trade); log; never auto-repair by
  re-prompting into an order.
- **Oracle stale / `apply_decision` arrives stale** → no-op success (bot pauses honestly).
- **Sentiment oracle fails** → brief omits sentiment (numeric signals still flow); never blocks a tick.
- **Kill-switch tripped** → entries rejected on-chain until the day rolls; surfaced in UI as content.
- **Operator key issues** → that bot simply stops trading; others unaffected.
- **Copy-flow failures** → inherited from the shipped Flash tail machinery.

## 13. Testing

- **Safety-floor parity suite:** the floor math (sizing, stop/tp/liq, cooldown, trade cap, daily
  kill-switch, day-roll) implemented in Rust + a TS reference, asserted identical on shared JSON
  fixtures (mirrors the existing `strategy-reference` parity discipline).
- **Anchor tests** (local ephemeral validator): `apply_decision` clamps leverage, rejects no-stop /
  cooldown / over-cap / halted, opens & closes correctly at the fixture oracle price; `tick` runs
  `maintain` for LlmBots and skips `decide`; stored stop/tp fire deterministically.
- **Vitest:** brain-loop lease behavior, shared-brief construction (identical bytes per bot), indicator
  math, sentiment-oracle sanitization, decision Zod validation, TS pre-check ↔ on-chain parity,
  zero-copy decode round-trip for the new `LlmBot` account.
- **Devnet/mainnet soak:** deploy the upgraded program; init+delegate `grok-v1`; run the brain loop
  against the ER; verify decisions land, the tape commits to base layer (Solscan), the kill-switch
  trips, and the leaderboard benchmarks vs buy-and-hold over a multi-hour window. Then add `claude-v1`.
- **Real-money copy verification:** one in-house follower copies an LLM-bot position with a small stake
  via the shipped Flash flow (open → attribute → close → reconcile).

## 14. Phasing

- **P0 — gate:** re-verify on `feat/onchain-arena` that the live arena ticks + commits cleanly with the
  deterministic bots (it's on mainnet; confirm the toolchain + crank locally before touching the
  program). Add `@ai-sdk/anthropic` + read the `claude-api` skill for the current Claude model id.
- **P1 — program:** `LlmBot` account + `LlmPosition` + `apply_decision` + safety floor + `tick`
  branch + delegation/commit, with the parity suite + Anchor tests green. Deterministic bots untouched.
- **P2 — Grok brain:** `lib/arena/llm/` loop, shared brief (incl. indicators + market-sentiment +
  sentiment oracle), `LlmClient` (Grok), operator submit; init+delegate `grok-v1`; mainnet ER soak;
  benchmark vs buy-and-hold.
- **P3 — Claude + UI:** add Claude (`claude-v1`) as a data row + adapter; arena UI honesty tiers,
  reasoning tape, leaderboard with Sortino + benchmark; live head-to-head.
- **P4 — optional:** "your last N closed trades" reflection block (research: cheap reflection helps);
  AI-Gateway models (GPT/Gemini/DeepSeek/Qwen) as more entrants; risk-based-sizing knob experiment.

## 15. Out of scope / explicitly not doing

- Real-money bot custody / bot wallets (paper only; copy is the sole real-money surface, via shipped
  rails).
- LLM logic *inside* the ER program (impossible).
- Extending or migrating the live `Bot` account or its bots (`scalper-v1`/`rider-v1` untouched).
- Wiping/migrating the Postgres paper arena (hard rule).
- Per-model live data tools in v1 (the shared brief is the fair-arena default; a "tools" mode is a
  later, separate experiment).

## 16. Open items to verify in the plan

1. Current Claude model id + pricing (read `claude-api`; do not hardcode from memory).
2. Whether `apply_decision` should read the feed directly (honest, extra account) or trust
   `market_state.last_price` with a freshness check (simpler) — decide in P1; default to reading the
   feed for symmetry with `tick`.
3. CU headroom: `apply_decision` is per-bot (cheap); but confirm commit/undelegate still fit with the
   added LlmBot accounts (the ~5-account ceiling noted in `commit_state`).
4. Zero-copy `LlmBot` layout: lock byte offsets + a layout test; confirm the Phase-2 UI decoder and the
   Anchor IDL agree (the `serialization: bytemuck` / Borsh-order caveat in `state.rs`).
5. Operator-key model: one shared operator vs per-bot keys; how it's funded for ER gas.
6. Where the brain loop runs (same Railway service as the crank vs its own) and its lease TTL.
7. **Confirm the real per-leg taker rate** on the copy venue (Pacifica 4 bps / Flash ≈5–6 bps) and
   pick the `funding_bps_per_hour` proxy value (calibrate against observed SOL funding, e.g. a
   long-run average). Funding *treatment* is decided (Decisions log 9): deterministic on-chain proxy.

## Decisions log

1. **Approach A** (program computes PnL + enforces rules via `apply_decision`) over Approach C
   (off-chain engine + on-chain journal only) — strongest, unfakeable, non-backfillable track record;
   matches the arena spec's thesis. (User, 2026-06-13.)
2. **Base branch `feat/onchain-arena`** (deployed program + arena UI + `lib/arena`). (User, 2026-06-13.)
3. **Roster:** Claude + Grok first (already personas'd/wired); expand via AI Gateway later as data rows.
4. **LLM drives the full open/close lifecycle; the program enforces a hard safety floor.** (User.)
5. **Goal: both spectacle + rigor** — watchable leaderboard AND honest benchmarks (Sortino, buy-and-hold).
6. **Data inputs:** price + candles + indicators + funding + OI/long-short/taker flow + a **shared
   sentiment oracle**; one shared brief, identical bytes per bot (arena fairness); numeric data safe,
   news sanitized (injection hygiene). (User chose the shared-oracle mode, 2026-06-13.)
7. **Separate `LlmBot` account** (not extending the layout-locked, live `Bot`).
8. **Risk-based sizing is an off-by-default knob** (LLM picks size within caps); flaggable per bot —
   the research's biggest single win, surfaced but not forced, per the user's "full lifecycle" choice.
9. **Fee realism (user, 2026-06-13):** taker fee charged on both legs, pinned to the real copy venue;
   spread haircut both legs; all costs hit the on-chain balance + `fees_micro` so the leaderboard and
   the LLM feel over-trading. **Funding: deterministic on-chain holding-cost proxy** (`funding_bps_per_hour`,
   symmetric) — keeps PnL fully verifiable; live directional funding deferred to P4.
