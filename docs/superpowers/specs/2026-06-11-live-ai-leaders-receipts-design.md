# Live AI Leaders + On-Chain Receipts — Design

**Date:** 2026-06-11 (rev 2 — post adversarial verification against working tree @ 233e644)
**Status:** Approved direction, pending spec review
**Trigger:** MagicBlock Solana Blitz v5 idea thread ("Idea 1: Trading bot") — but scoped as a
full product build, not a weekend hack. Blitz editions recur every 2–3 weeks; the Magic
Incubator accepts entries anytime. A launch event will exist whenever the build is ready.

## 1. Summary

Gwak gets two new primitives:

1. **Live AI leaders** — house bots (starting with Pulse) promoted from paper trading to
   real-money execution on Flash Trade, surfaced as copyable leaders next to the whales.
   Followers get two modes, shipped in sequence: **position-copy** (tap to mirror one
   open bot position, auto-closed when the bot exits) and **subscription tailing**
   (allocate once; the server auto-opens AND auto-closes every future bot trade for
   you, sized proportionally).
2. **Receipts** — every fill in a copy trade, leader-side and follower-side, journaled
   on-chain in a MagicBlock Ephemeral Rollup (ER) within milliseconds, streamed live in
   the UI, and periodically committed to Solana base layer.

Plus a third pillar built on the same rails: **Scalp Autopilot** (Phase 3c) — a
budgeted AI that trades the user's *own* wallet in the Scalp game, tiered up to 500x
via Flash Degen Mode, with the same glass-box receipts treatment.

**The honest trust claim (verbatim for marketing/judges):** every Flash receipt links a
fill to a real venue transaction — anyone can cross-check it on Solscan (program, market,
side, size, signer) and audit completeness by replaying the leader wallet's public tx
history. Receipts are *attestations anchored to verifiable txs*, not trustless proofs:
appends are permissioned to our writer; Pacifica receipts carry venue order ids (not
Solana sigs) and are attestation-only; verification claims apply once the journal runs on
mainnet ER — the devnet phase is demo-only. A "How to verify a receipt" section ships
with the UI and doubles as the verifier protocol.

Receipts is the headline; the live bot is the engine that makes the receipts tape move.
Competitive scan (June 2026): no project in MagicBlock's 170+ Blitz entries or the broader
Solana copy-trading field (Stratium, perp.ag, Copin, pvp.trade) does follower-side
verification. MagicBlock has publicly named copy-trading as a wanted ER use case with
nobody in the lane. AI-agent trading alone IS derivative (Kestrel, ClawPump) — receipts
must lead.

## 2. Verified current state (file-level, re-verified 2026-06-11 vs working tree)

- **Flash tail opens persist nothing.** `TailModal` posts to `/api/flash/perp` with ONLY
  `{market, side, stakeUsdc, leverage, mode, walletAddress}` — the whale/bot lineage the
  client holds in `TailSource` is **never sent** (components/tail/TailModal.tsx:456–470).
  The `betId` shown is a client-side `flash:${signature}` (TailModal.tsx:190). No bets
  row, no fills. Portfolio renders Flash positions from live on-chain state
  (`positionsOf()`, app/api/portfolio/route.ts:233) as `sourceKind: 'wallet'`,
  `betId: null`.
- **Flash supports 31 markets across 8 pools** (lib/flash/markets.ts): Crypto.1
  (BTC/ETH/SOL/ZEC/BNB), meme pools (BONK/WIF/PENGU/PUMP/FARTCOIN), Governance.1
  (JUP/PYTH/JTO/KMNO/HYPE/MEGA), Equity.1 (SPY/NVDA/TSLA/AAPL/AMD/AMZN), Virtual.1
  (XAU/XAG/EUR/GBP/CRUDEOIL/USDJPY/USDCNH/NATGAS). The old "SOL/BTC/ETH only" lore is
  stale — Bullion (XAU) and Atlas (SPY) are NOT blocked from going live later.
- **Flash holds one position per (owner, market, side)**; the close route derives the
  position from market+side+trader (app/api/flash/perp/close/route.ts). The live
  resolver must never double-open the same (market, side).
