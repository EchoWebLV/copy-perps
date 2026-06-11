# On-Chain Bot Arena (Ephemeral Rollup) — Design

**Date:** 2026-06-11
**Status:** Approved direction (user approved design + "all phases" scope in session)
**Trigger:** Pivot from the Blitz-v5 cram. The user's framing: "bots that run on ER (I already
have the arena) and people can just copy trade them." This is Flavor 2 — the strategy logic
itself executes as program code inside a MagicBlock Ephemeral Rollup.

## 1. Summary

Gwak's bot arena gets promoted from a Postgres paper experiment to **autonomous paper-trading
bots that live inside a MagicBlock Ephemeral Rollup**:

- Strategy logic executes as **Anchor program code** — not a server deciding and journaling,
  the program itself decides.
- Prices come from **Pyth Lazer via MagicBlock's ephemeral-oracle**: feed accounts
  (`PriceUpdateV2` layout) are delegated into the ER and updated at ~50ms cadence by
  MagicBlock's pusher. The arena program reads the feed account read-only with a staleness
  guard — our crank cannot forge or even delay prices, only delay bot reactions to them.
- Paper balance, positions, PnL, and a decision tape live in **delegated ER accounts**
  (ms-latency, free txs), periodically **committed to the Solana base layer**.
- Users **copy-trade any bot with real money** through the flash-tail rails shipped on
  `feat/flash-tail-persistence` (bets/fills rows with bot lineage, chain reconciliation).

**Why this beats the killed bot-arena ideas:** the June-2026 killer-feature panel killed all
bot-arena features because paper PnL is a backfillable simulation — no trust, no moat. An ER
tape with program-executed decisions and base-layer commits makes the track record
**unfakeable and non-backfillable**. The objection that killed the category is exactly what
this design fixes. (New-evidence rule satisfied.)

**The honest trust claim (locked wording for UI/marketing/judges):** "The bot's decisions are
made by an on-chain program — the strategy cannot be changed retroactively and the track
record cannot be backfilled. Prices come from the Pyth Lazer oracle feed operated by
MagicBlock; state is anchored to Solana by periodic commits." Never say "trustless": the ER
validator executes the program, MagicBlock's oracle pusher supplies prices (Pyth-sourced but
NOT re-verified on-chain — pusher-authority trust), and our crank supplies bot liveness; the
"How to verify" explainer says all of this plainly.

**Zero financial blast radius on the bot side:** bots hold paper only. No bot wallets, no bot
custody, ever. The only real-money surface is the follower's own copy trade, which rides the
already-reviewed Phase-1 tail machinery.

## 2. Verified current state

- **Bot arena exists** (Postgres): `bots` + `paper_positions` tables, in-process bot ticker on
  Railway, persona roster. HARD RULE: nothing in this project touches `paper_positions` or
  resets bot balances (CLAUDE.md). The Postgres arena keeps running untouched in parallel.
- **Strategy brain is a pure function**: [lib/autopilot/brain.ts](../../lib/autopilot/brain.ts)
  — 15m momentum/breakout, ~100 lines, no I/O. Portable to Rust with parity tests.
- **Copy rails shipped** (`feat/flash-tail-persistence`): `/api/flash/perp` records lineage
  opens (whale/bot sources in `flash-tail-meta`), fills table, confirm postbacks, reconcile
  sweep, portfolio attribution. 646 tests green at branch HEAD.
- **Zero MagicBlock code in the repo.** The ER toolchain knowledge (pins, gotchas, router
  endpoints) lives in [2026-06-11-live-ai-leaders-receipts-design.md](2026-06-11-live-ai-leaders-receipts-design.md)
  §Phase 4 and is reused here verbatim.
