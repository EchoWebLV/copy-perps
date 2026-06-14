# gwak.gg

**TikTok for perps.** A vertical-scroll feed that turns leveraged trading into one-tap degen entertainment — plus a live, on-chain arena where frontier LLMs trade real perps against each other and you can copy them.

All execution is on **Solana mainnet**. Auth + signing is a [Privy](https://privy.io) embedded Solana wallet — no seed phrase, no extension.

> Repo package name is `breach`; the shipped product is branded **gwak.gg**.

---

## What's in it

gwak.gg aggregates a few rails of "degen attention" onto a single scrollable feed, plus an autonomous bot arena:

| Rail / Feature | What it is | Venue |
|---|---|---|
| **Live tape** | The center of the app — a real-time feed of trades, signals, and bot activity | — |
| **Whale tail** | Tail/Fade a leveraged perp spotted on Hyperliquid | Flash Trade / Pacifica (Solana) |
| **Meme** | One-tap buy of a hot Solana SPL token | Jupiter Swap |
| **Prediction** | YES/NO on a prediction market | Jupiter Prediction (Polymarket + Kalshi liquidity) |
| **🤖 LLM Arena** | Frontier models trading SOL/BTC/ETH perps live, on-chain, copyable | MagicBlock Ephemeral Rollup |

### The LLM Arena

A standout feature sitting alongside the feed — and the part that runs on-chain. Four AI models run as autonomous trading bots inside a [MagicBlock](https://magicblock.gg) Ephemeral Rollup on Solana:

- **Opus 4.8** — Claude, cautious
- **Grok 4.3** — bold, fast
- **GPT-5** — disciplined, risk-sized
- **Aggressive Opus** — Claude, high-leverage degen foil

Each bot is an **"oracle bot"**: an off-chain brain (Vercel AI SDK `generateObject` + Zod) decides direction/stop/confidence from a live market brief, and an **operator-signed `apply_decision`** instruction lands the trade on-chain. An immutable on-chain program enforces a **safety floor** — leverage and stake clamps, a confidence floor, per-decision cooldown, a daily trade cap, a daily-loss kill switch, and a mandatory stop — so the model only ever chooses *timing and direction*, never the risk envelope. PnL is scored on-chain and the bots are tailable by users.

Tuning every bot's floor is a single editable file — [`scripts/arena/bot-tuning.ts`](scripts/arena/bot-tuning.ts) — applied instantly on-chain with `npm run arena:tune` (no redeploy).

Arena program: [`6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC`](https://solscan.io/account/6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC) (Anchor 1.0, zero-copy accounts, delegated to MagicBlock).

---

## Tech stack

- **Next.js 16** App Router + React 19, Tailwind v4, TypeScript strict — standalone build
- **Privy** (`@privy-io/react-auth`, `@privy-io/server-auth`) — auth + embedded Solana wallet, gas sponsorship, session signers for copy execution
- **Drizzle ORM** + `@neondatabase/serverless` (Neon Postgres over HTTP — serverless-friendly)
- **Solana**: `@solana/web3.js` v1 + `@solana/kit`, Helius RPC
- **Perps**: Flash Trade (`flash-sdk`) + Pacifica
- **Jupiter** REST for swaps and predictions
- **MagicBlock** Ephemeral Rollups + an Anchor program ([`arena-program/`](arena-program/)) for the LLM arena
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
npm run arena:crank          # crank worker — folds fresh oracle prices into market state
npm run arena:tune           # push bot-tuning.ts to MAINNET bots (instant, on-chain)
npm run arena:tune:devnet    # push tuning to the devnet demo instead
```

The off-chain LLM operator loop lives at [`scripts/arena/llm-operator-worker.ts`](scripts/arena/llm-operator-worker.ts) — it reads each bot's on-chain state, builds a market brief, asks the model, runs the TS pre-check, and submits an operator-signed `apply_decision` to the ER each tick.

> Verification = `npm run typecheck && npm run test` plus exercising the flow in the browser. There is no e2e runner.

---

## Architecture

```
app/                     Next.js App Router
  feed/                  the vertical-scroll feed (server-hydrated)
  arena/                 LLM bot arena UI (bot cards, profiles, live PnL)
  portfolio/             open + closed positions
  api/
    feed/                GET signals ordered by heat
    bet/{meme,prediction,perp}/   open → confirm → close → close/confirm
    copy/                copy-trade subscriptions + execution
    cron/refresh-*       Vercel cron signal refreshers
components/
  feed/ arena/ portfolio/ shell/ auth/ providers/
lib/
  arena/                 ER client, crank, decode, personas
    llm/                 registry, brief, client, schema, floor, loop, submit
  db/                    Drizzle schema + queries (Neon)
  privy/ flash-trade/ jupiter/ hyperliquid/ solana/
arena-program/           Anchor program for the on-chain arena
scripts/arena/           operator worker, crank, tuning, init/delegate
```

### Signal pipeline

Vercel Cron hits `/api/cron/refresh-*` every 1–2 min. Each refresher does a write-through cache update of the `signals` table (`DELETE WHERE type = X` → bulk-insert the new top N). The frontend reads the hottest signals ordered by score.

### Bet lifecycle

The client orchestrates; **the server only ever builds unsigned transactions**. Privy's wallet signs and the tx is broadcast via Helius. The shape is always `open → confirm → close → close/confirm`. The whale/Pacifica deposit path uses Privy's native Solana sponsorship (`useSignAndSendTransaction` with `sponsor: true`).

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

Required for non-mock work (names only — never commit values):

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

> **Security:** the Privy authorization key signs real-money trades — keep it in the platform env only, scope its session-signer policy to the trading program, and rotate it if it's ever exposed.
