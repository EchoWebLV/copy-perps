# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

Fast Bet (now branded **gwak.gg**) is a TikTok-style vertical-scroll feed that aggregates three rails of degen attention onto a single screen with one-tap stakes ($5 / $10 / $20 / $50):

- **Meme** — buy a hot Solana SPL token via Jupiter Swap.
- **Prediction** — YES/NO on a Jupiter Prediction market (Polymarket + Kalshi liquidity).
- **Whale** — Tail/Fade a leveraged perp position spotted on Hyperliquid, executed on Solana.

All execution is on Solana mainnet. Auth + signing is a Privy embedded Solana wallet.

The full design doc lives at [docs/superpowers/specs/2026-05-04-fast-bet-design.md](docs/superpowers/specs/2026-05-04-fast-bet-design.md). Treat it as historical context — see "Spec vs. code divergence" below for what actually shipped.

## Commands

```bash
npm run dev              # Next.js dev server (localhost:3000)
npm run build            # Production build
npm run start            # Run built app
npm run lint             # next lint
npm run typecheck        # tsc --noEmit (TS 5.7, strict)

# Database (Neon Postgres via Vercel Marketplace)
npm run db:push          # drizzle-kit push — apply schema to DB
npm run db:studio        # drizzle-kit studio — visual table browser
npm run db:seed          # populate signals table from lib/mock-data.ts

# Local cron simulators (use real APIs, write to DB via .env.local)
npm run refresh:memes
npm run refresh:predictions
npm run refresh:whales
```

There is no test runner configured. Verification means `npm run typecheck && npm run lint` plus exercising the flow in the browser.

The `scripts/_test-*.mjs` files are ad-hoc one-off probes against mainnet (open a perp, close a perp, check a wallet, etc.); read each one before running — they hit real RPCs and may sign txs.

## Environment

Copy `.env.example` → `.env.local`. Required for any non-mock work:

- `DATABASE_URL` — Neon Postgres connection string.
- `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` — Privy app.
- `NEXT_PUBLIC_HELIUS_RPC_URL` — Helius mainnet RPC (used by both client and server).
- `CRON_SECRET` — `/api/cron/*` rejects requests without `Authorization: Bearer ${CRON_SECRET}` (Vercel sets this header automatically).
- `FEATURE_GASLESS_BETS` — `"true"` flips every bet/close/withdraw onto the gasless server-fee-payer path. Required env vars below are mandatory when this is on.
- `GAS_WALLET_PRIVATE_KEY` — base58 secret for the Gas Wallet that pays SOL fees on user txs.
- `TREASURY_PUBKEY` — Treasury Wallet pubkey; receives USDC platform fees (0.5% + $0.05 per bet).

`drizzle.config.ts` reads `.env.local` directly (via `dotenv`), so `db:push` and `db:studio` work outside Next.

## Architecture

### Tech stack (what's actually wired in)

- **Next.js 16 App Router** + React 19, Tailwind v4, TypeScript strict.
- **Privy** (`@privy-io/react-auth`, `@privy-io/server-auth`) for auth and the embedded Solana wallet.
- **Drizzle ORM** + `@neondatabase/serverless` (HTTP, not Pool — fits serverless).
- **Vercel Cron** declared in [vercel.json](vercel.json) refreshes signals every 1–2 minutes.
- **Solana**: `@solana/web3.js` v1 + `@solana/kit` (used only by Privy provider for RPC subscriptions).
- **Jupiter** REST APIs for swaps (`lite-api.jup.ag`) and predictions (`api.jup.ag/prediction/v1`).
- **Flash Trade** (`flash-sdk`) for perp execution (Crypto.1 pool, SOL/BTC/ETH).

### Repo layout