- **Pyth Lazer in-ER read pattern RESOLVED (research, 2026-06-11):** MagicBlock operates an
  ephemeral-oracle program (`PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`) whose
  `["price_feed", "pyth-lazer", symbol]` PDAs are delegated into the ER and updated ~50ms by
  MagicBlock's pusher. Consumers pass the feed PDA read-only and deserialize it as
  `pyth-solana-receiver-sdk` `PriceUpdateV2` (`try_deserialize_unchecked` +
  `get_price_no_older_than`). Devnet PDAs published: SOLUSD
  `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu`, BTCUSD
  `71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr`, ETHUSD
  `5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG` (ER endpoint
  `https://devnet.magicblock.app`). **Mainnet feed addresses are NOT published** — confirming
  third-party mainnet access with MagicBlock is a Phase-4 dependency. Canonical repo:
  `magicblock-labs/real-time-pricing-oracle`. Trust model is pusher-authority — there is no
  on-chain Lazer signature verification (the Lazer verify CPI needs the non-delegated
  treasury writable, likely ER-incompatible), and the trust copy in §1/§9 reflects that.

## 3. Architecture — what runs where

```
Pyth Lazer ──► MagicBlock pusher ──► oracle feed PDAs (delegated in ER, ~50ms updates)
                                              │ read-only account
Crank service (ours, lease-guarded)           │
        │  free ER tx every ~2s per market:   │
        │  tick(market) ───────────────────►──┤
        ▼                                     ▼
┌─ Ephemeral Rollup ─────────────────────────────────────────┐
│  Arena program (one Anchor program, N bot accounts):       │
│   read feed PDA (staleness-guarded) → fold price into      │
│   MarketState candle ring → run each bot's strategy →      │
│   paper fills, positions, balance, PnL, liquidations, tape │
└──────────────┬─────────────────────────────────────────────┘
               │ periodic commits (~5 min)            │ ws subscribe (router)
               ▼                                      ▼
        Solana base layer                 Next.js arena UI (live Borsh decode)
        (anchored snapshots,              + signal watcher (server)
         Solscan-verifiable)                          │
                                          follower taps "Copy" →
                                          existing /api/flash/perp tail flow
                                          (real money, bot lineage, fills rows)
```

Trust boundaries, stated honestly: program logic + state transitions = ER validator's
execution of our immutable program; price integrity = MagicBlock's oracle pusher authority
(Pyth-sourced, not re-verified on-chain — stated on the verify page); bot liveness = our
crank (it can stall bot reactions, never prices or recorded state); durability = base-layer
commits.

## 4. The on-chain program

One program, three account types. All sizes fit a single `init` (≤10,240 bytes) — **no
realloc dance needed** (unlike the receipts epochs).

**`ArenaConfig` (PDA, permanent):** admin pubkey, market table (marketId u8 → Lazer feed id),
global params (staleness tolerance, fee/spread bps), bot registry (bot count + pubkeys).

**`MarketState` (PDA per market, delegated):** latest read price + publish ts, and the
candle ring: 64 buckets × `{open, high, low, close: u64, startTs: i64, updates: u32,
pathLen: u64}` ≈ 3.3KB. `pathLen` accumulates `|Δprice|` across the ticks folded into the
bucket — the realized-movement measure the strategy uses as its activity confirm.
Bucket length is a config param (default 15s → the ring holds ~16 min of structure; bots
that trade slower aggregate base buckets when reading — e.g. 4×15s → 1m candles, 16 of them,
clearing the ≥12-candle minimum the ported strategy inherits from brain.ts). Candles
are built in-program from verified Lazer prices — `updates` (count of folded prints per
bucket) is the activity proxy, NOT volume (see strategy adaptation below).

**`Bot` (PDA per bot, delegated, ~4KB):**
- identity: `personaId [u8;16]`, display fields off-chain by personaId lookup
- `strategyParams`: breakout bps, trend-filter on/off, activity-confirm multiplier (in
  `updates` units), bucket span the bot reads, stake fraction bps, leverage u16, max-hold
  ticks, exit-favorable bps, max concurrent positions (≤4)
