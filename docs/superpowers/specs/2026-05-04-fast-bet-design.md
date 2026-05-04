---
project: fast-bet
status: approved
date: 2026-05-04
---

# Fast Bet — design

## Vision

Fast Bet is a TikTok-style vertical-scroll feed that aggregates the three places degens already spend their attention: hot meme coins, hot prediction markets, and hot whale leverage positions. Each card is a single bet opportunity with a one-tap stake ($5 / $10 / $20). Phase 1 ships in the browser as a PWA — installable, mobile-first, no native app.

The product wedge: **the unified short-attention betting surface**. Today, traders context-switch between Photon, Polymarket, and Hyperliquid. Fast Bet collapses that into one feed.

## The three rails

| Rail | Data source | Execution venue | Status in MVP |
|---|---|---|---|
| **Memes** | Birdeye trending + Jupiter token list + smart-money wallet watch | Jupiter Swap | REAL |
| **Prediction markets** | Jupiter Prediction API (= Polymarket + Kalshi liquidity) | Jupiter Prediction | REAL |
| **Whale positions** | Hyperliquid public REST (5s poll, MVP) → WebSocket later | Jupiter Perps | REAL |

All three execute on Solana. **Zero bridges in MVP.** The whale rail decouples signal source (Hyperliquid, where famous traders trade) from execution venue (Jupiter Perps, Solana-native) — disclosed in a small "executes on Jupiter Perps" line under the action button.

## Wallet & funding

- **Auth + wallet**: Privy embedded Solana wallet (social/email login)
- **Funding model**: pre-funded USDC on the Privy Solana wallet — single deposit, single chain, single balance pill ("$83.40 ready") at the top of the feed
- **Deposit ramp**: USDC address + QR + optional MoonPay fiat ramp (Privy config flag)

## Card anatomy

Every card is full-screen vertical, snap-scrolled, with the same skeleton:

1. Type badge (top-left): `MEME`, `POLYMARKET`, `WHALE OPENED`
2. Balance pill (top-center): live USDC balance
3. Headline content (varies per type)
4. Up to 3 signal chips with colored dots (green/amber/purple) explaining *why this is hot*
5. Stake actions at bottom:
   - **Memes**: $5 / $10 / $20 (always buy)
   - **Prediction**: $X YES / $X NO + size selector
   - **Whale**: Tail $X / Fade $X + size selector

Visual reference: `.superpowers/brainstorm/4933-1777890092/content/tiktok-feed.html`

## Signal pipeline

Each rail computes a **heat score 0-100** every 30-60 seconds. Feed is ranked by score with two rules:
- Max 2 consecutive cards of the same type
- Dedupe (same asset + type) within 24h

### Heat score inputs

**Memes**
- Volume velocity (Δ vs 24h avg)
- Price velocity (1h, 5min)
- Smart-money buys in last 15 min ($ + count)
- New-holder velocity
- Quality gate: ≥$50k liquidity, age ≥30min, basic honeypot heuristic

**Prediction markets**
- Volume velocity (1h vs 24h)
- |Δ YES probability| over 1h
- Time-to-resolve (closer = hotter, weighted)
- Category boost (politics / crypto / sports)
- Quality gate: ≥$10k 24h volume, resolves within 90d

**Whales**
- Position size (≥$250k to consider)
- Wallet 30d PnL (≥$500k to be "famous")
- Recency (open in last 5 min = hottest, decays over 30 min)
- Conviction multiplier (multiple watched wallets same direction)
- Quality gate: asset must be tradeable on Jupiter Perps

## Tech stack

| Layer | Pick | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Vercel-native, server components, PWA |
| Hosting | Vercel | Edge functions for low-latency feed reads |
| Styling | Tailwind v4 + shadcn/ui | Mockup CSS maps 1:1 |
| Animations | Framer Motion | Swipe-to-snap, card transitions |
| Auth + wallet | Privy (`@privy-io/react-auth` w/ Solana) | Embedded wallet, social login |
| DB | Neon Postgres (Vercel Marketplace) | User/bet/signal records |
| Cache | Upstash Redis (Vercel Marketplace) | Hot signal cache, rate limits |
| Background work | Vercel Cron + Functions | Signal recompute, market polling |
| Realtime | Server-Sent Events (Edge runtime) | Push new cards without WS infra |
| Solana RPC | Helius | Fast, reliable, account WS |
| Execution SDK | `@jup-ag/api` | Memes + Perps + Prediction, one library |
| Whale signals | Hyperliquid REST (poll) | Public, free |
| Observability | Vercel logs + Sentry | Live demo safety |

## Repo layout

