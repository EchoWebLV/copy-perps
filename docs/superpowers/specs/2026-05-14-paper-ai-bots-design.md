# Paper AI Bots Design

**Status**: foundation locked, ready for plan.
**Branch**: `casino-mode` (rename pending; current branch holds prior work-in-progress).
**Supersedes** (operationally, not deleted): the wallet-leaderboard copy-trade rail documented in [2026-05-14-gwak-perps-pacifica-design.md](2026-05-14-gwak-perps-pacifica-design.md) and the casino-mode rework in [2026-05-14-casino-mode-design.md](2026-05-14-casino-mode-design.md). Both stay in the repo behind feature flags (`FEATURE_COPY_TRADE`, `FEATURE_CASINO_MODE`); neither is the Phase 1 surface.

## Goal

Build a paper-trading AI persona feed where 12 named bots run hand-coded perp strategies, compete on a public leaderboard, and users can one-tap copy any bot's current position with real Pacifica execution via their agent wallet.

Phase A is "paper for the bots, real for the user" — the bot side is bookkeeping against Pacifica's canonical mark; the user side opens a real Pacifica perp order through the existing agent-wallet plumbing. No treasury exposure on the bot side in Phase A. Phase B promotes proven paper bots to real-bankroll status and opens a humans-vs-bots arena on the same leaderboard.

## Why this, not wallet-leaderboard copy

The wallet rail at [2026-05-14-gwak-perps-pacifica-design.md](2026-05-14-gwak-perps-pacifica-design.md) depends on real traders being open. Inventory dies when no whale is positioned. Anonymous wallets like `9Gdm…4kS` don't propagate as memes; named characters do. AI personas are always-on, narrative-rich, and a TikTok feed of "Liquidation Lizard just opened 50x SOL short" beats "wallet `9Gdm…4kS` opened a position." This also positions the product for Phase B: humans compete against the same bots on the same leaderboard, which is the genuinely-novel category (no trading product ships bot-vs-human public arenas today).

Why not casino mode (the [2026-05-14-casino-mode-design.md](2026-05-14-casino-mode-design.md) direction): synthetic 1.9x payouts cap upside, "1.9× or push" mechanic reads as gambling-product not trading-product, and treasury PnL exposure dominates risk. Paper bots + real Pacifica copy delivers the same one-tap dopamine with real-world payouts and zero house-bankroll risk in Phase A.

## Core mechanic

### Tap → real Pacifica trade matching the bot

1. User scrolls the leaderboard or the live feed and finds a bot whose current paper position they want to ride.
2. Tap a stake (`$5 / $10 / $20 / $50`) on the bot's card.
3. Server signs a Pacifica `create_market_order` with the user's agent wallet matching the bot's `(market, side, leverage)`, scaled to the chosen stake. Existing flow from [app/api/bet/copy/route.ts](../app/api/bet/copy/route.ts), retargeted to a bot reference instead of a leader wallet.
4. Fill returns; row inserted into `bets` with `type: "copy"` and `meta.botId` pointing at the bot whose paper trade was copied.

### Auto-mirror close

When the bot closes its paper position (resolver-loop sees its strategy exit condition fire), the existing `mirror-close` cron at [app/api/cron/mirror-close/route.ts](../app/api/cron/mirror-close/route.ts) closes any open follower bets attached to that bot. Identical pattern to wallet-rail mirror-close, just keyed on `meta.botId` instead of `meta.leaderAddress`.

### Manual close + guardrails

- User can manually close anytime via the existing close flow.
- **Hard 24h auto-close** on any open follower position regardless of bot state, via the same expire-stale-copies cron we run today.
- **−50% circuit breaker** per follower position: if real-PnL drops below −50% of stake, server force-closes via `reduce_only` order. New worker, runs alongside mirror-close at 1-minute cadence.

## Roster: 12 bots

### 6 headliner personas

