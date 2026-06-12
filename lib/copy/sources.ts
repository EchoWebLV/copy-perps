// lib/copy/sources.ts
//
// Target position fetchers for the copy engine. The mappers are pure and
// unit-tested; the fetchers are thin RPC wrappers wired in by
// buildCopyEngineDeps(). Fetch errors must propagate — the engine treats a
// failed fetch as "unknown", never as "flat" (closing copies because an
// RPC blipped would be a money bug).

import { Connection, PublicKey } from "@solana/web3.js";
import { decodeBot, type ArenaBot } from "@/lib/arena/decode";
import { botPda } from "@/lib/arena/personas";
import type { FlashPositionSummary } from "@/lib/flash/perps";
import type { WhalePositionRecord, WhaleSource } from "@/lib/whales/types";
import {
  isFlashCopyableMarket,
  normalizeFlashMarket,
  type FlashMarketSymbol,
} from "@/lib/flash/markets";
import type { CopyTargetRef, SourcePosition } from "./types";

/** Arena market id → Flash market symbol. Every arena market so far trades
 *  the SOL feed (crank-deps FEEDS maps 0 and 1 to SOL/USD); extend alongside
 *  any BTC/ETH market init. */
const ARENA_MARKET_SYMBOLS: Record<number, FlashMarketSymbol> = {
  0: "SOL",
  1: "SOL",
};

const MAX_BOT_POSITION_SLOTS = 4; // MAX_POSITIONS in the on-chain layout

// ───────────────────────────── pure mappers ────────────────────────────────

export function arenaBotSourcePositions(
  persona: string,
  bot: ArenaBot,
): SourcePosition[] {
  const out: SourcePosition[] = [];
  for (const pos of bot.positions.slice(0, MAX_BOT_POSITION_SLOTS)) {
    if (!pos.active) continue;
    const market = ARENA_MARKET_SYMBOLS[pos.marketId];
    if (!market) continue;
    out.push({
      key: `arena:${persona}:${pos.openedTsMs}`,
      market,
      side: pos.side,
      entryPriceUsd: pos.entryPrice > 0 ? pos.entryPrice : null,
      leverage: pos.leverage > 0 ? pos.leverage : null,
      openedTsMs: pos.openedTsMs,
      sourceMarkUsd: null, // bots price off the same oracle getMark uses
    });
  }
  return out;
}

export function flashWalletSourcePositions(
  wallet: string,
  positions: FlashPositionSummary[],
): SourcePosition[] {
  const out: SourcePosition[] = [];
  for (const pos of positions) {
    if (!isFlashCopyableMarket(pos.symbol)) continue;
    const derivedLeverage =
      pos.leverage ??
      (pos.collateralUsd > 0 && pos.sizeUsd > 0
        ? pos.sizeUsd / pos.collateralUsd
        : null);
    out.push({
      // openTime stays OUT of the key on purpose: Flash merges per
      // owner+market+side and bumps openTime on adds — keying on it would
      // read every scale-in as close+reopen and churn followers' fees.
      key: `flash:${wallet}:${pos.symbol}:${pos.side}`,
      market: pos.symbol,
      side: pos.side,
      entryPriceUsd: pos.entryPriceUsd > 0 ? pos.entryPriceUsd : null,
      leverage:
        derivedLeverage !== null && Number.isFinite(derivedLeverage)
          ? derivedLeverage
          : null,
      openedTsMs:
        Number.isFinite(pos.openTime) && pos.openTime > 0 ? pos.openTime : null,
      sourceMarkUsd:
        pos.markPriceUsd !== undefined && pos.markPriceUsd > 0
          ? pos.markPriceUsd
          : null,
    });
  }
  return out;
}

/** Roster whale (HL/Pacifica) positions from the live cache. Keys are the
 *  records' own ids — identical to the feed cards' sourcePositionId, so
 *  manual whale tails match the close pass with zero translation. Markets
 *  Flash doesn't list at all are dropped here (the registry is broad:
 *  crypto, XAU, FX, equities); a copy's own source key is by construction
 *  a listed market, so the filter can never make the close pass misread
 *  "filtered" as "gone". */