```
app/
  page.tsx                 # Landing (countdown timer; login gated by SHOW_LOGIN flag)
  layout.tsx               # PrivyClientProvider wrap, manifest/metadata
  feed/page.tsx            # Server component, hydrates with top 50 signals
  deposit/page.tsx         # First-time funding (USDC address + QR)
  portfolio/page.tsx       # Open + closed positions
  api/
    feed/route.ts          # GET signals ordered by heatScore desc
    portfolio/route.ts     # GET positions w/ live PnL quotes
    users/me/route.ts      # POST upsert Privy↔Solana mapping
    withdraw/route.ts      # POST sign-ready USDC transfer (with consolidate phase)
    bet/{meme,prediction,perp}/
      route.ts             # POST open
      confirm/route.ts     # POST mark open tx confirmed (or failed)
      close/route.ts       # POST build close tx
      close/confirm/route.ts  # POST mark close tx confirmed
    cron/refresh-{memes,predictions,whales}/route.ts
components/
  feed/                    # FeedContainer + per-rail card + StakeButtons
  portfolio/               # PositionRow, CloseButton, WithdrawButton
  shell/                   # BalancePill (top), BottomNav
  auth/                    # AuthGate (login wall), UserEnsure (syncs DB row)
  providers/PrivyClientProvider.tsx
lib/
  db/{schema,index,queries}.ts
  privy/{server,use-solana-wallet}.ts
  auth/cron.ts             # checkCronAuth(request)
  users/ensure.ts          # upsert by privyId, sync solanaPubkey
  signals/                 # heat-* scoring + refresh-* pipelines + sparkline
  jupiter/{swap,constants}.ts
  jupiter-prediction/client.ts
  flash-trade/{client,perp}.ts
  hyperliquid/{client,whales}.ts        # CURATED_WHALES is the watchlist
  dexscreener/client.ts
  solana/{balance,use-usdc-balance}.ts
  usd/consolidate.ts       # jupUSD→USDC bridge for the bet flow
  bets/post-with-consolidation.ts  # client helper that wraps the consolidate dance
  types.ts                 # Signal, MemeSignal, PredictionSignal, WhaleSignal, ...
  mock-data.ts             # used by db:seed only
scripts/                   # local cron runners + ad-hoc test mjs
docs/superpowers/          # plans + specs
```

### Database (Drizzle)

Schema in [lib/db/schema.ts](lib/db/schema.ts). Five tables: `users`, `signals`, `bets`, `whale_wallets`, `feed_views`.

The `signals` table is a **write-through cache, not a log**. Each `refresh-*` cron does `DELETE WHERE type = X` then bulk-inserts the new top N — anything not currently hot is gone. The frontend reads via `getFeedSignals(limit)` ordered by `heatScore` desc.

`bets.meta` is a free-form JSONB used per rail to remember what you'd need to close the position (token mint + delivered atomic out for memes; positionPubkey + contracts for predictions; flashAsset + direction + leverage for perps).

### Signal pipeline

```
Vercel Cron (every 1–2 min)
   │
   ├── /api/cron/refresh-memes        ──► refreshMemes()       lib/signals/refresh-memes.ts
   │     DexScreener boosts → top pairs → memeHeatScore        lib/signals/heat-meme.ts
   │
   ├── /api/cron/refresh-predictions  ──► refreshPredictions() lib/signals/refresh-predictions.ts
   │     Jupiter Prediction events → predictionHeatScore       lib/signals/heat-prediction.ts
   │     Multi-outcome events emit a `multiprediction` signal type
   │
   └── /api/cron/refresh-whales       ──► refreshWhales()      lib/signals/refresh-whales.ts
         Hyperliquid REST poll of CURATED_WHALES → whaleHeatScore (lib/signals/heat-whale.ts)
```

Each cron route guards on `checkCronAuth` (Bearer CRON_SECRET) and runs in `runtime: nodejs` with `maxDuration: 60`. To exercise locally without curl-ing the endpoint, use `npm run refresh:*` — they call the same `refresh*()` function directly with `tsx --env-file=.env.local`.

### Bet lifecycle (the part that confused us repeatedly)

A bet is a multi-phase dance. The client orchestrates; the server only ever **builds** unsigned transactions. Privy's wallet signs; Helius RPC submits.

