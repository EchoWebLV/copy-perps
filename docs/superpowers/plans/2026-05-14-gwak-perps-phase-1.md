# gwak.gg Perps Pivot — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the perps-only copy-trading pivot: users can scroll a feed of real Phoenix Eternal traders' open positions and tap $5/$10/$20/$50 to copy any of them. Auto-close when the leader closes, manual close from `/portfolio`, 24h hard fallback.

**Architecture:** Two-rail design (wallet rail live in Phase 1, AI rail dark until Phase 2). One execution venue (Phoenix Eternal on Solana). One bet flow (`/api/bet/copy`) shared across rails. Mirror-close runs as a 1-minute cron-polled diff worker against Phoenix REST until WebSocket support lands in Phase 2/3. Legacy meme/prediction/perp rails go behind `FEATURE_LEGACY_RAILS` flag, dead by default.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, `@solana/web3.js` v1, Privy embedded wallets, Phoenix Eternal REST API (`https://perp-api.phoenix.trade`), Helius RPC.

**Spec:** [docs/superpowers/specs/2026-05-14-gwak-perps-copy-design.md](../specs/2026-05-14-gwak-perps-copy-design.md)

**Scope:** Phase 1 only (wallet rail end-to-end). Phase 2 (AI rail with 7 LLM agents) and Phase 3 (on-chain indexer + legacy deletion) are separate plans.

**Verification model:** This codebase has no test runner by design (per CLAUDE.md: "Verification means `npm run typecheck && npm run lint` plus exercising the flow in the browser"). Each task verifies via typecheck + lint + targeted manual command. TDD micro-loops are replaced with implement + typecheck + curl/browser-confirm + commit.

---

## File map

**New files:**
- `lib/phoenix/types.ts` — TypeScript shapes for Phoenix REST responses.
- `lib/phoenix/client.ts` — REST client (read + tx-ix builders).
- `lib/phoenix/markets.ts` — markets cache + per-asset max-leverage lookup.
- `lib/phoenix/whales.ts` — hand-curated seed list of Phoenix authorities.
- `lib/phoenix/orders.ts` — order tx composition (open + close).
- `lib/signals/heat-phoenix-trader.ts` — heat scoring.
- `lib/signals/refresh-traders.ts` — combined wallet-rail signal refresh.
- `lib/bets/copy.ts` — open + close orchestration.
- `lib/bets/mirror-close.ts` — leader-position diff and fan-out.
- `lib/bets/post-and-confirm.ts` — simplified client helper (replaces post-with-consolidation).
- `app/api/cron/refresh-traders/route.ts`
- `app/api/cron/mirror-close/route.ts`
- `app/api/cron/expire-stale-copies/route.ts`
- `app/api/bet/copy/route.ts`
- `app/api/bet/copy/confirm/route.ts`
- `app/api/bet/copy/close/route.ts`
- `app/api/bet/copy/close/confirm/route.ts`
- `scripts/refresh-traders.ts`
- `components/feed/CopyCard.tsx`
- `components/portfolio/CopyRow.tsx`

**Modified files:**
- `lib/types.ts` — add `PhoenixTraderSignal` and extend `SignalType`/`Signal` unions.
- `lib/db/queries.ts` — filter `getFeedSignals` to phase-1 types only.
- `vercel.json` — replace legacy crons with new ones.
- `components/feed/FeedContainer.tsx` — route `phoenix_trader` signals to `CopyCard`.
- `app/portfolio/page.tsx` — render `CopyRow` for `type: 'copy'` bets.
- `.env.example` — add `FEATURE_LEGACY_RAILS`, `PHOENIX_REFERRAL_CODE` (optional).

**Files guarded behind `FEATURE_LEGACY_RAILS`:**
- `app/api/bet/meme/**`, `app/api/bet/prediction/**`, `app/api/bet/perp/**`
- `app/api/cron/refresh-memes/**`, `app/api/cron/refresh-predictions/**`, `app/api/cron/refresh-whales/**`

**Files deleted:** Deferred to the final cleanup task; see Task 27.

---

## Task 1: Add `FEATURE_LEGACY_RAILS` env flag plumbing

**Files:**
- Modify: `.env.example`
- Create: `lib/features.ts`

- [ ] **Step 1: Update `.env.example`**

Add to the end of `.env.example`:

```bash
# --- Phase 1 pivot ---
# When unset or "false", legacy rails (meme / prediction / perp) return 410
# on all routes and are hidden from the feed. Default off.
FEATURE_LEGACY_RAILS=false

# Phoenix Eternal referral code (optional in Phase 1; used when their tx
# builder accepts a referrer parameter). Leave blank if not yet onboarded.
PHOENIX_REFERRAL_CODE=
```

- [ ] **Step 2: Create `lib/features.ts`**

```ts
// Centralized feature flags. Server-only — do not import from client
// modules; surface flag state via API responses or via NEXT_PUBLIC_*
// vars instead.

export function legacyRailsEnabled(): boolean {
  return process.env.FEATURE_LEGACY_RAILS === "true";
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add .env.example lib/features.ts
git commit -m "feat(features): add FEATURE_LEGACY_RAILS env flag"
```

---

## Task 2: Extend `lib/types.ts` with `PhoenixTraderSignal`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add type definitions**

Replace the `SignalType` line at `lib/types.ts:8` and the `Signal` union at lines 81-85.

```ts
export type SignalType =
  | "meme"
  | "prediction"
  | "whale"
  | "multiprediction"
  | "phoenix_trader";

// ... existing per-rail Signal interfaces stay as-is ...

export interface PhoenixTraderPosition {
  market: string;            // e.g. "SOL", "BTC", "ETH"
  side: "long" | "short";
  leverage: number;
  notionalUsd: number;
  entryPrice: number;
  unrealizedPnlPct: number;  // signed %, e.g. 12.4 or -8.1
  positionPubkey: string;    // Phoenix position account address
}

export interface PhoenixTraderStats7d {
  trades: number;
  winRatePct: number;
  pnlUsd: number;            // signed
  avgHoldMinutes: number;
}

export interface PhoenixTraderSignal extends BaseSignal {
  type: "phoenix_trader";
  authority: string;          // base58 Solana pubkey of the trader
  position: PhoenixTraderPosition | null;
  stats7d: PhoenixTraderStats7d;
  label?: string;             // optional display name from seed list
}

export type Signal =
  | MemeSignal
  | PredictionSignal
  | WhaleSignal
  | MultiPredictionSignal
  | PhoenixTraderSignal;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors. The new union member is structurally compatible with `BaseSignal`.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add PhoenixTraderSignal to Signal union"
```

---

## Task 3: Create `lib/phoenix/types.ts`

**Files:**
- Create: `lib/phoenix/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// Phoenix Eternal REST API response shapes. Sourced from
// https://docs.phoenix.trade/api/* (specifically /trader/{authority}/state
// and /exchange/markets). Field names mirror the API exactly so we can
// cast responses without an intermediate mapper.

export interface PhoenixMarketInfo {
  symbol: string;            // "SOL", "BTC", "ETH", ...
  baseDecimals: number;
  quoteDecimals: number;
  minOrderSize: number;
  tickSize: number;
  maxLeverage: number;       // per the active tier (no positions = top tier)
}

export interface PhoenixOpenPosition {
  market: string;
  side: "long" | "short";
  baseAmount: number;        // signed, in base-asset units
  notionalUsd: number;
  entryPrice: number;
  liquidationPrice: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  leverage: number;
  positionPubkey: string;
  openedAtSlot: number;
}

export interface PhoenixTraderState {
  authority: string;
  collateralUsdc: number;
  effectiveCollateralUsdc: number;
  positions: PhoenixOpenPosition[];
  hasActiveTrader: boolean;  // false if account was never opened on Phoenix
  slot: number;
}

export interface PhoenixTradeRow {
  market: string;
  side: "long" | "short";
  baseAmount: number;
  priceUsd: number;
  feeUsd: number;
  realizedPnlUsd: number;
  filledAt: string;          // ISO8601
}

// Response shape for /v1/ix/place-isolated-market-order. The exact JSON
// keys are confirmed at implementation time by running the endpoint in
// dev; this type names the conceptual fields we know must be present.
export interface PhoenixIxResponse {
  instructions: Array<{
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;            // base64
  }>;
  addressLookupTables: string[]; // ALT account addresses (Phoenix uses them)
  computeUnitsEstimate?: number;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/phoenix/types.ts
git commit -m "feat(phoenix): add API response type shapes"
```

