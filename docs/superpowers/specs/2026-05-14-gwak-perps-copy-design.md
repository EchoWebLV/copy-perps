# gwak.gg — Perps-Only Copy-Trading Pivot

**Date:** 2026-05-14
**Status:** Superseded by [2026-05-14-gwak-perps-pacifica-design.md](2026-05-14-gwak-perps-pacifica-design.md)
**Branch:** `perps-ai-wallets`

> **Why superseded:** This spec targets Phoenix Eternal as the venue. After implementation began, live API probes confirmed Phoenix has no public user base (every WS taker we sampled had zero on-chain trader state — they are internal spline / market-maker accounts), no discovery surface, and a 25x leverage cap that misses the "fast pace 50x+" product target. The Pacifica spec is the active design; the product decisions in this doc (snapshot copy, mirror close, two rails, fee model, etc.) all carry over.

## Problem

The current product ships three rails (meme swap, prediction YES/NO, whale perp tail/fade) glued together in a TikTok-style feed. Each rail uses a different execution venue (Jupiter Swap, Jupiter Prediction, Flash Trade) and a different signal source (DexScreener boosts, Jupiter Prediction events, curated Hyperliquid wallets). The fan-out across venues makes the codebase wide and the product story diffuse.

We want a sharper product: **a single perps-only copy-trading feed**, with one execution venue (Phoenix Eternal on Solana) and two narratively-aligned rails (real Phoenix traders, AI personas). Same TikTok-scroll-and-tap UX, same one-tap stakes ($5 / $10 / $20 / $50), same Privy embedded wallet, same gasless-from-the-user-POV Gas Wallet flow.

## Goals

1. **One rail format, one venue.** Every card is "a trader has an open perp position; tap to copy at your stake size." Wallet rail and AI rail differ only in *who the trader is*, not in mechanics or schema.
2. **Snapshot-copy with mirror-close.** Tap = open a position copying the leader's current asset/side/leverage at the user's stake size. Close fires automatically when the leader closes; user can also close manually anytime; hard 24h fallback prevents stale positions.
3. **Phoenix-native everything.** Execution on Phoenix Eternal. Leader wallets sourced from Phoenix. AI bots trade on Phoenix. One API surface, one fee structure, one set of markets.
4. **Pure-USDC user experience.** User funds with USDC, sees USDC balance, every bet is USDC-margined. Gas Wallet pays all SOL fees. No jupUSD, no SOL-balance gate, no asset bridging.
5. **Monetize via Phoenix referral kickback.** No on-tx platform fee. Treasury receives Phoenix's referral payouts.
6. **Honest copy-trading framing.** Real wallets are real wallets. AI personas are LLM-driven strategies with public, auditable on-chain identities (no fakery, no virtual positions).

## Non-goals

- **Reviving old rails.** Meme and prediction rails are hidden behind a feature flag during the pivot for rollback safety, then deleted entirely once we are past the 2-week stabilization window. Drift integration (`lib/drift/*`) is already dead; it stays deleted.
- **Live mirror (subscribe-and-auto-follow).** Rejected during design. Each user tap is a discrete, user-signed open. We rely on snapshot-copy + mirror-close, not subscription-based auto-mirror.
- **Custodial trading.** We never trade on behalf of users without their per-tap signature. Bots trade with platform-owned capital only; users always sign their own copies.
- **Cross-asset / cross-chain execution.** No Hyperliquid copy, no Drift fallback, no asset bridging. If a leader trades a market that doesn't exist on Phoenix, that card never appears.
- **Per-user risk caps.** USDC balance is the only ceiling. No max concurrent copies, no max-per-leader cap, no daily loss limit. The existing 5-minute pending-bet reaper stays as the only "kill orphaned holds" safety.
- **Viral / social layer (Phase 4+).** X auto-posting per persona, PnL share cards, leaderboards, and Phoenix referral rev-share to users are explicitly out of scope for v1. See "Phased rollout" and "Out of scope (v1)" below.

## Architecture

