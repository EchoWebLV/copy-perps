# Casino Mode Design

**Status**: foundation locked, ready for plan.
**Branch**: `casino-mode`.
**Supersedes** (operationally, not deleted): the copy-trade-snapshot model documented in [2026-05-14-gwak-perps-pacifica-design.md](2026-05-14-gwak-perps-pacifica-design.md) and [2026-05-14-gwak-perps-copy-design.md](2026-05-14-gwak-perps-copy-design.md). Copy-trade code stays in the repo behind `FEATURE_COPY_TRADE` for now; it's no longer the Phase 1 surface.

## Goal

Build a $1-stakes binary-direction casino on a TikTok-style swipe feed. Every card is one asset. Every minute is a fresh resolve. Every winner faces a press-your-luck moment that can compound to 100x+.

## Why this, not copy-trade

The copy-trade-snapshot model serves neither newbies (no narrative, dashboard fatigue) nor real traders (snapshot copying anonymous wallets is dumb). A binary direction casino with synthetic execution gives newbies one-tap dopamine, supports $1 stakes (real perps cannot), and the synthetic foundation enables future streamer-copy without a refactor.

## Core mechanic

### Synchronized 60-second candle

Each card surfaces one asset. The candle is the current wall-clock minute (00:00 to 00:59). All bets placed during a candle resolve at the next minute boundary based on mark price delta:

- `mark(close) > mark(open)` → long wins
- `mark(close) < mark(open)` → short wins
- `mark(close) == mark(open)` → push, stake returned

Mark price is the Pacifica WS canonical mark (`quoteAmount / baseAmount`) sampled at minute open (+0s) and minute close (+59.5s).

### Stake ladder

**$1 / $5 / $10 / $25.** Lowered from the previous $5/$10/$20/$50 ladder. The $1 floor is the unlock that makes "TikTok casino" actually plausible: every swipe affords a tap.

### Base payout

Win = stake × **1.9** (5% house edge per leg). Loss = stake forfeited to house. Push = stake returned.

### Press-your-luck multiplier

After every winning bet, viewer sees a prompt: **Cash 1.9x or push for another 60s at the same direction.** If they push and win again, multiplier compounds. Cash out anytime. Lose any leg, lose everything.

| Legs won | Multiplier | Approx probability |
|----------|-----------|---------------------|
| 1 | 1.9x | ~48% |
| 2 | 3.6x | ~23% |
| 3 | 6.9x | ~11% |
| 4 | 13x | ~5.3% |
| 5 | 25x | ~2.5% |
| 6 | 47x | ~1.2% |
| 7 | **89x** | ~0.6% |
| 8 | **169x** | ~0.3% |
| 9 | 322x | ~0.13% |
| 10 (cap) | 613x | ~0.06% |

Probabilities assume roughly 48% true win probability per leg (50/50 minus small directional edge after slippage and fees). House EV remains positive at every leg because 1.9x < 2.0x.

Cap at 10 legs to bound house exposure. A $25 stake riding 10 legs = $15,325 payout, which informs treasury sizing below.

## Execution model: synthetic hedged house book

**No on-chain action per bet.** Bets are DB rows. Stakes deducted from user's internal USDC balance, winnings credited to the same.

**House book.** Treasury USDC pool covers payouts. Net exposure tracked per asset per minute.

**Hedge.** Aggregate net stake (longs minus shorts) hedged via real Pacifica perp positions opened from a treasury-controlled agent wallet:

- **Hedge threshold**: hedge whenever `|net stake| > $250` per asset.
- **Rebalance frequency**: at every candle close, before the next minute opens.
- **Slippage**: funded out of the 5% per-leg house edge.

This keeps house directional risk near zero while letting users feel like they're trading. Per-trade chain costs disappear because we hedge in aggregate, not per bet.

### Settlement

USDC stays in user's internal balance (`users.internal_balance_usdc`). Withdraw to wallet on demand:

- Single SPL transfer per withdraw.
- Gasless via Gas Wallet (fee payer) per existing pattern in [lib/wallets/gas.ts](../lib/wallets/gas.ts).
- 0.5% withdraw fee to Treasury, baked in.

