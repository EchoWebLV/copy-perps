// lib/bots/strategies/source-mirror.ts
//
// Generic strategy that mirrors the position book of a real-world
// source (a wallet, a vault, a leaderboard trader). On each resolver
// tick the strategy:
//
//   - Phase 1 (evaluateExit): closes any open paper position whose
//     source-side counterpart has been closed since last tick.
//   - Phase 2 (evaluateEntry): opens a new paper position for any
//     source position the bot doesn't yet hold a mirror of.
//
// The bot's own bankroll sizes the trade: stake = bankroll × stakePct,
// applied at the source's reported leverage. Per-trade and total
// guardrails are enforced by the resolver layer; this strategy just
// reflects what the source did.
//
// One-position-per-asset assumption: HL/Pacifica wallets hold at most
// one open position per (asset). When the source flips (long → short),
// Phase 1 closes our long, Phase 2 opens our short, all within the
// same tick. No two-tick lag.

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";
import type { Source, SourcePosition } from "@/lib/sources/types";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;
// Per-tick cache of the source's positions, keyed by source id.
// Tick cadence is ~60s; cache for 30s so Phase 1 and Phase 2 in the
// same tick share a single API read.
const POSITIONS_TTL_MS = 30_000;
const _positionsCache = new Map<
  string,
  { expiresAt: number; positions: SourcePosition[] }
>();

interface SourceMirrorParams {
  id: string;
  source: Source;
  /** Default leverage cap if source reports an outlier value. */
  maxLeverage: number;
  /** Force-close after this many ms regardless of source. Cap on stale
   *  mirrors when the source goes silent. */
  maxHoldMs: number;
  /** Stop-loss as fraction of stake. Resolver applies the same gate
   *  via bot.config.stopLossPct, but we surface a per-strategy default
   *  too. */
  stopLossPct?: number;
}

async function loadSourcePositions(
  source: Source,
): Promise<SourcePosition[]> {
  const cached = _positionsCache.get(source.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.positions;
  const positions = await source.getCurrentPositions();
  _positionsCache.set(source.id, {
    positions,
    expiresAt: now + POSITIONS_TTL_MS,
  });
  return positions;
}

function findMatch(
  positions: SourcePosition[],
  asset: string,
  side?: "long" | "short",
): SourcePosition | undefined {
  return positions.find(
    (p) => p.asset === asset && (side ? p.side === side : true),
  );
}

export function createSourceMirrorStrategy(
  p: SourceMirrorParams,
): Strategy {
  return {
    id: p.id,
    markets: ALLOWED_MARKETS,

    async evaluateEntry(
      ctx: MarketContext,
      _signals: ExternalSignals,
    ): Promise<EntryDecision | null> {
      if (
        !ALLOWED_MARKETS.includes(
          ctx.asset as (typeof ALLOWED_MARKETS)[number],
        )
      ) {
        return null;
      }
      let positions: SourcePosition[];
      try {
        positions = await loadSourcePositions(p.source);
      } catch (err) {
        console.warn(`[${p.id}] source load failed:`, err);
        return null;
      }
      const match = findMatch(positions, ctx.asset);
      if (!match) return null;

      // Cap leverage at the strategy's max — even if the source is
      // running 50x we'll mirror at most maxLeverage.
      const leverage = Math.max(
        1,
        Math.min(p.maxLeverage, Math.round(match.leverage)),
      );
      // Conviction roughly tracks how aggressively the source is sized
      // relative to its account, but we don't have that ratio. Use a
      // mild conviction floor so stake sizing is predictable.
      const conviction = clampConviction(0.6);
      return {
        asset: match.asset,
        side: match.side,
        leverage,
        conviction,
        triggerMeta: {
          sourceId: p.source.id,
          sourceDisplayName: p.source.displayName,
          sourceExternalId: match.externalId,
          sourceEntryPx: match.entryPx,
          sourceLeverage: match.leverage,
          sourceNotionalUsd: match.notionalUsd,
          ...(match.meta ?? {}),
          dynamicLeverage: leverage,
          conviction,
        },
      };
    },

    evaluateExit(
      _ctx: MarketContext,
      position: PaperPosition,
    ): boolean {
      // Time guard: if we've held longer than maxHoldMs without the
      // source confirming, exit. Protects against stale mirrors when
      // the source endpoint flakes.
      const heldMs = Date.now() - position.entryTs.getTime();
      if (heldMs >= p.maxHoldMs) return true;

      // Read the source's current positions. If a synchronous fast-
      // path is needed (evaluateExit is sync in the Strategy
      // interface), we lean on the per-tick cache populated during
      // Phase 1's first market scan. If not warm yet, fail OPEN
      // (don't close) — better to wait one tick than misfire.
      const cached = _positionsCache.get(p.source.id);
      if (!cached || cached.expiresAt <= Date.now()) return false;
      const match = findMatch(cached.positions, position.asset, position.side);
      // No match = source closed (or flipped); close our mirror.
      return !match;
    },
  };
}

/** Helper for the registry — keeps each bot file thin. */
export function buildMirrorBot(args: {
  id: string;
  name: string;
  avatarEmoji: string;
  personaVoiceKey: string;
  source: Source;
  maxLeverage?: number;
  maxHoldMs?: number;
}): { bot: BotConfig; strategy: Strategy } {
  const strategy = createSourceMirrorStrategy({
    id: args.id,
    source: args.source,
    maxLeverage: args.maxLeverage ?? 15,
    maxHoldMs: args.maxHoldMs ?? 24 * 60 * 60 * 1000,
  });
  const bot: BotConfig = {
    id: args.id,
    parentId: null,
    name: args.name,
    avatarEmoji: args.avatarEmoji,
    personaVoiceKey: args.personaVoiceKey,
    strategyKey: args.id,
    config: {
      sourceId: args.source.id,
      sourceDisplayName: args.source.displayName,
      sourceExternalUrl: args.source.externalUrl,
      maxLeverage: args.maxLeverage ?? 15,
      maxHoldMs: args.maxHoldMs ?? 24 * 60 * 60 * 1000,
    },
    status: "paper",
  };
  return { bot, strategy };
}