### Two rails, one card shape, one bet shape

| Aspect | Wallet rail | AI rail |
| ------ | ----------- | ------- |
| Leader is | A Phoenix authority operated by a real trader | A Phoenix authority operated by an LLM agent |
| Discovery | Hand-curated seed list, then on-chain indexer | Static set: 7 strategy wallets |
| Card count | Up to 200 (best-effort, ceiling not floor) | ~50 via (7 strategies × ~8 markets) grid |
| Filter | Trades at per-asset Phoenix max leverage, has open position now, non-stale | Each persona card surfaces only when its strategy wallet has an open position in that market |
| Signal refresh | Cron, 1–2 min | Bot agents trade on their own decision tick; signal cron snapshots their state |

Both rails write into the same `signals` table with different `type` values and feed the same `/api/bet/copy` route. The frontend renders one card component with a "wallet" or "AI" badge variant.

### Three wallets (server-side)

Carries over the existing gasless-trades structure with one addition:

| Wallet | Holds | Job |
| ------ | ----- | --- |
| **Gas Wallet** (hot) | SOL only | Pays SOL fees on every user-signed tx |
| **Treasury Wallet** | USDC | Receives Phoenix referral kickbacks; refuels Gas Wallet on schedule |
| **Strategy Wallets** (7, hot) | USDC margin | Each operates one LLM-driven AI bot, holds bot's open positions on Phoenix |

Strategy Wallets are new. Each has its own `STRATEGY_WALLET_{N}_PRIVATE_KEY` env var, indexed `1..7`. Capital target per wallet at launch: $1k–2k USDC. Total bot float: ~$10–15k.

### Phoenix Eternal integration

- Read side: `GET /trader/{authority}/state` (positions, collateral, orders), `GET /trader/{authority}/trades-history` (recent activity), `GET /exchange/markets` (asset list, max-leverage per market).
- Write side: signed Solana transactions composed via Phoenix's tx-builder endpoints (specific endpoint paths confirmed at implementation time). Submission via Helius RPC `sendRawTransaction`, same as today's Jupiter and Flash flows.
- Real-time: leader account changes detected via **Helius account-change WebSocket** subscriptions on followed-leader Phoenix accounts. Phoenix's own WS may be used in addition if it carries info Helius does not (e.g. funding payments).

### Decision cadence

- **AI bot tick:** every 5 minutes per strategy wallet (7 LLM calls every 5 min = 84/hour ≈ $1–2/day with Haiku 4.5). Each tick the agent sees current position state, recent candles, funding rate, recent liquidations, and decides hold/open/adjust/close. Sonnet 4.6 runs a once-per-hour "session review" that may update the agent's running notes (also persisted in `signals.meta`).
- **Signal cron (`/api/cron/refresh-traders`):** runs every 90s, queries Phoenix for trader state on the seed-list wallets + the AI strategy wallets, writes/replaces `signals` rows.
- **Mirror-close detector:** persistent WebSocket worker subscribes to every leader Phoenix account that has at least one active follower. On state change, it diffs the leader's position list; for any position that closed, it builds and submits close txs for every user bet currently following that position. Implemented as a long-running Node worker on Vercel (Fluid Compute, no execution timeout) or as a dedicated background process if Fluid Compute's runtime model proves unsuitable.

## Wallet rail

### Discovery (phased)

**Phase 1 — hand-curated seed list.** `lib/phoenix/whales.ts` exports an array of Phoenix authority addresses. Mirrors today's `lib/hyperliquid/whales.ts` pattern. Sourced from:

- Phoenix's own UI / trader pages.
- Their Discord / X (high-engagement traders self-promote).
- Direct partnership ask to the Phoenix team for a top-volume list.

Target: 30–80 wallets at launch. The feed shows fewer than 200 cards on day one and that is fine; "200" is a ceiling, not a floor.

**Phase 3 — on-chain indexer.** `lib/phoenix/indexer.ts` subscribes to the Phoenix program via Helius `accountSubscribe` + `programSubscribe`, decodes trader account updates, aggregates per-authority into a rolling 7-day score:

```
heat_score = w1 * trades_per_day
           + w2 * avg_leverage_normalized_to_market_max
           + w3 * position_turnover_inverse   // shorter holds rank higher
           + w4 * has_open_position_now
           - w5 * stale_days
```

Top 200 by `heat_score` persist in a new `phoenix_traders` table. The seed list path is retained as a fallback override (so we can pin specific wallets if we want them in the feed).

### Card content

Each wallet card surfaces these fields:

- Authority address (truncated, with click-to-Solscan)
- Current open position: market, side, leverage, notional, entry price, unrealized PnL %
- 7-day stats: total trades, win rate, total PnL %, avg hold time
- Stake buttons: $5 / $10 / $20 / $50

### Heat scoring

Composite score driving feed order. Defined in `lib/signals/heat-phoenix-trader.ts`. Weights tuned empirically; first cut prioritizes (in order): has-open-position-now, recency-of-last-trade, trade-frequency, leverage-tier.

## AI rail

### Strategy roster (7 wallets, 7 LLMs)

| Strategy | Vibe | Decision style | Market basket |
| -------- | ---- | -------------- | ------------- |
| **DegenScalper** | High-frequency mean-revert | Fade extreme 1m–5m moves on majors | SOL, BTC, ETH, XRP |
| **FundingFlipper** | Funding-rate arb | Long when funding deeply negative, short when deeply positive | SOL, BTC, ETH, BNB, HYPE |
| **BreakoutHunter** | Trend-initiation sniper | Buy/sell on 4h/1d high/low breaks with volume confirm | SOL, BTC, ETH, JUP, PUMP |
| **LiquidationVulture** | Cascade reversal | Opens reverse direction after large liq cascades | SOL, BTC, ETH, DOGE |
| **MomentumRider** | EMA-crossover trend follow | Rides multi-hour trends, trails stops | SOL, BTC, ETH, XRP, TON |
| **ContrarianFader** | Patient reversal | Fades multi-day extreme moves | SOL, BTC, ETH, FARTCOIN |
| **NewsReactor** | Anomaly chase | Opens on price+volume z-score spikes | All majors + 2 random alts/day |

Each strategy wallet runs one LLM agent. The agent's system prompt encodes the vibe; the user prompt for each decision tick contains market state + position state + recent decision history.

### Persona projection (50 cards from 7 wallets)

The frontend shows up to 50 "persona" cards via a (strategy × market) projection:

```
persona_id = `${strategy_id}:${market_symbol}`
persona_card.position = strategy_wallet.positions.find(p => p.market === market_symbol)
```

If `DegenScalper` has SOL/Long and BTC/Short open right now, two cards appear: `degenscalper:SOL` and `degenscalper:BTC`. The remaining 5 markets in DegenScalper's basket produce cards that say "watching" (no current position, lower feed priority). At full saturation across 7 strategies × ~8 markets = ~56 raw cells; feed ranks by has-position-now then heat.

Each persona has its own display metadata (name, avatar, one-line bio) stored in `lib/ai-bots/personas.ts`. On-chain inspection reveals the 7 strategy wallets; we do not claim each persona is a unique on-chain entity.

### LLM agent runtime

`lib/ai-bots/agent.ts` — one function per agent:

```ts
async function tickStrategy(strategyId: StrategyId): Promise<void> {
  const wallet = getStrategyWallet(strategyId);
  const positions = await phoenix.getTraderState(wallet.publicKey);
  const marketContext = await gatherMarketContext(strategy.basket);
  const decision = await callLLM({
    model: 'claude-haiku-4-5-20251001',
    system: strategy.vibePrompt,
    messages: [{ role: 'user', content: buildDecisionPrompt({ positions, marketContext, recentNotes }) }],
    tools: [openPositionTool, closePositionTool, holdTool],
  });
  await executeDecision(decision, wallet);
  await persistAgentNote(strategyId, decision.reasoning);
}
```