- **Server-signed user transactions already ship in production.** The Scalp game's
  instant mode: client grants a session signer via
  `useSessionSigners().addSessionSigners({ address, signers: [{ signerId, policyIds }] })`
  (components/trade/FastPerpsGame.tsx:491–498, env `NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID` /
  `NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS`); the server signs-and-sends the user's Flash
  VersionedTransaction (ALTs included) via `privyServer.walletApi.solana
  .signAndSendTransaction` (lib/privy/instant-solana.ts:48–66), consumed by
  `/api/flash/perp{,/close,/trigger}` behind `body.instant === true`. Unit-tested.
  The old "Privy submit fails on ALTs" claim is dead — contradicted by working code.
  Note: a contract test (components/trade/flash-perps-game-contract.test.ts:62–63)
  explicitly forbids the legacy `useDelegatedActions/delegateWallet` API.
- **Mirror-close is Pacifica-only** (lib/bets/mirror-close.ts) — `closeBotFollowers` /
  `closeWhaleFollowers` / `closeLeaderFollowers` all close via agent wallets on
  Pacifica. No Flash-aware close path. Pacifica close ids are venue order ids
  (`pacifica:${order_id}`), not Solana signatures.
- **`/api/bet/whale` and `/api/bet/copy` are dormant but functional** (full persistence
  incl. pacificaOrderId); current UI routes all tails to Flash.
- **The TailModal `bot` arm is dead code** (components/tail/tail-types.ts:17–29): no
  `buildBotTailSource`, no endpoint exposing bot positions.
- **`bots.status` supports `'live'`** (lib/db/schema.ts:114); all bot tables (bots,
  paper_positions, bot_thoughts, bot_chats) survive in the schema. No `bot_wallets`
  table, no `venue` column, no fills table yet.