Deposit flow unchanged from existing Pacifica deposit (USDC → user wallet → internal balance crediting).

## Asset pool

**Phase 1: 8 majors.** BTC, ETH, SOL, HYPE, BNB, XRP, DOGE, AVAX.

Criteria: high Pacifica liquidity, predictable spreads, easy to hedge in size. Memecoin assets (FARTCOIN, PUMP, etc.) deferred to Phase 1.1 once treasury sizing is validated.

## Feed surface

The TikTok swipe feed renders 8 cards in rotation (top of feed reseeds every minute). Each card is one asset. User scrolls between assets; the candle clock is the same wall-clock minute across all cards.

### Card layout

```
┌────────────────────────────┐
│   SOL                      │
│   $241.23  +0.4% (1m)      │
│   sparkline of last 1m     │
│                            │
│   🟢 23 long  🔴 14 short  │
│   00:43 left in candle     │
│                            │
│ ┌────┬────┬────┬────┐      │
│ │$1  │$5  │$10 │$25 │ LONG │
│ └────┴────┴────┴────┘      │
│ ┌────┬────┬────┬────┐      │
│ │$1  │$5  │$10 │$25 │SHORT │
│ └────┴────┴────┴────┘      │
└────────────────────────────┘
```

### Press-your-luck overlay

When user has an active multi-leg streak, the card transforms:

```
┌────────────────────────────┐
│  5-STREAK ACTIVE           │
│  25x multiplier locked     │
│  SOL up, 00:43 left        │
│                            │
│  [ CASH $25 ]  [ PUSH 6x ] │
└────────────────────────────┘
```

The user is locked to the same asset and direction during the streak. They can swipe away to other cards but the streak only resolves on the original card's next candle.

## Social layer

- **Live counter per card**: "37 longs vs 12 shorts, 14s left". WS-driven, updates per bet placement.
- **Live winner tape** at top of feed: "@yordan just won $42 on SOL". Repurposes the existing [LiveTape](../components/feed/LiveTape.tsx) infra.
- **Press-your-luck broadcast**: "@yordan riding a 5-streak on BTC, watch the next minute." Top-of-feed event card surfaces during live streaks of 5+.

## Treasury sizing

**Initial bankroll target: $25,000 USDC.**

Math: max realistic single-jackpot payout at launch is $25 stake × 169x (8-leg cap, before we raise cap) = $4,225. Worst-case 10-leg cap payout = $15,325. Treasury must comfortably cover any single payout plus a buffer for clustered hits.

**Refuel**: house edge accrues into treasury balance. Refuel script monitors threshold; alerts to owner phone if balance drops below $5,000.

