import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import {
  getClearinghouseState,
  getUserFillsByTime,
  type HLFill,
} from "@/lib/hyperliquid/client";
import { CURATED_WHALES, truncateEthAddress } from "@/lib/hyperliquid/whales";
import { whaleHeatScore, whaleSignalChips } from "./heat-whale";
import { flashSymbolFor } from "@/lib/flash-trade/client";
import type { WhaleSignal } from "@/lib/types";

const MIN_POSITION_USD = 25_000;
const MIN_LEVERAGE = 1.5;
const TOP_PER_WHALE = 5;
const FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// Concurrency 2 for the cron path is gentler on HL's per-second guard
// than higher values. Refresh runs every 2 min — total runtime budget is
// ~60s per the route's maxDuration — so fast doesn't matter, *reliable*
// does. Pair with the retry helper below to ride out short 429 bursts.
const CONCURRENCY = 2;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      // Only retry on rate-limit. Other errors (network, server) are
      // not worth burning the time budget on.
      if (!msg.includes("429")) break;
      if (attempt < RETRY_ATTEMPTS - 1) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export interface RefreshWhalesResult {
  fetched: number;
  inserted: number;
  errors: number;
  durationMs: number;
}

async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function fillOpensSide(dir: string, side: "long" | "short"): boolean {
  if (side === "long") return dir === "Open Long" || dir === "Short > Long";
  return dir === "Open Short" || dir === "Long > Short";
}

export async function refreshWhales(): Promise<RefreshWhalesResult> {
  const startMs = Date.now();
  const windowStart = startMs - FRESH_WINDOW_MS;
  const stamp = new Date(startMs);
  let errors = 0;

  // Pass 1 — fills per wallet (which whales moved in the last 30 days).
  const fillsByWallet = await mapLimit(
    CURATED_WHALES,
    CONCURRENCY,
    async (whale) => {
      try {
        const fills = await withRetry("fills", () =>
          getUserFillsByTime(whale.address, windowStart),
        );
        const opens = fills.filter((f) =>
          /^(Open |Long > Short|Short > Long)/.test(String(f.dir)),
        );
        return { whale, opens };
      } catch (e) {
        errors++;
        console.warn("[refresh-whales fills]", whale.address, e);
        return { whale, opens: [] as HLFill[] };
      }
    },
  );
  const active = fillsByWallet.filter((r) => r.opens.length > 0);

  // Pass 2 — state for wallets that moved, then cross-reference open
  // fills with currently-open positions to find each position's openedAt.
  type Row = typeof signals.$inferInsert;
  const newRows: Row[] = [];

  await mapLimit(active, CONCURRENCY, async ({ whale, opens }) => {
    try {
      const state = await withRetry("state", () =>
        getClearinghouseState(whale.address),
      );
      const accVal = parseFloat(state.marginSummary.accountValue);
      if (accVal <= 0) return;

      const positions = state.assetPositions
        .map((ap) => ap.position)
        .filter(
          (p) =>
            flashSymbolFor(p.coin) !== null &&
            parseFloat(p.positionValue) >= MIN_POSITION_USD &&
            (p.leverage?.value ?? 0) >= MIN_LEVERAGE,
        );

      const fresh: {
        position: (typeof positions)[number];
        openedAt: number;
        scaledIn: boolean;
      }[] = [];
      for (const position of positions) {
        const sz = parseFloat(position.szi);
        const side: "long" | "short" = sz >= 0 ? "long" : "short";
        const candidates = opens
          .filter(
            (f) =>
              f.coin === position.coin &&
              fillOpensSide(String(f.dir), side),
          )
          .sort((a, b) => b.time - a.time);
        if (candidates.length === 0) continue;

        const latest = candidates[0];
        const startPos = parseFloat(latest.startPosition);
        const scaledIn =
          (side === "long" && startPos > 0) ||
          (side === "short" && startPos < 0);
        fresh.push({ position, openedAt: latest.time, scaledIn });
      }

      fresh.sort((a, b) => b.openedAt - a.openedAt);
      const top = fresh.slice(0, TOP_PER_WHALE);

      for (const { position, openedAt, scaledIn } of top) {
        const sz = parseFloat(position.szi);
        const side: "long" | "short" = sz >= 0 ? "long" : "short";
        const sizeUsd = parseFloat(position.positionValue);
        const entry = parseFloat(position.entryPx);
        const liquidation = position.liquidationPx
          ? parseFloat(position.liquidationPx)
          : 0;
        const score = whaleHeatScore(position, accVal, openedAt);
        const id = `whale:${whale.address.toLowerCase()}:${position.coin}`;

        const payload: WhaleSignal = {
          id,
          type: "whale",
          heatScore: score,
          createdAt: stamp.toISOString(),
          chips: whaleSignalChips(position, accVal, openedAt),
          walletAddress: whale.label ?? truncateEthAddress(whale.address),
          walletAccountValue: accVal,
          asset: position.coin,
          side,
          leverage: position.leverage?.value ?? 1,
          size: sizeUsd,
          entry,
          liquidation,
          openedAt: new Date(openedAt).toISOString(),
          scaledIn,
          venue: "Hyperliquid",
        };

        newRows.push({
          id,
          type: "whale",
          assetId: position.coin,
          heatScore: score,
          payload,
          createdAt: stamp,
        });
      }
    } catch (e) {
      errors++;
      console.warn("[refresh-whales state]", whale.address, e);
    }
  });

  // Atomic-ish swap: clear stale whale rows then insert the new top set.
  // Done sequentially because the table only holds the current top — old
  // rows aren't useful and removing them keeps queries fast.
  await db.delete(signals).where(eq(signals.type, "whale"));
  if (newRows.length > 0) {
    await db.insert(signals).values(newRows);
  }

  return {
    fetched: CURATED_WHALES.length,
    inserted: newRows.length,
    errors,
    durationMs: Date.now() - startMs,
  };
}
