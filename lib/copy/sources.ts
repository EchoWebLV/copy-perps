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
import {
  isFlashCopyableMarket,
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
    });
  }
  return out;
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

export async function fetchSourcePositions(
  ref: CopyTargetRef,
): Promise<SourcePosition[]> {
  return ref.kind === "arena-bot"
    ? fetchArenaBotPositions(ref.key)
    : fetchFlashWalletPositions(ref.key);
}