1. **POST `/api/bet/{rail}`** — server validates, runs balance preflight (see "USDC consolidation" below), builds the open tx (Jupiter swap / Jupiter Prediction order / Flash `swapAndOpen`). When `FEATURE_GASLESS_BETS=true`, the tx is built with **Gas Wallet as fee payer** and a **Treasury USDC fee-transfer ix appended** (0.5% + $0.05); server partial-signs as the fee payer before returning. Inserts a `bets` row with `status: 'pending'`, returns `{ phase: 'open', betId, swapTransaction }`, `{ phase: 'consolidate', consolidationTransaction }`, or — for prediction in gasless mode — `{ phase: 'open', betId, prefundTransaction, swapTransaction }`.

2. **Client signs** via `signTransaction` from `@privy-io/react-auth/solana` and **submits raw via Helius** (`Connection.sendRawTransaction`). Privy's built-in submit can't resolve Address Lookup Tables, which Jupiter swaps and Flash perps both use, so we sign-only and broadcast ourselves. This logic is centralized in [lib/bets/post-with-consolidation.ts](lib/bets/post-with-consolidation.ts) — which also handles the prediction-rail prefund tx by signing+submitting it before the swap.

3. **POST `/api/bet/{rail}/confirm`** — client posts back the tx signature; server flips `status: 'pending' → 'confirmed'` (or `'failed'`).

Close mirrors this: `close` builds, client signs+submits, `close/confirm` writes `proceedsUsdc` and `closeTxHash`. Closes carry no platform fee; the server still pays the SOL tx fee via Gas Wallet.

A pending bet that never reaches `confirm` (user cancels the wallet modal, network drops mid-sign) gets reaped to `status: 'abandoned'` after 5 minutes by `/api/portfolio` — see [app/api/portfolio/route.ts](app/api/portfolio/route.ts).

### Gasless via server fee payer

When `FEATURE_GASLESS_BETS=true`, users only ever hold USDC. SOL fees on every user tx are paid by a server-controlled **Gas Wallet** ([lib/wallets/gas.ts](lib/wallets/gas.ts), `GAS_WALLET_PRIVATE_KEY`) which is set as fee payer on every bet, close, withdraw, and consolidation tx. The user signs to authorize their own USDC moving; their SOL balance is irrelevant.

A 0.5% + $0.05 platform fee per open is appended as a `TransferChecked` USDC instruction inside the same tx, routed to a **Treasury Wallet** ([lib/wallets/treasury.ts](lib/wallets/treasury.ts), `TREASURY_PUBKEY`). Closes and withdraws are free.

Per-rail integration:

- **Meme rail / consolidate** — Jupiter `/swap-instructions` API returns raw ixs; we compose with Gas Wallet as fee payer and append the fee ix. See [lib/jupiter/swap.ts](lib/jupiter/swap.ts) `buildSwapInstructions` + `buildSwapTx`.
- **Whale rail (Flash perp)** — Flash builds the tx; we pass `gaslessFeePayer` and `appendInstructions` to inject the Gas Wallet pubkey + fee ix. See [lib/flash-trade/perp.ts](lib/flash-trade/perp.ts).
- **Prediction rail (Jupiter Prediction)** — their tx is baked with the user as fee payer and can't be modified. We use **atomic prefund**: a separate Gas Wallet → user SOL drip (~0.005 SOL when needed) + USDC fee transfer in one tx, landed before the prediction tx. The prediction tx pays itself out of that drip; position rent (~0.003 SOL) refunds back to the user on close, so most subsequent prediction bets skip the drip entirely.

Operations: [scripts/refuel-gas-wallet.mjs](scripts/refuel-gas-wallet.mjs) (run via `npm run refuel:gas` with `TREASURY_PRIVATE_KEY` set at invocation) swaps Treasury USDC → SOL via Jupiter and transfers to Gas Wallet when its balance drops below ~1 SOL.

Spec: [docs/superpowers/specs/2026-05-05-gasless-trades-design.md](docs/superpowers/specs/2026-05-05-gasless-trades-design.md). Plan: [docs/superpowers/plans/2026-05-05-gasless-trades.md](docs/superpowers/plans/2026-05-05-gasless-trades.md).