```
fast-bet/
├── app/
│   ├── layout.tsx                # Privy + global shell
│   ├── page.tsx                  # Landing → /feed if authed
│   ├── feed/page.tsx             # Server component, hydrates with first 10 cards
│   ├── deposit/page.tsx          # First-time funding
│   ├── history/page.tsx          # Bet history
│   └── api/
│       ├── feed/route.ts         # GET cursor-paginated feed (Edge)
│       ├── feed/stream/route.ts  # SSE for new cards
│       ├── bet/{meme,prediction,perp}/route.ts
│       ├── balance/route.ts
│       └── cron/refresh-{memes,predictions,whales}/route.ts
├── components/
│   ├── feed/{FeedContainer,MemeCard,PredictionCard,WhaleCard,SignalChip,StakeButtons}.tsx
│   ├── shell/{BalancePill,BottomNav}.tsx
│   └── ui/                       # shadcn primitives
├── lib/
│   ├── jupiter/                  # swap, perps, prediction wrappers
│   ├── hyperliquid/              # rest poller, decoders
│   ├── birdeye/                  # trending fetcher
│   ├── signals/                  # heat-score functions, ranker
│   ├── privy/                    # server-side helpers
│   └── db/                       # Drizzle schema + queries
├── drizzle/                      # SQL migrations
└── public/manifest.json          # PWA manifest
```

## Database schema (essential)

```sql
users          (id pk, privy_id unique, solana_pubkey, created_at)
signals        (id pk, type, asset_id, heat_score, payload jsonb, expires_at, created_at)
bets           (id pk, user_id fk, signal_id fk, type, amount_usdc, tx_hash, status, created_at)
whale_wallets  (address pk, pnl_30d, label, last_updated)
feed_views     (id pk, user_id, signal_id, action [skip|stake], viewed_at)
```

## Background architecture

```
Vercel Cron (30s/60s/5s)
        │
   ┌────┼─────────────────┐
   ▼    ▼                 ▼
Birdeye Jupiter Pred  Hyperliquid REST
   │    │                 │
   └────┴── compute heat ─┘
              │
           Postgres `signals`
              │
           Redis hot cache
              │
       /api/feed (Edge) → SSE → browser
```

**Hyperliquid WebSocket note**: long-lived WS doesn't fit Vercel Functions. MVP uses 5s REST polling via Vercel Cron. Post-MVP, swap to a dedicated worker (Railway/Fly) without touching the rest of the system.

## MVP scope cuts

**Out of scope for MVP**:
- Mobile native app (browser-only PWA, installable)
- Push notifications service
- KYC / withdrawal flows beyond wallet export
- Per-user feed personalization (everyone sees the same feed)
- Social signal scoring (Twitter/Telegram mention APIs are paid + complex)
- ML ranking (pure formula-based heat scores)
- Bridge to Polygon for native Polymarket (using Jupiter's integration instead)

## Phased timeline (14 days, one developer)

### Phase 0 — Foundation (days 1-3)
1. Next.js 16 scaffold, Tailwind, shadcn, Vercel, Neon, Upstash, Privy app, Drizzle
2. Privy provider, login, gated `/feed`, BalancePill + BottomNav scaffold
3. Feed UI fully built from mockup with mock data — looks like the prototype

### Phase 1 — Memes rail real (days 4-7)
4. Drizzle migrations applied; `/api/feed` reads DB; seed signals
5. Birdeye + Jupiter token list; `refresh-memes` cron; heat score v1
6. `/api/bet/meme` → Jupiter swap; Privy signing; real $1 swap test
7. `/deposit` page; MoonPay toggle; BalancePill subscribed to Helius account WS

### Phase 2 — Prediction + Whale rails (days 8-11)
8. Jupiter Prediction API integration; `refresh-predictions` cron; live data
9. `/api/bet/prediction` → Jupiter Prediction SDK; YES/NO real txs
10. Hyperliquid REST polling; curated whale list seeded; `refresh-whales` cron
11. `/api/bet/perp` → Jupiter Perps open; Tail/Fade real txs

### Phase 3 — Polish & demo (days 12-14)
12. SSE feed stream; composite ranker; Framer Motion polish
13. Empty states, bet failure UX, `/history` page, mobile QA
14. Pre-fund demo wallet, Colosseum demo video, production deploy

## Critical risks

1. **Jupiter Prediction API maturity** (shipped Feb 2026) — fallback: read-only Polymarket data + stub the bet for that rail. De-risk on day 8 morning.
2. **Hyperliquid REST rate limits** — fallback: Railway worker with WS. Adds ~0.5 day.
3. **Privy server-side signing flow** — needs a 30-min spike on day 1.
4. **Mainnet test budget** — ~$100 USDC for real-bet testing across rails.

## "MVP done" definition

A 60-second video showing: log in via X → deposit $50 → scroll feed → place 3 real bets across all 3 rails → see them in history. All txs are real, on Solana mainnet, signed by Privy embedded wallet.
