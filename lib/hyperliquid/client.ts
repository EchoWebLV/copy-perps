const BASE = "https://api.hyperliquid.xyz/info";

// Hyperliquid's public REST endpoint rate-limits aggressively and occasionally
// hangs. Bare fetches with no timeout/retry are how curated whales "lose
// connection": one stalled or 429'd request drops that whale from the refresh
// tick, and with nothing retrying, its live positions age out of the cache.
// hlPost gives every whale-refresh call a bounded timeout plus retry/backoff on
// 429, 5xx, network errors, and timeouts.
const HL_REQUEST_TIMEOUT_MS = 8_000;
const HL_MAX_ATTEMPTS = 3; // 1 initial + 2 retries

function hlDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hlBackoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(250, seconds * 1000);
    }
  }
  return 500 * Math.pow(2, attempt); // 500ms, 1s
}

function isRetryableHlStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Hyperliquid rate-limits the info API per IP. Concurrent callers (the whale
// refresh fans out at concurrency N, each with retries) otherwise burst past the
// limit and trigger a self-amplifying 429 storm — measured: a 6-wide burst 429s
// 100% of calls, while ~1 req every 400ms succeeds. Every hlPost reserves a slot
// on a shared timeline so all info calls are staggered by at least this gap,
// regardless of caller concurrency. Tunable via env without a code change.
const HL_MIN_REQUEST_GAP_MS = (() => {
  const v = Number(process.env.HL_MIN_REQUEST_GAP_MS);
  return Number.isFinite(v) && v >= 0 ? v : 400;
})();

let hlNextSlotMs = 0;

// Pure slot math (exported for tests): given the current time and the last
// reserved slot, return this request's slot and the new tail of the timeline.
export function reservePaceSlot(
  nowMs: number,
  nextSlotMs: number,
  gapMs: number,
): { slotMs: number; nextSlotMs: number } {
  const slotMs = Math.max(nowMs, nextSlotMs);
  return { slotMs, nextSlotMs: slotMs + gapMs };
}

async function hlPace(): Promise<void> {
  if (HL_MIN_REQUEST_GAP_MS <= 0) return;
  const now = Date.now();
  const { slotMs, nextSlotMs } = reservePaceSlot(
    now,
    hlNextSlotMs,
    HL_MIN_REQUEST_GAP_MS,
  );
  hlNextSlotMs = nextSlotMs;
  if (slotMs > now) await hlDelay(slotMs - now);
}

async function hlPost<T>(
  body: unknown,
  label: string,
  attempt = 0,
): Promise<T> {
  await hlPace();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HL_REQUEST_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    // Network failure or our own timeout abort — retry with backoff.
    if (attempt < HL_MAX_ATTEMPTS - 1) {
      await hlDelay(hlBackoffMs(attempt, null));
      return hlPost<T>(body, label, attempt + 1);
    }
    throw new Error(
      `Hyperliquid ${label} request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (isRetryableHlStatus(r.status) && attempt < HL_MAX_ATTEMPTS - 1) {
    await hlDelay(hlBackoffMs(attempt, r.headers.get("retry-after")));
    return hlPost<T>(body, label, attempt + 1);
  }

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Hyperliquid ${label} ${r.status}: ${txt}`);
  }
  return (await r.json()) as T;
}

export interface HLPosition {
  coin: string;
  szi: string; // signed; negative = short
  leverage: { type: string; value: number };
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  cumFunding?: {
    allTime: string;
    sinceOpen: string;
    sinceChange: string;
  };
}

export interface HLAssetPosition {
  type: string;
  position: HLPosition;
}

export interface HLClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary?: HLClearinghouseState["marginSummary"];
  assetPositions: HLAssetPosition[];
  withdrawable: string;
  time: number;
}

export async function getClearinghouseState(
  user: string,
): Promise<HLClearinghouseState> {
  return hlPost<HLClearinghouseState>(
    { type: "clearinghouseState", user },
    "clearinghouseState",
  );
}

export interface HLPortfolioWindow {
  accountValueHistory: Array<[number, string]>;
  pnlHistory: Array<[number, string]>;
  vlm: string;
}

export type HLPortfolio = Array<[string, HLPortfolioWindow]>;

export async function getPortfolio(user: string): Promise<HLPortfolio> {
  return hlPost<HLPortfolio>({ type: "portfolio", user }, "portfolio");
}

export async function getAllMids(): Promise<Record<string, string>> {
  return hlPost<Record<string, string>>({ type: "allMids" }, "allMids");
}

