# gwak.gg Perps Pivot — Phase 1 (Pacifica) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the perps-only copy-trading pivot against **Pacifica** (top Solana perp DEX). Users scroll a feed of real Pacifica traders' open positions and tap $5/$10/$20/$50 to copy any of them. First-tap onboards them (agent wallet bind + USDC deposit). Subsequent taps are sub-second, sign-free, off-chain order placements. Server-driven mirror-close auto-exits when the leader exits.

**Architecture:** Pacifica orders are signed JSON messages (Ed25519 over canonical-JSON), not Solana txs. Each user gets a server-custodied **agent wallet** registered to their Privy main wallet, which signs all order ops on their behalf. Main wallet only signs onboarding (`bind_agent_wallet` + `deposit` Solana tx) and withdraws. Gas Wallet pays SOL fees on the deposit/withdraw txs.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, `@solana/web3.js` v1, `@noble/ed25519` for canonical-JSON Ed25519 signing, Privy embedded wallets (signMessage + signTransaction), Pacifica REST `https://api.pacifica.fi/api/v1` + WS `wss://ws.pacifica.fi/ws`, Helius RPC.

**Spec:** [docs/superpowers/specs/2026-05-14-gwak-perps-pacifica-design.md](../specs/2026-05-14-gwak-perps-pacifica-design.md)

**Supersedes:** [docs/superpowers/plans/2026-05-14-gwak-perps-phase-1.md](2026-05-14-gwak-perps-phase-1.md) (the Phoenix plan; abandoned after live probes showed no Phoenix user base).

**Scope:** Phase 1 only (wallet rail end-to-end). Phase 2 (AI rail) and Phase 3 (legacy deletion) are separate plans.

**Verification model:** No test runner by design (per CLAUDE.md). Each task verifies via `npm run typecheck` + targeted command or browser observation.

**Already-committed prior work** (carries forward — do NOT redo):
- `e70bedc` — `FEATURE_LEGACY_RAILS` env flag + `lib/features.ts`.
- `14a2d15` + `e1d3e84` — `PhoenixTraderSignal` type and fanout. **Task 1 below renames this to `PacificaTraderSignal` and adapts the payload.**
- `47a4423` + `6c71703` — `lib/phoenix/types.ts`. **Task 2 deletes this file.**

---

## File map

**New files:**

Pacifica integration:
- `lib/pacifica/types.ts`
- `lib/pacifica/sign.ts`
- `lib/pacifica/client.ts`
- `lib/pacifica/markets.ts`
- `lib/pacifica/leaderboard.ts`
- `lib/pacifica/deposit.ts`
- `lib/pacifica/orders.ts`

Wallet plumbing:
- `lib/wallets/agent.ts`
- `lib/db/schema.ts` (modify, add `agent_wallets` table)

Bet flow:
- `lib/bets/onboard.ts`
- `lib/bets/copy.ts`
- `lib/bets/mirror-close.ts`

Signal pipeline:
- `lib/signals/heat-pacifica-trader.ts`
- `lib/signals/refresh-traders.ts`

API routes:
- `app/api/users/me/agent/bind/route.ts`
- `app/api/users/me/deposit/route.ts`
- `app/api/bet/copy/route.ts`
- `app/api/bet/copy/close/route.ts`
- `app/api/cron/refresh-traders/route.ts`
- `app/api/cron/mirror-close/route.ts`
- `app/api/cron/expire-stale-copies/route.ts`

Local script:
- `scripts/refresh-traders.ts`

UI:
- `components/feed/CopyCard.tsx`
- `components/portfolio/CopyRow.tsx`

**Modified files:**
- `lib/types.ts` — `PhoenixTraderSignal` → `PacificaTraderSignal` (Task 1).
- `lib/feed/card-color.ts` — rename FAMILIES key.
- `components/feed/StakeButtons.tsx` — rename RAIL_MIN key.
- `scripts/seed.ts` — rename ternary branch.
- `components/feed/FeedContainer.tsx` — route `pacifica_trader` signals to `CopyCard`.
- `app/portfolio/page.tsx` — render `CopyRow` for `type: 'copy'` bets.
- `app/api/portfolio/route.ts` — include `copyRows` for the new bet type.
- `lib/db/queries.ts` — `getFeedSignals` filters legacy types out when flag is off.
- `vercel.json` — replace legacy crons.
- `.env.example` — add `AGENT_WALLET_ENCRYPTION_KEY`, `PACIFICA_BUILDER_CODE` (optional).
- `package.json` — add `refresh:traders` script, add `@noble/ed25519` if missing.

**Deleted in this plan:** `lib/phoenix/types.ts` (Task 2). Legacy rail routes/UI stay behind `FEATURE_LEGACY_RAILS` flag, deleted in Phase 3.

---

## Task 1: Rename `PhoenixTraderSignal` → `PacificaTraderSignal`

**Files:** `lib/types.ts`, `lib/feed/card-color.ts`, `components/feed/StakeButtons.tsx`, `scripts/seed.ts`

- [ ] **Step 1: Update `lib/types.ts`**

Replace the three `Phoenix*` interfaces and the `Signal` union update from commit `14a2d15`. New shapes (drop `entryPrice` precision comments unchanged; carry over `BaseSignal` extension):

```ts
export type SignalType =
  | "meme"
  | "prediction"
  | "whale"
  | "multiprediction"
  | "pacifica_trader";

export interface PacificaTraderPosition {
  market: string;            // "SOL", "BTC", "ETH", ...
  side: "long" | "short";
  leverage: number;
  notionalUsd: number;
  entryPrice: number;
  unrealizedPnlPct: number;
  pacificaPositionId: string;  // identifier returned by Pacifica positions API
}

export interface PacificaTraderStats {
  equityUsdc: number;
  openInterestUsdc: number;
  pnl1dUsdc: number;
  pnl7dUsdc: number;
  pnl30dUsdc: number;
  pnlAllTimeUsdc: number;
  volume1dUsdc: number;
  volume7dUsdc: number;
}

export interface PacificaTraderSignal extends BaseSignal {
  type: "pacifica_trader";
  address: string;          // base58 Solana pubkey (user's main wallet on Pacifica)
  username: string | null;  // Pacifica display name, if set
  position: PacificaTraderPosition | null;
  stats: PacificaTraderStats;
}

export type Signal =
  | MemeSignal
  | PredictionSignal
  | WhaleSignal
  | MultiPredictionSignal
  | PacificaTraderSignal;
```

- [ ] **Step 2: Update consumers (RAIL_MIN, FAMILIES, seed.ts)**

In `components/feed/StakeButtons.tsx`: rename `phoenix_trader: 5` to `pacifica_trader: 5`.

In `lib/feed/card-color.ts`: rename the `phoenix_trader` family entry to `pacifica_trader` (same hue 165, same numbers).

In `scripts/seed.ts`: the ternary chain currently ends with `: s.authority` (which only matched `phoenix_trader`). Change the final branch label to read `s.address` (the new type uses `address`, not `authority`):

```ts
const assetId =
  s.type === "meme"
    ? s.ticker
    : s.type === "prediction"
      ? s.id
      : s.type === "multiprediction"
        ? s.eventId
        : s.type === "whale"
          ? s.walletAddress
          : s.address;
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/feed/card-color.ts components/feed/StakeButtons.tsx scripts/seed.ts
git commit -m "refactor(types): rename PhoenixTraderSignal to PacificaTraderSignal"
```

---

## Task 2: Delete `lib/phoenix/types.ts`

**Files:** `lib/phoenix/types.ts`

- [ ] **Step 1: Verify it's unreferenced**

Run: `rg "from \"@/lib/phoenix" -l`
Expected: empty result (the file was created earlier in commit `47a4423` and never imported elsewhere).

- [ ] **Step 2: Delete the file**

```bash
rm lib/phoenix/types.ts
# Remove the directory if it's empty:
rmdir lib/phoenix 2>/dev/null || true
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(phoenix): remove unused Phoenix Eternal types module"
```

---

## Task 3: Add `@noble/ed25519` dependency

**Files:** `package.json`

- [ ] **Step 1: Install**

Run: `npm install @noble/ed25519`
Expected: dependency added to `package.json`, lockfile updated.

Use `@noble/ed25519` rather than re-exporting `tweetnacl` because it's a smaller, modern, audited ESM-first Ed25519 library that handles both signing and verifying with a clean API. Privy's `signMessage` returns raw bytes, but we'll need to verify our own canonical-JSON signing logic locally, and noble is the right tool.

- [ ] **Step 2: Verify install**

Run: `npm ls @noble/ed25519`
Expected: version printed, no peer warnings.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @noble/ed25519 for Pacifica canonical-JSON signing"
```

---

## Task 4: Create `lib/pacifica/types.ts`

**Files:** `lib/pacifica/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// Pacifica REST + WS response shapes. Sourced from
// https://api.pacifica.fi/api/v1 and the official Python SDK.
// Field names mirror the API exactly so casts work without an
// intermediate mapper.

export interface PacificaMarketInfo {
  symbol: string;              // "SOL", "BTC", "ETH", ...
  base_decimals: number;
  quote_decimals: number;
  tick_size: string;           // decimal string
  min_amount: string;
  max_leverage_tiers: Array<{
    max_leverage: number;
    max_notional_usd: string;
  }>;
}

export interface PacificaLeaderboardEntry {
  address: string;
  username: string | null;
  pnl_1d: string;
  pnl_7d: string;
  pnl_30d: string;
  pnl_all_time: string;
  equity_current: string;
  oi_current: string;
  volume_1d: string;
  volume_7d: string;
  volume_30d: string;
  volume_all_time: string;
}

export interface PacificaPosition {
  id: string;                  // Pacifica position identifier
  symbol: string;
  side: "bid" | "ask";         // bid = long, ask = short
  amount: string;
  entry_price: string;
  margin: string | null;       // present only for isolated positions
  leverage: number;
  funding: string;
  isolated: boolean;
  unrealized_pnl: string;
  unrealized_pnl_percent: string;
  created_at: number;
  updated_at: number;
}