---

## Task 4: Create `lib/phoenix/client.ts` (read side)

**Files:**
- Create: `lib/phoenix/client.ts`

- [ ] **Step 1: Write the client**

```ts
import type {
  PhoenixIxResponse,
  PhoenixMarketInfo,
  PhoenixTradeRow,
  PhoenixTraderState,
} from "./types";

const BASE_URL =
  process.env.PHOENIX_API_BASE_URL ?? "https://perp-api.phoenix.trade";

// Phoenix's public endpoints don't require auth in Phase 1. Add an
// X-Phoenix-Referral header once we have a referral code; absence is
// safe.
function commonHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (process.env.PHOENIX_REFERRAL_CODE) {
    h["X-Phoenix-Referral"] = process.env.PHOENIX_REFERRAL_CODE;
  }
  return h;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: commonHeaders(),
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`Phoenix GET ${path} failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: commonHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Phoenix POST ${path} failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as T;
}

export async function getMarkets(): Promise<PhoenixMarketInfo[]> {
  return getJson<PhoenixMarketInfo[]>("/exchange/markets");
}

export async function getTraderState(
  authority: string,
): Promise<PhoenixTraderState> {
  return getJson<PhoenixTraderState>(`/trader/${authority}/state`);
}

export async function getTraderTradesHistory(
  authority: string,
  limit = 50,
): Promise<PhoenixTradeRow[]> {
  return getJson<PhoenixTradeRow[]>(
    `/trader/${authority}/trades-history?limit=${limit}`,
  );
}