### USDC ↔ jupUSD consolidation

Jupiter Prediction settles winnings in **jupUSD**, not USDC. The user's "$X ready" balance pill sums USDC + jupUSD because both peg 1:1, but every bet/withdraw path needs unified USDC. [lib/usd/consolidate.ts](lib/usd/consolidate.ts) implements:

- **`ensureUsdcOrConsolidate({ userPubkey, requiredUsd })`** — legacy path. If USDC ≥ required, returns `{ ready: true }`. If USDC + jupUSD covers it but USDC alone doesn't, returns a Jupiter `jupUSD → USDC` swap tx for the shortfall (with a 2% over-swap buffer for stable-to-stable slippage). User pays SOL fees.
- **`ensureUsdcOrConsolidateGasless({ userPubkey, requiredUsd })`** — gasless variant used when `FEATURE_GASLESS_BETS=true`. Same threshold logic, but the consolidation tx is built with Gas Wallet as fee payer and partial-signed by Gas Wallet.
- **`requireSolForBet(pubkey)`** (legacy only) — throws `InsufficientSolForFeesError` if user's SOL < `MIN_SOL_FOR_BET = 0.01`. Skipped entirely on the gasless path since the user no longer pays SOL.

When a bet/withdraw route returns `phase: 'consolidate'`, [postBetWithConsolidation](lib/bets/post-with-consolidation.ts) signs the swap, waits for chain confirmation + 1.5s RPC propagation buffer, then re-calls the same endpoint. Capped at 2 attempts to avoid infinite loops.

### Whale rail: signal source ≠ execution venue

Whale **signals** come from Hyperliquid (curated wallet list in [lib/hyperliquid/whales.ts](lib/hyperliquid/whales.ts), polled via REST). Whale **execution** is Solana-native via **Flash Trade** (`flash-sdk`, Crypto.1 pool: SOL/BTC/ETH only). The user sees "Executes on Drift Perps" in some places and "Flash" in others — copy is inconsistent and being cleaned up.

Important Flash quirk: Crypto.1 perp markets are **self-collateralized** (SOL/Long expects SOL collateral, etc.). Calling `openPosition` with USDC collateral against a SOL/Long market hits Anchor 0xbc4 (AccountNotInitialized). [lib/flash-trade/perp.ts](lib/flash-trade/perp.ts) uses `swapAndOpen`/`closeAndSwap` so Flash swaps USDC↔target inline within the tx.

### Spec vs. code divergence

The design spec ([docs/superpowers/specs/2026-05-04-fast-bet-design.md](docs/superpowers/specs/2026-05-04-fast-bet-design.md)) names **Drift Protocol** for perp execution. The shipped code uses **Flash Trade**. `lib/drift/*` exists but is **unimported and dead** — leave it alone unless the user explicitly asks to revive Drift. All perp routes (`/api/bet/perp/**` and `app/api/portfolio/route.ts`) import from `lib/flash-trade/`.

The spec also lists several future-state pieces (SSE feed stream, `/history` page, Hyperliquid WS) that are not in the codebase.

### Auth flow

- Client: `usePrivy().getAccessToken()` returns a JWT; client passes it as `Authorization: Bearer <token>`.
- Server: `verifyPrivyRequest(request)` in [lib/privy/server.ts](lib/privy/server.ts) calls `privyServer.verifyAuthToken` and returns `{ userId, appId, sessionId }` or `null`.
- After login, `<UserEnsure />` ([components/auth/UserEnsure.tsx](components/auth/UserEnsure.tsx)) POSTs to `/api/users/me` to upsert the `users` row and sync `solanaPubkey`. The whole authed UI is wrapped in `<AuthGate>` which shows a login wall if `!authenticated`.

### Landing page caveat

[app/page.tsx](app/page.tsx) is currently a 2-day countdown to launch with `SHOW_LOGIN = false`. Flip that constant to re-enable the Login / Enter buttons. The countdown auto-hides once the launch time passes.