export interface PacificaAccountInfo {
  address: string;
  username: string | null;
  equity: string;
  available_balance: string;
  margin_used: string;
  positions: PacificaPosition[];
  fee_tier: string;
}

export interface PacificaOrderFill {
  order_id: string;
  client_order_id: string | null;
  symbol: string;
  side: "bid" | "ask";
  filled_amount: string;
  avg_fill_price: string;
  fee: string;
  status: string;
  created_at: number;
}

export interface PacificaSignedRequest<P> {
  account: string;
  agent_wallet?: string;
  signature: string;
  timestamp: number;
  expiry_window: number;
  // ...payload fields flatten in here
  payload: P;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pacifica/types.ts
git commit -m "feat(pacifica): add API response type shapes"
```

---

## Task 5: Create `lib/pacifica/sign.ts` (canonical-JSON Ed25519 signer)

**Files:** `lib/pacifica/sign.ts`

- [ ] **Step 1: Write the signing helpers**

```ts
import * as ed25519 from "@noble/ed25519";
import bs58 from "bs58";

// @noble/ed25519 v3 bundles SHA-512 internally, so no etc.sha512Sync
// setter is needed (that was a v2 requirement).

// Pacifica's canonical-JSON signing recipe (per pacifica-fi/python-sdk
// common/utils.py): recursively sort all object keys alphabetically,
// then JSON.stringify with compact separators (",", ":").

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
  return out;
}

export function canonicalize(obj: unknown): string {
  return JSON.stringify(sortKeys(obj), null, 0).replace(/, /g, ",").replace(/: /g, ":");
  // JSON.stringify with no replacer/indent already uses compact
  // separators (",", ":"); the .replace calls are defensive belt-and-
  // braces in case future runtimes default to padded separators.
}

export type SignatureHeader = {
  type: string;                // e.g. "create_market_order", "bind_agent_wallet"
  timestamp: number;           // ms
  expiry_window: number;       // ms, typically 5000
};

export interface SignedMessage<P> {
  message: string;
  signatureB58: string;
  publicKeyB58: string;
  header: SignatureHeader;
  payload: P;
}

// Build the canonical message string Pacifica expects: header fields
// at the top level, payload nested under "data".
export function buildMessage<P>(header: SignatureHeader, payload: P): string {
  const obj = { ...header, data: payload };
  return canonicalize(obj);
}

