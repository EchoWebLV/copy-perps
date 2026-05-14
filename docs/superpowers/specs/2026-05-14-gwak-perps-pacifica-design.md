# gwak.gg Perps Pivot — Pacifica Venue

**Date:** 2026-05-14
**Status:** Draft (awaiting review)
**Supersedes:** [2026-05-14-gwak-perps-copy-design.md](2026-05-14-gwak-perps-copy-design.md) (the original spec targeted Phoenix Eternal; pivot below explains why we switched)

## Problem

The original Phoenix Eternal target turned out to be unbuildable in Phase 1:

- **No public user base.** Three minutes of live WS capture across 11 markets produced 14 unique `taker` pubkeys, and **0 of them had an on-chain Phoenix trader account** (`/trader/{authority}/state` returns `traders: []` for every one). Phoenix's WS tape exposes internal **spline liquidity providers and market makers**, not user wallets.
- **No discovery surface.** Phoenix has no leaderboard, no top-traders endpoint, no recent-fills with user pubkeys.
- **Leverage capped at 25x** (SILVER/GOLD only); majors top out at 10-20x. Below the "fast pace 50x+" target.

**Pacifica** is the correct venue:

- **Top Solana perp DEX by volume** (overtook Jupiter Perps in late 2025; ~$1.49B daily across 20 markets).
- **5x-50x leverage** — meets the original target.
- **Public leaderboard API** at `GET /api/v1/leaderboard` that returns wallets with full PnL/equity/volume metrics across 1d/7d/30d/all-time horizons. We just hit it; sample wallets have $400-500k equity, $1M+ daily volume, real positions.
- **EdDSA signed-message API** (Ed25519 over canonical JSON) — much simpler than tx composition, fits our Privy wallet model directly.
- **Agent wallet delegation** lets us register a server-side signer per user, so subsequent taps and server-driven mirror-closes need no user interaction.
- **Active points program** (running through Feb 2026) driving sustained user engagement.

## What carries over from the original spec (unchanged)

These product decisions hold regardless of venue:

- **TikTok-style vertical-scroll feed**, one-tap stakes ($5 / $10 / $20 / $50).
- **Two rails**: wallet rail (real Pacifica traders, top of leaderboard) + AI rail (7 LLM-driven strategies, ~50 persona cards via strategy × market projection — Phase 2).
- **Snapshot-copy with mirror-close**: tap = open a position matching the leader's current market/side/leverage at user's stake size. Close fires automatically when the leader closes; manual anytime; 24h hard fallback.
- **No platform fee on trades.** Pacifica builder-program kickback is the monetization (Pacifica's equivalent of Phoenix's referral kickback).
- **Pure-USDC user experience.** User funds with USDC, sees USDC balance, every bet is USDC-margined.
- **Legacy meme/prediction/perp rails** behind `FEATURE_LEGACY_RAILS` flag, hidden by default, deleted in Phase 3.
- **No per-user risk caps** beyond USDC balance.
- **Phase order:** Phase 1 = wallet rail end-to-end; Phase 2 = AI rail; Phase 3 = on-chain indexer + legacy deletion; Phase 4 = viral layer (X auto-posting, share cards, leaderboards, ref split).

## What changes (Pacifica specifics)

### Execution venue

- **Pacifica Perpetuals** (`https://app.pacifica.fi`), Solana mainnet.
- REST: `https://api.pacifica.fi/api/v1` — markets, orders, positions, leaderboard, agent binding.
- WebSocket: `wss://ws.pacifica.fi/ws` — real-time trades, orderbook, account state.
- On-chain program: `PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH`. Used only for deposits/withdrawals; order placement is fully off-chain.
- Central state account: `9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY`. Vault: `72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa`. USDC mint: standard Circle USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- 20 perp markets at launch (full list pulled from `GET /api/v1/markets` at implementation time; representative: SOL, BTC, ETH, XRP, BNB, HYPE, JUP, PUMP, FARTCOIN, DOGE, SUI, TON, AAVE, NEAR, TAO, AVAX, LINK, SUI, ARB, OP).
- Leverage 5x-50x depending on market.

### Order placement = signed JSON, not a Solana tx

Pacifica's order API takes a signed JSON payload, not a Solana transaction. No fee payer, no blockhash, no ALTs. Sub-200ms execution.

**Signing recipe** (per the official Pacifica Python SDK):