// Builds instructions for an isolated market order. Used for both
// opening and closing positions (with reduce_only=true for close).
// Returns the unsigned instruction set; caller composes the v0 tx with
// Gas Wallet as fee payer.
export async function placeMarketOrderIx(params: {
  authority: string;          // user's Solana pubkey
  market: string;
  side: "long" | "short";
  marginUsdc: number;         // for opens; ignored when reduceOnly=true
  leverage: number;           // matches leader's leverage on open
  reduceOnly?: boolean;
  closePositionPubkey?: string; // for close, identifies which position
}): Promise<PhoenixIxResponse> {
  return postJson<PhoenixIxResponse>("/v1/ix/place-isolated-market-order", {
    authority: params.authority,
    market: params.market,
    side: params.side,
    margin_usdc: params.marginUsdc,
    leverage: params.leverage,
    reduce_only: params.reduceOnly ?? false,
    position_pubkey: params.closePositionPubkey,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Smoke-test against live Phoenix**

Run: `npx tsx --env-file=.env.local -e "import('./lib/phoenix/client.ts').then(m => m.getMarkets()).then(m => console.log('markets:', m.length, m.slice(0,3)))"`
Expected: prints "markets: 29" (or similar) and the first three market objects with shape matching `PhoenixMarketInfo`.

If the field names in the response do not match `PhoenixMarketInfo` exactly, adjust `lib/phoenix/types.ts` to match the live JSON keys before continuing. This is the one place we are confirming Phoenix's exact JSON shape.

- [ ] **Step 4: Commit**

```bash
git add lib/phoenix/client.ts
git commit -m "feat(phoenix): add REST client (read + ix builders)"
```

---

## Task 5: Create `lib/phoenix/markets.ts`

**Files:**
- Create: `lib/phoenix/markets.ts`

- [ ] **Step 1: Write the cache**

```ts
import type { PhoenixMarketInfo } from "./types";
import { getMarkets } from "./client";

// In-process cache. Markets list changes rarely (a new symbol is a
// rare event), so 1-hour TTL is fine. Lambda warm-start reuse keeps
// this populated across requests in a single instance.
const TTL_MS = 60 * 60 * 1000;

let _cache: { markets: PhoenixMarketInfo[]; expiresAt: number } | null = null;

export async function getMarketsCached(): Promise<PhoenixMarketInfo[]> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.markets;
  const fresh = await getMarkets();
  _cache = { markets: fresh, expiresAt: Date.now() + TTL_MS };
  return fresh;
}

export async function getMarketBySymbol(
  symbol: string,
): Promise<PhoenixMarketInfo | null> {
  const all = await getMarketsCached();
  return all.find((m) => m.symbol === symbol) ?? null;
}

// Returns the maximum leverage Phoenix permits on this market today.
// Heat-scoring + tap validation both use this to recognize "max-lev
// leader" trades versus conservative ones.
export async function getMaxLeverage(symbol: string): Promise<number> {
  const m = await getMarketBySymbol(symbol);
  if (!m) throw new Error(`Unknown Phoenix market: ${symbol}`);
  return m.maxLeverage;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/phoenix/markets.ts
git commit -m "feat(phoenix): add markets cache with per-asset max-lev lookup"
```

---

## Task 6: Create `lib/phoenix/whales.ts` (seed list)

**Files:**
- Create: `lib/phoenix/whales.ts`

- [ ] **Step 1: Write the seed module**

```ts
// Hand-curated seed list of Phoenix Eternal authorities to surface in
// the wallet rail during Phase 1. Replaced by the on-chain indexer
// in Phase 3 (which writes to a `phoenix_traders` table and is
// queried by the refresh cron instead of this file).
//
// Add wallets by appending to SEED_AUTHORITIES. The signal cron polls
// each in parallel every refresh tick. Empty array is acceptable —
// feed simply shows zero cards until at least one wallet is added.

export interface SeedWallet {
  authority: string;          // base58 Solana pubkey
  label?: string;             // optional display name (e.g. "@cryptohandle")
}

export const SEED_AUTHORITIES: SeedWallet[] = [
  // Populate from Phoenix UI / Discord / partnership. Examples:
  // { authority: "9XYZ...", label: "@maxlev_chad" },
];
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/phoenix/whales.ts
git commit -m "feat(phoenix): scaffold hand-curated seed authorities list"
```

---

## Task 7: Create `lib/signals/heat-phoenix-trader.ts`

**Files:**
- Create: `lib/signals/heat-phoenix-trader.ts`

- [ ] **Step 1: Write the heat scorer**

```ts
import type { PhoenixTraderState, PhoenixTradeRow } from "@/lib/phoenix/types";
import type { PhoenixMarketInfo } from "@/lib/phoenix/types";

interface ScoreInput {
  state: PhoenixTraderState;
  recentTrades: PhoenixTradeRow[];   // last ~50 fills
  markets: PhoenixMarketInfo[];      // for max-lev normalization
}

// Composite score in [0, 1000]. Higher = earlier in feed.
//
// Components:
//  has_open_position_now      0..400   binary, biggest single factor
//  recent_trade_count_norm    0..200   trades in last 7d / 50, capped at 1
//  leverage_max_ratio         0..200   leader's avg lev / market max lev
//  position_turnover_score    0..100   inverse of avg hold time
//  last_seen_recency          0..100   1 - (hours_since_last_trade / 168)
//
// The constants are deliberately not env-tuned in Phase 1; we will
// tune by hand once we have the indexer running and a real population
// of wallets to compare.
export function phoenixTraderHeatScore(input: ScoreInput): number {
  const { state, recentTrades, markets } = input;

  const hasOpen = state.positions.length > 0 ? 400 : 0;

  const trades7d = recentTrades.filter((t) => {
    const ageMs = Date.now() - new Date(t.filledAt).getTime();
    return ageMs <= 7 * 24 * 60 * 60 * 1000;
  });
  const tradeCountNorm = Math.min(1, trades7d.length / 50) * 200;

  let leverageRatio = 0;
  if (trades7d.length > 0) {
    // We don't have leverage on individual fills, so approximate from
    // the current open positions' leverage when present; otherwise 0.
    if (state.positions.length > 0) {
      const ratios = state.positions.map((p) => {
        const m = markets.find((mk) => mk.symbol === p.market);
        return m ? p.leverage / m.maxLeverage : 0;
      });
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      leverageRatio = Math.min(1, avg) * 200;
    }
  }

  let turnover = 0;
  if (trades7d.length >= 2) {
    // Sort ascending, compute gaps between consecutive fills as a
    // crude proxy for hold time per position. Lower = more turnover.
    const sorted = [...trades7d].sort(
      (a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime(),
    );
    let gapSum = 0;
    for (let i = 1; i < sorted.length; i++) {
      gapSum +=
        new Date(sorted[i].filledAt).getTime() -
        new Date(sorted[i - 1].filledAt).getTime();
    }
    const avgGapMinutes = gapSum / (sorted.length - 1) / 1000 / 60;
    turnover = Math.max(0, Math.min(1, 1 - avgGapMinutes / (60 * 24))) * 100;
  }

  let recency = 0;
  if (trades7d.length > 0) {
    const lastFilledAt = Math.max(
      ...trades7d.map((t) => new Date(t.filledAt).getTime()),
    );
    const hoursSince = (Date.now() - lastFilledAt) / 1000 / 60 / 60;
    recency = Math.max(0, Math.min(1, 1 - hoursSince / 168)) * 100;
  }

  return Math.round(hasOpen + tradeCountNorm + leverageRatio + turnover + recency);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/signals/heat-phoenix-trader.ts
git commit -m "feat(signals): add heat-phoenix-trader scoring fn"
```

---

## Task 8: Create `lib/signals/refresh-traders.ts`

**Files:**
- Create: `lib/signals/refresh-traders.ts`

- [ ] **Step 1: Write the refresh function**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { SEED_AUTHORITIES } from "@/lib/phoenix/whales";
import { getTraderState, getTraderTradesHistory } from "@/lib/phoenix/client";
import { getMarketsCached } from "@/lib/phoenix/markets";
import { phoenixTraderHeatScore } from "@/lib/signals/heat-phoenix-trader";
import type { PhoenixTraderSignal, SignalChipData } from "@/lib/types";

const SIGNAL_TYPE = "phoenix_trader";

interface RefreshResult {
  attempted: number;
  written: number;
  errors: Array<{ authority: string; message: string }>;
}

function buildChips(signal: Omit<PhoenixTraderSignal, "chips">): SignalChipData[] {
  const chips: SignalChipData[] = [];
  if (signal.position) {
    chips.push({
      text: `${signal.position.market} ${signal.position.side.toUpperCase()} ${Math.round(signal.position.leverage)}x`,
      level: signal.position.side === "long" ? "green" : "purple",
    });
    const pnl = signal.position.unrealizedPnlPct;
    chips.push({
      text: `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`,
      level: pnl >= 0 ? "green" : "purple",
    });
  } else {
    chips.push({ text: "Watching", level: "amber" });
  }
  return chips;
}

export async function refreshTraders(): Promise<RefreshResult> {
  const markets = await getMarketsCached();
  const result: RefreshResult = { attempted: 0, written: 0, errors: [] };

  // Build signals in parallel; one slow wallet should not stall the rest.
  const rows = await Promise.all(
    SEED_AUTHORITIES.map(async (seed) => {
      result.attempted++;
      try {
        const [state, trades] = await Promise.all([
          getTraderState(seed.authority),
          getTraderTradesHistory(seed.authority, 50),
        ]);
        if (!state.hasActiveTrader) return null;

        const heatScore = phoenixTraderHeatScore({
          state,
          recentTrades: trades,
          markets,
        });

        // Surface only the first position in Phase 1; multi-position
        // surfacing is a Phase 2 frontend concern.
        const firstPos = state.positions[0] ?? null;
        const wins = trades.filter((t) => t.realizedPnlUsd > 0).length;
        const totalPnl = trades.reduce((s, t) => s + t.realizedPnlUsd, 0);
        const closedTrades = trades.filter((t) => t.realizedPnlUsd !== 0);
        const winRatePct =
          closedTrades.length > 0
            ? (wins / closedTrades.length) * 100
            : 0;

        const partial: Omit<PhoenixTraderSignal, "chips"> = {
          id: `${SIGNAL_TYPE}:${seed.authority}`,
          type: "phoenix_trader",
          heatScore,
          createdAt: new Date().toISOString(),
          authority: seed.authority,
          label: seed.label,
          position: firstPos
            ? {
                market: firstPos.market,
                side: firstPos.side,
                leverage: firstPos.leverage,
                notionalUsd: firstPos.notionalUsd,
                entryPrice: firstPos.entryPrice,
                unrealizedPnlPct: firstPos.unrealizedPnlPct,
                positionPubkey: firstPos.positionPubkey,
              }
            : null,
          stats7d: {
            trades: trades.length,
            winRatePct,
            pnlUsd: totalPnl,
            avgHoldMinutes: 0, // populated in Phase 3 when indexer has it
          },
        };

        const signal: PhoenixTraderSignal = {
          ...partial,
          chips: buildChips(partial),
        };

        return {
          id: signal.id,
          type: SIGNAL_TYPE,
          assetId: signal.position?.market ?? "watching",
          heatScore,
          payload: signal,
        };
      } catch (err) {
        result.errors.push({
          authority: seed.authority,
          message: String(err),
        });
        return null;
      }
    }),
  );

  const valid = rows.filter((r): r is NonNullable<typeof r> => r !== null);

  // Delete-then-insert pattern matches the existing refresh-* crons.
  await db.transaction(async (tx) => {
    await tx.delete(signals).where(eq(signals.type, SIGNAL_TYPE));
    if (valid.length > 0) {
      await tx.insert(signals).values(valid);
    }
  });

  result.written = valid.length;
  return result;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/signals/refresh-traders.ts
git commit -m "feat(signals): add refreshTraders pipeline"
```

---

## Task 9: Create `app/api/cron/refresh-traders/route.ts`

**Files:**
- Create: `app/api/cron/refresh-traders/route.ts`

- [ ] **Step 1: Write the route**

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

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/refresh-traders/route.ts
git commit -m "feat(cron): add refresh-traders cron route"
```

---

## Task 10: Create `scripts/refresh-traders.ts` for local testing

**Files:**
- Create: `scripts/refresh-traders.ts`
- Modify: `package.json` (add `refresh:traders` script)

- [ ] **Step 1: Write the script**

```ts
// Local invocation: `npm run refresh:traders`. Same code path as the
// cron route but runs in your shell against your .env.local.

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

- [ ] **Step 2: Add npm script**

Edit `package.json` and add to the `scripts` block (alphabetize alongside `refresh:memes`, `refresh:predictions`, `refresh:whales`):

```json
"refresh:traders": "tsx --env-file=.env.local --tsconfig tsconfig.json -r tsconfig-paths/register scripts/refresh-traders.ts"
```

Confirm by reading the existing `refresh:memes` script in `package.json` and matching the same invocation pattern.

- [ ] **Step 3: Verify**

Run: `npm run refresh:traders`
Expected: prints `[refresh-traders] { "attempted": 0, "written": 0, "errors": [] }` because `SEED_AUTHORITIES` is empty. No DB error (delete-then-insert on empty set is a no-op delete).

- [ ] **Step 4: Commit**

```bash
git add scripts/refresh-traders.ts package.json
git commit -m "feat(scripts): add refresh:traders local runner"
```

---

## Task 11: Update `vercel.json` crons

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Replace cron list**

Replace the entire `crons` array. Old crons stay reachable as routes (gated by `FEATURE_LEGACY_RAILS` in later tasks) but are not scheduled. `mirror-close` and `expire-stale-copies` cron routes are created in Tasks 17 and 18; including them here now is fine — Vercel ignores 404 paths.

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

- [ ] **Step 2: Verify**

Run: `npx vercel dev --listen 3001 &` (or whatever is already wired) to confirm the schema parses; or simply `cat vercel.json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"`.
Expected: no parse error.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(cron): swap legacy refresh crons for Phase-1 trader/mirror crons"
```

---

## Task 12: Guard legacy bet routes with `FEATURE_LEGACY_RAILS`

**Files:**
- Modify: `app/api/bet/meme/route.ts`, `app/api/bet/meme/confirm/route.ts`, `app/api/bet/meme/close/route.ts`, `app/api/bet/meme/close/confirm/route.ts`
- Modify: `app/api/bet/prediction/route.ts`, `app/api/bet/prediction/confirm/route.ts`, `app/api/bet/prediction/close/route.ts`, `app/api/bet/prediction/close/confirm/route.ts`
- Modify: `app/api/bet/perp/route.ts`, `app/api/bet/perp/confirm/route.ts`, `app/api/bet/perp/close/route.ts`, `app/api/bet/perp/close/confirm/route.ts`
- Modify: `app/api/cron/refresh-memes/route.ts`, `app/api/cron/refresh-predictions/route.ts`, `app/api/cron/refresh-whales/route.ts`

- [ ] **Step 1: Add the guard at the top of each `POST` (or `GET` for crons)**

For every file above, immediately after the auth check (or at the start of `GET` for crons), insert this block:

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

Put the import next to the other route imports. The guard runs **before** any other work in the handler.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Confirm guard fires**

Run dev: `npm run dev`. In another shell:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/bet/meme \
  -H "Authorization: Bearer dummy" -H "Content-Type: application/json" -d '{}'
```
Expected: `410`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/refresh-memes \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `410`.

- [ ] **Step 4: Commit**

```bash
git add app/api/bet app/api/cron
git commit -m "feat(legacy): gate meme/prediction/perp routes behind FEATURE_LEGACY_RAILS"
```

---

## Task 13: Filter legacy signal types out of the feed

**Files:**
- Modify: `lib/db/queries.ts`

- [ ] **Step 1: Replace `getFeedSignals`**

```ts
import { desc, inArray } from "drizzle-orm";
import { db } from "./index";
import { signals } from "./schema";
import type { Signal, SignalType } from "@/lib/types";
import { legacyRailsEnabled } from "@/lib/features";

const PHASE_1_TYPES: SignalType[] = ["phoenix_trader"];
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
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/db/queries.ts
git commit -m "feat(feed): restrict getFeedSignals to phase-1 signal types"
```

---

## Task 14: Create `lib/bets/post-and-confirm.ts`

**Files:**
- Create: `lib/bets/post-and-confirm.ts`

- [ ] **Step 1: Write the helper**

```ts
import { Connection, SendTransactionError } from "@solana/web3.js";
import bs58 from "bs58";
import type { useSignTransaction } from "@privy-io/react-auth/solana";
import type { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export function decodeBase64Tx(b64: unknown, label: string): Uint8Array {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error(
      `${label}: expected base64 string, got ${typeof b64} (${
        typeof b64 === "string" ? "empty" : String(b64).slice(0, 40)
      })`,
    );
  }
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch (err) {
    throw new Error(
      `${label}: base64 decode failed (len=${b64.length}, head="${b64.slice(0, 40)}…"): ${String(err)}`,
    );
  }
}

export async function signAndSubmitTx(
  txBytes: Uint8Array,
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>,
  signTransaction: ReturnType<typeof useSignTransaction>["signTransaction"],
  opts: { skipPreflight?: boolean } = {},
): Promise<string> {
  if (!wallet) throw new Error("Wallet not ready");
  const result = (await signTransaction({
    transaction: txBytes,
    wallet,
  })) as { signedTransaction: Uint8Array };
  const conn = new Connection(RPC_URL, "confirmed");
  try {
    return await conn.sendRawTransaction(result.signedTransaction, {
      skipPreflight: opts.skipPreflight ?? false,
      maxRetries: 3,
    });
  } catch (err) {
    if (err instanceof SendTransactionError) {
      const logs = await err.getLogs(conn).catch(() => null);
      console.error("[copy] sim logs:", logs);
    }
    throw err;
  }
}

export function bs58Encode(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

// Posts to a server route that returns `{ phase: "open", betId,
// openTransaction }` and stops there. No consolidation, no prefund —
// Phoenix copies are USDC-margined and the server's Gas Wallet
// already pays SOL fees, so the user signs exactly one tx.
export async function postBetAndConfirm(
  url: string,
  body: unknown,
  token: string,
): Promise<{ betId: string; openTransaction: string; [k: string]: unknown }> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.error ?? `HTTP ${r.status}`);
  }
  const data = (await r.json()) as Record<string, unknown>;
  if (data.phase !== "open") {
    throw new Error(`unexpected phase: ${String(data.phase)}`);
  }
  return data as { betId: string; openTransaction: string };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/bets/post-and-confirm.ts
git commit -m "feat(bets): add simplified post-and-confirm helper"
```

---

## Task 15: Create `lib/phoenix/orders.ts` (tx composition)

**Files:**
- Create: `lib/phoenix/orders.ts`

- [ ] **Step 1: Write the composer**

```ts
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection } from "@/lib/solana/balance";
import { placeMarketOrderIx } from "./client";
import {
  getGasWalletPubkey,
  partialSignAsFeePayer,
} from "@/lib/wallets/gas";

interface ComposeResult {
  // Base64-encoded v0 tx, already partial-signed by Gas Wallet.
  // Client adds the user signature via Privy.
  transactionB64: string;
  positionMarket: string;
  positionSide: "long" | "short";
  positionLeverage: number;
}

function rebuildIx(
  raw: {
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;
  },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(raw.data, "base64"),
  });
}