`tickStrategy` is invoked every 5 minutes per strategy by a Vercel Cron-scheduled route (`/api/cron/tick-ai-bots`) iterating all 7.

### Guardrails (per agent)

- **Max position notional per trade:** $300 (caps total bot risk per market).
- **Daily loss cap per agent:** -$50. Hit → agent goes to "rest" for 24h; no opens permitted; existing positions still close normally.
- **Asset allowlist:** enforced server-side regardless of LLM output.
- **Leverage cap:** Phoenix's per-asset max, enforced before tx build.
- **Treasury kill-switch:** env var `AI_BOTS_PAUSED=true` halts all opens (closes still execute) within one tick (≤5 min). Used during incidents.
- **Tool schema validation:** if the LLM returns malformed tool args, the tick is a no-op and the error logged. We do not retry within the same tick.

## Tap → close flow

1. **Tap.** User taps `$10` on a card. Client POST `/api/bet/copy` with `{ leaderAuthority, market, side, leverage, stakeUsdc }`.
2. **Validate + build.** Server:
   - Verifies leader still has the position open (re-fetches Phoenix state).
   - Verifies user's USDC ≥ `stakeUsdc`.
   - Composes a Phoenix open-position tx using user's pubkey as trader authority, Gas Wallet as fee payer.
   - Partial-signs as Gas Wallet.
   - Inserts `bets` row with `status: 'pending'`, `type: 'copy'`, `meta: { leaderAuthority, leaderPositionPubkey, market, side, leverage, userPositionPubkey: null }`.
   - Returns `{ betId, openTransaction }` (base64, partially signed).