Each headliner is a full character: distinct strategy, distinct xAI voice, distinct avatar, distinct lore. Hand-coded strategy logic in `lib/bots/strategies/<slug>.ts`; persona description + voice prompt in `lib/bots/personas/<slug>.ts`.

| Bot | Strategy | Voice | Markets |
|---|---|---|---|
| 🦎 **Liquidation Lizard** | Fades 1–3% wicks confirmed by Hyperliquid liquidation feed (>$50k forced sells). 1m timeframe. | Predator. Shit-talks the liquidated. "Free money." | BTC, ETH, SOL |
| 📊 **Funding Phoebe** | Shorts when ≥3 venues' funding flips positive against the same direction. Holds until funding mean-reverts. | Dry quant. Cites numbers. | All 8 majors |
| 🎯 **Mean-Revert Mike** | z-score > 2.5 above 30m mean → short, inverse for longs. Regime-gated — pauses in trending markets. | Contrarian dad. Eye-rolls at the crowd. | SOL, HYPE, alts |
| 🚀 **Momo Max** | 5m–1h breakout long with HL volume confirmation. Correlation-gated against BTC 1m momentum. | Exuberant FOMO bro. | BTC, ETH, SOL, HYPE |
| 💥 **Vol Vector** | Sleeps in calm regimes. Opens with the direction of the move when realized vol > 2× 24h baseline + order book thinning confirms. | Terse, single-word messages. | Opportunistic alts |
| 🐢 **Boomer Trend** | 4h fast/slow MA crossover. Lowest trade frequency, longest holds. | Patient elder statesman. | BTC, ETH only |

### 6 strategy variants

Each variant is a parametric extension of a headliner: same code path, different thresholds. Share the parent's voice (xAI prompt inherits with a `variant=jr` flag noting the tighter parameters). Fills the leaderboard with categorically-similar but distinct entries.

| Variant | Parent | Parameter delta |
|---|---|---|
| 🦎 Liquidation Lizard Jr. | Liquidation Lizard | Wick threshold 0.5–1.5% (smaller wicks, more trades) |
| 📊 Funding Phoebe Lite | Funding Phoebe | Triggers on 2 venues instead of 3 (lower bar, more trades) |
| 🎯 Mean-Revert Mike Patient | Mean-Revert Mike | z-score > 3.0 + 1h timeframe (rarer, higher conviction) |
| 🚀 Momo Max Aggressive | Momo Max | 5m breakouts at lower volume threshold (more shots) |
| 💥 Vol Vector Hair-Trigger | Vol Vector | Vol baseline multiplier 1.5× instead of 2× (more sensitive) |
| 🐢 Boomer Trend Wide | Boomer Trend | Slower MAs (8h fast / 24h slow); fewer, bigger swings |

### One position per bot

Each bot holds **at most one open paper position at a time**, across all the markets in its bracket. Keeps the leaderboard ranking honest (one strategy = one PnL line), keeps the feed clean (one card per bot), preserves the persona-as-character framing (each bot has one "current take"). Multi-position is Phase B if the feed feels sparse in QA.

## Strategy + LLM model

Strategies are deterministic, hand-coded TypeScript in `lib/bots/strategies/`. No LLM-driven trade decisions — promotion to live treasury bankroll (Phase B) requires measurable paper edge, and an LLM in the decision path makes that signal unreliable.

xAI Grok acts as a co-pilot in exactly three roles:

1. **Regime classifier** ([lib/bots/regime.ts](../lib/bots/regime.ts), new). Continuous per-asset classification into `trending | mean-reverting | vol-expanding | chop`. Inputs: recent candle stats, realized vol, microstructure summary. Output: regime label + confidence. Cached per-asset for 60s. Bots gate strategy entry against the current regime (e.g. Mean-Revert Mike refuses to open in `trending`).
2. **Real-time narrator**. Every open and close emits a persona-voiced 1–2 sentence explanation via Grok. Prompt structure: persona system prompt + per-event payload (asset, side, entry, exit, paper-PnL, recent market context). Voice is generated lazily on read — UI fetches narration when a card surfaces, server caches indefinitely keyed on `(botId, eventId)`.
3. **Weekly dossier** ([lib/bots/dossier.ts](../lib/bots/dossier.ts), new). Each bot self-reflects on its trades for the past 7 days. Public artifact on the bot's detail page. Cron job runs every Monday morning.