async function resolveAlts(
  conn: ReturnType<typeof getConnection>,
  altAddresses: string[],
): Promise<AddressLookupTableAccount[]> {
  if (altAddresses.length === 0) return [];
  const fetched = await Promise.all(
    altAddresses.map(async (addr) => {
      const r = await conn.getAddressLookupTable(new PublicKey(addr));
      return r.value;
    }),
  );
  return fetched.filter((a): a is AddressLookupTableAccount => a !== null);
}

export async function buildOpenCopyTx(params: {
  userPubkey: PublicKey;
  market: string;
  side: "long" | "short";
  marginUsdc: number;
  leverage: number;
}): Promise<ComposeResult> {
  const ixResp = await placeMarketOrderIx({
    authority: params.userPubkey.toBase58(),
    market: params.market,
    side: params.side,
    marginUsdc: params.marginUsdc,
    leverage: params.leverage,
    reduceOnly: false,
  });

  const ixs = ixResp.instructions.map(rebuildIx);
  const conn = getConnection();
  const alts = await resolveAlts(conn, ixResp.addressLookupTables);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const msg = new TransactionMessage({
    payerKey: getGasWalletPubkey(),
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(alts);

  const tx = new VersionedTransaction(msg);
  partialSignAsFeePayer(tx);

  return {
    transactionB64: Buffer.from(tx.serialize()).toString("base64"),
    positionMarket: params.market,
    positionSide: params.side,
    positionLeverage: params.leverage,
  };
}

export async function buildCloseCopyTx(params: {
  userPubkey: PublicKey;
  market: string;
  // The side of the position being closed — we submit the opposite as
  // reduce_only=true.
  positionSide: "long" | "short";
  positionPubkey: string;
}): Promise<{ transactionB64: string }> {
  const ixResp = await placeMarketOrderIx({
    authority: params.userPubkey.toBase58(),
    market: params.market,
    side: params.positionSide === "long" ? "short" : "long",
    marginUsdc: 0,
    leverage: 1,           // ignored by Phoenix when reduce_only=true
    reduceOnly: true,
    closePositionPubkey: params.positionPubkey,
  });

  const ixs = ixResp.instructions.map(rebuildIx);
  const conn = getConnection();
  const alts = await resolveAlts(conn, ixResp.addressLookupTables);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const msg = new TransactionMessage({
    payerKey: getGasWalletPubkey(),
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(alts);

  const tx = new VersionedTransaction(msg);
  partialSignAsFeePayer(tx);

  return { transactionB64: Buffer.from(tx.serialize()).toString("base64") };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/phoenix/orders.ts
git commit -m "feat(phoenix): compose open/close copy txs with Gas Wallet fee payer"
```

---

## Task 16: Create `app/api/bet/copy/route.ts` (open)

**Files:**
- Create: `app/api/bet/copy/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buildOpenCopyTx } from "@/lib/phoenix/orders";
import { getTraderState } from "@/lib/phoenix/client";
import { getMaxLeverage } from "@/lib/phoenix/markets";
import {
  ensureGasWalletReady,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

interface OpenBody {
  leaderAuthority?: string;
  market?: string;
  side?: "long" | "short";
  leverage?: number;
  stakeUsdc?: number;
  walletAddress?: string;
  signalId?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as OpenBody | null;
  if (
    !body?.leaderAuthority ||
    !body.market ||
    (body.side !== "long" && body.side !== "short") ||
    typeof body.leverage !== "number" ||
    typeof body.stakeUsdc !== "number"
  ) {
    return NextResponse.json(
      {
        error:
          "leaderAuthority, market, side (long|short), leverage, stakeUsdc required",
      },
      { status: 400 },
    );
  }

  if (body.stakeUsdc < MIN_USDC || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const maxLev = await getMaxLeverage(body.market).catch(() => null);
  if (maxLev === null) {
    return NextResponse.json(
      { error: `unknown Phoenix market: ${body.market}` },
      { status: 400 },
    );
  }
  // Clamp leader's leverage to Phoenix's per-asset max — Phoenix would
  // reject anyway, surface the cleaner error here.
  const userLeverage = Math.min(body.leverage, maxLev);

  // Re-verify the leader still has the matching position open. Snapshot-
  // copy guarantees we copy the live position, not a stale signal.
  const leaderState = await getTraderState(body.leaderAuthority).catch(
    () => null,
  );
  const leaderPos = leaderState?.positions.find(
    (p) => p.market === body.market && p.side === body.side,
  );
  if (!leaderPos) {
    return NextResponse.json(
      { error: "leader no longer has this position open" },
      { status: 409 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  let tx;
  try {
    tx = await buildOpenCopyTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      market: body.market,
      side: body.side,
      marginUsdc: body.stakeUsdc,
      leverage: userLeverage,
    });
  } catch (err) {
    console.error("[bet/copy] build failed:", err);
    return NextResponse.json(
      { error: `Phoenix tx build failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "copy",
      signalId: body.signalId ?? null,
      amountUsdc: body.stakeUsdc,
      status: "pending",
      meta: {
        leaderAuthority: body.leaderAuthority,
        leaderPositionPubkey: leaderPos.positionPubkey,
        market: body.market,
        side: body.side,
        leverage: userLeverage,
        leaderEntryPrice: leaderPos.entryPrice,
        leaderUnrealizedPnlPctAtTap: leaderPos.unrealizedPnlPct,
        userPositionPubkey: null,
        leaderRailType: "phoenix_trader",
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    openTransaction: tx.transactionB64,
    market: tx.positionMarket,
    side: tx.positionSide,
    leverage: tx.positionLeverage,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/bet/copy/route.ts
git commit -m "feat(bet/copy): add open route"
```

---

## Task 17: Create `app/api/bet/copy/confirm/route.ts`

**Files:**
- Create: `app/api/bet/copy/confirm/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getTraderState } from "@/lib/phoenix/client";
import { PublicKey } from "@solana/web3.js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface ConfirmBody {
  betId?: string;
  txSignature?: string;
  failed?: boolean;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ConfirmBody | null;
  if (!body?.betId || (!body.failed && !body.txSignature)) {
    return NextResponse.json(
      { error: "betId and txSignature (or failed:true) required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) {
    return NextResponse.json({ error: "bet not found" }, { status: 404 });
  }
  if (bet.status !== "pending") {
    return NextResponse.json({ ok: true, status: bet.status });
  }

  if (body.failed) {
    await db
      .update(bets)
      .set({ status: "failed" })
      .where(eq(bets.id, bet.id));
    return NextResponse.json({ ok: true, status: "failed" });
  }

  // Read on-chain trader state to capture the new userPositionPubkey
  // before flipping confirmed. If Phoenix hasn't indexed the position
  // yet, fall back to confirmed-without-pubkey; the mirror-close
  // worker will discover the pubkey on its next sweep.
  let userPositionPubkey: string | null = null;
  try {
    if (user.solanaPubkey) {
      const state = await getTraderState(user.solanaPubkey);
      const meta = bet.meta as { market: string; side: "long" | "short" };
      const match = state.positions.find(
        (p) => p.market === meta.market && p.side === meta.side,
      );
      userPositionPubkey = match?.positionPubkey ?? null;
    }
  } catch (err) {
    console.warn("[bet/copy/confirm] could not read trader state:", err);
  }

  const oldMeta = (bet.meta as Record<string, unknown>) ?? {};
  await db
    .update(bets)
    .set({
      status: "confirmed",
      txHash: body.txSignature ?? null,
      meta: { ...oldMeta, userPositionPubkey },
    })
    .where(eq(bets.id, bet.id));

  return NextResponse.json({ ok: true, status: "confirmed" });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/bet/copy/confirm/route.ts
git commit -m "feat(bet/copy): add confirm route"
```

---

## Task 18: Create `app/api/bet/copy/close/route.ts`

**Files:**
- Create: `app/api/bet/copy/close/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buildCloseCopyTx } from "@/lib/phoenix/orders";
import {
  ensureGasWalletReady,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface CloseBody {
  betId?: string;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CloseBody | null;
  if (!body?.betId) {
    return NextResponse.json({ error: "betId required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) {
    return NextResponse.json({ error: "bet not found" }, { status: 404 });
  }
  if (bet.status !== "confirmed") {
    return NextResponse.json(
      { error: `cannot close bet with status ${bet.status}` },
      { status: 409 },
    );
  }

  const meta = bet.meta as {
    market: string;
    side: "long" | "short";
    userPositionPubkey: string | null;
  };
  if (!meta.userPositionPubkey) {
    return NextResponse.json(
      { error: "user position pubkey not yet indexed; retry shortly" },
      { status: 503 },
    );
  }

  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  let tx;
  try {
    tx = await buildCloseCopyTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      market: meta.market,
      positionSide: meta.side,
      positionPubkey: meta.userPositionPubkey,
    });
  } catch (err) {
    console.error("[bet/copy/close] build failed:", err);
    return NextResponse.json(
      { error: `Phoenix close tx build failed: ${String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    betId: bet.id,
    closeTransaction: tx.transactionB64,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/bet/copy/close/route.ts
git commit -m "feat(bet/copy): add close route"
```

---

## Task 19: Create `app/api/bet/copy/close/confirm/route.ts`

**Files:**
- Create: `app/api/bet/copy/close/confirm/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getTraderState } from "@/lib/phoenix/client";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface ConfirmCloseBody {
  betId?: string;
  txSignature?: string;
  failed?: boolean;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ConfirmCloseBody | null;
  if (!body?.betId || (!body.failed && !body.txSignature)) {
    return NextResponse.json(
      { error: "betId and txSignature (or failed:true) required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) {
    return NextResponse.json({ error: "bet not found" }, { status: 404 });
  }
  if (bet.status === "closed") {
    return NextResponse.json({ ok: true, status: "closed" });
  }

  if (body.failed) {
    // We do not flip the bet to a terminal state on a single failed
    // close — mirror-close will retry next sweep. Just log.
    console.warn("[bet/copy/close/confirm] reported failed close:", bet.id);
    return NextResponse.json({ ok: true, status: bet.status });
  }

  // Read the trader state to capture realized PnL for the closed
  // position. Phoenix surfaces realized PnL in trades-history; for
  // Phase 1 we approximate proceeds = initial stake + realized delta
  // from on-chain state at this moment (collateral - prior collateral
  // is the cleanest single-tx delta). If we can't compute, store null
  // and a follow-up indexer reconciles later.
  let proceedsUsdc: number | null = null;
  try {
    if (user.solanaPubkey) {
      const state = await getTraderState(user.solanaPubkey);
      // Best-effort proceeds = current effective collateral (no other
      // positions) minus stake already deducted. In Phase 1 we are
      // willing to be imprecise; reconcile in Phase 3.
      const meta = bet.meta as { market: string };
      const stillOpen = state.positions.find((p) => p.market === meta.market);
      if (!stillOpen) {
        // Position is gone — assume full close. Without per-trade
        // accounting, leave proceeds null and let the indexer fix it.
      }
      void state;
    }
  } catch (err) {
    console.warn("[bet/copy/close/confirm] state read failed:", err);
  }

  await db
    .update(bets)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeTxHash: body.txSignature ?? null,
      proceedsUsdc,
    })
    .where(eq(bets.id, bet.id));

  return NextResponse.json({ ok: true, status: "closed" });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/bet/copy/close/confirm/route.ts
git commit -m "feat(bet/copy): add close-confirm route"
```

---

## Task 20: Create `lib/bets/mirror-close.ts`

**Files:**
- Create: `lib/bets/mirror-close.ts`

**Phase 1 scope:** This worker **detects** that a leader has closed a position and **tags** every follower bet with `leaderClosedAt`, surfacing a "leader exited" CTA in `/portfolio`. It does **not** auto-submit close txs in Phase 1 — Phoenix's close tx requires the user's signature, and we don't have server-side delegated signing wired yet (Phase 2 work). The user closes manually from `/portfolio`, or the 24h fallback in Task 22 ages the bet out.

- [ ] **Step 1: Write the worker**

```ts
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { getTraderState } from "@/lib/phoenix/client";

interface MirrorResult {
  scannedLeaders: number;
  leaderClosesDetected: number;
  errors: Array<{ betId: string; message: string }>;
}

interface BetMeta {
  leaderAuthority: string;
  leaderPositionPubkey: string;
  market: string;
  side: "long" | "short";
  userPositionPubkey: string | null;
  leaderClosedAt?: string;
  leaderRailType?: string;
}

// One sweep:
//   1. SELECT every confirmed copy bet that doesn't already have a
//      leaderClosedAt tag.
//   2. Group by leaderAuthority (one Phoenix REST call per leader, not
//      per follower).
//   3. For each leader, fetch their current Phoenix state.
//   4. For each follower bet, if the leader's matching position is
//      gone, write `leaderClosedAt` into bet.meta.
export async function runMirrorCloseSweep(): Promise<MirrorResult> {
  const result: MirrorResult = {
    scannedLeaders: 0,
    leaderClosesDetected: 0,
    errors: [],
  };

  const openBets = await db
    .select({
      id: bets.id,
      userId: bets.userId,
      meta: bets.meta,
      userSolanaPubkey: users.solanaPubkey,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    .where(
      and(
        eq(bets.type, "copy"),
        eq(bets.status, "confirmed"),
        isNotNull(bets.meta),
      ),
    );

  if (openBets.length === 0) return result;

  // Skip bets already tagged — don't waste a Phoenix call.
  const untagged = openBets.filter((b) => {
    const m = b.meta as BetMeta | null;
    return m && !m.leaderClosedAt;
  });

  const byLeader = new Map<string, typeof untagged>();
  for (const row of untagged) {
    const meta = row.meta as BetMeta;
    const list = byLeader.get(meta.leaderAuthority) ?? [];
    list.push(row);
    byLeader.set(meta.leaderAuthority, list);
  }

  for (const [leaderAuthority, followerBets] of byLeader.entries()) {
    result.scannedLeaders++;
    let leaderState;
    try {
      leaderState = await getTraderState(leaderAuthority);
    } catch (err) {
      for (const b of followerBets) {
        result.errors.push({ betId: b.id, message: `leader state: ${err}` });
      }
      continue;
    }

    for (const bet of followerBets) {
      const meta = bet.meta as BetMeta;
      const stillOpen = leaderState.positions.find(
        (p) =>
          p.market === meta.market &&
          p.side === meta.side &&
          p.positionPubkey === meta.leaderPositionPubkey,
      );
      if (stillOpen) continue;

      console.log(
        `[mirror-close] leader ${leaderAuthority} closed ${meta.market}/${meta.side}; tagging follower bet ${bet.id}`,
      );
      try {
        await db
          .update(bets)
          .set({
            meta: { ...meta, leaderClosedAt: new Date().toISOString() },
          })
          .where(eq(bets.id, bet.id));
        result.leaderClosesDetected++;
      } catch (err) {
        result.errors.push({ betId: bet.id, message: String(err) });
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/bets/mirror-close.ts
git commit -m "feat(bets): add mirror-close detector (tags leader closes; Phase 1)"
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/bets/mirror-close.ts
git commit -m "feat(bets): add mirror-close worker (detect-only in Phase 1)"
```

---

## Task 21: Create `app/api/cron/mirror-close/route.ts`

**Files:**
- Create: `app/api/cron/mirror-close/route.ts`

- [ ] **Step 1: Write the route**

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

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/mirror-close/route.ts
git commit -m "feat(cron): add mirror-close sweep route"
```

---

## Task 22: Create `app/api/cron/expire-stale-copies/route.ts`

**Files:**
- Create: `app/api/cron/expire-stale-copies/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { checkCronAuth } from "@/lib/auth/cron";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 24h hard-close fallback. The first user-tap copy is at time T;
// if neither leader-close nor manual close has fired by T+24h, we
// flip the bet to status="expired" so it stops appearing in the
// /portfolio open list. We do NOT submit a Phoenix close here in
// Phase 1 (no server-side user signer); the position remains open
// on chain until the user manually closes it from /portfolio. The
// expire status is a UX hint that the bet aged out of the snapshot
// window, not a chain action.
export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth) return auth;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const expired = await db
    .update(bets)
    .set({ status: "expired" })
    .where(
      and(
        eq(bets.type, "copy"),
        eq(bets.status, "confirmed"),
        lt(bets.createdAt, cutoff),
      ),
    )
    .returning({ id: bets.id });
  return NextResponse.json({ ok: true, expired: expired.length });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/expire-stale-copies/route.ts
git commit -m "feat(cron): add 24h expire-stale-copies fallback"
```

---

## Task 23: Create `components/feed/CopyCard.tsx`

**Files:**
- Create: `components/feed/CopyCard.tsx`

- [ ] **Step 1: Read existing card for style parity**

Read `components/feed/WhaleCard.tsx` (entire file) to mirror its structure: client component, prop types, stake-button row, card layout.

- [ ] **Step 2: Write `CopyCard.tsx`**

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  decodeBase64Tx,
  postBetAndConfirm,
  signAndSubmitTx,
} from "@/lib/bets/post-and-confirm";
import type { PhoenixTraderSignal, StakeAmount } from "@/lib/types";

const STAKES: StakeAmount[] = [5, 10, 20, 50];

interface Props {
  signal: PhoenixTraderSignal;
  isActive: boolean;
}

export function CopyCard({ signal, isActive }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState<StakeAmount | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pos = signal.position;

  const truncated = useMemo(
    () => `${signal.authority.slice(0, 4)}…${signal.authority.slice(-4)}`,
    [signal.authority],
  );

  const onTap = useCallback(
    async (stake: StakeAmount) => {
      if (!pos || busy) return;
      setBusy(stake);
      setStatus("Building tx…");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");
        const open = await postBetAndConfirm(
          "/api/bet/copy",
          {
            leaderAuthority: signal.authority,
            market: pos.market,
            side: pos.side,
            leverage: pos.leverage,
            stakeUsdc: stake,
            walletAddress: wallet?.address,
            signalId: signal.id,
          },
          token,
        );
        setStatus("Sign in wallet…");
        const txBytes = decodeBase64Tx(open.openTransaction, "open tx");
        const sig = await signAndSubmitTx(txBytes, wallet, signTransaction);
        setStatus("Confirming…");
        await fetch("/api/bet/copy/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            betId: open.betId,
            txSignature: sig,
            walletAddress: wallet?.address,
          }),
        });
        setStatus("Opened ✓");
      } catch (err) {
        console.error("[copy] tap failed:", err);
        setStatus(`Failed: ${String(err).slice(0, 80)}`);
      } finally {
        setBusy(null);
        setTimeout(() => setStatus(null), 4000);
      }
    },
    [busy, getAccessToken, pos, signal.authority, signal.id, signTransaction, wallet],
  );

  return (
    <div
      className="flex h-full w-full flex-col justify-between p-6 text-white"
      data-card-type="phoenix_trader"
    >
      <div>
        <div className="text-xs uppercase tracking-widest text-white/60">
          Phoenix Trader
        </div>
        <div className="mt-1 text-2xl font-bold">
          {signal.label ?? truncated}
        </div>
        <a
          href={`https://solscan.io/account/${signal.authority}`}
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
            <span
              className={
                pos.unrealizedPnlPct >= 0 ? "text-green-400" : "text-rose-400"
              }
            >
              {pos.unrealizedPnlPct >= 0 ? "+" : ""}
              {pos.unrealizedPnlPct.toFixed(1)}%
            </span>
          </div>
          <div className="text-xs text-white/50">
            7d: {signal.stats7d.trades} trades,{" "}
            {signal.stats7d.winRatePct.toFixed(0)}% wins
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

      {status && (
        <div className="mt-2 text-center text-xs text-white/70">{status}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add components/feed/CopyCard.tsx
git commit -m "feat(feed): add CopyCard for phoenix_trader signals"
```

---

## Task 24: Route `phoenix_trader` signals in `FeedContainer`

**Files:**
- Modify: `components/feed/FeedContainer.tsx`

- [ ] **Step 1: Add CopyCard to renderer**

Locate the rail-card switch in `FeedContainer.tsx` (search for `WhaleCard` to find it — the file maps `signal.type` to a per-rail component). Add:

```tsx
import { CopyCard } from "./CopyCard";

// ... inside the per-signal render switch ...
{signal.type === "phoenix_trader" && (
  <CopyCard signal={signal} isActive={isActive} />
)}
```

Also update `buildAllowedTypes`:

```ts
function buildAllowedTypes(prefs: FeedPrefs): Set<SignalType> {
  const allowed = new Set<SignalType>();
  allowed.add("phoenix_trader");        // always on in Phase 1
  if (prefs.meme) allowed.add("meme");
  if (prefs.prediction) {
    allowed.add("prediction");
    allowed.add("multiprediction");
  }
  if (prefs.whale) allowed.add("whale");
  return allowed;
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add components/feed/FeedContainer.tsx
git commit -m "feat(feed): render CopyCard for phoenix_trader signals"
```

---

## Task 25: Create `components/portfolio/CopyRow.tsx` and wire into `/portfolio`

**Files:**
- Create: `components/portfolio/CopyRow.tsx`
- Modify: `app/portfolio/page.tsx`

- [ ] **Step 1: Read existing portfolio for parity**

Read `components/portfolio/PositionRow.tsx` (or whichever component currently renders perp bets) and `app/portfolio/page.tsx` to understand the data shape returned by `/api/portfolio` and the row layout.

- [ ] **Step 2: Write `CopyRow.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  decodeBase64Tx,
  signAndSubmitTx,
} from "@/lib/bets/post-and-confirm";

export interface CopyRowData {
  betId: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  stakeUsdc: number;
  leaderAuthority: string;
  leaderLabel?: string;
  unrealizedPnlPct: number | null;
  leaderClosedAt: string | null;    // set by mirror-close worker when leader exits
}

interface Props {
  row: CopyRowData;
  onClosed: (betId: string) => void;
}

export function CopyRow({ row, onClosed }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onClose = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Building close…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const r = await fetch("/api/bet/copy/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          betId: row.betId,
          walletAddress: wallet?.address,
        }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${r.status}`);
      }
      const { closeTransaction } = (await r.json()) as {
        closeTransaction: string;
      };
      setStatus("Sign in wallet…");
      const txBytes = decodeBase64Tx(closeTransaction, "close tx");
      const sig = await signAndSubmitTx(txBytes, wallet, signTransaction);
      setStatus("Confirming…");
      await fetch("/api/bet/copy/close/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          betId: row.betId,
          txSignature: sig,
          walletAddress: wallet?.address,
        }),
      });
      setStatus("Closed");
      onClosed(row.betId);
    } catch (err) {
      console.error("[copy close]", err);
      setStatus(`Failed: ${String(err).slice(0, 80)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  }, [busy, getAccessToken, onClosed, row.betId, signTransaction, wallet]);

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/5 p-4">
      <div>
        <div className="text-sm font-semibold">
          {row.market} {row.side.toUpperCase()} {Math.round(row.leverage)}x
        </div>
        <div className="text-xs text-white/60">
          Stake ${row.stakeUsdc} · Copying {row.leaderLabel ?? `${row.leaderAuthority.slice(0, 4)}…${row.leaderAuthority.slice(-4)}`}
        </div>
        {row.leaderClosedAt && (
          <div className="mt-1 text-xs text-amber-300">
            Leader exited. Close yours to settle.
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {row.unrealizedPnlPct !== null && (
          <div
            className={
              row.unrealizedPnlPct >= 0 ? "text-green-400" : "text-rose-400"
            }
          >
            {row.unrealizedPnlPct >= 0 ? "+" : ""}
            {row.unrealizedPnlPct.toFixed(1)}%
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
      {status && (
        <div className="ml-3 text-xs text-white/70">{status}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Modify `/api/portfolio/route.ts` to include `type:'copy'` bets**

Read `app/api/portfolio/route.ts` first. The route currently aggregates perp/meme/prediction bets; extend it so `type: 'copy'` bets are included with these computed fields per row: `{ betId, market, side, leverage, stakeUsdc, leaderAuthority, leaderLabel, unrealizedPnlPct, leaderClosedAt }`.

The `unrealizedPnlPct` is computed by calling `getTraderState(user.solanaPubkey)` (in `lib/phoenix/client.ts`) once per response and matching positions by market/side. `leaderClosedAt` reads from `bet.meta.leaderClosedAt` set by the mirror-close worker in Task 20.

Add this block to the aggregator (alongside the existing per-type aggregators):

```ts
import { getTraderState } from "@/lib/phoenix/client";

// ... inside the GET handler, after fetching the user's bets ...

const copyBets = userBets.filter((b) => b.type === "copy");
let userState = null;
if (copyBets.length > 0 && user.solanaPubkey) {
  userState = await getTraderState(user.solanaPubkey).catch(() => null);
}
const copyRows = copyBets.map((b) => {
  const meta = b.meta as {
    market: string;
    side: "long" | "short";
    leverage: number;
    leaderAuthority: string;
    leaderLabel?: string;
    leaderClosedAt?: string;
  };
  const livePos = userState?.positions.find(
    (p) => p.market === meta.market && p.side === meta.side,
  );
  return {
    betId: b.id,
    market: meta.market,
    side: meta.side,
    leverage: meta.leverage,
    stakeUsdc: b.amountUsdc,
    leaderAuthority: meta.leaderAuthority,
    leaderLabel: meta.leaderLabel,
    unrealizedPnlPct: livePos?.unrealizedPnlPct ?? null,
    leaderClosedAt: meta.leaderClosedAt ?? null,
  };
});

// Add `copyRows` to the route response object.
```

- [ ] **Step 4: Modify `app/portfolio/page.tsx`**

Read the existing page to understand how it fetches and renders portfolio data, then layer in a "Copies" section. The exact JSX depends on the existing layout, but the pattern is:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { CopyRow, type CopyRowData } from "@/components/portfolio/CopyRow";

interface PortfolioResponse {
  copyRows: CopyRowData[];
  // ...existing fields stay
}

// Inside the page component, alongside existing portfolio fetching:
const [copyRows, setCopyRows] = useState<CopyRowData[]>([]);

const refetch = useCallback(async () => {
  const token = await getAccessToken();
  if (!token) return;
  const r = await fetch("/api/portfolio", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return;
  const data = (await r.json()) as PortfolioResponse;
  setCopyRows(data.copyRows ?? []);
  // ...also update other portfolio sections as the existing code does
}, [getAccessToken]);

useEffect(() => { refetch(); }, [refetch]);

const onClosed = useCallback(() => { refetch(); }, [refetch]);

// In JSX, add this section (place above or below the existing
// "Perp Positions" / "Open Bets" sections):
{copyRows.length > 0 && (
  <section className="space-y-2">
    <h2 className="text-lg font-semibold text-white/80">Copies</h2>
    {copyRows.map((row) => (
      <CopyRow key={row.betId} row={row} onClosed={onClosed} />
    ))}
  </section>
)}
```

Drop into the existing page so it lives alongside the existing sections. Do not rewrite the existing portfolio logic — only add.

- [ ] **Step 5: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio/CopyRow.tsx app/portfolio/page.tsx app/api/portfolio/route.ts
git commit -m "feat(portfolio): render CopyRow for copy bets with live PnL"
```

---

## Task 26: End-to-end smoke test

**Files:** (no code changes, validation only)

- [ ] **Step 1: Populate seed list with one real Phoenix authority**

Mine one active high-lev Phoenix wallet from their UI (or use a known test wallet). Add it to `lib/phoenix/whales.ts`:

```ts
export const SEED_AUTHORITIES: SeedWallet[] = [
  { authority: "REPLACE_WITH_REAL_PHOENIX_AUTHORITY", label: "@testdegen" },
];
```

Commit:

```bash
git add lib/phoenix/whales.ts
git commit -m "feat(phoenix): seed first authority for smoke testing"
```

- [ ] **Step 2: Run refresh-traders locally**

Run: `npm run refresh:traders`
Expected: `attempted: 1, written: 1, errors: []`. If `written: 0`, inspect `errors[0].message`.

- [ ] **Step 3: Start dev and verify feed**

Run: `npm run dev`. Open `http://localhost:3000/feed` (after login). Expected: at least one card with the seeded authority appears in the feed. The card shows the trader's current position or "Watching…".

- [ ] **Step 4: Tap a stake button**

Pre-fund a test user's Privy wallet with ~$60 USDC. Tap a `$5` stake on a card with an open position. Watch:
- Wallet sign prompt appears.
- Sign in wallet (simulated or real).
- Card shows "Confirming…" then "Opened ✓".
- `/portfolio` page now shows a CopyRow for the trade.

Verify in DB:

```bash
npm run db:studio
```

In the `bets` table, find the new row: `type='copy'`, `status='confirmed'`, `tx_hash` set, `meta` has `userPositionPubkey`.

- [ ] **Step 5: Manually close from /portfolio**

Tap "Close" on the CopyRow. Sign the close tx. Verify `bets.status='closed'`, `closeTxHash` set.

- [ ] **Step 6: Verify mirror-close cron**

Run: `curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/mirror-close | jq`
Expected: `{ ok: true, scannedLeaders: N, leaderClosesDetected: M, errors: [] }`.

- [ ] **Step 7: Verify expire-stale-copies**

Run: `curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-stale-copies | jq`
Expected: `{ ok: true, expired: 0 }` (no bets are 24h old yet).

- [ ] **Step 8: Verify legacy rails are gone from feed**

Run: `curl -s "http://localhost:3000/api/feed?limit=50" | jq '.signals | map(.type) | unique'`
Expected: `["phoenix_trader"]` (no legacy types since FEATURE_LEGACY_RAILS=false).

- [ ] **Step 9: Commit smoke results (if anything fixed in this task)**

If any step required code fixes, commit them with a clear message scoped to what was fixed.

---

## Task 27: Delete dead plumbing files

**Files:**
- Delete: `lib/usd/consolidate.ts`
- Delete: `lib/jupiter/swap.ts`, `lib/jupiter/constants.ts`
- Delete: `lib/jupiter-prediction/client.ts`
- Delete: `lib/flash-trade/client.ts`, `lib/flash-trade/perp.ts`
- Delete: `lib/dexscreener/client.ts`
- Delete: `lib/hyperliquid/client.ts`, `lib/hyperliquid/whales.ts`
- Delete: `lib/drift/*` (entire directory)
- Delete: `lib/bets/post-with-consolidation.ts`
- Delete: `lib/signals/refresh-memes.ts`, `lib/signals/refresh-predictions.ts`, `lib/signals/refresh-whales.ts`
- Delete: `lib/signals/heat-meme.ts`, `lib/signals/heat-prediction.ts`, `lib/signals/heat-whale.ts`
- Delete: `scripts/refresh-memes.ts`, `scripts/refresh-predictions.ts`, `scripts/refresh-whales.ts`
- Delete: `lib/fees/calc.ts` (if it has no callers after Task 12 flag-guarding)
- Delete: `lib/wallets/treasury.ts` callers — keep treasury.ts (referral payouts still go there) but remove the per-tx fee-transfer ix builder if it's a separate file.

- [ ] **Step 1: Confirm nothing imports the files to be deleted**

Run (replace patterns as you go):

```bash
rg "from \"@/lib/usd/consolidate\"" -l
rg "from \"@/lib/jupiter/" -l
rg "from \"@/lib/jupiter-prediction/" -l
rg "from \"@/lib/flash-trade/" -l
rg "from \"@/lib/dexscreener/" -l
rg "from \"@/lib/hyperliquid/" -l
rg "from \"@/lib/drift/" -l
rg "from \"@/lib/bets/post-with-consolidation\"" -l
rg "from \"@/lib/fees/calc\"" -l
```

Each command should print **only** legacy route files (already 410-guarded in Task 12) — those routes will be deleted in a later phase (Phase 3 per the spec). If any *non-legacy* file imports a path slated for deletion, fix the importer first before continuing.

Expected: `app/api/bet/{meme,prediction,perp}/**` routes still import these. That is OK in Phase 1 (they are 410-guarded and never execute their bodies). They get deleted in Phase 3.

- [ ] **Step 2: Decide and execute deletion order**

Because legacy routes still import the legacy plumbing, we **cannot delete these files in Phase 1** without also deleting the legacy routes. Two options:

- **Option A (recommended):** keep the dead plumbing in place for Phase 1. The flag-guard at Task 12 prevents execution; the imports are inert. Phase 3's "delete legacy routes" task will delete everything together.
- **Option B:** delete legacy routes + plumbing now. Risks losing the rollback safety the flag is supposed to provide.

Phase 1 chooses **Option A** to preserve rollback safety. **No files are deleted in Phase 1.**

Skip Steps 3-4 below.

- [ ] **Step 3: (skipped under Option A)**
- [ ] **Step 4: (skipped under Option A)**

- [ ] **Step 5: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: passes (everything still compiles).

- [ ] **Step 6: Commit a no-op note (or skip entirely)**

If you made any code changes during the import audit, commit them. Otherwise no commit needed.

---

## Task 28: Final verification + smoke deploy

**Files:** (no code changes)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: builds clean, no warnings about missing exports or unused modules.

- [ ] **Step 4: Drizzle schema verification**

Run: `npm run db:push`
Expected: "No changes detected" — the schema migration was unnecessary in Phase 1 (`signals.type` and `bets.type` are `text` columns, new values insert without DDL).

- [ ] **Step 5: Vercel preview deploy and verify**

Push the branch to remote and open the Vercel preview URL:

```bash
git push -u origin perps-ai-wallets
```

Wait for the preview deploy. Set `FEATURE_LEGACY_RAILS=false`, `CRON_SECRET`, `PHOENIX_REFERRAL_CODE` (optional), `NEXT_PUBLIC_HELIUS_RPC_URL`, `GAS_WALLET_PRIVATE_KEY` in the preview environment.

Verify on the preview URL:
1. Feed loads and shows `phoenix_trader` cards (or empty state if seed list is empty).
2. Tapping a card with an open position triggers a wallet sign prompt.
3. After a successful tap, `/portfolio` shows the CopyRow.
4. The Vercel "Crons" dashboard shows the 3 new crons (refresh-traders, mirror-close, expire-stale-copies) running successfully.

- [ ] **Step 6: Final commit + PR**

If any preview-deploy issue required code fixes, commit them. Open a PR from `perps-ai-wallets` to `main`:

```bash
gh pr create --title "Phase 1: perps-only copy-trading pivot" --body "$(cat <<'EOF'
## Summary
- Pivot meme/prediction/perp rails behind FEATURE_LEGACY_RAILS flag (off by default).
- Ship Phase 1 of the perps-only copy-trading product on Phoenix Eternal.
- Wallet rail: hand-curated seed list of Phoenix authorities, refreshed every 2 min, surfaced as CopyCards.
- Tap flow: $5/$10/$20/$50 stake opens a matching market order on Phoenix; Gas Wallet pays SOL fees.
- Mirror-close detects leader exit each minute and tags the user bet; user closes manually from /portfolio.
- 24h expire fallback flips stale bets to "expired" (chain position remains until manual close).

## Test plan
- [ ] Seed at least one real Phoenix authority in lib/phoenix/whales.ts.
- [ ] `npm run refresh:traders` reports written>0 and no errors.
- [ ] Feed at /feed renders at least one card.
- [ ] Tap $5 on a card with open position, sign, observe /portfolio CopyRow appears.
- [ ] Manual close from /portfolio settles the bet to status=closed.
- [ ] mirror-close cron returns ok:true.
- [ ] expire-stale-copies cron returns ok:true.

Spec: docs/superpowers/specs/2026-05-14-gwak-perps-copy-design.md
Plan: docs/superpowers/plans/2026-05-14-gwak-perps-phase-1.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## What's NOT in Phase 1 (deferred to later plans)

- **AI rail (7 LLM strategy wallets + persona grid):** Phase 2 plan.
- **On-chain Phoenix indexer + `phoenix_traders` table:** Phase 3 plan.
- **Legacy file deletion:** Phase 3 plan (Option A in Task 27 preserves rollback).
- **Server-side delegated signing for auto-mirror-close:** Phase 2 plan (Phase 1 detects + tags + relies on manual / 24h expire).
- **X auto-posting per persona, PnL share cards, leaderboards, referral rev-share:** Phase 4 spec (separate brainstorm).
