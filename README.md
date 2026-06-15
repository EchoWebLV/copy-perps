# gwak.gg

**TikTok for perps.** A live, PnL-ranked feed of the sharpest traders on Solana (elite whale wallets and frontier AI agents) that you scroll, vote on, and copy with one tap. When they open, you open; when they close, you close, automatically. You can also trade perps directly.

All execution is on **Solana mainnet**. Auth + signing is a [Privy](https://privy.io) embedded Solana wallet, no seed phrase, no extension.

> Repo package name is `breach`; the shipped product is branded **gwak.gg**.

---

## What's in it

gwak.gg is one scrollable feed of traders you can copy, plus the venues that execute the trades. The surfaces map to the app's bottom nav:

| Surface | What it is | Venue |
|---|---|---|
| **Traders** (home feed) | Live, PnL-ranked feed of whale wallets + AI agents. Filter humans/bots, vote bullish/bearish, one-tap copy | (read-only feed) |
| **Copy trading** (Copies) | Auto-copy any whale or AI agent. Mirrors their opens and closes to your size, and auto-closes when they do | Flash Trade (Solana) |
| **🤖 AI bot arena** | 3 frontier models (Opus 4.8, Grok 4.3, GPT-5) trading SOL/BTC/ETH perps live, fully on-chain, copyable | MagicBlock Ephemeral Rollup |
| **Trade** | Open your own leveraged perp directly | Pacifica (Solana) |
| **Whale tail** | One-tap copy a whale's current position | Pacifica (Solana) |
| **Live** | Real-time stream of positions opening and closing | (read-only feed) |

### The AI bot arena

The standout feature, and the part that runs on-chain. Three frontier models run as autonomous trading bots inside a [MagicBlock](https://magicblock.gg) Ephemeral Rollup on Solana:

- **Opus 4.8** (Anthropic)
- **Grok 4.3** (xAI)
- **GPT-5** (OpenAI)

It's a controlled experiment: every bot gets the **identical prompt, identical risk limits, and identical market data**, so the **model is the only variable**.

Each bot is an **"oracle bot"**: an off-chain brain (Vercel AI SDK `generateObject` + Zod) decides direction/stop/confidence from a live market brief (price, indicators, OI/funding/long-short, plus a free Fear & Greed + community-vote sentiment signal). An **operator-signed `apply_decision`** instruction lands the trade on-chain, where an immutable program enforces a **safety floor**: leverage and stake clamps, a confidence floor, a per-decision cooldown, a daily trade cap, a daily-loss kill switch, and a mandatory stop. The model only ever chooses *timing and direction*, never the risk envelope. PnL is scored on-chain, and users can copy any bot with one tap (the copy executes as a real perp on Flash Trade).

Tuning every bot's floor is a single editable file, [`scripts/arena/bot-tuning.ts`](scripts/arena/bot-tuning.ts), applied instantly on-chain with `npm run arena:tune` (no redeploy).

Arena program: [`6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC`](https://solscan.io/account/6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC) (Anchor 1.0, zero-copy accounts, delegated to MagicBlock).

---

## Tech stack

- **Next.js 16** App Router + React 19, Tailwind v4, TypeScript strict, standalone build
- **Privy** (`@privy-io/react-auth`, `@privy-io/server-auth`), auth + embedded Solana wallet, gas sponsorship, session signers for copy execution
- **Drizzle ORM** + `@neondatabase/serverless` (Neon Postgres over HTTP, serverless-friendly)
- **Solana**: `@solana/web3.js` v1 + `@solana/kit`, Helius RPC
- **Perps**: Flash Trade (`flash-sdk`, the copy/autopilot execution venue) + Pacifica (direct trade + whale tail)
- **Jupiter** REST for USDC ↔ jupUSD consolidation in the deposit/withdraw path
- **Market data**: candle + funding/OI/long-short feeds, plus a free Fear & Greed + community-vote sentiment signal (`lib/data/*`)
- **MagicBlock** Ephemeral Rollups + an Anchor program ([`arena-program/`](arena-program/)) for the AI bot arena
- **AI**: Vercel AI SDK with `@ai-sdk/anthropic`, `@ai-sdk/xai`, `@ai-sdk/openai`
- **Vitest** for unit tests; **Railway** for deploy

---

## Quick start

```bash
# 1. install
npm install            # Node 22+

# 2. env
cp .env.example .env.local   # then fill in the required vars (see below)

# 3. db
npm run db:push        # apply Drizzle schema to Neon

# 4. run
npm run dev            # Next.js dev server on localhost:3000
```

### Commands

```bash
npm run dev            # dev server
npm run build          # production (standalone) build
npm run start          # run the built standalone server
npm run typecheck      # tsc --noEmit (strict)
npm run test           # vitest run

# Database (Neon Postgres via Drizzle)
npm run db:push        # apply schema
npm run db:studio      # visual table browser
npm run seed:bots      # seed bot rows

# Arena (MagicBlock ER)
npm run arena:crank          # crank worker, folds fresh oracle prices into market state
npm run arena:tune           # push bot-tuning.ts to MAINNET bots (instant, on-chain)
npm run arena:tune:devnet    # push tuning to the devnet demo instead
```

The off-chain LLM operator loop lives at [`scripts/arena/llm-operator-worker.ts`](scripts/arena/llm-operator-worker.ts), it reads each bot's on-chain state, builds a market brief, asks the model, runs the TS pre-check, and submits an operator-signed `apply_decision` to the ER each tick.

> Verification = `npm run typecheck && npm run test` plus exercising the flow in the browser. There is no e2e runner.

---

## Architecture

```
app/(app)/               Next.js App Router (the authed app)
  feed/                  Traders, the live PnL-ranked feed (whales + AI bots)
  portfolio/             Copies, positions you're copying
  arena/  arena/llm/     AI bot arena UI + the live "brain" view (per-bot reasoning)
  trade/                 direct perp trading
  chatter/  leaderboard/ live positions feed + leaderboard
  api/
    whales/  cron/refresh-whales   whale roster + its 1-min refresh
    copy/subscriptions/  auto-copy subscriptions (the in-process copy engine)
    bet/{copy,whale}/    one-tap copy a bot/whale; tail a whale (Pacifica)
    flash/perp/  trade/perp/        Flash + Pacifica perp open/close/confirm
    arena/  arena/llm/   ER reads + the brain API
    autopilot/  markets/  portfolio/  notifications/ ...
components/  feed/ arena/ portfolio/ shell/ trade/ ...
lib/
  arena/ (+ llm/)        ER client, crank, decode, personas; LLM registry/brief/floor/loop/submit
  copy/                  the copy engine + lease-guarded in-process ticker (executes on Flash)
  flash/  pacifica/      the two perp venues
  data/                  candles, market-sentiment, news-sentiment (Fear & Greed)
  db/  privy/  whales/  jupiter/  usd/  solana/  ...
arena-program/           Anchor program for the on-chain arena
scripts/arena/           operator worker, crank, tuning, init/delegate
```

### Data + signal flow

A Vercel cron hits `/api/cron/refresh-whales` to refresh the whale roster into an evictable `signals` cache (`DELETE` + bulk-insert the current top N); the Traders feed reads that roster. The **AI bots are read live from the MagicBlock ER** (`useArenaLive`, WebSocket `onAccountChange` with a poll fallback). The market brief the bots trade on (candles, OI/funding/long-short, Fear & Greed sentiment) is built in `lib/data/*` and is byte-identical for every bot.

### Copy + trade execution

The automated **copy engine** runs as an in-process ticker (`lib/copy/ticker.ts`, lease-guarded, gated by `COPY_DRY_RUN`): it watches each subscriber's targets (arena bots via the ER, whale wallets, Flash wallets), and mirrors their opens/closes as real perps on **Flash Trade**, auto-closing when the source does. Direct trading and one-tap whale tails execute on **Pacifica**. For manual flows the client orchestrates and the server only builds unsigned transactions; Privy's embedded wallet signs (copies use Privy session signers).

---

## Deployment

Deployed on **Railway** as two services off this branch:

| Service | Role | Build / start |
|---|---|---|
| `perps-arena` | The web app (gwak.gg) | full Next.js standalone build |
| `arena-llm-operator` | The LLM operator worker | `tsx` only, no Next build |

The launcher scripts ([`scripts/railway-build.sh`](scripts/railway-build.sh), [`scripts/railway-start.sh`](scripts/railway-start.sh)) branch on `RAILWAY_SERVICE_NAME` so one repo drives both services. The worker exposes a trivial health server on `$PORT` for Railway's healthcheck.

---

## Environment

Required for non-mock work (names only, never commit values):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Privy app |
| `NEXT_PUBLIC_HELIUS_RPC_URL` | Helius mainnet RPC (client + server) |
| `CRON_SECRET` | Bearer guard on `/api/cron/*` |
| `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY` | Privy session-signer key for real copy execution |
| `COPY_DRY_RUN`, `FEATURE_COPY_TRADE` | Copy-trade gates (`false` / `true` = live) |

Arena worker (`arena-llm-operator` service):

| Var | Purpose |
|---|---|
| `ARENA_OPERATOR_KEYPAIR` | Operator secret key (inline JSON array) |
| `ARENA_PROGRAM_ID`, `ARENA_FEED`, `ARENA_MARKET_ID` | On-chain arena coordinates |
| `ARENA_ER_ENDPOINT` | MagicBlock ER endpoint (mainnet/devnet) |
| `ARENA_LLM_BOTS` | Comma list of active bot personas (on/off without code change) |
| `ARENA_LLM_TICK_MS` | Decision cadence (ms) |
| `ARENA_LLM_OPERATOR_CLAUDE` / `_GROK` / `_GPT` / `_VADER` | Per-bot operator keys |
| `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY` | Model providers |

> **Security:** the Privy authorization key signs real-money trades, keep it in the platform env only, scope its session-signer policy to the trading program, and rotate it if it's ever exposed.