export function whaleSourcePositions(
  records: WhalePositionRecord[],
): SourcePosition[] {
  const out: SourcePosition[] = [];
  for (const record of records) {
    if (record.status !== "open") continue;
    const market = normalizeFlashMarket(record.market);
    if (!market || !isFlashCopyableMarket(market)) continue;
    const openedTsMs = record.openedAt.getTime();
    out.push({
      key: record.id,
      market,
      side: record.side,
      entryPriceUsd: record.entryPrice > 0 ? record.entryPrice : null,
      leverage: record.leverage > 0 ? record.leverage : null,
      openedTsMs: Number.isFinite(openedTsMs) && openedTsMs > 0 ? openedTsMs : null,
      sourceMarkUsd:
        record.currentMark !== null && record.currentMark > 0
          ? record.currentMark
          : null,
    });
  }
  return out;
}

const WHALE_SOURCES: ReadonlySet<string> = new Set([
  "hyperliquid",
  "pacifica",
  "ostium",
]);

/** Whale targetKey format: `${source}:${sourceAccount}` (makeWhaleId). */
export function parseWhaleTargetKey(
  key: string,
): { source: WhaleSource; sourceAccount: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const source = key.slice(0, idx);
  const sourceAccount = key.slice(idx + 1);
  if (!WHALE_SOURCES.has(source) || sourceAccount.length === 0) return null;
  return { source: source as WhaleSource, sourceAccount };
}

// ───────────────────────────── live fetchers ───────────────────────────────

let erConnection: Connection | null = null;

function arenaErConnection(): Connection {
  if (erConnection) return erConnection;
  const endpoint =
    process.env.ARENA_ER_ENDPOINT ??
    process.env.NEXT_PUBLIC_ARENA_ER_ENDPOINT;
  if (!endpoint) throw new Error("ARENA_ER_ENDPOINT is not configured");
  erConnection = new Connection(endpoint, "confirmed");
  return erConnection;
}

function arenaProgramId(): PublicKey {
  const raw =
    process.env.ARENA_PROGRAM_ID ?? process.env.NEXT_PUBLIC_ARENA_PROGRAM_ID;
  if (!raw) throw new Error("ARENA_PROGRAM_ID is not configured");
  return new PublicKey(raw);
}

async function fetchArenaBotPositions(
  persona: string,
): Promise<SourcePosition[]> {
  const info = await arenaErConnection().getAccountInfo(
    botPda(persona, arenaProgramId()),
  );
  if (!info) throw new Error(`arena bot account missing: ${persona}`);
  const bot = decodeBot(new Uint8Array(info.data));
  if (!bot) throw new Error(`arena bot account undecodable: ${persona}`);
  return arenaBotSourcePositions(persona, bot);
}

async function fetchFlashWalletPositions(
  wallet: string,
): Promise<SourcePosition[]> {
  const { getFlashPerpsService } = await import("@/lib/flash/perps");
  const positions = await getFlashPerpsService().positionsOf(wallet);
  return flashWalletSourcePositions(wallet, positions);
}

async function fetchWhalePositions(targetKey: string): Promise<SourcePosition[]> {
  const parsed = parseWhaleTargetKey(targetKey);
  if (!parsed) throw new Error(`bad whale target key: ${targetKey}`);
  const { getWhaleLivePositionsForAccount } = await import(
    "@/lib/whales/live-cache"
  );
  const records = await getWhaleLivePositionsForAccount(
    parsed.sourceAccount,
    parsed.source,
  );
  // null = cache cold / account not in the snapshot — that's UNKNOWN, and
  // unknown must throw so the engine never reads it as "whale went flat".
  if (records === null) {
    throw new Error(`whale live-cache has no snapshot for ${targetKey}`);
  }
  return whaleSourcePositions(records);
}

export async function fetchSourcePositions(
  ref: CopyTargetRef,
): Promise<SourcePosition[]> {
  switch (ref.kind) {
    case "arena-bot":
      return fetchArenaBotPositions(ref.key);
    case "flash-wallet":
      return fetchFlashWalletPositions(ref.key);
    case "whale":
      return fetchWhalePositions(ref.key);
  }
}