3. **User signs.** Client calls Privy `signTransaction`, broadcasts via Helius `sendRawTransaction`.
4. **Confirm.** Client POST `/api/bet/copy/confirm` with the signature. Server polls signature status, flips `status: 'confirmed'`, populates `userPositionPubkey` from on-chain confirmation.
5. **Live.** Mirror-close worker (already subscribed to that leader's account) tracks the user's bet under the leader's `leaderPositionPubkey`.
6. **Close.** Three triggers, whichever fires first:
   - **Leader close** (primary): worker observes leader's position close → builds a close tx for the user's matching bet, partial-signs with Gas Wallet, submits via a server-side bot-style flow that uses a delegated session signer (option A) **or** notifies the client which signs and submits (option B). Decision pending: spec defaults to (A) using Privy's delegated-actions API so close is automatic and does not require the user to be online. If delegated signing is not viable at implementation time, falls back to (B) with the 24h hard close as backstop.
   - **Manual close** (UI): user taps "Close" on the position row in `/portfolio`. Same tx flow but signed live by the user.
   - **24h hard fallback**: cron `/api/cron/expire-stale-copies` runs hourly, closes any bet whose `confirmedAt` is older than 24h regardless of leader state.
7. **Settle.** Close-confirm marks `status: 'closed'`, writes `proceedsUsdc` and `closeTxHash` to `bets`.

### Entry-price caveat (acknowledged in product copy)

User enters at the live mark when their tx lands, not at the leader's entry price. Any unrealized PnL the leader had at the moment of the user's tap is *not* inherited. Surfaces in the card as "you enter at ~$X (leader entered at $Y, +Z% ahead of you)". This is the honest cost of snapshot-copy.

## Schema changes

### `signals` table

- Existing shape preserved. New `type` enum values: `'phoenix_trader'`, `'ai_persona'`. Existing values (`meme`, `prediction`, `multiprediction`, `whale`) remain but are no longer populated by any cron in v1.
- `meta` JSONB shape for new types:

```ts
// type: 'phoenix_trader'
{
  authority: string,         // base58 Solana pubkey
  position: {
    market: string,
    side: 'long' | 'short',
    leverage: number,
    notionalUsd: number,
    entryPrice: number,
    unrealizedPnlPct: number,
    positionPubkey: string,
  } | null,
  stats7d: { trades: number, winRatePct: number, pnlUsd: number, avgHoldMinutes: number }
}

// type: 'ai_persona'
{
  strategyId: 'degen_scalper' | 'funding_flipper' | ...,
  marketSymbol: string,
  personaDisplay: { name: string, avatarUrl: string, bio: string },
  strategyWalletAuthority: string,
  position: { /* same shape as above */ } | null,
  stats7d: { ... }
}
```

### `bets` table

- New `type` enum value: `'copy'`. Existing values (`meme`, `prediction`, `perp`) remain for legacy rail rows but get no new writes in v1.
- **`feeUsdc` column** stops being populated on new bets (no per-tx platform fee; Phoenix referral kickback is settled out-of-band, not per-tx). Column is retained on the table for legacy bet history; no DDL migration.
- `meta` JSONB shape for `type: 'copy'`:

```ts
{
  leaderAuthority: string,
  leaderPositionPubkey: string,
  market: string,
  side: 'long' | 'short',
  leverage: number,
  userPositionPubkey: string | null,    // populated on open-confirm
  leaderRailType: 'phoenix_trader' | 'ai_persona',
}
```

### New tables

- **`phoenix_traders`** (Phase 3): populated by the on-chain indexer.

  ```
  authority text primary key
  first_seen_at timestamptz
  last_active_at timestamptz
  heat_score double precision
  rolling_stats jsonb           -- trades/day, avg lev, turnover, pnl trajectory
  is_pinned boolean default false   -- override flag for hand-curated inclusion
  ```

- **`ai_bot_notes`** (Phase 2): rolling agent memory.

  ```
  id serial primary key
  strategy_id text not null
  recorded_at timestamptz not null default now()
  note_kind text not null         -- 'decision' | 'session_review' | 'guardrail_trip'
  content text not null
  metadata jsonb
  ```

No table is added for follow-subscriptions or copy-fanout — mirror-close fans out by querying `bets WHERE meta->>'leaderPositionPubkey' = $1 AND status = 'confirmed'`.

## Code changes

### Removed (no flag, dead path under v1)

- `lib/usd/consolidate.ts` — consolidation was for jupUSD; no more jupUSD.
- `lib/jupiter/swap.ts`, `lib/jupiter/constants.ts` — meme rail uses this; meme rail is going away.
- `lib/jupiter-prediction/client.ts` — prediction rail uses this; prediction rail is going away.
- `lib/flash-trade/*` — replaced by Phoenix.
- `lib/dexscreener/client.ts` — meme signal source.
- `lib/hyperliquid/client.ts`, `lib/hyperliquid/whales.ts` — whale signal source replaced by Phoenix-native.
- `lib/drift/*` — already dead; explicitly delete now.
- `lib/bets/post-with-consolidation.ts` — collapses to a much smaller helper.
- `lib/signals/refresh-memes.ts`, `lib/signals/refresh-predictions.ts`, `lib/signals/refresh-whales.ts` and corresponding `app/api/cron/refresh-*` routes.
- `lib/signals/heat-meme.ts`, `lib/signals/heat-prediction.ts`, `lib/signals/heat-whale.ts`.
- `scripts/refresh-memes.ts`, `scripts/refresh-predictions.ts`, `scripts/refresh-whales.ts`.

### Flagged (kept compilable, hidden under `FEATURE_LEGACY_RAILS`)

For a 2-week rollback safety window, then deleted:

- `app/api/bet/meme/**`, `app/api/bet/prediction/**`, `app/api/bet/perp/**`.
- `components/feed/*Meme*`, `components/feed/*Prediction*`, `components/feed/*Whale*`.

When the env var is unset or `false`, these routes return 410 Gone and the feed renderer hides the corresponding card types. Code paths still compile and can be flipped back on with one env var change. Deleted entirely in Phase 3.

### Added

- `lib/phoenix/client.ts` — REST + WS client for Phoenix Eternal. Wraps `GET /trader/{authority}/*`, `GET /exchange/markets`, order/position tx builders, account-change subscriptions.
- `lib/phoenix/whales.ts` — hand-curated seed list (Phase 1).
- `lib/phoenix/markets.ts` — cached `GET /exchange/markets` response (refreshed daily). Source of truth for per-asset max leverage.
- `lib/phoenix/indexer.ts` — on-chain Phoenix program indexer (Phase 3).
- `lib/wallets/strategy.ts` — Strategy Wallet keypair loader (mirrors `lib/wallets/gas.ts`).
- `lib/ai-bots/strategies.ts` — the 7 strategy definitions (vibe prompt, market basket, parameters).
- `lib/ai-bots/personas.ts` — display metadata for the ~50 persona cells.
- `lib/ai-bots/agent.ts` — LLM tick implementation.
- `lib/ai-bots/runtime.ts` — orchestration of tick scheduling, guardrails, kill-switch.
- `lib/ai-bots/notes.ts` — agent memory persistence.
- `lib/signals/refresh-traders.ts` — combined signal-refresh for wallet rail + AI rail.
- `lib/signals/heat-phoenix-trader.ts` — heat scoring.
- `lib/bets/copy.ts` — tx build + sign coordination for `/api/bet/copy`.
- `lib/bets/mirror-close.ts` — leader-state diff + close fan-out logic.
- `lib/bets/post-and-confirm.ts` — replaces `post-with-consolidation.ts`, no consolidation branch.
- `app/api/bet/copy/route.ts`, `app/api/bet/copy/confirm/route.ts`, `app/api/bet/copy/close/route.ts`, `app/api/bet/copy/close/confirm/route.ts`.
- `app/api/cron/refresh-traders/route.ts` — replaces 3 refresh-* routes.
- `app/api/cron/tick-ai-bots/route.ts` — invokes `tickStrategy` for each of 7 strategies (5-min cron).
- `app/api/cron/expire-stale-copies/route.ts` — 24h hard close fallback (hourly cron).
- `components/feed/CopyCard.tsx` — single card component, variants for wallet and AI badges.
- `components/portfolio/CopyRow.tsx` — single position row for `/portfolio`.

### Env vars (new)

- `STRATEGY_WALLET_1_PRIVATE_KEY` … `STRATEGY_WALLET_7_PRIVATE_KEY` — base58 secrets for the 7 AI strategy wallets.
- `ANTHROPIC_API_KEY` — for Haiku 4.5 + Sonnet 4.6 calls in `lib/ai-bots/agent.ts`.
- `PHOENIX_REFERRAL_CODE` — our referral code, attached to every user tx (if Phoenix's tx builder accepts a referral parameter; verified at implementation time).
- `AI_BOTS_PAUSED` — kill-switch flag.
- `FEATURE_LEGACY_RAILS` — flag retaining the meme/prediction/perp routes for rollback safety; defaults `false`.

### Env vars (removed in Phase 3)

- `FEATURE_GASLESS_BETS` — gasless is the only path now; flag retired.

## Phased rollout

**Phase 1 — base wallet rail + Phoenix integration (week 1):**
- `lib/phoenix/*` (client, markets, whales), `lib/wallets/strategy.ts`.
- `app/api/bet/copy/*` routes.
- `lib/signals/refresh-traders.ts` (wallet-rail only — feeds from `phoenix/whales.ts`).
- `components/feed/CopyCard.tsx`, `components/portfolio/CopyRow.tsx`.
- Mirror-close worker (`lib/bets/mirror-close.ts`) running against wallet-rail bets only.
- Legacy rails flagged off (`FEATURE_LEGACY_RAILS=false`).

**Phase 2 — AI rail live (week 2):**
- `lib/ai-bots/*` complete.
- 7 strategy wallets funded with $1–2k each.
- Bots run in "paper" mode (decisions logged, tx not submitted) for 48h, then go live with full guardrails.
- Persona grid populates the feed alongside wallet rail.
- `/api/cron/tick-ai-bots` cron active.

**Phase 3 — on-chain indexer + legacy deletion (week 3+):**
- `lib/phoenix/indexer.ts` and `phoenix_traders` table.
- Indexer replaces seed list as the source of truth (seed list still applied as pinned override).
- Legacy rail code physically deleted (no flag).
- `FEATURE_GASLESS_BETS` env var removed.

**Phase 4 — viral / social layer (week 4+, separate spec):**
- X auto-posting per AI persona.
- PnL share card generator.
- Leaderboards (daily/weekly).
- Phoenix referral rev-share to users.

## Out of scope (v1)

- All Phase 4 items above.
- Live mirror / subscribe-and-auto-follow.
- Cross-venue execution.
- Per-user risk caps beyond USDC balance.
- Phoenix WebSocket integration (Helius WS suffices for account changes; revisit if Phoenix WS carries info Helius does not).
- Reclaiming SOL rent on close (rounding error; revisit if it adds up).
- KYC / geofencing changes (existing Vercel `fra1` region pin from commit `d379516` remains; revisit if Phoenix imposes its own geo restrictions).
- Mobile parity (Expo app at `apps/mobile/`) — tracked separately under "Mobile parity goal."

## Open risks

1. **Phoenix is new.** The active trader pool may be smaller than 200, and Phoenix's referral economics, API stability, and uptime are unproven over our launch window. Mitigation: Phase 1 ships even if only 30–50 wallets fill the feed; AI rail provides constant content; we monitor Phoenix uptime and have a "Phoenix degraded" UI banner ready.
2. **LLM bot drawdowns.** A bot could blow $50/day for several days in a row before we notice. Mitigation: daily loss cap per agent (-$50, then 24h rest), treasury kill-switch, daily PnL summary in ops channel.
3. **Asymmetric copy fidelity.** Even Phoenix-native, snapshot-copy users systematically enter later than leaders. Some will feel cheated. Mitigation: explicit UI surfacing of "leader entered at $X, you enter at $Y" before tap; also surfaces leader's unrealized PnL so user has the context.
4. **Phoenix referral payouts may be delayed or below expectation.** We are betting that referral kickback is enough to fund the product at our stake sizes. Mitigation: monitor referral revenue weekly; if dry, fall back to a low-rate per-tx fee (we know how to add one back, since we just removed it).
5. **Privy delegated signing for auto-close may be unavailable or unsafe.** Mitigation: 24h hard close fallback (already in design) guarantees positions don't stay open indefinitely; manual close in `/portfolio` covers the engaged-user case.
6. **Helius WS reliability at scale.** Subscribing to N leader accounts where N may reach hundreds is non-trivial. Mitigation: connection-pool worker with reconnect/backoff; fallback to 30s REST polling on any account whose WS sub fails; monitor missed-close incidents weekly.
7. **AI-bot regulatory surface.** A US user copying an LLM that is in turn placing perps trades on Solana could be argued in either direction by US regulators. Mitigation: same legal posture as the existing product (geofence US via Vercel region + Phoenix's own geofence if it has one); explicit ToS disclosure that AI personas are platform-operated systematic strategies, not human traders.

## File-level summary (for reviewer orientation)

The pivot touches roughly:
- **Adds:** ~18 new files under `lib/phoenix/`, `lib/ai-bots/`, `lib/bets/copy.ts`, `lib/bets/mirror-close.ts`, and 4 new API route files.
- **Removes:** ~15 files under `lib/jupiter*`, `lib/flash-trade/`, `lib/hyperliquid/`, `lib/drift/`, `lib/dexscreener/`, `lib/usd/`, `lib/signals/refresh-{memes,predictions,whales}.ts`, `lib/signals/heat-{meme,prediction,whale}.ts`.
- **Flagged for 2 weeks then removed:** ~8 directories under `app/api/bet/{meme,prediction,perp}/` + corresponding card components.
- **Schema:** `signals` and `bets` keep their tables (new `type` values; `bets.feeUsdc` retained but unset on new copy bets); two new tables added later (`phoenix_traders` in Phase 3, `ai_bot_notes` in Phase 2).