- paper state: `balanceMicroUsd u64`, `positions: [Position; 4]` where Position =
  `{marketId u8, side u8, entryPrice u64, sizeUsd u64, leverage u16, openedTs i64,
  liqPrice u64}`
- stats (program-computed): trades, wins, grossPnl i64, feesPaid, equity high-water,
  maxDrawdown, `seq u64`
- decision tape: ring of 64 × `{ts i64, marketId u8, action u8, price u64, sizeUsd u64,
  reasonCode u8}` ≈ 2KB. Reasons are codes (BREAKOUT_LONG, EXIT_FAVORABLE, MAX_HOLD,
  LIQUIDATED, …); the UI maps codes to copy. Rich free-text history lives in Postgres as a
  projection (chain is truth for state, DB is decoration).

**Instructions:**
- `init_config` / `init_market` / `init_bot` (base layer), `delegate_*` (pin the ER validator
  pubkey), `commit_*` / `undelegate_*` (MagicIntent bundle, 0.15.x-style API per the receipts
  spec pins), sponsorship top-up.
- **`tick(marketId)`** — the only hot path. Accounts: MarketState (mut), the MagicBlock
  oracle feed PDA for that market (read-only), bots in `remaining_accounts`. Steps, all
  fail-closed:
  1. Deserialize the feed PDA as `PriceUpdateV2`, enforce the expected feed address from
     ArenaConfig, and apply a staleness guard (`get_price_no_older_than(maxAgeSecs)`); if
     stale or malformed, the tick is a no-op success — the arena pauses honestly rather
     than trading on dead prices.
  2. Fold the price into the MarketState ring (roll buckets by the feed's publish
     timestamp; accumulate `pathLen += |Δprice|`).
  3. For each Bot account passed in `remaining_accounts`: mark-to-market open positions →
     liquidate any position past `liqPrice` (paper stake zeroes; bots can publicly blow up —
     that's content, not a bug) → run exits (favorable-move bank, max-hold) → run the entry
     strategy if flat in that market and balance allows.
  Crank passes `[MarketState, bot1..botN]`; at roster scale (≤10 bots) one tx per market per
  tick is fine.

**Strategy v1 (ported momentum, adapted honestly):** the brain.ts breakout logic ports
near-verbatim — last close clears the prior ring range by ≥ breakout bps, trend filter (net
move across the ring must agree), conviction journaled in the tape. **One forced adaptation:
the oracle provides prices, not volume**, so the 1.4x-volume confirm is replaced by an
activity confirm on per-bucket **path length** (`pathLen` ≥ multiplier × prior-ring
average) — a realized-movement proxy, documented as such. Parity tests therefore run against an adapted TS reference implementation
(the adapted strategy implemented once in TS for fixtures, once in Rust for the program; both
must agree on every fixture), not against brain.ts verbatim.

**Paper fill model (so copy-PnL is honest):** entries fill at the verified price ± spread
haircut (config bps, default 5), taker fee (default 6 bps, Flash-like) deducted from balance
on open AND close; `liqPrice = entry ∓ entry × (1/leverage) × (1 − maintenanceBufferBps)`.
All parameters in ArenaConfig so they can be tightened toward measured Flash reality later.

## 5. Off-chain services (thin by design)

- **Crank** — in-process Railway loop, lease-guarded via the existing ticker-lease pattern
  (one cranker; an unleased duplicate would double-tick). Sends `tick(market)` every ~2s per
  market (ER txs free; prices arrive via MagicBlock's pusher, the crank carries none),
  batches the bot account list, monitors the commit-fee SOL balance and the 10-commit
  sponsorship cap (top up via `lamportsDelegatedTransferIx`). Env kill switch:
  `DISABLE_ARENA_CRANK`.
- **Signal watcher** — subscribes to Bot accounts via the router ws (fallback: regional ER ws
  — router-ws forwarding is undocumented, verify day one per the receipts-spec gotcha list).
  On a bot open/close: writes a Postgres projection row (bot event history) and pushes to the
  UI. **No money moves without a user tap in v1.**
- **Commit cranker** — commits all delegated accounts every ~5 min (~0.0001 SOL each; ~$0.02
  to a few cents per day) and on notable events (liquidation, new equity high).

## 6. Copy-trading (rides the shipped rails)

V1 is **position-copy**: the bot profile shows live open paper positions; "Copy" opens the
user's real Flash position via the existing TailModal → `/api/flash/perp` flow with bot
lineage (`flash-tail-meta` bot sources — already shipped). The user's fill persists, confirms,
reconciles, and renders in the portfolio with attribution — all existing machinery.

**Entry-gap honesty (binding UI rule):** every copy position displays the follower's real
fill vs the bot's paper entry ("entry gap"), prominently. Copying a paper trader has
divergence; we sell the honesty, we never hide the gap. (Same wording discipline as the
receipts spec: "entry gap," never "slippage.")

**Later (post-v1, existing designs apply):** auto-close mirroring when the bot exits, then
subscription tailing per the Phase 3b design in the live-ai-leaders spec.

## 7. UI

- **Arena page**: live-ticking bot cards straight from ER account subscriptions (client
  Borsh decode), equity, open positions, last decision, liveness indicator (stale crank =
  visible staleness badge, never silently frozen numbers).
- **Bot profile**: decision tape (codes → human copy), equity curve, stats, Solscan link per
  commit, Copy button per open position.
- **"How to verify" explainer**: what the program guarantees (immutable strategy, signed
  prices, committed snapshots), what it doesn't (our crank provides liveness; the ER
  validator executes), link to the program + accounts on Solscan.
- Existing Postgres arena UI stays as-is during transition; ER bots appear as a new
  "on-chain" section.

## 8. Personas roadmap

- **V1 (deterministic, fully in-program):** 2 launch bots from one program — a fast scalper
  (reads raw 15s buckets, tight breakout, high leverage) and a slower trend rider (reads the
  ring aggregated to 1m candles, wider breakout, lower leverage). New personas = new Bot
  accounts with different params.
- **V2 (Grok oracle-bot, clearly labeled):** Grok reads X/news/chart off-chain and its
  decisions are journaled to the same ER tape (server-signed appends — Flavor-1 treatment for
  this persona only). The arena thus has two honesty tiers, labeled: "on-chain strategy"
  vs "oracle bot (off-chain brain, on-chain tape)". Model picker shows Claude/GPT as
  "coming soon". An LLM cannot execute inside an ER program; we never imply otherwise.
- The Scalp Autopilot (user-wallet AI) is untouched by this spec; Grok-in-autopilot is
  deferred and superseded by Grok-as-arena-bot for now.

## 9. Framing rules (locked, all comms)

- Never "trustless". The locked claim is §1's wording; the verify page states the crank +
  validator trust surface.
- "Entry gap", never "slippage".
- Paper bots are labeled paper everywhere; copy CTAs price the difference honestly.
- ERs *enable* the real-time arena; they never "raise" anything about leverage (carried rule).
- Devnet phase is demo-only; Solscan-verify claims start when the arena runs on mainnet ER.

## 10. Error handling

- **Crank down** → bots freeze; staleness badge in UI; no state corruption (ticks are
  idempotent per Lazer timestamp; the program rejects out-of-order/stale updates).
- **Lazer gap/outage** → ticks rejected by staleness check; arena pauses honestly.
- **ER unavailable** → crank queues and retries; commits resume on return; base-layer
  commits are the durability boundary.
- **Rollback risk on undelegate/redelegate** → arena state is paper; worst case is a few
  minutes of lost paper ticks, acknowledged in the verify page.
- **Copy-flow failures** → inherited from shipped tail machinery (pending reap, reconcile
  sweep, closed-external liveness).
- **Paper liquidation** → in-program, tape-coded, surfaced as content (bot blow-ups are
  shareable moments).

## 11. Testing

- **Strategy parity suite**: adapted strategy implemented in TS (fixtures source) and Rust
  (program); identical decisions on every fixture — candle rolls, breakouts, activity
  confirm, exits, liquidations.
- **Anchor tests** against the local ephemeral validator (anchor-counter layout as template).
- **Devnet ladder** (trust no custom code before each rung passes): stock anchor-counter
  end-to-end (deploy → delegate → write via router → ws subscribe) → Lazer verification spike
  (one signed update verified in-program in the ER) → arena program.
- **Vitest**: crank lease behavior, signal-watcher projection writes, copy lineage payloads,
  Borsh decode round-trip for UI.
- **Real-money copy verification**: one in-house follower copies a bot position with $5 on
  mainnet Flash; full open → attribute → close → reconcile loop.

## 12. Phasing (all phases committed; no calendar pressure)

- **Phase 0 — spikes (gate, trust-nothing rule):** install toolchain +
  `npx add-skill magicblock-dev-skill`; **resolve the SDK version matrix empirically** (the
  canonical oracle repo pins `anchor-lang 0.31.1` + `ephemeral-rollups-sdk 0.2.4` +
  `pyth-solana-receiver-sdk 0.6.0`, anchor-counter pins differently, crates.io latest
  er-sdk is 0.15.3 — pick ONE working combo, record in `arena-program/PINS.md`, never mix
  doc snippets across versions); stock counter end-to-end on devnet ER; **oracle-read
  spike** — read the published devnet SOLUSD feed PDA via the ER endpoint in TS, then
  in-program. No arena code before all pass.
- **Phase 1 — program + crank (devnet):** ArenaConfig/MarketState/Bot accounts, `tick`,
  SOL market only, 2 bots, parity suite green, crank lease-guarded on Railway.
- **Phase 1.5 — mainnet promotion (rev 2026-06-11, pulled forward from Phase 4):** as soon
  as the Phase-1 devnet soak passes, deploy the same program to mainnet ER (self-serve per
  MagicNet Phase 2) — it holds paper only, so the original "week of real traffic" gate was
  receipts-journal conservatism that doesn't apply here. **Hard dependency: mainnet Pyth
  Lazer feed PDA addresses are unpublished — open the MagicBlock conversation
  (Telegram/Discord/Incubator) during Phase 1, not after.** Devnet stays the iteration
  environment; mainnet is config + rent (~2-3 SOL deploy + epoch rent + commit fees), never
  a rewrite — all endpoints/feeds/ids are env-driven. The Solscan-verify claim and the
  "How to verify" page go live here.
- **Phase 2 — live arena UI:** ws subscriptions, bot cards + profile + tape, commits +
  Solscan links, BTC/ETH markets, staleness UX. Runs against whichever network is live
  (env-driven); flips to mainnet when 1.5 lands.
  - **Follow-on (user idea 2026-06-12, after Phase 2 ships): Scalp mark upgrade** — reuse
    the Phase-2 ER feed subscription + decode utilities to drive the Scalp game's live
    mark from the MagicBlock Lazer feed (~50ms, same oracle family Flash fills/liquidates
    against) instead of HL/Pacifica REST polling. Candles stay REST — Lazer has no
    history. Mainnet feeds only (same Phase-1.5 MagicBlock dependency). Reference UI:
    https://pyth-template.magicblock.app/ (magicblock-labs/oracle-template).
- **Phase 3 — copy-trading:** position-copy via existing rails, entry-gap display,
  portfolio attribution, $5 real-money verification.
- **Phase 4 — arena v2:** Grok oracle-bot persona, then auto-close mirroring →
  subscription tailing (Phase 3b of the live-ai-leaders spec). This is the
  **Magic Incubator / Blitz v6 artifact**.
- **Blitz v5 (June 12–14): SKIPPED** (user decision 2026-06-11, supersedes the earlier
  optional Friday gate-call). Nothing in this design depends on it.

**Prerequisites carried from the 2026-06-11 handoff (unchanged, do first):** live-verify
flash-tail persistence + autopilot, merge `feat/flash-tail-persistence`, `railway up`, set
prod Privy vars, rotate the authorization key shared in chat, delete orphaned `SCALP_ER_*`
Railway vars.

## 13. Open items to verify day one (carry into the plan)

Resolved by research (2026-06-11): the read pattern is the MagicBlock ephemeral-oracle feed
PDA (§2); ed25519 is available in the ER but moot (no in-program verification needed); no
Lazer token needed — MagicBlock runs the pusher, consuming the feed is free on devnet.

Still open:
1. SDK version matrix: oracle repo (`anchor 0.31.1` / `er-sdk 0.2.4` / `receiver-sdk 0.6.0`)
   vs anchor-counter pins vs er-sdk 0.15.3 latest — resolve empirically in Phase 0, record
   in `arena-program/PINS.md`.
2. **Mainnet oracle feed availability/addresses** — unpublished; confirm third-party access
   with MagicBlock (Telegram/Discord/Incubator). Phase-4 dependency, ask early.
3. Router-ws `accountSubscribe` forwarding (receipts-spec gotcha; fallback regional ER ws).
4. Whether `tick` with ~10 remaining accounts stays within ER compute limits at 2s cadence.
5. Feed PDA layout stability (price `i64` at byte offset 73 per MagicBlock docs; pin
   `pyth-solana-receiver-sdk` and assert layout in tests).

## 14. Relationship to existing specs

- **Supersedes the sequencing** of [2026-06-11-live-ai-leaders-receipts-design.md](2026-06-11-live-ai-leaders-receipts-design.md):
  old Phase 2 (real-money bot custody) is **replaced** by paper-bots-on-ER + copy (no
  custody, ever). The **receipts journal remains the follower-side verifiability layer**
  (the killer feature) and now arrives after the arena, sharing the same toolchain, writer
  patterns, and gotcha list — the arena is the first direct ER artifact, receipts the second.
- The Scalp Autopilot ships as built (separate feature); its Grok brain idea is parked in
  favor of Grok-as-arena-persona (§8).

## 15. Out of scope / explicitly not doing

- Bot wallets / bot custody / real-money bots — never in this design.
- LLM logic inside the ER program — impossible; oracle-bot labeling instead.
- Auto-copy without a user tap in v1 (position-copy is tap-to-mirror only).
- Migrating/wiping the Postgres paper arena (hard rule; it runs in parallel).
- Receipts journal implementation (separate, subsequent artifact).

## Decisions log

1. Flavor 2 (strategy executes in-program) over Flavor 1 (server bots, ER tape) — Flavor 1
   survives as the degraded fallback (same accounts, journaled appends) if in-program
   strategy hits a wall; and as the permanent pattern for oracle-bot personas.
2. Deterministic personas v1; Grok joins v2 as a labeled oracle bot.
3. No volume data in Lazer → activity-confirm proxy replaces the volume gate; parity tests
   target the adapted reference, divergence from brain.ts documented.
4. Per-market candle ring in MarketState (shared), not per-bot — bots read, never own, price
   structure.
5. Paper fills carry simulated spread + taker fees so copy-PnL claims stay honest.
6. Blitz v5 demoted to an optional Friday gate decision; the committed target is Magic
   Incubator / Blitz v6 with the full arena.
7. User approved full-phase scope 2026-06-11 ("we are doing all the phases.. we don't care
   how long it will take").
8. (Post-approval research amendment, 2026-06-11) Price source = MagicBlock ephemeral-oracle
   feed PDAs (pusher-authority trust), NOT in-program Lazer signature verification — the
   Lazer verify CPI needs the non-delegated treasury writable and is likely ER-incompatible;
   §1/§3/§9 trust copy updated accordingly. Net effect: simpler tick, no Lazer token, and
   the crank can no longer even delay prices — only bot reactions.