```text
header  = { "type": <op>, "timestamp": <ms>, "expiry_window": 5000 }
payload = { ...op-specific fields }
canonical_obj = { ...header, "data": payload }   // header at top level, payload nested under "data"
sorted = recursively sort all keys alphabetically
message = JSON.stringify(sorted, compact_separators(",",":"))
signature = ed25519.sign(utf8(message), keypair)
signature_str = base58(signature)

POST body = {
  "account": <main pubkey>,
  "agent_wallet": <agent pubkey>,   // present iff signed by an agent
  "signature": signature_str,
  "timestamp": <ms>,
  "expiry_window": 5000,
  ...payload
}
```

Operation `type` values we'll use in Phase 1: `bind_agent_wallet`, `create_market_order`, `cancel_order`, `withdraw` (and Pacifica's other op types as needed for portfolio reads, which are unsigned GETs).

### Agent wallet delegation (the key UX unlock)

Every user gets an **agent wallet** — a per-user Ed25519 keypair we generate and custody server-side, registered to the user's main Privy wallet via `POST /api/v1/agent/bind`. Once registered:

- **All orders** (open, close, reduce_only) are signed by the **agent wallet**, server-side, with no user signature prompt.
- **Withdraw and bind-agent** are still signed by the **main wallet** (the user's Privy wallet via `signMessage`), preserving the security boundary that arbitrary funds movement requires user authorization.
- **Compromise scope**: a leaked agent wallet can trade with the user's deposited USDC inside Pacifica but cannot withdraw, send to a different address, or rotate the agent. We document this in user-facing copy.

Storage: agent wallets persist in a new `agent_wallets` table keyed on `user_id`. Private key encrypted at rest using a server-side master key in `AGENT_WALLET_ENCRYPTION_KEY` (similar pattern to `GAS_WALLET_PRIVATE_KEY` today).

### Onboarding (first-time-user flow)

Before a user can tap-to-copy, three things must be true. We bundle them into one server-coordinated flow on first tap:

1. **Agent wallet generated and bound.** Server generates an Ed25519 keypair. User signs `{type: "bind_agent_wallet", data: {agent_wallet: <pubkey>}}` via Privy `signMessage`. We POST to `/api/v1/agent/bind`.
2. **USDC deposited into Pacifica.** User signs a Solana tx invoking the Pacifica program's `deposit` instruction. Gas Wallet remains the fee payer (preserves the zero-SOL-from-user UX). Discriminator: `sha256("global:deposit")[:8]`, args: `{ amount: u64 }` (6 decimals for USDC).
3. **Default leverage configured.** Optional `POST /api/v1/leverage` per asset; can default to leader's leverage on each tap, so this step is skippable.

Subsequent taps need none of the above; they're pure off-chain agent-signed order POSTs.

### Wallet rail discovery (no more seed list, no more indexer)

The Phoenix plan needed a hand-curated `whales.ts` seed list and an eventual on-chain indexer to discover wallets. Pacifica makes this trivial:

```text
GET /api/v1/leaderboard
→ { success: true, data: [
    { address, username, pnl_1d, pnl_7d, pnl_30d, pnl_all_time,
      equity_current, oi_current,
      volume_1d, volume_7d, volume_30d, volume_all_time }, ...
  ]}
```

A single `refresh-traders` cron call yields the entire leaderboard. We score, sort, filter, and write to `signals` every 2 minutes. No `phoenix_traders` table, no Helius program subscription, no seed file to maintain.

Composite heat score (replaces `phoenix-trader-heat`):

```text
heat = 600 * (has_open_position_now ? 1 : 0)         // open position is the biggest factor
     + 200 * clamp(volume_1d / 1_000_000, 0, 1)      // recency-weighted activity
     + 100 * clamp(equity_current / 100_000, 0, 1)   // skin in the game
     + 100 * clamp(pnl_7d / 50_000, -1, 1)           // recent edge (signed; bad traders sink)
```

We populate the wallet rail with the top N from the leaderboard that satisfy basic filters: `has_open_position_now`, `volume_1d > $5k`, and `pnl_all_time > -X` (configurable floor to exclude blow-ups).

To detect "has open position now" cheaply during cron, we fan out `GET /api/v1/positions?account=<addr>` for the top 100 by leaderboard rank. Pacifica seems to allow these in parallel without auth.

### Tap → close flow (revised)

1. **Tap.** User taps `$10` on a card. Client POST `/api/bet/copy` with `{ leaderAddress, market, side, leverage, stakeUsdc }`.

2. **First-time onboarding (skipped after first tap).** If user has no `agent_wallets` row, server:
   - Generates an Ed25519 keypair.
   - Returns `{ phase: "onboard", bindMessage, depositTx }` to client.
   - Client signs `bindMessage` via Privy `signMessage`, POSTs to `/api/users/me/agent/bind` (server submits to Pacifica's `/agent/bind`).
   - Client signs `depositTx` (a versioned Solana tx with Gas Wallet as fee payer, calling Pacifica's `deposit` ix to move user's USDC into the Pacifica vault) via Privy `signTransaction`, submits via Helius.
   - Client re-POSTs `/api/bet/copy` once both succeed.

3. **Live re-verify leader.** Server re-fetches `GET /api/v1/positions?account=<leaderAddress>`, confirms the leader still has the matching position. If gone, return 409.

4. **Submit order.** Server signs `create_market_order` with the user's agent wallet:
   ```text
   payload = { symbol, amount, side, slippage_percent: "1.0", reduce_only: false, client_order_id: <uuid> }
   ```
   POST to Pacifica `/orders/create_market`. Response includes the order ID and a fill summary.

5. **Persist.** Insert a `bets` row with `type: "copy"`, `status: "confirmed"` (Pacifica fills are immediate on success), `meta` carrying `{ leaderAddress, leaderMarket, leaderSide, leverage, pacificaOrderId, pacificaPositionId, leaderEntryPriceAtTap }`. Return `{ phase: "open", betId, fill }` to client. Card UI flips to "Opened ✓" with the fill price.

   The `pending → confirmed` two-phase pattern is no longer needed because there is no separate client-sign-and-broadcast step.

**Close** (manual or mirror-fired):

1. Server signs `create_market_order` with the same agent wallet but `reduce_only: true` and reversed `side`.
2. POST to `/orders/create_market`.
3. Update `bets` row: `status: "closed"`, `closeTxHash` becomes the Pacifica order id (no on-chain hash; we store the API order id with a prefix to mark it).

### Mirror-close (worker)

The Phoenix plan deferred auto-mirror-close to Phase 2 because Phoenix's close required a user-side signature. **Pacifica removes that limitation.** With the agent wallet, the server can close on behalf of the user the moment the leader exits.

Worker (`lib/bets/mirror-close.ts`), runs every minute via cron:

1. `SELECT` open copy bets joined on `agent_wallets` and `users`.
2. Group by `leaderAddress`.
3. For each leader: `GET /api/v1/positions?account=<leader>`. If a leader's position has closed/disappeared, find the matching follower bets and submit `reduce_only` close orders with each follower's agent wallet.
4. Update the bets to `closed`.
5. Log every fan-out; cap concurrency at ~10 in-flight closes per worker tick.

24h expire fallback unchanged from the Phoenix plan, except the cron now also closes the position on Pacifica (not just tag-it-and-rely-on-user) because the server has agent-wallet authority.

### Withdrawals

Same as the Phoenix plan in spirit: user signs a `{type: "withdraw", data: {amount}}` message with their **main Privy wallet** (not the agent). Server submits to Pacifica's `/withdraw` endpoint; Pacifica processes the on-chain transfer back to the user's USDC ATA. Gas Wallet covers any SOL fees if Pacifica's flow requires one (otherwise unused for withdraws).

### Schema changes

```text
+ table agent_wallets
    user_id          uuid primary key references users(id)
    main_pubkey      text not null                -- Privy main wallet pubkey
    agent_pubkey     text not null unique         -- Pacifica-bound agent wallet
    agent_secret_enc text not null                -- base58 of encrypted Ed25519 seed
    bound_at         timestamptz not null default now()

+ signals.type new value: "pacifica_trader"
  signals.payload shape (for the new type):
    {
      address: string,
      username: string | null,
      position: {
        market, side: "long"|"short", leverage, notionalUsd,
        entryPrice, unrealizedPnlPct, pacificaPositionId
      } | null,
      stats: {
        equityUsdc, openInterestUsdc,
        pnl1dUsdc, pnl7dUsdc, pnl30dUsdc, pnlAllTimeUsdc,
        volume1dUsdc, volume7dUsdc
      },
      heatScore
    }

+ bets.type new value: "copy"
  bets.meta shape:
    {
      leaderAddress, leaderMarket, leaderSide, leverage,
      pacificaOrderId, pacificaPositionId,
      leaderEntryPriceAtTap, leaderUnrealizedPnlPctAtTap,
      leaderClosedAt?, closeOrderId?
    }
  bets.feeUsdc: unset on new copy bets (column retained for legacy rows).
```

The Phoenix plan's `phoenix_traders` table is **not** added (Pacifica's leaderboard API replaces it). `ai_bot_notes` table comes in Phase 2 (AI rail) and is unchanged.

### Gas Wallet usage (reduced)

- Pays SOL fees on:
  - The one-time `deposit` tx during onboarding.
  - Withdraw txs (if Pacifica's withdraw flow requires one).
- **Not used** for order placement (orders are off-chain).
- Net SOL burn drops dramatically vs the Phoenix plan, since each open + close was an on-chain tx in that design.

### Code changes (delta from the Phoenix plan)

Removed from the Phoenix plan (no longer needed):
- `lib/phoenix/types.ts`, `lib/phoenix/client.ts`, `lib/phoenix/markets.ts`, `lib/phoenix/whales.ts`, `lib/phoenix/orders.ts`.
- `phoenix_traders` table and indexer scope.
- Two-phase `pending → confirmed` bet flow (replaced with synchronous response).
- Address Lookup Table resolution code.

Added for Pacifica:
- `lib/pacifica/types.ts` — REST/WS response shapes.
- `lib/pacifica/client.ts` — REST + WS client, including signed-message helper.
- `lib/pacifica/sign.ts` — canonical JSON + Ed25519 signing (uses `tweetnacl` or `@noble/ed25519`).
- `lib/pacifica/markets.ts` — markets cache.
- `lib/pacifica/orders.ts` — `submitMarketOrder` and `submitReduceOnlyClose` helpers (agent-wallet signed).
- `lib/pacifica/leaderboard.ts` — `fetchLeaderboard()` + filter helpers.
- `lib/pacifica/deposit.ts` — `buildDepositTx({ userPubkey, amountUsdc })` returning a partially-signed v0 tx.
- `lib/wallets/agent.ts` — agent-wallet generation, persistence, encrypted-at-rest secret loading.
- `lib/bets/onboard.ts` — coordinates bind + deposit when first detected user.

Renamed/adapted:
- `PhoenixTraderSignal` → `PacificaTraderSignal` (different `payload` shape).
- `refresh-traders` cron now calls Pacifica's leaderboard API.
- `mirror-close` cron now submits agent-signed `reduce_only` orders rather than just tagging.

### Carryover from already-committed work

Three commits have already landed on `perps-ai-wallets`:

- `e70bedc` — `feat(features): add FEATURE_LEGACY_RAILS env flag`. Venue-neutral, **keep**.
- `14a2d15` + `e1d3e84` — `PhoenixTraderSignal` type + downstream fanout. **Adapt**: rename the type to `PacificaTraderSignal` and update the payload shape. The `RAIL_MIN`, `FAMILIES`, and `seed.ts` fanouts stay (just retarget the new type's discriminator).
- `47a4423` + `6c71703` — `lib/phoenix/types.ts` and its doc clarification. **Delete**: these interfaces don't match Pacifica.

## Open risks

1. **Closed beta deposit cap.** Pacifica's docs note a $100k account-equity ceiling during closed beta. Plenty for our $5-50 stakes, but worth monitoring.
2. **Builder-program economics unknown.** We're assuming Pacifica's builder program kicks back a meaningful share of fees per referred user trade. Verify with Pacifica team before relying on this as the sole monetization.
3. **Agent wallet key custody.** Server-held Ed25519 keys are a new attack surface. Mitigations: encrypted at rest with master key in env (rotated via secret manager); per-user keys (compromise scope = one user); withdraw still requires main-wallet sig.
4. **Pacifica API rate limits.** Unclear if `GET /positions` allows unauthenticated parallel scans at the cadence we need (top-100 every 60s = 100 requests/min). Add backoff and consider WS subscription as fallback.
5. **WS reconnect / missed-close.** If the mirror-close worker stalls or drops the WS, leaders' exits go unnoticed. Phase 1 mitigation: cron polls every minute regardless of WS state; cron is the source of truth.
6. **Leverage clamp by tier.** Pacifica's per-asset leverage caps apply tier-wise (size affects max leverage). The leader may be at 50x but our smaller stake might fit a tier that allows higher leverage, or the leader's leverage might not be achievable at our position size. Plan: clamp to the leader's leverage AND the per-tier maximum for our notional, surfaced as a warning.
7. **Mirror lag.** 60-second poll cadence means a leader exit is detected and copied with up to a minute of delay. Most copies will lose some PnL to this. Phase 2/3 upgrade: WS-driven detection.

## Out of scope (Phase 1)

- AI rail (7 LLM strategies) → Phase 2.
- WS-driven mirror-close → Phase 2.
- Multi-position per leader (we surface only the top-priority open position per leader in Phase 1).
- Withdraw flow UI polish → Phase 2.
- X auto-posting, share cards, leaderboards, ref split → Phase 4.
- KYC / geofencing changes beyond the existing `fra1` region pin.