// Hyperliquid fill direction strings. "Long > Short" (and vice-versa) are
// flips — the fill closes the prior direction AND opens the opposite.
export type HLFillDir =
  | "Open Long"
  | "Open Short"
  | "Close Long"
  | "Close Short"
  | "Long > Short"
  | "Short > Long"
  | "Liquidated Long"
  | "Liquidated Short";

export interface HLFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  dir: HLFillDir | string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
}

export async function getUserFillsByTime(
  user: string,
  startTimeMs: number,
): Promise<HLFill[]> {
  return hlPost<HLFill[]>(
    { type: "userFillsByTime", user, startTime: startTimeMs },
    "userFillsByTime",
  );
}

// ---------------------------------------------------------------------------
// Public leaderboard — whale discovery
// ---------------------------------------------------------------------------
//
// Hyperliquid's leaderboard lives on a separate stats host, NOT the info API
// (the info endpoint 422s on a "leaderboard" type). It returns EVERY trader —
// the full payload is ~30 MB — so callers must filter it down and cache the
// result hard rather than re-pulling it on every refresh tick. The shape is a
// list of rows, each with windowed (day/week/month/allTime) pnl/roi/vlm.
const HL_LEADERBOARD_URL =
  "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
// The leaderboard payload is large; give it a longer ceiling than the info
// calls so a slow-but-healthy download isn't aborted as a timeout.
const HL_LEADERBOARD_TIMEOUT_MS = 20_000;

export type HLLeaderboardWindow = "day" | "week" | "month" | "allTime";

export interface HLLeaderboardWindowStats {
  pnl: string;
  roi: string;
  vlm: string;
}

export interface HLLeaderboardRow {
  ethAddress: string;
  accountValue: string;
  windowPerformances: Array<
    [HLLeaderboardWindow | string, HLLeaderboardWindowStats]
  >;
  prize?: number;
  displayName?: string | null;
}

export interface HLLeaderboard {
  leaderboardRows: HLLeaderboardRow[];
}

export async function getLeaderboard(attempt = 0): Promise<HLLeaderboard> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    HL_LEADERBOARD_TIMEOUT_MS,
  );
  let r: Response;
  try {
    r = await fetch(HL_LEADERBOARD_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (attempt < HL_MAX_ATTEMPTS - 1) {
      await hlDelay(hlBackoffMs(attempt, null));
      return getLeaderboard(attempt + 1);
    }
    throw new Error(
      `Hyperliquid leaderboard request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (isRetryableHlStatus(r.status) && attempt < HL_MAX_ATTEMPTS - 1) {
    await hlDelay(hlBackoffMs(attempt, r.headers.get("retry-after")));
    return getLeaderboard(attempt + 1);
  }

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Hyperliquid leaderboard ${r.status}: ${txt}`);
  }
  return (await r.json()) as HLLeaderboard;
}

// ---------------------------------------------------------------------------
// Liquidation buffer — Phase 1 REST polling
// ---------------------------------------------------------------------------
//
// PROBE FINDINGS (2026-05-14):
//   - HL REST has NO global liquidation stream. Types "liquidations",
//     "allLiquidations", "recentLiquidations" all return 422.
//   - "recentTrades" (requires `coin` param) returns the last ~10 trades per
//     coin with fields [coin, side, px, sz, time, hash, tid, users] — NO
//     `liquidation` field. The `liquidation` sub-object only appears in the
//     WebSocket "trades" channel, not REST.
//   - Zero-hash trades in recentTrades are NOT a reliable liquidation proxy
//     (HL uses zero-hash for internal matching, not only liquidations).
//   - "userFillsByTime" per-user fills DO use dir="Liquidated Long" /
//     "Liquidated Short" for the liquidated account. This is the only REST
//     signal available.
//
// APPROACH: poll each curated whale wallet's userFillsByTime every 5 s and
// collect fills where dir starts with "Liquidated". Because these are curated
// directional traders (not HFT/MM), a liquidation fill for them is a
// meaningful signal for Liquidation Lizard.
//
// Phase 2: upgrade to WS subscription to the "trades" channel for a true
// global liquidation stream once the resolver runs in a long-lived process.
//
import type { LiquidationEvent, WhaleOpenEvent } from "@/lib/bots/types";
import { CURATED_WHALES } from "@/lib/hyperliquid/whales";

let _buffer: LiquidationEvent[] = [];
let _lastFetchMs = 0;
const POLL_INTERVAL_MS = 5_000;
const BUFFER_RETENTION_MS = 120_000;