xAI cost budget: ~3 LLM calls per trade event × ~50 trades/day across roster × 30 days ≈ 4,500 calls/month. Negligible at Grok's pricing.

## Data stack

Six sources, four already in the codebase:

| Source | Status | Used by |
|---|---|---|
| **Pacifica WS + REST** ([lib/pacifica/](../lib/pacifica/)) | Shipped | All bots; execution venue; user copies |
| **Hyperliquid full WS** ([lib/hyperliquid/](../lib/hyperliquid/)) | Partial — currently REST-only for whale poll; needs full WS subscription for liquidation feed + big fills | Liquidation Lizard, Momo Max, Vol Vector |
| **Multi-CEX funding aggregator** | New — ~4hr build, hits Binance/Bybit/OKX/dYdX public funding endpoints | Funding Phoebe |
| **Helius webhooks** | API key shipped; webhook listener new | Mean-Revert Mike (whale-flow confirmation) |
| **Pyth oracles** | New — Pyth on-chain SDK + subscription | Mean-Revert Mike (spot divergence); safety circuit (Pacifica mark vs Pyth oracle divergence > X% pauses all bots) |
| **xAI Grok** ([@ai-sdk/xai](../package.json)) | Shipped via Analyze modal | Regime classifier, narrator, dossier |

### New module layout

```
lib/bots/
  index.ts                    # bot registry: id → BotConfig
  personas/<slug>.ts          # persona + voice prompt per headliner; 6 files
  strategies/<slug>.ts        # strategy implementation per archetype; 6 files
  variants.ts                 # variant config (parametric extensions)
  regime.ts                   # xAI regime classifier
  microstructure.ts           # order book depth analysis
  correlation.ts              # BTC correlation gate
  cross-bot.ts                # disagreement detection
  narrator.ts                 # xAI per-event narration
  dossier.ts                  # weekly self-reflection cron
  paper.ts                    # paper-PnL bookkeeping helpers
  resolver.ts                 # 10s tick loop, samples marks, resolves paper positions
lib/data/
  hyperliquid-ws.ts           # full WS subscription (liquidations, fills, marks)
  cex-funding.ts              # multi-venue funding aggregator
  helius-webhooks.ts          # large-USDC-flow listener
  pyth.ts                     # oracle subscription
```

## Architectural sophistication

Six middleware/infra pieces wrapped around strategy code. Each is a thin abstraction with a clear test surface.

### Multi-timeframe analysis

Strategies operate on candles aggregated from Pacifica WS fills at 1m / 5m / 1h / 4h. Aggregator runs in-process, rolling window per-asset per-timeframe in memory. Same strategy archetype can fire on different timeframes for different variants (Liquidation Lizard Jr. on 1m wicks, Liquidation Lizard regular on 5m).

### Regime detection

xAI-classifier output (per asset, 60s cache) gates strategy entry. Strategies declare which regimes they're allowed in:

```ts
LIQUIDATION_LIZARD.regimeAllowed = ["vol-expanding", "chop"];
MEAN_REVERT_MIKE.regimeAllowed   = ["mean-reverting"];
MOMO_MAX.regimeAllowed           = ["trending", "vol-expanding"];
BOOMER_TREND.regimeAllowed       = ["trending"];
```

If a bot is in an open position and regime changes against it, the strategy can elect to early-exit (declared in strategy config).

### Correlation gating

`lib/bots/correlation.ts` exposes `btcMomentumOk(side: "long"|"short")` — returns whether BTC's 1m momentum confirms the requested side. Alts-only strategies (Momo Max, Mean-Revert Mike on alts) call this before opening; longs blocked when BTC is rolling over. Cuts a meaningful share of correlated dumb losses.

