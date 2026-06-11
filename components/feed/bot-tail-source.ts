// Pure builders for tailing an arena bot from the unified /feed — the bot
// counterpart of components/whales/whale-tail-source.ts. Renderer-free so
// the null gates (flat bot, missing/mismatched market, frozen data) and the
// botId namespacing are unit-testable.
//
// botId is NAMESPACED as `arena:${personaName}` on purpose: the legacy
// Postgres paper bots wrote bare ids into bets lineage
// (lib/bets/flash-tail-meta.ts), so arena bots must be distinguishable in
// analytics forever. Same scheme for positionId:
// `arena:${personaName}:${openedTsMs}` — openedTsMs is the only stable
// per-position identity the on-chain slot carries.

import type { TailSource } from "@/components/tail/tail-types";
import type { ArenaBot, ArenaMarketState } from "@/lib/arena/decode";
import { ARENA_PERSONAS } from "@/lib/arena/personas";
import { isStale } from "@/lib/arena/use-arena-live";
import { arenaMarketTicker, primaryBotPosition } from "./unified-feed-model";

export type BotTailSource = Extract<TailSource, { kind: "bot" }>;

/** TailSource for a bot's primary open position, or null when no honest
 *  tail exists: bot not loaded, no active position, market account missing
 *  or for a different market (no live mark to copy against), or a position
 *  whose entry/leverage can't support real math (fail-closed, mirrors
 *  botPositionPnlPct).
 *
 *  maxLeverage is null by design: TailModal only reads maxLeverage on whale
 *  sources (its leverage slider is whale-only); bot tails submit the bot's
 *  own leverage and the venue bounds are enforced by /api/flash/perp. */
export function buildBotTailSource(
  name: string,
  bot: ArenaBot | null,
  market: ArenaMarketState | null,
): BotTailSource | null {
  if (!bot) return null;
  const position = primaryBotPosition(bot);
  if (!position) return null;
  if (market === null || market.marketId !== position.marketId) return null;
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) {
    return null;
  }
  if (!Number.isFinite(position.leverage) || position.leverage < 1) {
    return null;
  }

  const persona = ARENA_PERSONAS[name];
  return {
    kind: "bot",
    botId: `arena:${name}`,
    botName: persona?.display ?? name,
    avatarEmoji: persona?.emoji ?? "🤖",
    avatarImageUrl: null,
    asset: arenaMarketTicker(position.marketId),
    side: position.side,
    leverage: position.leverage,
    maxLeverage: null,
    entryMark: position.entryPrice,
    positionId: `arena:${name}:${position.openedTsMs}`,
  };
}

/** What the bot card's CTA slot should render. */
export type BotCopyCta =
  | { state: "tail"; source: BotTailSource }
  /** Open position, but the data is frozen — tailing it would be dishonest. */
  | { state: "stale" }
  /** Open position, fresh data, but no live mark (market missing/mismatched). */
  | { state: "unavailable" }
  /** Flat (or not loaded) — the card keeps its flat line, no CTA. */
  | { state: "none" };

/** CTA gate for both feed renderings (stacked BotFeedCard + desktop grid).
 *
 *  Staleness is the OR of two clocks, both via isStale():
 *  - transport: lastUpdateMs — no chain read applied recently (dead ws+poll);
 *  - oracle: market.lastPublishTsMs — the crank stopped publishing, which a
 *    healthy poll loop would otherwise mask (refetch restamps lastUpdateMs
 *    even when the accounts are frozen, e.g. the arena pause incident).
 *  nowMs starts at 0 on first client paint (useNowTick hydration convention);
 *  isStale treats a future timestamp as fresh, so the first paint matches
 *  what the 1s tick will compute — same convention as the whale cards. */
export function botCopyCta(args: {
  name: string;
  bot: ArenaBot | null;
  market: ArenaMarketState | null;
  lastUpdateMs: number;
  nowMs: number;
}): BotCopyCta {
  const { name, bot, market, lastUpdateMs, nowMs } = args;
  if (!bot || primaryBotPosition(bot) === null) return { state: "none" };
  const frozen =
    isStale(lastUpdateMs, nowMs) ||
    (market !== null && isStale(market.lastPublishTsMs, nowMs));
  if (frozen) return { state: "stale" };
  const source = buildBotTailSource(name, bot, market);
  return source === null ? { state: "unavailable" } : { state: "tail", source };
}