/**
 * Returns recent Hyperliquid liquidations (last ~2 minutes) for Liquidation
 * Lizard's strategy. Polls each curated whale wallet via REST every 5 s,
 * collecting fills where dir is "Liquidated Long" or "Liquidated Short".
 *
 * Phase 1 uses REST polling because Vercel serverless cannot hold a
 * persistent WS. Phase 2 should upgrade to WS subscription on the "trades"
 * channel once the resolver runs in a long-lived process — that channel
 * includes a `liquidation` sub-object for all market liquidations, not just
 * curated whales.
 *
 * If no curated whale was liquidated in the last 2 minutes the buffer is
 * empty and Liquidation Lizard will sit idle — that's acceptable for Phase 1.
 */
export async function getRecentLiquidations(): Promise<LiquidationEvent[]> {
  const now = Date.now();
  if (now - _lastFetchMs <= POLL_INTERVAL_MS) {
    return _buffer.slice();
  }
  _lastFetchMs = now;

  const startTime = now - BUFFER_RETENTION_MS;
  const seen = new Set(_buffer.map((e) => `${e.asset}:${e.ts}`));

  await Promise.allSettled(
    CURATED_WHALES.map(async ({ address }) => {
      try {
        const r = await fetch(BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "userFillsByTime", user: address, startTime }),
          cache: "no-store",
        });
        if (!r.ok) {
          console.error(`[HL] userFillsByTime ${address} → ${r.status}`);
          return;
        }
        const fills = (await r.json()) as HLFill[];
        for (const f of fills) {
          if (!f.dir || !f.dir.startsWith("Liquidated")) continue;
          const key = `${f.coin}:${f.time}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // "Liquidated Long" → a long was force-closed → side is "long"
          // "Liquidated Short" → a short was force-closed → side is "short"
          const side: "long" | "short" = f.dir === "Liquidated Long" ? "long" : "short";
          const notionalUsd = Number(f.px) * Number(f.sz);
          _buffer.push({
            asset: f.coin,
            side,
            notionalUsd,
            ts: f.time,
            source: "hyperliquid",
          });
        }
      } catch (err) {
        console.error(`[HL] fetch error for ${address}:`, err);
      }
    }),
  );

  // Drop entries older than the retention window
  _buffer = _buffer.filter((e) => e.ts >= now - BUFFER_RETENTION_MS);
  return _buffer.slice();
}

// ---------------------------------------------------------------------------
// Whale-opens buffer — same source as liquidations, different filter
// ---------------------------------------------------------------------------
//
// Polls each curated whale wallet's userFillsByTime and collects fills where
// dir is "Open Long" or "Open Short" (excluding closes, flips, and liqs).
// Buffer retention is wider (5 min) than the liq buffer (2 min) so a slow
// resolver tick still catches a 30s-old whale entry. Used by Whale Shadow:
// when a tracked wallet opens a position ≥ $500k notional, the bot mirrors
// the direction.
//
// Why curated, not market-wide: HL has no public REST stream of all opens,
// and the curated list filters out HFT/MM bots so a "whale opened" is a
// real directional signal, not algo noise.

let _openBuffer: WhaleOpenEvent[] = [];
let _openLastFetchMs = 0;
const OPEN_POLL_INTERVAL_MS = 5_000;
const OPEN_BUFFER_RETENTION_MS = 5 * 60 * 1000;

export async function getRecentWhaleOpens(): Promise<WhaleOpenEvent[]> {
  const now = Date.now();
  if (now - _openLastFetchMs <= OPEN_POLL_INTERVAL_MS) {
    return _openBuffer.slice();
  }
  _openLastFetchMs = now;

  const startTime = now - OPEN_BUFFER_RETENTION_MS;
  const seen = new Set(
    _openBuffer.map((e) => `${e.whaleAddress}:${e.asset}:${e.ts}`),
  );

  await Promise.allSettled(
    CURATED_WHALES.map(async ({ address }) => {
      try {
        const r = await fetch(BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "userFillsByTime", user: address, startTime }),
          cache: "no-store",
        });
        if (!r.ok) return;
        const fills = (await r.json()) as HLFill[];
        for (const f of fills) {
          if (f.dir !== "Open Long" && f.dir !== "Open Short") continue;
          const key = `${address}:${f.coin}:${f.time}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const side: "long" | "short" =
            f.dir === "Open Long" ? "long" : "short";
          const px = Number(f.px);
          const sz = Number(f.sz);
          if (!Number.isFinite(px) || !Number.isFinite(sz) || sz <= 0) continue;
          _openBuffer.push({
            asset: f.coin,
            side,
            notionalUsd: px * sz,
            px,
            ts: f.time,
            whaleAddress: address,
            source: "hyperliquid",
          });
        }
      } catch {
        // swallow — one whale failing shouldn't poison the buffer
      }
    }),
  );

  _openBuffer = _openBuffer.filter(
    (e) => e.ts >= now - OPEN_BUFFER_RETENTION_MS,
  );
  return _openBuffer.slice();
}