### Order book microstructure

`lib/bots/microstructure.ts` reads Pacifica + Hyperliquid bid/ask depth, detects: large hidden orders, fast depth thinning on one side, recent fill side-bias. Vol Vector uses this directly; Liquidation Lizard uses it as a tie-breaker on small wicks.

### Cross-bot awareness

`lib/bots/cross-bot.ts` exposes the current open paper positions across all bots. Strategies can:

1. **Avoid pileup** — refuse to open the same side on the same asset that ≥3 bots are already in (reduces correlated paper-PnL drawdowns from the same wrong call).
2. **Surface disagreement** — when one bot is long and another is short on the same asset, both cards link to each other in the feed ("Liquidation Lizard disagrees with this trade"). UX feature; the strategies don't act on it.

### Backtest gate before paper-live

New bots and variants must pass a backtest against 30 days of historical Pacifica + Hyperliquid data before they're surfaced in the live leaderboard. Backtest runs in CI on every strategy file change. Required minimum: positive paper PnL on backtest, ≥40 simulated trades, ≥50% win rate. Bots that fail the gate are tagged `status: "backtest-fail"` and excluded from the public feed. Manual override available for tuning periods.

## Surface

### Leaderboard (primary)

Mobile-first single-page leaderboard at `/feed` (replacing the current Pacifica wallet leaderboard at that path). Each row:

```
#1 🦎 Liquidation Lizard       +$4,231   67%   24x streak   LONG SOL 50x   [Copy $5 $10 $20 $50]
#2 📊 Funding Phoebe           +$2,891   71%   8x  streak   SHORT BTC 20x  [Copy ...]
#3 🚀 Momo Max                 +$1,420   54%   3x  streak   IDLE           [Watch]
...
```

Default sort: 24h paper PnL. Toggle: 7d / 30d / all-time / win rate / streak.
First-time visitor lands on 24h sort (most movement, freshest narrative).
Tapping a row opens the bot detail page: full position history, weekly dossier, persona avatar + bio, live narration of current position.

### Live Feed (secondary tab)

TikTok-style swipe at `/feed/live`. Cards appear when a bot opens a position, persist until close or 24h hard cap. Sorted by recency. Empty state (rare — at least one bot is usually open): shows "no fresh trades in the last 5 minutes" + persona commentary cards generated by xAI.

Card layout follows the existing [CopyCard](../components/feed/CopyCard.tsx) shape but renders bot persona + paper-PnL chart + narration in place of leader wallet data.

### Onboarding default

First-time-authed users land on the leaderboard. A one-time intro overlay introduces "These are 12 AI bots that paper-trade real markets. Tap to copy any of them with your real USDC."

## Schema changes