- **The bot arena is deleted from the working tree** (`lib/bots/` gone; admin bot
  routes/pages gone). `instrumentation.ts:23–27` deliberately skips `startBotTicker()`
  — removed because the ~50s tick kept Neon awake 24/7 ("bulk of the Neon compute
  bill"); its in-file claim that `lib/bots/*` is untouched is stale. Restoration
  sources: resolver/paper mechanics at `810f7d1`, Pulse persona at `369d0ce`,
  checkpoint at `7b13b6c`.
- **Server-side key custody precedent:** agent wallets (lib/wallets/agent.ts),
  AES-256-GCM encrypted Ed25519 seeds.
- **A bot CAN own Flash positions:** `/api/flash/perp` builds an UNSIGNED
  VersionedTransaction with `req.trader` as owner/payer (lib/flash/perps.ts:312–314,
  391–398); a server-held Keypair matching that owner can deserialize, sign, and
  submit. ALTs are resolved server-side at build time.

## 3. Architecture overview

```
            ┌─────────────────────────── Railway (Next.js, one process) ───────────────────────────┐
            │                                                                                       │
 signals ──►│  bot resolver tick ──► flashBot.open/close ──► Flash Trade (mainnet, bot wallet)      │
 (Grok/X,   │        │                       │                                                      │
  HL, CEX)  │        │                       ├──► fills + bets rows (Neon)                          │
            │        │                       └──► receiptWriter (lease-guarded) ──► journal (ER)    │
            │        │                                                  │ commits (~0.0001 SOL)     │
            │  follower tails ──► /api/flash/perp ──► user signs (Privy)│                           │
            │        │                 │  auto-close: server signs via  ▼                           │
            │        │                 │  Privy session signer      Solana base layer               │
            │        │                 │  (signerId + policyIds)        │                           │
            │        │                 └──► fills + bets rows           ▼                           │
            │        │                                          Receipts UI (ws onAccountChange,    │
            │        │                                          ms-latency tape + Solscan links)    │
            └───────────────────────────────────────────────────────────────────────────────────────┘
```

## 3.1 Where MagicBlock comes in — exact boundaries

The one-table answer to "are we using MagicBlock, and for what":

| Layer | MagicBlock? | What it does for us | What it does NOT do |
|---|---|---|---|
| **Trading venue** (Flash, incl. 500x Degen Mode) | Indirect — Flash itself runs on MagicBlock ERs + Pyth Lazer feeds | Sub-50ms execution and real-time liquidations are why a 0.2%-wide liquidation band (500x) can exist on a Solana DEX at all. Every fill in our product executes on MagicBlock-powered infra | We do not integrate ER here ourselves; leverage caps are Flash's risk-engine parameter — ERs **enable** 500x, they never **raise** caps (framing rule for all comms) |
| **Receipts journal** (Phase 4) | **Direct — our own ER integration** | Our Anchor program's epoch accounts delegate to an ER: free ms-latency appends, in-program mirror verification, live on-chain leader scoreboard; periodic commits anchor state to Solana mainnet | Not the source of truth for money (Postgres is); receipts are attestations anchored to venue txs, not trustless proofs |
| **Copy engine, auto-close, autopilot execution** (build phases 3/3b/3c) | None | — | Deliberate: runs on Privy session signers + our server (rung-3 on-chain copy engine deferred; see Phase 4) |
| **Bot brains / signals** (Phase 2) | None | — | Grok/X, Hyperliquid, CEX funding — off-chain by nature |

Net: MagicBlock is the **verification layer we build on directly** and the
**execution substrate we inherit from Flash**. The product trades without our ER
integration; it cannot be *verified live* without it. That containment is deliberate
— money never waits on MagicBlock.

## 4. Build phases (dependency order)

### Phase 1 — Follower-side truth (data layer; prereq for everything)

- **Extend the tail payload (client + server).** `/api/flash/perp`'s body today has no
  lineage fields; TailModal must start sending `{sourceKind: 'whale'|'bot', whaleId?,
  botId?, sourcePositionId?, leaderMarket, leaderSide}` and the route must accept them.
  Without this there is nothing to persist. (Verified gap — the original spec assumed
  the request already carried it.)
- Insert a bets row on tail opens: `venue: 'flash'`, lineage meta, stake, leverage,
  entry quote, open signature, **plus `privyUserId` + `walletAddress`** (required later
  by session-signer auto-close to resolve the Privy walletId).
- Confirm postback after client submit; close postback on `/api/flash/perp/close`
  recording closedAt + close signature. **Realized PnL is NOT available from the close
  route** (it returns a quote-time estimate) — actual realized PnL is derived
  post-confirmation from the parsed transaction (collateral balance delta).
- New `fills` table: `(id, betId NULLABLE, botId NULLABLE, sequence, side, orderIdOrSig,
  filledAmount, price, feesUsd, txHash, ts)` — nullable betId + botId so LEADER (bot)
  fills and follower fills share the table the receipt writer consumes. The resolver's
  live branch (Phase 2) writes the leader fill rows.
- **Flash reconciliation is its own work item, not a bullet:** no Flash history client
  exists. Mechanism: Helius `getSignaturesForAddress` per tracked wallet + decoding
  Flash program instructions (fallback: Flash's backend API if it proves stable).
  Backfills fills the client never reported and computes confirmed realized PnL.
- Standalone value: fixes the "Flash positions evaporate on reload" bug. Ship even if
  everything else stalls.

### Phase 2 — Live bot execution (production custody)

- `bot_wallets` table mirroring `agent_wallets` (AES-256-GCM, same master-key
  pattern); admin route to generate/bind, treasury-funded with USDC, on-chain
  confirmation before `status: 'live'`.
- Restore minimal bot machinery from git (`810f7d1` resolver/paper, `369d0ce` Pulse) —
  no arena UI revival. Fix the stale instrumentation.ts comment while in there.
- Resolver `'live'` branch: strategies are signer-free; opens/closes route to
  `flashBot.open/close` — build unsigned via `getFlashPerpsService()`, sign with the
  bot Keypair as owner, submit. **Constraint: one position per (market, side)** — the
  live branch must check for an existing open position before opening.
- Position tracking: extend `paper_positions` with `venue ('paper'|'flash')` +
  `entryTxHash`; live PnL hydrated from `positionsOf(botPubkey)`.
- Risk controls (non-negotiable before real funds): per-trade stake cap + max
  concurrent positions (config JSONB), hard stop-loss independent of strategy,
  liquidation/bust detection → `'busted'` + admin alert, `DISABLE_LIVE_BOT` kill
  switch, audit log of every signed bot tx.
- **Cost acknowledgment:** the resolver loop was removed specifically because its
  ~50s tick kept Neon awake (the bulk of the DB bill). Re-enabling it for a live bot
  re-incurs that cost — budget it (slower tick for live-only mode, e.g. 60–90s, and/or
  Neon plan bump) as part of this phase.
- First live bot: **Pulse** (BTC/ETH/SOL only — all on Flash Crypto.1, verified
  compatible). Small bankroll ($200–500); the accumulating verifiable track record is
  the launch asset.
- Admin UI: re-add a minimal `/admin/bots` for live state (balance, positions,
  pause/close).

### Phase 3 — Copy rails for bot leaders

- `buildBotTailSource` + endpoint exposing the live bot's open positions; bot leader
  card in the roster (live UI).
- Follower opens stay client-signed on Flash (now persisted via Phase 1).
- **Auto-close reuses the SHIPPED session-signer stack — not a new integration.**
  Consent: `useSessionSigners().addSessionSigners({ address, signers: [{ signerId,
  policyIds }] })` exactly as FastPerpsGame does (policy-scoped, NOT the legacy
  `useHeadlessDelegatedActions().delegateWallet` — a contract test forbids that API
  and it delegates without policy scoping). Execution: reuse
  `signAndSendPrivySolanaTransaction` (lib/privy/instant-solana.ts) from the
  mirror-close sweep. The remaining real work is **policy scoping**: define a Privy
  policy allowing server-initiated closes (no user request in flight) restricted to
  Flash close instructions on tail positions only.
- **Fee payer must be solved:** the follower wallet pays SOL on every close, and the
  sponsored-USDC-only onboarding means many followers hold 0 SOL — they'd be stranded
  in open positions (auto-close AND one-tap close both fail). Pick at implementation:
  Privy sponsor flag on the server send, SOL-balance precheck + buffer at tail time,
  or a gas-drip top-up. The tail flow must refuse to open a copy it cannot later close.
- Consent UX: request the session signer at first bot-tail ("enable auto-close").
  Tails without delegation fall back to notify + one-tap close. **Revocation is
  all-or-nothing** (revokeWallets revokes every delegated wallet for the user) — the
  fallback path must assume bulk revocation.
- Extend mirror-close with the Flash-aware path: on leader exit, enumerate confirmed
  bot-follower bets (venue flash), close via session signer, journal close receipts.
  Closes run in parallel batches; ordering is oldest-bet-first (documented fairness
  rule).
- **Divergence is acknowledged and displayed, not hidden:** follower exits land
  seconds after the leader's; realized PnL differs. The receipt pair renders both
  ("leader exited at X, you exited at Y, Δ") — divergence transparency IS the product,
  and the Copy-PnL index quantifies it rather than papering over it.

### Phase 3b — Subscription tailing (auto-copy every future trade)

Runs after Phase 3 (position-copy proves the rails); independent of Phase 4 and may
proceed in parallel with it.

- **Allocation model.** New `bot_subscriptions` table: `(id, userId, botId,
  allocationUsd, status 'active'|'paused'|'stopped', riskConfig jsonb, createdAt)`.
  Follower stake per trade = bot's stake-as-%-of-bankroll × follower allocation
  (mirrors the bot's conviction sizing). Skip-and-record when the follower balance
  can't cover the minimum stake — a skipped trade emits a notification, never a retry
  into a stale entry.
- **Freshness gate on auto-opens:** only open the follower position while price is
  within 0.5% of the bot's entry (same gate the whale-mirror bots use). If the window
  is missed, skip and record — never chase.
- **Execution.** In the resolver live branch, after the bot's own open confirms, fan
  out follower opens via the same session-signer path
  (`signAndSendPrivySolanaTransaction`), parallel batches,
  oldest-subscription-first fairness. Closes ride the existing Phase 3 mirror-close
  sweep. All subscription fills hit the fills table and journal as receipts (tagged
  subscription vs position-copy).
- **Policy scoping is stricter than close-only.** A server that can OPEN positions
  needs a tighter Privy policy: Flash program only, per-transaction size cap, and
  ideally market allowlist. Defined as a separate policy bundle from the close-only
  one; subscribing grants both.
- **Follower-side risk controls** (riskConfig): per-subscription stop
  ("auto-unsubscribe if my allocation draws down X%"), max concurrent positions,
  pause/resume, hard per-trade cap. Auto-pause every subscription when the bot goes
  `'busted'`.
- **Subscribe-time prechecks:** the fee-payer solution (Phase 3) must cover opens
  too; refuse subscription if the wallet can't fund closes/opens (SOL or sponsor
  path), and verify the session signer + both policy grants exist.
- **UX:** "Tail Pulse with $100" — one consent flow (session signer + policies), then
  a subscription card in the portfolio showing allocation, live aggregate PnL, recent
  auto-trades with receipts, and pause/stop controls.

### Phase 3c — Scalp Autopilot (AI trades the user's own wallet)

The Scalp game gains an **Autopilot** mode: the user allocates a session budget,
picks a risk tier, and a server-side AI scalps their wallet for them — every
decision narrated, every fill journaled. Sequenced after Phase 3b (shares the
session-signer consent, policy, fee-payer solution, and budget bookkeeping); can be
re-ordered ahead of 3b if product priority demands, since it does not need the
proportional-allocation model.

**Verified foundations (June 2026):** Flash Degen Mode is live at 125x–500x on
SOL/BTC/ETH (market orders only) and already wired into the app —
lib/flash/markets.ts carries `maxLeverage: 500`, FastPerpsGame's degen presets are
[125, 250, 500], and instant mode already lets the server sign-and-send the user's
trades after one session-signer approval. TP/SL trigger orders exist via
`/api/flash/perp/trigger`. The autopilot is a brain + a budget ledger on top of
shipped rails. Flash is the only Solana DEX at 500x; no competitor ships one-tap AI
scalping of the user's own wallet on Solana perps (nearest: PerpsClaw agent arena on
Drift, Hyperliquid delegated bots).

**The 500x physics (drives every design choice below):** liquidation sits 1/L from
entry — 0.2% at 500x — and Flash's ~4bps open + ~4bps close burns ~40% of that
margin at entry; effective survivable adverse move ≈0.1%, one oracle tick, with
market-order slippage both ways. No strategy "manages risk" inside that geometry.
The honest product is **the disciplined degen**: an AI that never revenge-trades,
always attaches the stop, sizes tiny, banks profits, and quits at the cap. The
discipline is the value; 500x is the entertainment tier.

- **Session model.** `autopilot_sessions` table: `(id, userId, budgetUsd, tier,
  status 'active'|'stopped'|'exhausted'|'target', pnlUsd, config jsonb, startedAt,
  endedAt)`. The budget is the **absolute loss bound** — the autopilot can never
  deploy more than the remaining budget, ever. Stop button takes effect next tick;
  open positions are closed on stop.
- **Risk tiers** (server-enforced, clamped to lib/flash market bounds):
  - *Cruise* — standard mode 20–100x, stake ≤10% of budget per trade, up to 2
    concurrent
  - *Sweat* — degen 125–250x, stake ≤5% of budget, 1 concurrent
  - *Full Degen* — 500x, stake hard-capped $1–$10, 1 concurrent, mandatory TP+SL
    triggers attached at open
- **The deterministic shell rule:** the LLM (Grok catalyst layer, Pulse-style) may
  pick direction and conviction; **code** decides size, leverage, stops, and whether
  a trade is allowed at all. The brain's base is the restored Blitz 15m momentum
  strategy from the Phase 2 kit; the shell reuses the bot kit's tilt guard (loss
  streak → cooldown) and adds: always-attached SL trigger, per-tier caps, auto-stop
  on liquidation or budget exhaustion.
