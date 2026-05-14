const BASE = "https://api.hyperliquid.xyz/info";

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
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user }),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Hyperliquid clearinghouseState ${r.status}: ${txt}`);
  }
  return (await r.json()) as HLClearinghouseState;
}

export async function getAllMids(): Promise<Record<string, string>> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Hyperliquid allMids ${r.status}`);
  return (await r.json()) as Record<string, string>;
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
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "userFillsByTime",
      user,
      startTime: startTimeMs,
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Hyperliquid userFillsByTime ${r.status}: ${txt}`);
  }
  return (await r.json()) as HLFill[];
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
import type { LiquidationEvent } from "@/lib/bots/types";
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