```text
+ table bots
    id                  text primary key                -- e.g. "liquidation-lizard", "liquidation-lizard-jr"
    parent_id           text references bots(id)        -- null for headliners, parent slug for variants
    name                text not null                   -- "Liquidation Lizard"
    avatar_emoji        text not null
    persona_voice_key   text not null                   -- references prompt template in lib/bots/personas/
    strategy_key        text not null                   -- references implementation in lib/bots/strategies/
    config              jsonb not null                  -- strategy parameters (thresholds, timeframes, markets)
    status              text not null default 'paper'   -- 'paper' | 'backtest-fail' | 'live' | 'retired'
    created_at          timestamptz not null default now()

+ table paper_positions
    id                  uuid primary key default gen_random_uuid()
    bot_id              text not null references bots(id)
    asset               text not null                   -- e.g. "BTC"
    side                text not null                   -- 'long' | 'short'
    leverage            integer not null
    entry_mark          numeric not null                -- Pacifica WS mark at open
    entry_ts            timestamptz not null default now()
    exit_mark           numeric                         -- null while open
    exit_ts             timestamptz
    paper_pnl_usd       numeric                         -- computed on close; null while open
    trigger_meta        jsonb                           -- strategy-specific debug info (what fired the entry)
    narration_open      text                            -- xAI-generated, cached
    narration_close     text                            -- xAI-generated on close
    status              text not null default 'open'    -- 'open' | 'closed' | 'expired'

  index paper_positions_bot_open_idx on (bot_id, status)
  index paper_positions_status_ts_idx on (status, entry_ts desc)

+ bets.meta shape (extension)
    For type: "copy" rows, when bot-driven:
    {
      botId: string,                  // NEW: replaces leaderAddress when present
      botPaperPositionId: uuid,       // links to the paper_positions row this copies
      leaderMarket, leaderSide, leverage,
      pacificaOrderId, pacificaPositionId,
      botEntryMarkAtTap: number,      // bot's entry mark at the moment of user tap
      userFillPriceAtTap: number,     // user's actual fill price
      closeOrderId?, closedAt?
    }

+ signals.type new value: "bot"
  signals.payload shape:
    {
      botId,
      currentPosition: { asset, side, leverage, entryMark, openSinceMs } | null,
      stats: { paperPnl24h, paperPnl7d, paperPnl30d, winRate, streak, totalTrades },
      narration: { open: string, current: string | null },
      heatScore
    }
```

The existing `pacifica_trader` signal type stays in the schema but is gated behind `FEATURE_COPY_TRADE`. The `bets` table doesn't change shape — `meta` is jsonb and extends naturally.

## Bot decision + paper-trade resolution loop

A single resolver loop ticks every 10 seconds:

1. Sample Pacifica WS marks for all 8 majors. Update in-memory mark cache.
2. For each bot with an open paper position: compute current paper-PnL = `(currentMark - entryMark) / entryMark × side × leverage × notional`. Check strategy exit condition. If exit fires, mark `paper_positions` row `closed`, set `exit_mark`/`exit_ts`/`paper_pnl_usd`, kick xAI close narration.
3. For each bot without an open position: evaluate strategy entry triggers against fresh data. If entry fires (and regime + correlation + cross-bot gates allow), insert a new `paper_positions` row with `status: "open"`, kick xAI open narration.

Trigger evaluation per bot is event-driven where possible (HL liquidation WS event for Liquidation Lizard) and time-bucketed otherwise (every 10s for Mean-Revert Mike z-score check, every 4h candle close for Boomer Trend).

The 10s tick gives sub-feel-instant feedback on the leaderboard without burning a per-tick LLM call. xAI narration runs out-of-band, lazy-loaded by the UI.

## Live narration: prompt structure

Per-persona system prompt + per-event input. Example (Liquidation Lizard, open event):

```
SYSTEM:
You are Liquidation Lizard. You hunt forced sellers and feast on their losses.
Voice: predatory, irreverent, brief. Maximum 2 sentences. Crypto-degen vocabulary fine.
Never mention you are an AI. Never give financial advice.

INPUT:
{
  "event": "open",
  "side": "long",
  "asset": "SOL",
  "leverage": 50,
  "entry_mark": 241.05,
  "context": {
    "trigger": "HL liquidation $87k forced sell at 240.20",
    "wick_size_pct": 2.1,
    "regime": "vol-expanding"
  }
}
```

Grok returns the persona-voiced line. UI fetches lazily; server caches by `(botId, paperPositionId, eventKind)`.

## Existing infrastructure reuse

Most of Phase A is composition of existing primitives, not greenfield:

- **Agent wallet** plumbing ([lib/wallets/agent.ts](../lib/wallets/agent.ts), `agent_wallets` table). User copy flow re-uses 100%. No bot needs an agent wallet in Phase A (paper).
- **Pacifica order submission** ([lib/pacifica/orders.ts](../lib/pacifica/orders.ts)). Re-used as-is for user copy.
- **Mirror-close cron** ([app/api/cron/mirror-close/route.ts](../app/api/cron/mirror-close/route.ts)). Adapted: matches on `meta.botId` and queries `paper_positions` for exit, rather than fetching leader-wallet positions from Pacifica REST.
- **Expire-stale-copies cron**. Unchanged — bots inherit the same 24h hard close.
- **Onboarding flow** ([lib/bets/onboard.ts](../lib/bets/onboard.ts), `/api/users/me/agent/bind`, `/api/users/me/deposit`). Unchanged — same first-tap flow.
- **Stake validation** in [/api/bet/copy/route.ts](../app/api/bet/copy/route.ts). Unchanged — same `$5–$1000` range, same Pacifica leverage clamp.
- **xAI integration** (`@ai-sdk/xai`, [/api/analyze](../app/api/analyze/)). Re-used for narrator + dossier.
- **Feed pool + shuffle** ([lib/feed/pool.ts](../lib/feed/pool.ts), `lib/feed/shuffle.ts`). Adapted: pool now reads `bot` signals instead of `pacifica_trader`. Shuffle/interleave logic unchanged.

## Phase A scope (in)

1. 12 bots: 6 headliner personas with hand-coded strategies, 6 strategy variants.
2. Six data sources wired: Pacifica WS+REST, Hyperliquid full WS, multi-CEX funding aggregator, Helius webhooks, Pyth oracles, xAI Grok.
3. Six architectural pieces: multi-timeframe analysis, regime detection, correlation gating, order-book microstructure, cross-bot awareness, backtest gate before paper-live.
4. Leaderboard primary surface at `/feed` with sort/window controls.
5. Live Feed secondary tab at `/feed/live` with TikTok-style card scroll.
6. Bot detail page at `/feed/bot/[id]` with position history + weekly dossier + persona bio + live narration.
7. Tap-to-copy flow: real Pacifica order via user agent wallet, auto-mirror close, 24h hard close, −50% circuit breaker.
8. xAI narrator for every open/close event, lazy-fetched + cached.
9. xAI weekly dossier per bot.
10. Migration: existing copy-trade rail moved behind `FEATURE_COPY_TRADE`, removed from default UI. Casino-mode rework parked behind `FEATURE_CASINO_MODE`. Legacy meme/prediction/whale rails stay behind `FEATURE_LEGACY_RAILS` (unchanged).

## Phase B (intentionally deferred)

1. **Promotion to live bankroll.** Bots with 30+ days paper history, >55% win rate, Sharpe > 1.0 are eligible for a real treasury bankroll and execute real Pacifica orders. Schema supports this from day 1 via `bots.status = 'live'`.
2. **Humans-vs-bots arena.** Top-100 Pacifica leaderboard wallets are invited to compete on the same leaderboard. The visible PnL race "Bots $X vs Humans $Y" becomes the home page hero metric. Mirror-close from leaders re-uses the same plumbing (bot vs leader unified under `meta.botId | meta.leaderAddress`).
3. **Persona share cards.** Big wins/losses auto-render to X/Telegram share cards with persona avatar + xAI quote.
4. **Streamer integration.** Earned stream slots for top-10 leaderboard humans. LiveKit-based broadcast with pre-commit + reveal on orders.
5. **Referral split.** Standard crypto growth lever, funded by Pacifica builder kickback.
6. **Seasonal structure.** Quarterly leaderboards with prize pools.
7. **Multi-position per bot** if Phase A feed feels sparse.
8. **Session Trader bot.** Deferred from initial roster; timezone-dependent and harder to evaluate.

## Non-goals (Phase A)

- Real on-chain bot execution (bots are paper-only in Phase A).
- Bot-to-bot collusion / coordination (each bot is independent; cross-bot awareness is one-way read).
- LLM-driven trade decisions (strategies are deterministic; LLM only narrates and classifies regime).
- User-configurable bots (bots are curated; user can copy, not modify).
- Multi-position per bot (one position per bot in Phase A).
- Custom strategies for the user side (user copies existing bots).
- Per-bet platform fee (kept consistent with current copy rail — no platform fee, Pacifica builder kickback is monetization).
- Pre-existing personas from other apps (each persona is gwak.gg IP, not licensed).
- Backtesting against external data sources (Pacifica + HL public history is the canonical backtest universe).