- **Execution.** One shared lease-guarded autopilot loop ticks all active sessions
  (NOT a loop per user); entries/exits go through the existing
  `/api/flash/perp{,/close,/trigger}` paths with `instant: true` via
  `signAndSendPrivySolanaTransaction`. Same fee-payer solution as Phase 3 (opens,
  closes, AND triggers). Same Neon-cost note as Phase 2 — one more always-on loop.
- **Consent & safety.** A distinct consent screen ("this AI will trade this budget
  from your wallet — it can lose all of it") separate from the copy auto-close
  consent; per-session audit log of every decision (including skipped entries and
  why); liquidation-distance and fee math shown in the UI at tier selection;
  revocation honored with the all-or-nothing caveat.
- **Receipts.** Every autopilot fill journals to the ER (receipt kind tagged
  autopilot) — the "glass-box AI": its decisions appear on the public tape in
  milliseconds. Narration in persona voice feeds the Scalp UI.
- **MagicBlock role here:** indirect but load-bearing — 500x exists on a Solana DEX
  only because Flash runs on the ER + Lazer speed stack (see §3b; "enables, never
  raises"). Our direct ER use is the journaling of autopilot decisions/fills.

### Phase 4 — ER receipts layer (the MagicBlock integration)

**Receipt struct (fixed-size, ~158 bytes):** `{ kind: u8, leaderId: [u8;16],
followerWallet: [u8;32] (zeroed for leader receipts), marketId: u8 (lookup table),
side: u8, price: u64, sizeUsd: u64, feeUsd: u64, venueSig: [u8;64], ts: i64, seq: u64 }`.
- `venueSig` (the raw Flash tx signature = the Solana tx id) is the verifiability
  anchor — keep it whole, never hash it. For Pacifica-sourced receipts it carries the
  order id padded, flagged attestation-only via `kind`.
- **No followerHash pseudo-privacy** (rev 2 decision): the adjacent venueSig exposes
  the follower wallet on Solscan anyway, so v1 stores the wallet plainly. Privacy
  moves wholesale to Phase 5, where it must also hide venue-tx linkage.

**Journal sizing (the math that makes it implementable):** Anchor `init` via CPI caps
account creation at 10,240 bytes (~60 receipts) — too small. Therefore: create the
epoch PDA on **base layer** and grow it by repeated +10,240-byte reallocs **before
delegation** to ~100KB (~600 receipts, ~0.7 SOL rent). One leader trade with F
followers emits 2+2F receipts; at Pulse's 5–10 fires/day with 10 followers
(~110–220 receipts/day) a 100KB epoch lasts ~3–5 days.

**Epoch rollover (concrete):** the lease-guarded writer cranks rollover when
`count ≥ capacity − headroom`: undelegate+commit epoch N (base-layer dance), init +
pre-realloc + delegate epoch N+1, flip the on-chain **leader index account** (tiny
permanent PDA: leaderId → current epoch address + epoch count). Receipts arriving
mid-rollover queue in the writer's retry buffer. The UI subscribes to the index
account and re-subscribes to the new epoch PDA on advance. **Retention:** old epochs
stay alive initially (rent ~0.7 SOL each, bounded by epoch cadence); revisit with a
merkle-root compaction into the index account if rent matters at scale.

**Program:** `init_index`, `init_epoch`, `grow_epoch` (pre-delegation reallocs),
`append_receipt`, `delegate`, `commit`, `undelegate`, `advance_epoch`; macros
`#[ephemeral]` / `#[delegate]` / `#[commit]` + `MagicIntentBundleBuilder` (0.15.x
API; older `commit_accounts` helpers deprecated).

**In-ER verification (baseline, not optional):** `append_receipt` is not a dumb log
write. On a follower receipt, the program matches it against the leader receipt in
the same epoch (same market, same side, price within tolerance, timestamp within
window) and flags it `verified_mirror` — the PROGRAM certifies the copy, not our
server. On every append it also updates per-leader running aggregates held in the
epoch account (follower count, aggregate divergence, copy-PnL) — a live, on-chain-
computed leader scoreboard at ER latency. ~50 lines of Anchor; it is the difference
between "fast log" and "copy-trading verified inside the Ephemeral Rollup" (the
hackathon-grade mechanic).

**Deferred — on-chain copy engine ("rung 3", decision 2026-06-11: NOT built now).**
The stronger-still version moves the fan-out decision itself into the ER program
(subscriptions as delegated accounts; program computes each follower's size and
emits copy orders; server merely executes). Deliberately deferred: it forces
dual-source-of-truth sync between on-chain subscription state and Postgres (where
allocations must also live, since deposits/withdrawals/pauses happen off-chain), the
purity claim leaks anyway (the ER cannot see live follower Flash balances, so the
server must still validate/skip), and its audience is judges rather than users —
receipts + in-ER verification already answer the real user trust question. Revisit
only after M4 ships, as a scoped sprint on top of Phase 3b state, if a specific
Blitz edition or incubator conversation makes it decisive.

**Toolchain / pins (verified June 2026):** Rust 1.89.0, Solana 3.1.9, Anchor 1.0.2;
`ephemeral-rollups-sdk` pinned to whatever `magicblock-engine-examples/anchor-counter`
pins (0.14.3 at writing; docs describe 0.15.x — never mix doc snippets with example
code). Delegation program `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`. Local ER
validator `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev` (localhost:7799 via
`@magicblock-labs/ephemeral-validator`). Router: devnet
`https://devnet-router.magicblock.app` (+wss, free); mainnet
`https://router.magicblock.app`. Mainnet ER is self-serve (MagicNet Phase 2),
validator identities published. Costs: ER txs free; ~0.0001 SOL/commit; 0.0003
SOL/session close; 10-commit fee-payer sponsorship cap → top up via
`lamportsDelegatedTransferIx` from base layer. Install MagicBlock's AI dev skill
first: `npx add-skill https://github.com/magicblock-labs/magicblock-dev-skill`.

**Known gotchas (encode into the plan):** pin the ER validator pubkey in the delegate
ix; `acct.exit(&crate::ID)?` before commit CPIs; ER txs take recentBlockhash from the
ER/router connection; `skipPreflight: true`; undelegate goes to the ER and
`GetCommitmentSignature` recovers the base-layer sig; router-ws `accountSubscribe`
forwarding is undocumented — verify day one, fallback to the regional ER ws; accounts
must exist on base layer before delegation.

**Writer service:** in-process loop, **lease-guarded via the existing ticker-lease
pattern** (dev + prod share one Neon DB; an unleased writer double-appends and
corrupts seq). `seq` is assigned in Postgres (sequence/serial), not process memory —
idempotent re-appends. Consumes fill rows from Phases 1–3, retries with backoff,
monitors commit-fee balance.

**Rollout:** devnet first (demo-grade — and labeled as such), mainnet ER once the
journal survives a week of real traffic. The "verify on Solscan" claim is only made
for the mainnet deployment.

**UI:** live receipts tape on the bot leader page (ws `onAccountChange`, Borsh
decode); leader + follower receipts side-by-side **with the divergence delta**; each
commit links to Solscan; a public shareable receipts page per leader; a "How to
verify a receipt" explainer (the verifier protocol: open venueSig on Solscan →
confirm Flash program, market, side, size, signer → confirm signer is the claimed
leader/follower wallet; audit completeness by replaying the leader wallet's tx
history). Later: Magic Actions post-commit calls maintaining an on-chain Copy-PnL
leaderboard.

### Phase 5 — Stretch: private copy-sizing (Private ER)

Follower stake sizes hidden in a Private Ephemeral Rollup. Honest version (rev 2):
hiding sizes requires also hiding venue-tx linkage (hash the sig, publish a size
bucket), which downgrades those receipts to attestations — acceptable for followers
who opt into privacy over verifiability. Only after the public journal is proven.

## 5. Error handling

- **Bot tx failure** (Flash rejection, RPC timeout): attempt marked failed, no
  position row, no receipt; retried next tick only if the strategy still signals.
- **Receipt write failure**: fills are source-of-truth in Postgres; writer retries
  with backoff; Postgres-assigned seq makes gaps detectable and backfill idempotent.
  The journal is a projection — never a money bug.
- **Session-signer close failure** (revoked delegation — all-or-nothing, Privy
  outage): fall back to notify + one-tap close; bet flagged `autoCloseFailed` for the
  reconciliation job. One-tap close still requires the fee-payer solution (Phase 3).
- **ER unavailability**: writer queues receipts; commits resume when the ER returns.
  Base-layer commits are the durability boundary.
- **Bot liquidation**: detected in tick → `'busted'`, followers closed via the
  standard mirror-close path, admin alert.
- **Rollover window**: receipts queue in the retry buffer; UI re-subscribes via the
  leader index account.

## 6. Testing

- Vitest: fills persistence, receipt Borsh round-trip, resolver live-branch decisions
  (signer mocked), session-signer close builder, payload extension contract
  (TailModal ↔ /api/flash/perp).
- Anchor program tests against the local ephemeral validator; anchor-counter test
  layout is the template.
- Devnet integration smoke: stock counter end-to-end FIRST (deploy → delegate →
  write via router → ws subscribe), then the journal. Riskiest integration step —
  trust no custom code before it passes.
- Real-money verification: bot trades tiny bankroll on mainnet Flash; one in-house
  follower account with a $5 stake exercises open → receipt → auto-close → receipt
  before any external user.

## 7. Risks

| Risk | Mitigation |
|---|---|
| ER delegate-then-write handoff (validator pinning, blockhash source, sponsorship cap) | Stock-counter-first rule; localnet ephemeral validator in CI |
| SDK version churn (0.13→0.15 in 6 weeks) | Pin to example versions; upgrade deliberately |
| Epoch rollover complexity (the real Phase 4 risk) | Pre-sized 100KB epochs (~3–5 days each), lease-guarded cranker, queue during rollover, index-account resubscription — all specified in §4 |
| Privy policy scoping for server-initiated closes | The only unproven Privy piece (signing stack itself already ships in Scalp instant mode); spike the policy definition early; fallback notify + one-tap |
| Server-initiated OPENS (Phase 3b) widen the blast radius | Separate, stricter policy bundle (program allowlist + per-tx cap); freshness gate prevents stale entries; per-subscription drawdown stop; subscribe-time prechecks |
| Autopilot loses user money fast at 500x (Phase 3c) | Budget = absolute loss bound; deterministic shell (code sets size/leverage/stops, LLM only picks direction); mandatory SL triggers; tier caps; tilt-guard cooldowns; distinct "it can lose all of it" consent; liquidation math shown in UI |
| 0-SOL followers stranded in positions | Fee-payer decision required in Phase 3 (sponsor flag / SOL precheck at tail / gas drip); tails refuse to open uncloseable copies |
| Bot loses real money | Small bankroll, hard caps, kill switch, busted handling; losses are verifiable content too |
| Neon compute cost of reviving the resolver loop | Acknowledged: slower live-only tick + budget; this was the original removal reason |
| Bot arena code mid-removal | Restore minimal pieces from git (`810f7d1`, `369d0ce`, `7b13b6c`); no arena UI revival |
| Receipts trust overclaim | Honest wording locked in §1; verifier protocol shipped as UI explainer; devnet labeled demo-only |

## 8. Milestones

1. **M1 — Truth**: Phase 1 shipped (incl. payload extension + Flash reconciliation).
   Flash tails persist; fills table live. (Shippable alone.)
2. **M2 — Live leader**: Phase 2. Pulse trades real money, admin-only visibility,
   track record accumulating.
3. **M3 — Copyable**: Phase 3. Bot leader card public; session-signer auto-close
   working incl. fee-payer solution.
4. **M4 — Receipts**: Phase 4 on devnet ER → the Blitz v6 / Magic Incubator entry
   artifact; mainnet ER after a week of stability (Solscan-verify claim starts here).
   Phase 3b (subscriptions) may run in parallel with this milestone.
5. **M5 — Subscriptions**: Phase 3b shipped — allocate-once tailing with
   proportional sizing, follower risk controls, and subscription receipts.
6. **M6 — Autopilot**: Phase 3c shipped — budgeted AI scalping of the user's own
   wallet in the Scalp game, tiered up to 500x, glass-box receipts.
7. **M7 — Privacy stretch** (Phase 5), once the public journal is proven.

## 9. Decisions log

- Receipts is the headline; AI leader is the engine (competitive scan, June 2026).
- First live bot: Pulse (BTC/ETH/SOL — verified Flash-compatible). Restored from git.
- Follower auto-close: **Privy session signers via the shipped Scalp pattern**
  (`addSessionSigners({signerId, policyIds})` + `signAndSendPrivySolanaTransaction`).
  NOT `useHeadlessDelegatedActions` (contract-test-forbidden, unscoped). NOT
  sign-only+Helius (the ALT failure lore is stale; Privy submit handles Flash txs in
  prod today). Fallback ladder: notify + one-tap close.
- Receipt struct: keep raw 64-byte venueSig (it IS the verifiability); drop the
  followerHash pseudo-privacy (rev 2); Pacifica receipts flagged attestation-only.
- Journal: ~100KB pre-realloc'd epochs on base layer before delegation; lease-guarded
  writer cranks rollover; permanent leader index account; old epochs retained, merkle
  compaction deferred.
- Trust language: attestations anchored to verifiable venue txs — never "trustless".
- Devnet ER first (demo-only label), mainnet ER second. Bot trading is mainnet Flash
  from day one.
- **Both follow modes, sequenced** (user decision 2026-06-11): position-copy ships
  first (M3), subscription tailing is designed in as Phase 3b / M5 — not deferred to
  a future spec.
- **In-ER verification is the Phase 4 baseline; the on-chain copy engine is
  deliberately deferred** (user decision 2026-06-11): mirror-matching + live
  aggregates run inside the ER program; moving the fan-out decision on-chain is
  recorded as a future option, revisited only post-M4 for a specific event.
- **Scalp Autopilot is in scope as Phase 3c** (user decision 2026-06-11): budgeted
  AI trading of the user's own wallet, tiered to 500x via Flash Degen Mode, built
  on the shipped instant/session-signer stack. Framing rule everywhere: MagicBlock
  speed *enables* 500x on-chain; it never *raises* leverage caps.
- **No Telegram bot** (user decision 2026-06-11). Alerts/auto-close fallbacks are
  in-app only.
- Blitz v5 (June 12–14) is NOT a deadline; target Blitz v6+/Magic Incubator with M4.
- Verification env note: `.env.local` lacks `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY` +
  signer/policy ids — confirm the Railway env carries them before relying on
  auto-close in prod; local dev cannot exercise server-side signing today.