// Sign with a raw 32-byte Ed25519 secret seed. Returns base58 signature.
export async function signWithSeed(
  message: string,
  secretSeed: Uint8Array,
): Promise<string> {
  if (secretSeed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${secretSeed.length}`);
  }
  const sig = await ed25519.signAsync(
    new TextEncoder().encode(message),
    secretSeed,
  );
  return bs58.encode(sig);
}

// Verify a signature (used for self-tests + agent-wallet sanity check).
export async function verifySig(
  message: string,
  signatureB58: string,
  publicKeyB58: string,
): Promise<boolean> {
  const sig = bs58.decode(signatureB58);
  const pub = bs58.decode(publicKeyB58);
  return ed25519.verifyAsync(sig, new TextEncoder().encode(message), pub);
}

// Convenience: full sign with a Solana keypair object that exposes
// {publicKey: PublicKey, secretKey: Uint8Array (64 bytes; first 32 are
// the Ed25519 seed)}.
export async function signSolanaMessage<P>(
  header: SignatureHeader,
  payload: P,
  publicKeyB58: string,
  secretKey64: Uint8Array,
): Promise<SignedMessage<P>> {
  const message = buildMessage(header, payload);
  const seed = secretKey64.subarray(0, 32);
  const signatureB58 = await signWithSeed(message, seed);
  return { message, signatureB58, publicKeyB58, header, payload };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Smoke-test signing matches the Python SDK output**

Run an ad-hoc node script:

```bash
node -e "
import('./lib/pacifica/sign.ts').then(async m => {
  const header = { type: 'bind_agent_wallet', timestamp: 1700000000000, expiry_window: 5000 };
  const payload = { agent_wallet: 'AgentWalletPubkey111111111111111111111111111' };
  const msg = m.buildMessage(header, payload);
  console.log(msg);
});
"
```

Expected output (single line, no spaces around `:` or `,`, keys sorted alphabetically):
```
{"data":{"agent_wallet":"AgentWalletPubkey111111111111111111111111111"},"expiry_window":5000,"timestamp":1700000000000,"type":"bind_agent_wallet"}
```

If it doesn't match, fix the `canonicalize` function before continuing — the signature is rejected by Pacifica if the message bytes differ by even one whitespace character.

- [ ] **Step 4: Commit**

```bash
git add lib/pacifica/sign.ts
git commit -m "feat(pacifica): add canonical-JSON Ed25519 signing helpers"
```

---

## Task 6: Create `lib/pacifica/client.ts` (REST client)

**Files:** `lib/pacifica/client.ts`

- [ ] **Step 1: Write the client**

```ts
import type {
  PacificaAccountInfo,
  PacificaLeaderboardEntry,
  PacificaMarketInfo,
  PacificaOrderFill,
  PacificaPosition,
} from "./types";
import type { SignatureHeader } from "./sign";

const BASE_URL =
  process.env.PACIFICA_REST_URL ?? "https://api.pacifica.fi/api/v1";

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`Pacifica GET ${path} failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as T;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  code: number | null;
}

async function getEnvelope<T>(path: string): Promise<T> {
  const j = await getJson<ApiEnvelope<T>>(path);
  if (!j.success || j.data === null) {
    throw new Error(`Pacifica GET ${path} error: ${j.error ?? "unknown"}`);
  }
  return j.data;
}

export async function getMarkets(): Promise<PacificaMarketInfo[]> {
  return getEnvelope<PacificaMarketInfo[]>("/info");
  // Pacifica's docs name the endpoint differently across versions:
  // `/info` returns markets + metadata; if it doesn't, fall back to
  // `/markets`. Confirm at implementation time by hitting both.
}

export async function getLeaderboard(): Promise<PacificaLeaderboardEntry[]> {
  return getEnvelope<PacificaLeaderboardEntry[]>("/leaderboard");
}

export async function getPositions(account: string): Promise<PacificaPosition[]> {
  return getEnvelope<PacificaPosition[]>(`/positions?account=${account}`);
}

export async function getAccountInfo(account: string): Promise<PacificaAccountInfo> {
  return getEnvelope<PacificaAccountInfo>(`/account/info?account=${account}`);
}

// Generic signed POST. The caller provides the already-signed message
// envelope (built via lib/pacifica/sign.ts). Returns the typed response
// payload or throws on failure.
export async function postSigned<P, R>(
  path: string,
  signed: {
    account: string;
    agentWallet?: string;
    signatureB58: string;
    header: SignatureHeader;
    payload: P;
  },
): Promise<R> {
  const body: Record<string, unknown> = {
    account: signed.account,
    signature: signed.signatureB58,
    timestamp: signed.header.timestamp,
    expiry_window: signed.header.expiry_window,
    ...(signed.payload as Record<string, unknown>),
  };
  if (signed.agentWallet) body.agent_wallet = signed.agentWallet;
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const env = (await r.json()) as ApiEnvelope<R>;
  if (!r.ok || !env.success || env.data === null) {
    throw new Error(
      `Pacifica POST ${path} failed: ${r.status} ${env.error ?? "unknown"}`,
    );
  }
  return env.data;
}

// Wrapper: place a market order. Caller has already signed the payload
// with the appropriate keypair (agent for orders, main for bind).
export async function placeMarketOrder(signed: {
  account: string;
  agentWallet?: string;
  signatureB58: string;
  header: SignatureHeader;
  payload: {
    symbol: string;
    amount: string;
    side: "bid" | "ask";
    slippage_percent: string;
    reduce_only: boolean;
    client_order_id?: string;
  };
}): Promise<PacificaOrderFill> {
  return postSigned("/orders/create_market", signed);
}

export async function bindAgentWallet(signed: {
  account: string;
  signatureB58: string;
  header: SignatureHeader;
  payload: { agent_wallet: string };
}): Promise<{ ok: boolean }> {
  return postSigned("/agent/bind", signed);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Smoke-test reads against live Pacifica**

Run:
```bash
npx tsx --env-file=.env.local -e "import('./lib/pacifica/client.ts').then(async m => { const lb = await m.getLeaderboard(); console.log('leaderboard size:', lb.length, 'first:', lb[0]); })"
```
Expected: prints a number > 0 and a leaderboard entry object with `address`, `username`, `pnl_1d`, etc.

If `getMarkets()` returns `404`, swap `/info` for `/markets` in `lib/pacifica/client.ts` and re-test.

- [ ] **Step 4: Commit**

```bash
git add lib/pacifica/client.ts
git commit -m "feat(pacifica): add REST client (reads + signed POSTs)"
```

---

## Task 7: Create `lib/pacifica/markets.ts` (markets cache)

**Files:** `lib/pacifica/markets.ts`

- [ ] **Step 1: Write the cache**

```ts
import type { PacificaMarketInfo } from "./types";
import { getMarkets } from "./client";

const TTL_MS = 60 * 60 * 1000;
let _cache: { markets: PacificaMarketInfo[]; expiresAt: number } | null = null;

export async function getMarketsCached(): Promise<PacificaMarketInfo[]> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.markets;
  const fresh = await getMarkets();
  _cache = { markets: fresh, expiresAt: Date.now() + TTL_MS };
  return fresh;
}

export async function getMarketBySymbol(
  symbol: string,
): Promise<PacificaMarketInfo | null> {
  const all = await getMarketsCached();
  return all.find((m) => m.symbol === symbol) ?? null;
}

// Pacifica exposes a flat max_leverage per market (e.g. BTC=50, smaller
// alts are lower). No notional-tier table at this time, so we just
// return the per-market cap.
export async function getMaxLeverage(symbol: string): Promise<number> {
  const m = await getMarketBySymbol(symbol);
  if (!m) throw new Error(`Unknown Pacifica market: ${symbol}`);
  return m.max_leverage;
}

// Clamp the leader's leverage to what Pacifica permits on this market.
// (Identical to getMaxLeverage today, but isolated as a helper so we
// can add notional-tier logic later without changing call sites.)
export async function clampLeverageForNotional(
  symbol: string,
  _notionalUsd: number,
): Promise<number> {
  return getMaxLeverage(symbol);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pacifica/markets.ts
git commit -m "feat(pacifica): add markets cache + tier-aware leverage helpers"
```

---

## Task 8: Create `lib/pacifica/leaderboard.ts` (heat helpers)

**Files:** `lib/pacifica/leaderboard.ts`, `lib/signals/heat-pacifica-trader.ts`

- [ ] **Step 1: Write the heat scorer at `lib/signals/heat-pacifica-trader.ts`**

```ts
import type { PacificaLeaderboardEntry, PacificaPosition } from "@/lib/pacifica/types";

// Score in [0, 1000]. Higher = earlier in feed.
//
//   has_open_position_now      0..600
//   volume_1d_norm             0..200   capped at $1M
//   equity_norm                0..100   capped at $100k
//   pnl_7d_norm                -100..100 signed; bad traders sink
export function pacificaTraderHeatScore(
  entry: PacificaLeaderboardEntry,
  positions: PacificaPosition[],
): number {
  const hasOpen = positions.length > 0 ? 600 : 0;
  const vol1d = Number(entry.volume_1d);
  const eq = Number(entry.equity_current);
  const pnl7d = Number(entry.pnl_7d);
  const volNorm = Math.min(1, vol1d / 1_000_000) * 200;
  const eqNorm = Math.min(1, eq / 100_000) * 100;
  const pnlNorm = Math.max(-1, Math.min(1, pnl7d / 50_000)) * 100;
  return Math.round(hasOpen + volNorm + eqNorm + pnlNorm);
}
```

- [ ] **Step 2: Write `lib/pacifica/leaderboard.ts` (filter helpers)**

```ts
import type { PacificaLeaderboardEntry } from "./types";

// Filter to wallets we want to surface in the feed. Excludes traders
// with low recent activity, tiny equity, or catastrophic all-time PnL.
export function filterTradeable(
  entries: PacificaLeaderboardEntry[],
  opts: {
    minVolume1dUsd?: number;
    minEquityUsd?: number;
    minPnlAllTimeUsd?: number;
  } = {},
): PacificaLeaderboardEntry[] {
  const minVol = opts.minVolume1dUsd ?? 5000;
  const minEq = opts.minEquityUsd ?? 1000;
  const minPnl = opts.minPnlAllTimeUsd ?? -500_000;
  return entries.filter(
    (e) =>
      Number(e.volume_1d) >= minVol &&
      Number(e.equity_current) >= minEq &&
      Number(e.pnl_all_time) >= minPnl,
  );
}

// Sort by 1d volume descending — pre-sort before applying heat scoring,
// to control which N candidates we fetch positions for (Pacifica positions
// endpoint is per-account, so fewer candidates = fewer requests).
export function preRankByActivity(
  entries: PacificaLeaderboardEntry[],
): PacificaLeaderboardEntry[] {
  return [...entries].sort(
    (a, b) => Number(b.volume_1d) - Number(a.volume_1d),
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add lib/pacifica/leaderboard.ts lib/signals/heat-pacifica-trader.ts
git commit -m "feat(pacifica): add leaderboard filter + heat-score helpers"
```

---

## Task 9: Add `agent_wallets` table to Drizzle schema

**Files:** `lib/db/schema.ts`

- [ ] **Step 1: Append the table to `lib/db/schema.ts`**

Add at the end of the file:

```ts
export const agentWallets = pgTable("agent_wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Pacifica account = user's main Privy Solana wallet pubkey.
  mainPubkey: text("main_pubkey").notNull(),
  // Agent wallet pubkey we registered to the main account via
  // POST /api/v1/agent/bind.
  agentPubkey: text("agent_pubkey").notNull().unique(),
  // Encrypted Ed25519 seed (32 bytes), AES-256-GCM with the master key
  // in AGENT_WALLET_ENCRYPTION_KEY. Format:
  // base64(iv || ciphertext || authTag).
  agentSecretEnc: text("agent_secret_enc").notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Push schema to DB**

Run: `npm run db:push`
Expected: drizzle-kit reports adding the new `agent_wallets` table. Confirm by re-running — second run says "no changes."

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): add agent_wallets table for Pacifica agent-wallet custody"
```

---

## Task 10: Create `lib/wallets/agent.ts` (generation + encrypted persistence)

**Files:** `lib/wallets/agent.ts`, `.env.example`

- [ ] **Step 1: Append to `.env.example`**

Append at the end of `.env.example`:

```bash
# Agent wallet master encryption key (base64-encoded 32 bytes, AES-256-GCM).
# Generate with: openssl rand -base64 32
# Rotating this key invalidates ALL existing agent_wallets rows; rotate only
# alongside a re-bind migration.
AGENT_WALLET_ENCRYPTION_KEY=
```

- [ ] **Step 2: Write `lib/wallets/agent.ts`**

```ts
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { agentWallets } from "@/lib/db/schema";

function getMasterKey(): Buffer {
  const b64 = process.env.AGENT_WALLET_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error("AGENT_WALLET_ENCRYPTION_KEY is required for agent wallet custody");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `AGENT_WALLET_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

// Encrypts the 32-byte Ed25519 seed. Encoding: base64(iv || ciphertext || tag).
function encryptSeed(seed: Uint8Array): string {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(seed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

function decryptSeed(enc: string): Uint8Array {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}

export interface AgentWalletRecord {
  userId: string;
  mainPubkey: string;
  agentPubkey: string;
  // 64-byte Solana secretKey (32-byte seed + 32-byte derived pubkey).
  agentSecretKey: Uint8Array;
}

// Generates a new Ed25519 keypair for an agent wallet. Returns the
// pubkey (base58) and the 32-byte seed (the writable half of secretKey).
export function generateAgentKeypair(): { publicKeyB58: string; seed: Uint8Array } {
  const kp = Keypair.generate();
  return {
    publicKeyB58: kp.publicKey.toBase58(),
    seed: kp.secretKey.subarray(0, 32),
  };
}

export async function getAgentWallet(userId: string): Promise<AgentWalletRecord | null> {
  const [row] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.userId, userId))
    .limit(1);
  if (!row) return null;
  const seed = decryptSeed(row.agentSecretEnc);
  // Rebuild full 64-byte secretKey for @solana/web3.js APIs that need it.
  const kp = Keypair.fromSeed(seed);
  return {
    userId: row.userId,
    mainPubkey: row.mainPubkey,
    agentPubkey: row.agentPubkey,
    agentSecretKey: kp.secretKey,
  };
}

export async function persistAgentWallet(params: {
  userId: string;
  mainPubkey: string;
  agentPubkey: string;
  seed: Uint8Array;
}): Promise<void> {
  await db.insert(agentWallets).values({
    userId: params.userId,
    mainPubkey: params.mainPubkey,
    agentPubkey: params.agentPubkey,
    agentSecretEnc: encryptSeed(params.seed),
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Smoke-test encrypt/decrypt roundtrip**

```bash
AGENT_WALLET_ENCRYPTION_KEY=$(openssl rand -base64 32) npx tsx -e "
import('./lib/wallets/agent.ts').then(async m => {
  const kp = m.generateAgentKeypair();
  console.log('pubkey:', kp.publicKeyB58);
  // Roundtrip check is internal — generate, encrypt via a temp call,
  // decrypt back, verify seed equality.
});
"
```
Expected: a base58 pubkey prints, no errors. (Persistence + decrypt is verified end-to-end during Task 16's first-tap smoke test.)

- [ ] **Step 5: Commit**

```bash
git add lib/wallets/agent.ts .env.example
git commit -m "feat(wallets): add agent wallet generation + encrypted persistence"
```

---

## Task 11: Create `lib/pacifica/deposit.ts` (build deposit Solana tx)

**Files:** `lib/pacifica/deposit.ts`

- [ ] **Step 1: Write the deposit-tx builder**

```ts
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { getConnection } from "@/lib/solana/balance";
import {
  getGasWalletPubkey,
  partialSignAsFeePayer,
} from "@/lib/wallets/gas";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const PACIFICA_PROGRAM_ID = new PublicKey(
  "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH",
);
const PACIFICA_CENTRAL_STATE = new PublicKey(
  "9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY",
);
const PACIFICA_VAULT = new PublicKey(
  "72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa",
);
const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
const SYS_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

function getDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

// Encode the deposit ix data: 8-byte discriminator || u64 amount (in
// USDC's 6-decimal atomic units).
function buildDepositIxData(amountUsdc: number): Buffer {
  const disc = getDiscriminator("deposit");
  const atomic = BigInt(Math.round(amountUsdc * 1_000_000));
  const amt = Buffer.alloc(8);
  amt.writeBigUInt64LE(atomic);
  return Buffer.concat([disc, amt]);
}

// Returns a base64-encoded v0 tx with Gas Wallet as fee payer,
// partial-signed by Gas Wallet. Client signs (adds user signature)
// and broadcasts via Helius, matching the existing gasless flow.
export async function buildDepositTx(params: {
  userPubkey: PublicKey;
  amountUsdc: number;
}): Promise<{ transactionB64: string }> {
  const userUsdcAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    params.userPubkey,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PACIFICA_PROGRAM_ID,
  );

  const ix = new TransactionInstruction({
    programId: PACIFICA_PROGRAM_ID,
    keys: [
      { pubkey: params.userPubkey, isSigner: true, isWritable: true },
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },
      { pubkey: PACIFICA_CENTRAL_STATE, isSigner: false, isWritable: true },
      { pubkey: PACIFICA_VAULT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SYS_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PACIFICA_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: buildDepositIxData(params.amountUsdc),
  });

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: getGasWalletPubkey(),
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  partialSignAsFeePayer(tx);
  return { transactionB64: Buffer.from(tx.serialize()).toString("base64") };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pacifica/deposit.ts
git commit -m "feat(pacifica): build deposit tx with Gas Wallet fee payer"
```

---

## Task 12: Create `lib/pacifica/orders.ts` (high-level helpers)

**Files:** `lib/pacifica/orders.ts`

- [ ] **Step 1: Write the helpers**

```ts
import { randomUUID } from "crypto";
import { placeMarketOrder } from "./client";
import { signSolanaMessage } from "./sign";
import type { PacificaOrderFill } from "./types";
import type { AgentWalletRecord } from "@/lib/wallets/agent";

// Side convention: Pacifica uses "bid" for long, "ask" for short.
function toPacificaSide(side: "long" | "short"): "bid" | "ask" {
  return side === "long" ? "bid" : "ask";
}

export async function openCopyOrder(params: {
  agent: AgentWalletRecord;
  symbol: string;
  side: "long" | "short";
  amountBase: string;       // amount in BASE asset units (e.g. SOL units, not USD)
  slippagePercent?: string; // default "1.0"
}): Promise<PacificaOrderFill> {
  const timestamp = Date.now();
  const signed = await signSolanaMessage(
    { type: "create_market_order", timestamp, expiry_window: 5000 },
    {
      symbol: params.symbol,
      amount: params.amountBase,
      side: toPacificaSide(params.side),
      slippage_percent: params.slippagePercent ?? "1.0",
      reduce_only: false,
      client_order_id: randomUUID(),
    },
    params.agent.agentPubkey,
    params.agent.agentSecretKey,
  );
  return placeMarketOrder({
    account: params.agent.mainPubkey,
    agentWallet: params.agent.agentPubkey,
    signatureB58: signed.signatureB58,
    header: signed.header,
    payload: signed.payload,
  });
}

export async function closeCopyOrder(params: {
  agent: AgentWalletRecord;
  symbol: string;
  // Side of the position being closed; we submit the reverse with
  // reduce_only=true.
  positionSide: "long" | "short";
  amountBase: string;
  slippagePercent?: string;
}): Promise<PacificaOrderFill> {
  const timestamp = Date.now();
  const reverseSide: "long" | "short" =
    params.positionSide === "long" ? "short" : "long";
  const signed = await signSolanaMessage(
    { type: "create_market_order", timestamp, expiry_window: 5000 },
    {
      symbol: params.symbol,
      amount: params.amountBase,
      side: toPacificaSide(reverseSide),
      slippage_percent: params.slippagePercent ?? "1.0",
      reduce_only: true,
      client_order_id: randomUUID(),
    },
    params.agent.agentPubkey,
    params.agent.agentSecretKey,
  );
  return placeMarketOrder({
    account: params.agent.mainPubkey,
    agentWallet: params.agent.agentPubkey,
    signatureB58: signed.signatureB58,
    header: signed.header,
    payload: signed.payload,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pacifica/orders.ts
git commit -m "feat(pacifica): add agent-signed open/close order helpers"
```

---

## Task 13: Create `lib/signals/refresh-traders.ts` + cron route

**Files:** `lib/signals/refresh-traders.ts`, `app/api/cron/refresh-traders/route.ts`, `scripts/refresh-traders.ts`, `package.json`

- [ ] **Step 1: Write `lib/signals/refresh-traders.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { getLeaderboard, getPositions } from "@/lib/pacifica/client";
import {
  filterTradeable,
  preRankByActivity,
} from "@/lib/pacifica/leaderboard";
import { pacificaTraderHeatScore } from "@/lib/signals/heat-pacifica-trader";
import type { PacificaTraderSignal, SignalChipData } from "@/lib/types";
import type { PacificaPosition } from "@/lib/pacifica/types";

const SIGNAL_TYPE = "pacifica_trader";
const MAX_SIGNALS = 200;
const POSITION_FETCH_TOP_N = 150; // top-N by 1d volume that we hydrate positions for

function pickFirstPosition(positions: PacificaPosition[]) {
  // Surface the largest-notional open position; absent → null.
  if (positions.length === 0) return null;
  const sorted = [...positions].sort(
    (a, b) => Math.abs(Number(b.amount) * Number(b.entry_price)) - Math.abs(Number(a.amount) * Number(a.entry_price)),
  );
  return sorted[0];
}

function buildChips(sig: Omit<PacificaTraderSignal, "chips">): SignalChipData[] {
  if (!sig.position) return [{ text: "Watching", level: "amber" }];
  const lev = Math.round(sig.position.leverage);
  return [
    {
      text: `${sig.position.market} ${sig.position.side.toUpperCase()} ${lev}x`,
      level: sig.position.side === "long" ? "green" : "purple",
    },
    {
      text: `${sig.position.unrealizedPnlPct >= 0 ? "+" : ""}${sig.position.unrealizedPnlPct.toFixed(1)}%`,
      level: sig.position.unrealizedPnlPct >= 0 ? "green" : "purple",
    },
  ];
}

export async function refreshTraders(): Promise<{
  attempted: number;
  written: number;
  errors: Array<{ address: string; message: string }>;
}> {
  const leaderboard = await getLeaderboard();
  const tradeable = filterTradeable(leaderboard);
  const ranked = preRankByActivity(tradeable).slice(0, POSITION_FETCH_TOP_N);
  const result = { attempted: ranked.length, written: 0, errors: [] as { address: string; message: string }[] };

  const CONCURRENCY = 10;
  const rows: Array<{ id: string; type: string; assetId: string; heatScore: number; payload: PacificaTraderSignal } | null> =
    new Array(ranked.length).fill(null);

  let cursor = 0;
  async function worker() {
    while (cursor < ranked.length) {
      const i = cursor++;
      const entry = ranked[i];
      try {
        const positions = await getPositions(entry.address);
        const heatScore = pacificaTraderHeatScore(entry, positions);
        const first = pickFirstPosition(positions);
        const sigPos = first
          ? {
              market: first.symbol,
              side: (first.side === "bid" ? "long" : "short") as "long" | "short",
              leverage: first.leverage,
              notionalUsd: Math.abs(Number(first.amount) * Number(first.entry_price)),
              entryPrice: Number(first.entry_price),
              unrealizedPnlPct: Number(first.unrealized_pnl_percent),
              pacificaPositionId: first.id,
            }
          : null;

        const partial: Omit<PacificaTraderSignal, "chips"> = {
          id: `${SIGNAL_TYPE}:${entry.address}`,
          type: "pacifica_trader",
          heatScore,
          createdAt: new Date().toISOString(),
          address: entry.address,
          username: entry.username,
          position: sigPos,
          stats: {
            equityUsdc: Number(entry.equity_current),
            openInterestUsdc: Number(entry.oi_current),
            pnl1dUsdc: Number(entry.pnl_1d),
            pnl7dUsdc: Number(entry.pnl_7d),
            pnl30dUsdc: Number(entry.pnl_30d),
            pnlAllTimeUsdc: Number(entry.pnl_all_time),
            volume1dUsdc: Number(entry.volume_1d),
            volume7dUsdc: Number(entry.volume_7d),
          },
        };
        const signal: PacificaTraderSignal = { ...partial, chips: buildChips(partial) };

        rows[i] = {
          id: signal.id,
          type: SIGNAL_TYPE,
          assetId: signal.position?.market ?? "watching",
          heatScore,
          payload: signal,
        };
      } catch (err) {
        result.errors.push({ address: entry.address, message: String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Sort by heat desc and keep top MAX_SIGNALS.
  const valid = rows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.heatScore - a.heatScore)
    .slice(0, MAX_SIGNALS);

  await db.transaction(async (tx) => {
    await tx.delete(signals).where(eq(signals.type, SIGNAL_TYPE));
    if (valid.length > 0) await tx.insert(signals).values(valid);
  });

  result.written = valid.length;
  return result;
}
```

- [ ] **Step 2: Write `app/api/cron/refresh-traders/route.ts`**

```ts
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { refreshTraders } from "@/lib/signals/refresh-traders";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth) return auth;
  try {
    const result = await refreshTraders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/refresh-traders] failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Write `scripts/refresh-traders.ts`**

```ts
import { refreshTraders } from "@/lib/signals/refresh-traders";

async function main() {
  const result = await refreshTraders();
  console.log("[refresh-traders]", JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add npm script**

In `package.json`, add to `scripts`:
```json
"refresh:traders": "tsx --env-file=.env.local --tsconfig tsconfig.json -r tsconfig-paths/register scripts/refresh-traders.ts"
```

- [ ] **Step 5: Smoke-test locally**

Run: `npm run refresh:traders`
Expected: prints `{ attempted: <N>, written: <M>, errors: [] }` where N > 0 and M > 0. Check `npm run db:studio` and confirm the `signals` table has rows with `type='pacifica_trader'` and `payload` containing real Pacifica addresses.

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/signals/refresh-traders.ts app/api/cron/refresh-traders/route.ts scripts/refresh-traders.ts package.json
git commit -m "feat(signals): wallet rail refresh from Pacifica leaderboard"
```

---

## Task 14: Update `vercel.json` crons

**Files:** `vercel.json`

- [ ] **Step 1: Replace crons**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/refresh-traders",
      "schedule": "*/2 * * * *"
    },
    {
      "path": "/api/cron/mirror-close",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/expire-stale-copies",
      "schedule": "0 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Verify schema parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"`
Expected: no output (parses cleanly).

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(cron): swap legacy refresh crons for Phase-1 Pacifica crons"
```

---

## Task 15: Guard legacy bet + cron routes with `FEATURE_LEGACY_RAILS`

**Files:** all `app/api/bet/{meme,prediction,perp}/**/route.ts`, all `app/api/cron/refresh-{memes,predictions,whales}/route.ts`

(Identical to Task 12 from the Phoenix plan. Repeating here so this plan is self-contained.)

- [ ] **Step 1: Insert the guard at the top of each handler**

In every listed route file, immediately after the auth check (or at the start of `GET` for crons), insert:

```ts
import { legacyRailsEnabled } from "@/lib/features";
// ...
if (!legacyRailsEnabled()) {
  return NextResponse.json(
    { error: "legacy rail disabled" },
    { status: 410 },
  );
}
```

- [ ] **Step 2: Verify**

Start `npm run dev`. In another shell:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/bet/meme \
  -H "Authorization: Bearer dummy" -H "Content-Type: application/json" -d '{}'
```
Expected: `410`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/refresh-memes
```
Expected: `410`.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/bet app/api/cron
git commit -m "feat(legacy): gate meme/prediction/perp routes behind FEATURE_LEGACY_RAILS"
```

---

## Task 16: Filter legacy signal types out of the feed

**Files:** `lib/db/queries.ts`

(Identical to Task 13 from the Phoenix plan, retargeted to `pacifica_trader`.)

- [ ] **Step 1: Replace `getFeedSignals`**

```ts
import { desc, inArray } from "drizzle-orm";
import { db } from "./index";
import { signals } from "./schema";
import type { Signal, SignalType } from "@/lib/types";
import { legacyRailsEnabled } from "@/lib/features";

const PHASE_1_TYPES: SignalType[] = ["pacifica_trader"];
const LEGACY_TYPES: SignalType[] = [
  "meme",
  "prediction",
  "multiprediction",
  "whale",
];

export async function getFeedSignals(limit = 50): Promise<Signal[]> {
  const allowed = legacyRailsEnabled()
    ? [...PHASE_1_TYPES, ...LEGACY_TYPES]
    : PHASE_1_TYPES;
  const rows = await db
    .select()
    .from(signals)
    .where(inArray(signals.type, allowed))
    .orderBy(desc(signals.heatScore))
    .limit(limit);
  return rows.map((r) => r.payload as Signal);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/queries.ts
git commit -m "feat(feed): restrict getFeedSignals to Phase-1 Pacifica signals"
```

---

## Task 17: Create `lib/bets/onboard.ts` (first-tap coordinator)

**Files:** `lib/bets/onboard.ts`

- [ ] **Step 1: Write the coordinator**

```ts
import { PublicKey } from "@solana/web3.js";
import { buildMessage } from "@/lib/pacifica/sign";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import {
  generateAgentKeypair,
  getAgentWallet,
  persistAgentWallet,
} from "@/lib/wallets/agent";

export interface OnboardPlan {
  alreadyOnboarded: boolean;
  // Present when client must sign the bind message and the deposit tx.
  bindMessage?: string;
  bindAgentPubkey?: string;
  depositTransactionB64?: string;
  initialDepositUsdc?: number;
}

const DEFAULT_INITIAL_DEPOSIT_USDC = 25; // covers one $5-$20 tap plus headroom

// Builds the onboarding payload the client needs to sign on first tap.
// Does NOT persist the agent wallet yet — that happens in
// finalizeOnboarding after the bind tx is confirmed by Pacifica.
export async function planOnboarding(params: {
  userId: string;
  userMainPubkey: string;
  desiredStakeUsdc: number;
}): Promise<OnboardPlan> {
  const existing = await getAgentWallet(params.userId);
  if (existing) return { alreadyOnboarded: true };

  const { publicKeyB58: agentPubkey, seed } = generateAgentKeypair();
  const timestamp = Date.now();
  const bindMessage = buildMessage(
    { type: "bind_agent_wallet", timestamp, expiry_window: 5000 },
    { agent_wallet: agentPubkey },
  );

  const initialDeposit = Math.max(
    DEFAULT_INITIAL_DEPOSIT_USDC,
    Math.ceil(params.desiredStakeUsdc * 2.5),
  );
  const { transactionB64 } = await buildDepositTx({
    userPubkey: new PublicKey(params.userMainPubkey),
    amountUsdc: initialDeposit,
  });

  // Stash the freshly-generated agent seed in a one-time cache. Server
  // re-loads it during finalize. For Phase 1 we store it transiently
  // in process memory keyed on agentPubkey — finalize must happen on
  // the same instance; if not, the user re-onboards. Acceptable tradeoff;
  // Phase 2 moves this to Redis/KV.
  pendingAgentSeeds.set(agentPubkey, { userId: params.userId, mainPubkey: params.userMainPubkey, seed, expiresAt: Date.now() + 10 * 60 * 1000 });

  return {
    alreadyOnboarded: false,
    bindMessage,
    bindAgentPubkey: agentPubkey,
    depositTransactionB64: transactionB64,
    initialDepositUsdc: initialDeposit,
  };
}

interface PendingSeed {
  userId: string;
  mainPubkey: string;
  seed: Uint8Array;
  expiresAt: number;
}
const pendingAgentSeeds = new Map<string, PendingSeed>();

// Called from /api/users/me/agent/bind/confirm after Pacifica acknowledges
// the bind, and from /api/users/me/deposit/confirm after the on-chain
// deposit lands. Two-call site, idempotent.
export async function finalizeAgentBind(params: {
  agentPubkey: string;
}): Promise<{ persisted: boolean }> {
  const pending = pendingAgentSeeds.get(params.agentPubkey);
  if (!pending) return { persisted: false };
  if (pending.expiresAt < Date.now()) {
    pendingAgentSeeds.delete(params.agentPubkey);
    return { persisted: false };
  }
  await persistAgentWallet({
    userId: pending.userId,
    mainPubkey: pending.mainPubkey,
    agentPubkey: params.agentPubkey,
    seed: pending.seed,
  });
  pendingAgentSeeds.delete(params.agentPubkey);
  return { persisted: true };
}

export function clearPendingAgent(agentPubkey: string): void {
  pendingAgentSeeds.delete(agentPubkey);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/bets/onboard.ts
git commit -m "feat(bets): add first-tap onboarding coordinator (bind + deposit plan)"
```

---

## Task 18: Create onboarding API routes

**Files:** `app/api/users/me/agent/bind/route.ts`, `app/api/users/me/deposit/route.ts`

- [ ] **Step 1: Write `app/api/users/me/agent/bind/route.ts`**

```ts
import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { bindAgentWallet } from "@/lib/pacifica/client";
import { finalizeAgentBind, clearPendingAgent } from "@/lib/bets/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  agentPubkey?: string;
  signatureB58?: string;
  timestamp?: number;
  expiryWindow?: number;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.agentPubkey || !body.signatureB58 || !body.timestamp || !body.expiryWindow) {
    return NextResponse.json({ error: "agentPubkey, signatureB58, timestamp, expiryWindow required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    await bindAgentWallet({
      account: user.solanaPubkey,
      signatureB58: body.signatureB58,
      header: {
        type: "bind_agent_wallet",
        timestamp: body.timestamp,
        expiry_window: body.expiryWindow,
      },
      payload: { agent_wallet: body.agentPubkey },
    });
  } catch (err) {
    clearPendingAgent(body.agentPubkey);
    console.error("[agent/bind] Pacifica rejected:", err);
    return NextResponse.json({ error: `Pacifica bind failed: ${String(err)}` }, { status: 502 });
  }

  const persisted = await finalizeAgentBind({ agentPubkey: body.agentPubkey });
  return NextResponse.json({ ok: true, persisted });
}
```

- [ ] **Step 2: Write `app/api/users/me/deposit/route.ts`**

```ts
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import {
  ensureGasWalletReady,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  amountUsdc?: number;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.amountUsdc || body.amountUsdc < 5) {
    return NextResponse.json({ error: "amountUsdc >= 5 required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const tx = await buildDepositTx({
    userPubkey: new PublicKey(user.solanaPubkey),
    amountUsdc: body.amountUsdc,
  });
  return NextResponse.json({ depositTransaction: tx.transactionB64 });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/users/me/agent app/api/users/me/deposit
git commit -m "feat(api): add agent-bind + deposit onboarding routes"
```

---

## Task 19: Create `app/api/bet/copy/route.ts` (open)

**Files:** `app/api/bet/copy/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { getPositions } from "@/lib/pacifica/client";
import { clampLeverageForNotional } from "@/lib/pacifica/markets";
import { openCopyOrder } from "@/lib/pacifica/orders";
import { planOnboarding } from "@/lib/bets/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

interface Body {
  leaderAddress?: string;
  market?: string;
  side?: "long" | "short";
  leverage?: number;
  stakeUsdc?: number;
  signalId?: string;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    !body?.leaderAddress ||
    !body.market ||
    (body.side !== "long" && body.side !== "short") ||
    typeof body.leverage !== "number" ||
    typeof body.stakeUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "leaderAddress, market, side (long|short), leverage, stakeUsdc required" },
      { status: 400 },
    );
  }
  if (body.stakeUsdc < MIN_USDC || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  // First-tap onboarding: if no agent wallet exists yet, return the
  // bind+deposit plan to the client. Client signs both, calls the
  // onboarding routes, then re-POSTs here.
  const agent = await getAgentWallet(user.id);
  if (!agent) {
    const plan = await planOnboarding({
      userId: user.id,
      userMainPubkey: user.solanaPubkey,
      desiredStakeUsdc: body.stakeUsdc,
    });
    return NextResponse.json({ phase: "onboard", ...plan });
  }

  // Re-verify the leader still holds the matching position.
  let leaderPositions;
  try {
    leaderPositions = await getPositions(body.leaderAddress);
  } catch (err) {
    return NextResponse.json({ error: `Pacifica leader lookup failed: ${String(err)}` }, { status: 502 });
  }
  const leaderPos = leaderPositions.find(
    (p) => p.symbol === body.market && ((body.side === "long" && p.side === "bid") || (body.side === "short" && p.side === "ask")),
  );
  if (!leaderPos) {
    return NextResponse.json({ error: "leader no longer has this position open" }, { status: 409 });
  }

  // Compute the user's notional + amount given their stake and leader's lev.
  const userNotional = body.stakeUsdc * body.leverage;
  const clamped = await clampLeverageForNotional(body.market, userNotional);
  const effectiveLeverage = Math.min(body.leverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const entryPrice = Number(leaderPos.entry_price); // approximate; Pacifica fills at mark
  const amountBase = (finalNotional / entryPrice).toFixed(6);

  let fill;
  try {
    fill = await openCopyOrder({
      agent,
      symbol: body.market,
      side: body.side,
      amountBase,
    });
  } catch (err) {
    console.error("[bet/copy] open failed:", err);
    return NextResponse.json({ error: `Pacifica order failed: ${String(err)}` }, { status: 502 });
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "copy",
      signalId: body.signalId ?? null,
      amountUsdc: body.stakeUsdc,
      status: "confirmed",
      meta: {
        leaderAddress: body.leaderAddress,
        leaderMarket: body.market,
        leaderSide: body.side,
        leverage: effectiveLeverage,
        pacificaOrderId: fill.order_id,
        pacificaPositionId: leaderPos.id,
        leaderEntryPriceAtTap: Number(leaderPos.entry_price),
        leaderUnrealizedPnlPctAtTap: Number(leaderPos.unrealized_pnl_percent),
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    fill: {
      orderId: fill.order_id,
      avgFillPrice: fill.avg_fill_price,
      filledAmount: fill.filled_amount,
      side: fill.side,
    },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/bet/copy/route.ts
git commit -m "feat(bet/copy): add open route with first-tap onboarding"
```

---

## Task 20: Create `app/api/bet/copy/close/route.ts`

**Files:** `app/api/bet/copy/close/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { closeCopyOrder } from "@/lib/pacifica/orders";
import { getPositions } from "@/lib/pacifica/client";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  betId?: string;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.betId) return NextResponse.json({ error: "betId required" }, { status: 400 });

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });

  const agent = await getAgentWallet(user.id);
  if (!agent) return NextResponse.json({ error: "no agent wallet bound" }, { status: 409 });

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) return NextResponse.json({ error: "bet not found" }, { status: 404 });
  if (bet.status !== "confirmed") {
    return NextResponse.json({ error: `cannot close bet with status ${bet.status}` }, { status: 409 });
  }

  const meta = bet.meta as { leaderMarket: string; leaderSide: "long" | "short" };

  // Look up the user's current position on Pacifica to get the exact
  // amount to reduce. If the position is already gone, mark closed
  // and return success.
  let userPositions;
  try {
    userPositions = await getPositions(user.solanaPubkey);
  } catch (err) {
    return NextResponse.json({ error: `Pacifica account lookup failed: ${String(err)}` }, { status: 502 });
  }
  const userPos = userPositions.find(
    (p) => p.symbol === meta.leaderMarket && ((meta.leaderSide === "long" && p.side === "bid") || (meta.leaderSide === "short" && p.side === "ask")),
  );
  if (!userPos) {
    await db.update(bets).set({ status: "closed", closedAt: new Date() }).where(eq(bets.id, bet.id));
    return NextResponse.json({ ok: true, alreadyClosed: true });
  }

  let fill;
  try {
    fill = await closeCopyOrder({
      agent,
      symbol: meta.leaderMarket,
      positionSide: meta.leaderSide,
      amountBase: userPos.amount,
    });
  } catch (err) {
    console.error("[bet/copy/close] failed:", err);
    return NextResponse.json({ error: `Pacifica close failed: ${String(err)}` }, { status: 502 });
  }

  await db
    .update(bets)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeTxHash: `pacifica:${fill.order_id}`,
    })
    .where(eq(bets.id, bet.id));

  return NextResponse.json({ ok: true, orderId: fill.order_id });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/bet/copy/close/route.ts
git commit -m "feat(bet/copy): add manual close route"
```

---

## Task 21: Create `lib/bets/mirror-close.ts` + cron route

**Files:** `lib/bets/mirror-close.ts`, `app/api/cron/mirror-close/route.ts`

- [ ] **Step 1: Write `lib/bets/mirror-close.ts`**

```ts
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users, agentWallets } from "@/lib/db/schema";
import { Keypair } from "@solana/web3.js";
import { getPositions } from "@/lib/pacifica/client";
import { closeCopyOrder } from "@/lib/pacifica/orders";
import type { AgentWalletRecord } from "@/lib/wallets/agent";
import { createDecipheriv } from "crypto";

interface BetMeta {
  leaderAddress: string;
  leaderMarket: string;
  leaderSide: "long" | "short";
  leverage: number;
  pacificaPositionId: string;
}

function decryptSeed(enc: string): Uint8Array {
  const key = Buffer.from(process.env.AGENT_WALLET_ENCRYPTION_KEY ?? "", "base64");
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}

interface MirrorResult {
  scannedLeaders: number;
  closesAttempted: number;
  closesSucceeded: number;
  errors: Array<{ betId: string; message: string }>;
}

export async function runMirrorCloseSweep(): Promise<MirrorResult> {
  const result: MirrorResult = {
    scannedLeaders: 0,
    closesAttempted: 0,
    closesSucceeded: 0,
    errors: [],
  };

  const openBets = await db
    .select({
      betId: bets.id,
      userId: bets.userId,
      meta: bets.meta,
      userMainPubkey: users.solanaPubkey,
      agentPubkey: agentWallets.agentPubkey,
      agentSecretEnc: agentWallets.agentSecretEnc,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    .innerJoin(agentWallets, eq(agentWallets.userId, bets.userId))
    .where(
      and(
        eq(bets.type, "copy"),
        eq(bets.status, "confirmed"),
        isNotNull(bets.meta),
      ),
    );
  if (openBets.length === 0) return result;

  // Group by leaderAddress so we only fetch each leader's positions once.
  const byLeader = new Map<string, typeof openBets>();
  for (const row of openBets) {
    const meta = row.meta as BetMeta | null;
    if (!meta?.leaderAddress) continue;
    const list = byLeader.get(meta.leaderAddress) ?? [];
    list.push(row);
    byLeader.set(meta.leaderAddress, list);
  }

  for (const [leaderAddress, followers] of byLeader.entries()) {
    result.scannedLeaders++;
    let leaderPositions;
    try {
      leaderPositions = await getPositions(leaderAddress);
    } catch (err) {
      for (const f of followers) {
        result.errors.push({ betId: f.betId, message: `leader fetch: ${err}` });
      }
      continue;
    }

    for (const row of followers) {
      const meta = row.meta as BetMeta;
      const stillOpen = leaderPositions.find(
        (p) =>
          p.symbol === meta.leaderMarket &&
          ((meta.leaderSide === "long" && p.side === "bid") ||
            (meta.leaderSide === "short" && p.side === "ask")) &&
          p.id === meta.pacificaPositionId,
      );
      if (stillOpen) continue;

      // Leader closed → close follower.
      result.closesAttempted++;
      try {
        const seed = decryptSeed(row.agentSecretEnc);
        const kp = Keypair.fromSeed(seed);
        const agent: AgentWalletRecord = {
          userId: row.userId,
          mainPubkey: row.userMainPubkey!,
          agentPubkey: row.agentPubkey,
          agentSecretKey: kp.secretKey,
        };
        // Look up user's current position to know how much to close.
        const userPositions = await getPositions(row.userMainPubkey!);
        const userPos = userPositions.find(
          (p) =>
            p.symbol === meta.leaderMarket &&
            ((meta.leaderSide === "long" && p.side === "bid") ||
              (meta.leaderSide === "short" && p.side === "ask")),
        );
        if (!userPos) {
          // Position already gone on user side (manual close beat us).
          await db.update(bets).set({ status: "closed", closedAt: new Date() }).where(eq(bets.id, row.betId));
          result.closesSucceeded++;
          continue;
        }
        const fill = await closeCopyOrder({
          agent,
          symbol: meta.leaderMarket,
          positionSide: meta.leaderSide,
          amountBase: userPos.amount,
        });
        await db
          .update(bets)
          .set({
            status: "closed",
            closedAt: new Date(),
            closeTxHash: `pacifica:${fill.order_id}`,
          })
          .where(eq(bets.id, row.betId));
        result.closesSucceeded++;
      } catch (err) {
        result.errors.push({ betId: row.betId, message: String(err) });
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: Write `app/api/cron/mirror-close/route.ts`**

```ts
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { runMirrorCloseSweep } from "@/lib/bets/mirror-close";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth) return auth;
  try {
    const result = await runMirrorCloseSweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/mirror-close] failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add lib/bets/mirror-close.ts app/api/cron/mirror-close/route.ts
git commit -m "feat(bets): mirror-close worker (agent-signed reduce_only)"
```

---

## Task 22: Create `app/api/cron/expire-stale-copies/route.ts`

**Files:** `app/api/cron/expire-stale-copies/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, agentWallets, users } from "@/lib/db/schema";
import { Keypair } from "@solana/web3.js";
import { createDecipheriv } from "crypto";
import { checkCronAuth } from "@/lib/auth/cron";
import { getPositions } from "@/lib/pacifica/client";
import { closeCopyOrder } from "@/lib/pacifica/orders";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function decryptSeed(enc: string): Uint8Array {
  const key = Buffer.from(process.env.AGENT_WALLET_ENCRYPTION_KEY ?? "", "base64");
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}

// Force-close any copy bet whose createdAt is older than 24h and is
// still "confirmed". Unlike the Phoenix plan, we can actually submit
// the close (we have agent-wallet authority).
export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth) return auth;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stale = await db
    .select({
      betId: bets.id,
      userId: bets.userId,
      meta: bets.meta,
      userMainPubkey: users.solanaPubkey,
      agentPubkey: agentWallets.agentPubkey,
      agentSecretEnc: agentWallets.agentSecretEnc,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    .innerJoin(agentWallets, eq(agentWallets.userId, bets.userId))
    .where(
      and(
        eq(bets.type, "copy"),
        eq(bets.status, "confirmed"),
        lt(bets.createdAt, cutoff),
        isNotNull(bets.meta),
      ),
    );

  let closed = 0;
  const errors: Array<{ betId: string; message: string }> = [];
  for (const row of stale) {
    try {
      const meta = row.meta as { leaderMarket: string; leaderSide: "long" | "short" };
      const userPositions = await getPositions(row.userMainPubkey!);
      const userPos = userPositions.find(
        (p) =>
          p.symbol === meta.leaderMarket &&
          ((meta.leaderSide === "long" && p.side === "bid") ||
            (meta.leaderSide === "short" && p.side === "ask")),
      );
      if (userPos) {
        const seed = decryptSeed(row.agentSecretEnc);
        const kp = Keypair.fromSeed(seed);
        const fill = await closeCopyOrder({
          agent: {
            userId: row.userId,
            mainPubkey: row.userMainPubkey!,
            agentPubkey: row.agentPubkey,
            agentSecretKey: kp.secretKey,
          },
          symbol: meta.leaderMarket,
          positionSide: meta.leaderSide,
          amountBase: userPos.amount,
        });
        await db
          .update(bets)
          .set({ status: "expired", closedAt: new Date(), closeTxHash: `pacifica:${fill.order_id}` })
          .where(eq(bets.id, row.betId));
      } else {
        await db
          .update(bets)
          .set({ status: "expired", closedAt: new Date() })
          .where(eq(bets.id, row.betId));
      }
      closed++;
    } catch (err) {
      errors.push({ betId: row.betId, message: String(err) });
    }
  }
  return NextResponse.json({ ok: true, expired: closed, errors });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/expire-stale-copies/route.ts
git commit -m "feat(cron): 24h expire-stale-copies (agent-signed close)"
```

---

## Task 23: Create `components/feed/CopyCard.tsx`

**Files:** `components/feed/CopyCard.tsx`

- [ ] **Step 1: Read `components/feed/WhaleCard.tsx` for style parity**

(Read the existing whale card to mirror layout conventions, then write the new card.)

- [ ] **Step 2: Write the card**

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import type { PacificaTraderSignal, StakeAmount } from "@/lib/types";

const STAKES: StakeAmount[] = [5, 10, 20, 50];
const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

interface Props {
  signal: PacificaTraderSignal;
  isActive: boolean;
}

interface OnboardResponse {
  phase: "onboard";
  alreadyOnboarded: false;
  bindMessage: string;
  bindAgentPubkey: string;
  depositTransactionB64: string;
  initialDepositUsdc: number;
}

interface OpenResponse {
  phase: "open";
  betId: string;
  fill: { orderId: string; avgFillPrice: string; filledAmount: string; side: string };
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function CopyCard({ signal, isActive }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState<StakeAmount | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pos = signal.position;
  const truncated = useMemo(
    () => `${signal.address.slice(0, 4)}…${signal.address.slice(-4)}`,
    [signal.address],
  );

  const onTap = useCallback(
    async (stake: StakeAmount) => {
      if (!pos || busy || !wallet) return;
      setBusy(stake);
      setStatus("Placing order…");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");

        const body = {
          leaderAddress: signal.address,
          market: pos.market,
          side: pos.side,
          leverage: pos.leverage,
          stakeUsdc: stake,
          signalId: signal.id,
          walletAddress: wallet.address,
        };
        let resp = await fetch("/api/bet/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.error ?? `HTTP ${resp.status}`);
        }
        const first = (await resp.json()) as OnboardResponse | OpenResponse;

        if (first.phase === "onboard") {
          // Step A: sign + submit the bind message.
          setStatus("Authorizing trader…");
          const bindMsgBytes = new TextEncoder().encode(first.bindMessage);
          const { signature: bindSig } = (await signMessage({
            message: bindMsgBytes,
            wallet,
          })) as { signature: Uint8Array };
          // Send to bind endpoint.
          const bs58Sig = (await import("bs58")).default.encode(bindSig);
          // Parse out timestamp + expiry from the canonical message
          // bindMessage is a JSON string with header fields at top level.
          const parsed = JSON.parse(first.bindMessage) as {
            timestamp: number;
            expiry_window: number;
          };
          const bindResp = await fetch("/api/users/me/agent/bind", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              agentPubkey: first.bindAgentPubkey,
              signatureB58: bs58Sig,
              timestamp: parsed.timestamp,
              expiryWindow: parsed.expiry_window,
              walletAddress: wallet.address,
            }),
          });
          if (!bindResp.ok) {
            const e = await bindResp.json().catch(() => ({}));
            throw new Error(`bind failed: ${e.error ?? bindResp.status}`);
          }

          // Step B: sign + submit the deposit tx.
          setStatus("Depositing USDC…");
          const txBytes = b64ToBytes(first.depositTransactionB64);
          const { signedTransaction } = (await signTransaction({
            transaction: txBytes,
            wallet,
          })) as { signedTransaction: Uint8Array };
          const conn = new Connection(RPC, "confirmed");
          const sig = await conn.sendRawTransaction(signedTransaction, { maxRetries: 3 });
          await conn.confirmTransaction(sig, "confirmed");

          // Re-tap.
          setStatus("Placing order…");
          resp = await fetch("/api/bet/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
          });
          if (!resp.ok) {
            const e = await resp.json().catch(() => ({}));
            throw new Error(e.error ?? `HTTP ${resp.status}`);
          }
        }

        const open = (await resp.json()) as OpenResponse;
        setStatus(`Opened @ $${Number(open.fill.avgFillPrice).toFixed(4)}`);
      } catch (err) {
        console.error("[copy] tap failed:", err);
        setStatus(`Failed: ${String(err).slice(0, 80)}`);
      } finally {
        setBusy(null);
        setTimeout(() => setStatus(null), 5000);
      }
    },
    [busy, getAccessToken, pos, signal.address, signal.id, signMessage, signTransaction, wallet],
  );

  return (
    <div
      className="flex h-full w-full flex-col justify-between p-6 text-white"
      data-card-type="pacifica_trader"
    >
      <div>
        <div className="text-xs uppercase tracking-widest text-white/60">Pacifica Trader</div>
        <div className="mt-1 text-2xl font-bold">{signal.username ?? truncated}</div>
        <a
          href={`https://solscan.io/account/${signal.address}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-white/40 underline"
        >
          {truncated} ↗
        </a>
      </div>
      {pos ? (
        <div className="space-y-1 text-sm">
          <div>
            <span className="text-white/60">Position </span>
            <span className="font-semibold">
              {pos.market} {pos.side.toUpperCase()} {Math.round(pos.leverage)}x
            </span>
          </div>
          <div>
            <span className="text-white/60">Entry </span>
            <span>${pos.entryPrice.toFixed(4)}</span>
          </div>
          <div>
            <span className="text-white/60">PnL </span>
            <span className={pos.unrealizedPnlPct >= 0 ? "text-green-400" : "text-rose-400"}>
              {pos.unrealizedPnlPct >= 0 ? "+" : ""}{pos.unrealizedPnlPct.toFixed(1)}%
            </span>
          </div>
          <div className="text-xs text-white/50">
            7d vol ${Math.round(signal.stats.volume7dUsdc).toLocaleString()} ·
            equity ${Math.round(signal.stats.equityUsdc).toLocaleString()}
          </div>
        </div>
      ) : (
        <div className="text-sm text-white/60">No open position. Watching…</div>
      )}
      <div className="flex gap-2">
        {STAKES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={!pos || busy !== null || !isActive}
            onClick={() => onTap(s)}
            className="flex-1 rounded-2xl bg-white/10 py-3 font-semibold disabled:opacity-40"
          >
            {busy === s ? "…" : `$${s}`}
          </button>
        ))}
      </div>
      {status && <div className="mt-2 text-center text-xs text-white/70">{status}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/feed/CopyCard.tsx
git commit -m "feat(feed): add CopyCard with first-tap onboarding flow"
```

---

## Task 24: Route `pacifica_trader` signals through `FeedContainer`

**Files:** `components/feed/FeedContainer.tsx`

- [ ] **Step 1: Add CopyCard to the per-signal switch**

Read `FeedContainer.tsx` to find the existing per-rail render block (search for `WhaleCard`). Add:
```tsx
import { CopyCard } from "./CopyCard";

// ...in the per-signal render switch:
{signal.type === "pacifica_trader" && (
  <CopyCard signal={signal} isActive={isActive} />
)}
```

Update `buildAllowedTypes` to always include `pacifica_trader`:
```ts
function buildAllowedTypes(prefs: FeedPrefs): Set<SignalType> {
  const allowed = new Set<SignalType>();
  allowed.add("pacifica_trader");
  if (prefs.meme) allowed.add("meme");
  if (prefs.prediction) {
    allowed.add("prediction");
    allowed.add("multiprediction");
  }
  if (prefs.whale) allowed.add("whale");
  return allowed;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/feed/FeedContainer.tsx
git commit -m "feat(feed): render CopyCard for pacifica_trader signals"
```

---

## Task 25: Create `components/portfolio/CopyRow.tsx` and wire `/portfolio`

**Files:** `components/portfolio/CopyRow.tsx`, `app/api/portfolio/route.ts`, `app/portfolio/page.tsx`

- [ ] **Step 1: Write the row component**

```tsx
"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

export interface CopyRowData {
  betId: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  stakeUsdc: number;
  leaderAddress: string;
  leaderUsername: string | null;
  unrealizedPnlPct: number | null;
  leaderClosedAt: string | null;
}

interface Props {
  row: CopyRowData;
  onClosed: (betId: string) => void;
}

export function CopyRow({ row, onClosed }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onClose = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Closing…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const r = await fetch("/api/bet/copy/close", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ betId: row.betId, walletAddress: wallet?.address }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${r.status}`);
      }
      setStatus("Closed");
      onClosed(row.betId);
    } catch (err) {
      setStatus(`Failed: ${String(err).slice(0, 80)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  }, [busy, getAccessToken, onClosed, row.betId, wallet?.address]);

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/5 p-4">
      <div>
        <div className="text-sm font-semibold">
          {row.market} {row.side.toUpperCase()} {Math.round(row.leverage)}x
        </div>
        <div className="text-xs text-white/60">
          Stake ${row.stakeUsdc} · Copying {row.leaderUsername ?? `${row.leaderAddress.slice(0, 4)}…${row.leaderAddress.slice(-4)}`}
        </div>
        {row.leaderClosedAt && (
          <div className="mt-1 text-xs text-amber-300">Leader exited. Close yours to settle.</div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {row.unrealizedPnlPct !== null && (
          <div className={row.unrealizedPnlPct >= 0 ? "text-green-400" : "text-rose-400"}>
            {row.unrealizedPnlPct >= 0 ? "+" : ""}{row.unrealizedPnlPct.toFixed(1)}%
          </div>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          {busy ? "…" : "Close"}
        </button>
      </div>
      {status && <div className="ml-3 text-xs text-white/70">{status}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Extend `app/api/portfolio/route.ts`**

Read the existing route, find the bets aggregator, and add a `copyRows` block that filters `type === 'copy'` bets, fetches the user's Pacifica positions once, and computes the row shape. The pattern:

```ts
import { getPositions } from "@/lib/pacifica/client";

// ...inside GET, after fetching userBets:
const copyBets = userBets.filter((b) => b.type === "copy");
let userPositions = null;
if (copyBets.length > 0 && user.solanaPubkey) {
  try {
    userPositions = await getPositions(user.solanaPubkey);
  } catch (err) {
    console.warn("[portfolio] pacifica positions fetch failed:", err);
  }
}
const copyRows = copyBets.map((b) => {
  const meta = b.meta as {
    leaderMarket: string;
    leaderSide: "long" | "short";
    leverage: number;
    leaderAddress: string;
    leaderClosedAt?: string;
  };
  const livePos = userPositions?.find(
    (p) =>
      p.symbol === meta.leaderMarket &&
      ((meta.leaderSide === "long" && p.side === "bid") ||
        (meta.leaderSide === "short" && p.side === "ask")),
  );
  return {
    betId: b.id,
    market: meta.leaderMarket,
    side: meta.leaderSide,
    leverage: meta.leverage,
    stakeUsdc: b.amountUsdc,
    leaderAddress: meta.leaderAddress,
    leaderUsername: null,
    unrealizedPnlPct: livePos ? Number(livePos.unrealized_pnl_percent) : null,
    leaderClosedAt: meta.leaderClosedAt ?? null,
  };
});
// Add `copyRows` to the response payload alongside existing keys.
```

- [ ] **Step 3: Wire `app/portfolio/page.tsx`**

Read the existing page to see its layout, then add a "Copies" section that consumes `copyRows`:

```tsx
import { CopyRow, type CopyRowData } from "@/components/portfolio/CopyRow";

// ...alongside existing state and fetches:
const [copyRows, setCopyRows] = useState<CopyRowData[]>([]);

// In the refetch callback:
setCopyRows((data.copyRows as CopyRowData[]) ?? []);

// In JSX, alongside other position sections:
{copyRows.length > 0 && (
  <section className="space-y-2">
    <h2 className="text-lg font-semibold text-white/80">Copies</h2>
    {copyRows.map((row) => (
      <CopyRow key={row.betId} row={row} onClosed={() => void refetch()} />
    ))}
  </section>
)}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/portfolio/CopyRow.tsx app/portfolio/page.tsx app/api/portfolio/route.ts
git commit -m "feat(portfolio): render CopyRow + live Pacifica PnL"
```

---

## Task 26: End-to-end smoke test

**Files:** (validation only)

- [ ] **Step 1: Verify .env.local has all required keys**

Run: `grep -E "^(NEXT_PUBLIC_HELIUS_RPC_URL|DATABASE_URL|NEXT_PUBLIC_PRIVY_APP_ID|PRIVY_APP_SECRET|GAS_WALLET_PRIVATE_KEY|AGENT_WALLET_ENCRYPTION_KEY|CRON_SECRET)=" .env.local | wc -l`
Expected: 7 (one per required variable).

If `AGENT_WALLET_ENCRYPTION_KEY` is missing, generate:
```bash
echo "AGENT_WALLET_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.local
```

- [ ] **Step 2: Refresh signals**

Run: `npm run refresh:traders`
Expected: `{ attempted: 100-150, written: 50-200, errors: [...] }`. Some errors (Pacifica positions endpoint flakiness on a subset) are acceptable.

- [ ] **Step 3: Verify feed renders**

Start `npm run dev`. Open `http://localhost:3000/feed` after login.
Expected: At least one CopyCard appears showing a real Pacifica trader with a live open position (market, side, leverage, PnL).

- [ ] **Step 4: First-tap onboarding flow**

Pre-fund the test user's Privy wallet with ~$50 USDC and a small amount of SOL is NOT needed (Gas Wallet pays). Tap `$5` on a card with an open position.

Expected sequence:
1. Card shows "Authorizing trader…" (bind message signing).
2. Then "Depositing USDC…" (deposit tx signing + landing).
3. Then "Placing order…" (Pacifica order submit).
4. Then "Opened @ $X.XX" with the fill price.

Verify in DB:
```bash
npm run db:studio
```
- `agent_wallets` has a new row keyed on the test user.
- `bets` has a new row with `type='copy'`, `status='confirmed'`, `meta.pacificaOrderId` set.

Verify on Pacifica:
- `https://app.pacifica.fi/portfolio` (if logged in with the same wallet) shows the new position.

- [ ] **Step 5: Manual close**

Open `/portfolio`. The CopyRow appears with live PnL. Tap "Close".
Expected: `bets.status='closed'`, `closeTxHash` starts with `pacifica:`.

- [ ] **Step 6: Mirror-close cron**

Run:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/mirror-close | jq
```
Expected: `{ ok: true, scannedLeaders: N, closesAttempted: 0, closesSucceeded: 0, errors: [] }` (zero because no leader has closed yet against an open follower).

- [ ] **Step 7: Stale-close cron**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-stale-copies | jq
```
Expected: `{ ok: true, expired: 0 }`.

- [ ] **Step 8: Verify legacy rails are dark**

```bash
curl -s "http://localhost:3000/api/feed?limit=50" | jq '.signals | map(.type) | unique'
```
Expected: `["pacifica_trader"]`.

- [ ] **Step 9: Commit anything that needed fixing**

If any step failed and required code fixes, commit them.

---

## Task 27: Final verification + deploy

**Files:** (no code changes)

- [ ] **Step 1: Full typecheck + lint**

```bash
npm run typecheck && npm run lint
```
Expected: both pass.

- [ ] **Step 2: Build check**

```bash
npm run build
```
Expected: builds clean.

- [ ] **Step 3: Push branch + deploy preview**

```bash
git push -u origin perps-ai-wallets
```

Wait for Vercel preview. Set environment variables in the Vercel project: `DATABASE_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_HELIUS_RPC_URL`, `GAS_WALLET_PRIVATE_KEY`, `AGENT_WALLET_ENCRYPTION_KEY`, `CRON_SECRET`, `FEATURE_LEGACY_RAILS=false`.

- [ ] **Step 4: Verify on preview**

Hit the preview URL: feed loads, taps trigger onboarding correctly, copies appear in /portfolio, all three crons fire green from Vercel's cron dashboard.

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "Phase 1: perps-only copy-trading on Pacifica" --body "$(cat <<'EOF'
## Summary
- Pivot meme/prediction/perp rails behind FEATURE_LEGACY_RAILS flag (off by default).
- Ship Phase 1 of perps-only copy-trading on Pacifica (top Solana perp DEX, 50x lev, $1.49B daily).
- Wallet rail: fed from Pacifica's public leaderboard every 2 min, top 100-200 active traders ranked by composite heat (open position + 1d volume + equity + recent PnL).
- Tap flow: first tap onboards user (agent wallet bind + USDC deposit, Gas Wallet pays SOL). Subsequent taps are agent-signed REST calls — no client signature, no on-chain tx, sub-second.
- Mirror-close: server uses each user's agent wallet to close their copy when the leader exits.
- 24h hard expire fallback.

## Test plan
- [ ] `npm run refresh:traders` reports written>0.
- [ ] Feed at /feed shows real Pacifica trader cards with PnL.
- [ ] First-tap flow: signs bind, signs deposit tx, places order, success.
- [ ] /portfolio shows the CopyRow with live PnL.
- [ ] Manual close from /portfolio settles the bet.
- [ ] Cron dashboard shows refresh-traders + mirror-close + expire-stale-copies all green.

Spec: docs/superpowers/specs/2026-05-14-gwak-perps-pacifica-design.md
Plan: docs/superpowers/plans/2026-05-14-gwak-perps-pacifica-phase-1.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## What's NOT in Phase 1 (deferred)

- **AI rail (7 LLM strategies):** Phase 2 plan.
- **WS-driven mirror-close:** Phase 2.
- **Legacy file deletion:** Phase 3.
- **Withdraw UX:** Phase 2.
- **X auto-posting, share cards, leaderboards, ref split:** Phase 4 spec.