**Bankroll growth**: per [Kelly criterion](https://en.wikipedia.org/wiki/Kelly_criterion), with 5% edge and ~$10 average stake, expected daily revenue from 10k bets/day is ~$5,000. Bankroll doubles in roughly 5 days at that volume.

## Regulatory posture

Synthetic house book reads as **gambling, not trading**, in most jurisdictions. Phase 1 posture:

- **Geo-block**: IP-layer blocks for US states with strict gambling laws (NY, NJ, CA, NV exclusion based on legal review pending), UK, France, Germany. Use Vercel's geo headers; redirect to a "not available in your region" page.
- **Allow geos**: most of LATAM, SEA, Eastern Europe, Caribbean (typical crypto casino jurisdiction set).
- **ToS**: clear "house book / casino" framing. No investment language. Mandatory checkbox on first bet.
- **KYC**: none at launch (under daily threshold of $1,000 net deposit per user). Add tiered KYC at Phase 1.1 for high-stakes users.
- **Stake caps per user**: $1,000/day net deposit at launch; bump after validation.

This is the standard crypto-casino posture (Stake.com, Rollbit, Polymarket-adjacent). Not legal advice; user should engage counsel before going live.

## Migration from copy-trade code

### Keep (still useful)

- Pacifica REST/WS client ([lib/pacifica/](../lib/pacifica/)) for the hedge engine.
- Agent wallet infra ([lib/wallets/agent.ts](../lib/wallets/agent.ts)) for treasury hedger keypair.
- Privy auth + Solana wallet (unchanged).
- USDC deposit flow (unchanged).
- Withdraw flow (extended for internal balance).
- Feed scroll shell, BalancePill, bottom nav.
- LiveTape WS infra (repurposed for live winner tape).

### Dormant behind `FEATURE_COPY_TRADE` flag

- Trader leaderboard cron + refresh logic ([lib/signals/refresh-traders.ts](../lib/signals/refresh-traders.ts)).
- CopyCard, multi-position rendering ([components/feed/CopyCard.tsx](../components/feed/CopyCard.tsx)).
- Win-streak math against external traders.
- Sort/filter tabs ([components/feed/FeedFilterTabs.tsx](../components/feed/FeedFilterTabs.tsx)).
- Mirror-close polling.

Keep these importable so we can revive the copy-trade rail as a Phase 2 sidebar if desired.

### New code

- `BetCard` component (new card type, replaces CopyCard as primary feed card).
- `PressYourLuckOverlay` component.
- `/api/casino/bet` (place direction bet).
- `/api/casino/press` (cash or push decision).
- `/api/casino/resolve` cron (runs every minute on the minute, settles closed candle, broadcasts resolutions).
- `/api/casino/state` (returns active candle state per asset).
- Treasury hedge engine ([lib/casino/hedge.ts](../lib/casino/hedge.ts)).
- Internal balance ledger (new schema columns + migration).
- WS broadcast for live counters and resolutions.

## Phase 1 scope (in)

1. Synchronized 60s candle resolve loop.
2. Direction bet on 8 majors, $1/$5/$10/$25 ladder.
3. 1.9x fixed payout per leg.
4. Press-your-luck multiplier, 10-leg cap.
5. Internal USDC balance + withdraw-to-wallet.
6. Treasury hedge engine (Pacifica back-end).
7. Live counter per card via WS.
8. Live winner tape.
9. Geo-block + ToS gating.
10. Migration to feature-flag the existing copy-trade rail off.

## Phase 2 (intentionally deferred)

1. **Streamer-copy**. LiveKit-based broadcast, auto-tail with budget cap, react-to-copy buttons, streamer affiliate cut. The synthetic execution we chose was specifically chosen to enable this without refactor.
2. **Upfront multi-leg parlay**. Pick 2 to 10 legs across different assets/candles upfront. Multiplier = 1.9^N.
3. **Long-shot dynamic-odds binaries**. Touch/no-touch on stretched strikes. Dynamic odds engine required.
4. **AI persona rail**. LLM-driven strategy traders broadcasting their casino plays.
5. **Tiered KYC** for users over $1k daily threshold.
6. **Squad bets, leaderboards, XP** progression.

## Non-goals (Phase 1)

- Real on-chain perp execution per user bet.
- Per-bet rent costs or per-bet Pacifica fees.
- Copy-trade leader detection or tracking.
- 24/7 multi-asset depth beyond 8 majors.
- Streaming surface.
- Custom resolution oracle (Pacifica mark is canonical).
- Tournament/season structure.
- Real money stakes beyond internal balance (cannot bet what you don't have, no negative balances).
- Cross-bet correlation tracking (e.g., "you have 5 simultaneous longs on correlated assets"). House is hedged anyway.

## Open questions (need answers before plan)

1. **Stake ladder confirmation**: $1/$5/$10/$25, or something different? (default: this)
2. **Treasury bankroll**: $25k starting, or different size? (default: $25k)
3. **Hedge threshold per asset**: $250, or different? (default: $250)
4. **Geo-block list**: any geos to add/remove from US states + UK + FR + DE? (default: this)
5. **Daily user deposit cap**: $1,000/day pre-KYC, or different? (default: $1,000)
6. **Press-your-luck cap**: 10 legs, or different? (default: 10)
7. **Asset list**: top 8 majors as listed, or pick different 8? (default: BTC, ETH, SOL, HYPE, BNB, XRP, DOGE, AVAX)

If the defaults look fine, just say "defaults" and I'll move to writing the implementation plan.