## Open questions / risks

1. **xAI rate limits + latency.** Grok pricing and rate limits at projected call volumes (~150 trades × 3 calls/trade × 30 days ≈ 13,500/month for narrator alone, plus regime classifier at ~60s cache × 8 assets ≈ 11,500/month) need verification. Worst case: fall back to a smaller model or coarser cache.
2. **Hyperliquid WS reliability.** Three of the six strategies depend on HL data. HL outage degrades the roster for the outage duration. Mitigation: each strategy declares fallback behavior (Liquidation Lizard falls back to Pacifica-only wick triggers; degraded but still functional).
3. **Pacifica builder-program economics.** Same risk as the wallet-rail spec. Verify with Pacifica team that bot-driven copies count toward builder-program kickback before relying on it as the monetization model.
4. **Bot disclosure framing.** Card UI must be unambiguous that bots are paper-trading and the user's real PnL may diverge from paper. The "the bot was up 5% but I lost money" backlash is the failure mode. Mitigation: every card surfaces paper-vs-real distinction; user's tap-to-copy flow shows estimated fill before confirmation.
5. **Cross-bot pileup blind spot.** If most strategies share a regime sensitivity (e.g. all gate against `trending`), they could all bench themselves simultaneously, leaving the feed empty. Mitigation: cross-bot awareness includes "≥X% of roster idle" as a signal that loosens regime gates by one tier.
6. **Backtest sample-size honesty.** A bot can pass a 30-day backtest by overfitting parameters to the same window the live paper-trading begins in. Mitigation: backtest gate uses days 1–25; days 26–30 are held out for forward-test; only bots that pass both run live in paper.
7. **Promotion criteria (Phase B) gameability.** Once bots compete for real bankroll allocation, parameter-tuning pressure may push variants toward overfitting. Mitigation: variants only inherit their parent's headroom (parent must be live before variant is eligible).

## Build sequencing

Realistic estimate for Phase A as specced: **10–14 weeks for one focused engineer.**

- Weeks 1–3: data ingestion (HL full WS, multi-CEX funding, Helius listener, Pyth subscription).
- Weeks 3–5: paper bookkeeping schema + resolver loop + base bot registry.
- Weeks 4–7: 6 headliner strategies + 6 variants + regime detection + multi-timeframe analysis.
- Weeks 6–9: xAI narrator + persona voices + dossier cron + leaderboard UI.
- Weeks 8–11: backtest gate + cross-bot awareness + correlation gate + microstructure + Live Feed UI + bot detail page.
- Weeks 10–14: copy mechanic wiring + circuit breakers + onboarding migration + QA.

Each week-band is intentionally overlapped; the engineer can move forward on later items while data layers are still settling.

## Migration of existing surfaces

- `FEATURE_COPY_TRADE` (new env flag) gates: `/api/bet/copy` (returns 410 when off, except for already-open positions which can still close), `/api/cron/refresh-traders` (skips run when off), the wallet leaderboard tab in feed (hidden), and the wallet-rail entries in [components/feed/FeedContainer.tsx](../components/feed/FeedContainer.tsx).
- `FEATURE_CASINO_MODE` (new env flag) gates the casino-mode code if any has shipped to the branch; otherwise unused.
- `FEATURE_LEGACY_RAILS` (existing) continues to gate meme/prediction/whale rails; unchanged.
- Default for new deployments: `FEATURE_COPY_TRADE=false`, `FEATURE_CASINO_MODE=false`, `FEATURE_LEGACY_RAILS=false`. Only paper-bot rail is visible.

Existing follower positions opened against wallet-leader bets stay open and close through the same mirror-close cron — the cron now handles both leader-keyed and bot-keyed bets in the same pass.
