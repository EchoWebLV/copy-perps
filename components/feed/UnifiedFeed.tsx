"use client";

// The unified /feed: whales AND on-chain arena bots, one ranked list with
// two renderings. Below lg it's the Invo-style stacked-card list; at lg+
// the classic WhaleRoster card grid returns (founder feedback) — rich
// equity/exposure whale cards (DesktopWhaleCard) and the arena BotCard in
// the same 2/3-col grid. The entity pills + compact sort drive BOTH views
// off the same filtered+ranked entries.
//
// Data plumbing is salvaged straight from WhaleRoster (SSR initialWhales →
// /api/whales/roster visible-poll with the stale-refresh guard, TailModal
// wiring via buildWhaleTailSource) plus the arena live hook (REST seed →
// ER ws → poll fallback) for the bots. Entity pills (All · Whales · Bots)
// with a compact 1D · 7D · 30D · Equity segmented sort in the same row —
// no heat sort, no snap scroll, no tape.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WhaleTraderSignal } from "@/lib/types";
import { useArenaLive } from "@/lib/arena/use-arena-live";
import type { ArenaBot, ArenaMarketState } from "@/lib/arena/decode";
import { ARENA_PERSONAS } from "@/lib/arena/personas";
import { BotCard } from "@/components/arena/BotCard";
import { BalancePill } from "@/components/shell/BalancePill";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { CopyModal, type CopyModalTarget } from "@/components/copy/CopyModal";
import { buildWhaleTailSource } from "@/components/whales/whale-tail-source";
import { WhaleFingerprintAvatar } from "@/components/whales/WhaleFingerprintAvatar";
import { formatWhalePositionAge } from "@/components/whales/whale-position-age";
import { formatPriceUsd } from "@/components/whales/whale-money";
import { whaleDisplayName } from "@/lib/whales/alias";
import { classifyQuery, filterTraders, type SearchableTrader } from "@/lib/search/traders";
import { botCopyCta, type BotCopyCta } from "./bot-tail-source";
import { DesktopWhaleCard, SkeletonDesktopWhaleCard, SentimentRow, type TraderSentiment } from "./DesktopWhaleCard";
import { Sparkline } from "./Sparkline";
import { useMiniCandles } from "./use-mini-candles";
import {
  ACCENT,
  AI,
  AI_BORDER,
  AI_DIM,
  AiBotBadge,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  Headline,
  PANEL,
  PANEL_2,
  RealWalletBadge,
  RED,
  AI_TINT,
} from "@/components/v2/ui";
import {
  ACTIVE_TRADER_WINDOW_MS,
  FEED_ENTITY_OPTIONS,
  FEED_SORT_OPTIONS,
  FRESH_POSITION_MS,
  type FeedEntityFilter,
  type FeedEntry,
  type FeedSortKey,
  arenaMarketTicker,
  botPnlPct,
  botPositionPnlPct,
  formatCompactSignedUsd,
  formatCompactUsd,
  formatFeedAge,
  formatSignedPct,
  primaryBotPosition,
  rankFeedEntries,
  ringClosesChronological,
  shouldUseRosterRefresh,
  sourceChipLabel,
  whaleHeaderPnl,
} from "./unified-feed-model";

const POLL_MS = 30_000;

interface Props {
  initialWhales: WhaleTraderSignal[];
}

export function UnifiedFeed({ initialWhales }: Props) {
  const [whales, setWhales] = useState<WhaleTraderSignal[]>(initialWhales);
  const [loaded, setLoaded] = useState(initialWhales.length > 0);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);
  const [copyTarget, setCopyTarget] = useState<CopyModalTarget | null>(null);
  const { bots, market, mode, lastUpdateMs } = useArenaLive();
  const now = useNowTick();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/roster", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { whales: WhaleTraderSignal[] };
      setWhales((current) =>
        shouldUseRosterRefresh(data.whales, current) ? data.whales : current,
      );
    } catch {
      // Keep the last good roster if the poll misses.
    } finally {
      setLoaded(true);
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const [filter, setFilter] = useState<FeedEntityFilter>("all");
  const [sortKey, setSortKey] = useState<FeedSortKey>("pnl1d");
  const [searchQuery, setSearchQuery] = useState("");

  // Prefill the search from a `?q=` param so "View trader" links on the LIVE
  // tape land here focused on that trader (their card shows; Auto-copy is on it).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setSearchQuery(q);
  }, []);

  // Sentiment: reaction counts aggregated per whale across their open positions.
  // Fetched lazily from /api/pulse/social (unauthenticated — public read).
  const sentiment = useWhaleSentiment(whales);

  const botNames = useMemo(() => Object.keys(bots), [bots]);

  // Coarse minute tick for ranking: freshness buckets only move on hour
  // scales, and re-sorting every second would shuffle cards mid-scroll.
  const rankNow = now > 0 ? Math.floor(now / 60_000) * 60_000 : 0;
  const ranked = useMemo(() => {
    const entries: FeedEntry[] = [
      ...whales.map((whale) => ({ kind: "whale" as const, whale })),
      ...botNames.map((name) => ({
        kind: "bot" as const,
        name,
        bot: bots[name],
      })),
    ];
    return rankFeedEntries(entries, filter, sortKey, rankNow);
  }, [whales, bots, botNames, filter, sortKey, rankNow]);

  // Client-side search filter applied after ranking.
  const queryKind = searchQuery.trim() ? classifyQuery(searchQuery) : "text";
  const filteredRanked = useMemo(() => {
    if (!searchQuery.trim() || queryKind === "wallet") return ranked;
    const searchable: SearchableTrader[] = ranked.map((entry) => {
      if (entry.kind === "whale") {
        const p = entry.whale.payload;
        return {
          id: `whale:${p.whaleId}`,
          kind: "whale",
          name: whaleDisplayName(p.displayName, p.sourceAccount),
          markets: p.openPositions.map((pos) => pos.market),
        };
      }
      const persona = ARENA_PERSONAS[entry.name];
      return {
        id: `bot:${entry.name}`,
        kind: "bot",
        name: persona?.display ?? entry.name,
        markets: entry.bot?.positions
          .filter((pos) => pos.active)
          .map((pos) => arenaMarketTicker(pos.marketId)) ?? [],
        desc: persona?.blurb,
      };
    });
    const matchedIds = new Set(filterTraders(searchable, searchQuery).map((t) => t.id));
    return ranked.filter((entry) => {
      const id =
        entry.kind === "whale"
          ? `whale:${entry.whale.payload.whaleId}`
          : `bot:${entry.name}`;
      return matchedIds.has(id);
    });
  }, [ranked, searchQuery, queryKind]);

  const whalesPending = !loaded && whales.length === 0;
  const botsPending = mode === "loading" && botNames.length > 0;
  const showSkeletons =
    filteredRanked.length === 0 &&
    !searchQuery.trim() &&
    (filter === "bots" ? botsPending : whalesPending || botsPending);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <BalancePill />
      {/* Mobile bell is rendered globally by BottomNav (fixed top-3 right-3 z-40 lg:hidden).
          Desktop bell is rendered by DesktopNav. No per-feed mount needed. */}

      {/* Search bar — above filter pills. */}
      <div
        className="flex flex-none items-center gap-2 border-b px-3 pt-12 pb-2 lg:px-6 lg:pt-4 lg:pb-2"
        style={{ borderColor: FAINT }}
      >
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* One control row: entity pills left, compact sort right. Horizontal
          scroll instead of wrapping when a narrow viewport runs out of
          room — wrapped pills read as a broken layout. */}
      <div
        className="no-scrollbar flex flex-none items-center justify-between gap-2 overflow-x-auto border-b px-3 pb-2 pt-2 lg:px-6 lg:pb-3"
        style={{ borderColor: FAINT }}
      >
        <EntityPills filter={filter} onChange={setFilter} />
        <SortControl sortKey={sortKey} onChange={setSortKey} />
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3 lg:px-6 lg:pb-8">
        {/* Wallet address result — overrides normal list when the query is a
            valid Solana address. Opens CopyModal prefilled via flash-wallet. */}
        {queryKind === "wallet" && searchQuery.trim() ? (
          <>
            <div className="mx-auto flex w-full max-w-xl flex-col gap-3 lg:hidden">
              <WalletResultCard
                address={searchQuery.trim()}
                onCopy={(target) => setCopyTarget(target)}
              />
            </div>
            <div className="mx-auto hidden w-full max-w-6xl lg:block">
              <WalletResultCard
                address={searchQuery.trim()}
                onCopy={(target) => setCopyTarget(target)}
              />
            </div>
          </>
        ) : (
          <>
            {/* Below lg: the Invo-style stacked feed, untouched. */}
            <div className="mx-auto flex w-full max-w-xl flex-col gap-3 lg:hidden">
              {showSkeletons ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonFeedCard key={i} />
                ))
              ) : filteredRanked.length === 0 ? (
                searchQuery.trim() ? (
                  <EmptySearch onClear={() => setSearchQuery("")} />
                ) : (
                  <EmptyFeed
                    filter={filter}
                    arenaConfigured={botNames.length > 0}
                    onReset={() => setFilter("all")}
                  />
                )
              ) : (
                filteredRanked.map((entry) =>
                  entry.kind === "whale" ? (
                    <WhaleFeedCard
                      key={entry.whale.payload.whaleId}
                      whale={entry.whale}
                      sortKey={sortKey}
                      now={now}
                      sentiment={sentiment[entry.whale.payload.whaleId] ?? null}
                      onTail={(source) => setTailSource(source)}
                      onCopy={(target) => setCopyTarget(target)}
                    />
                  ) : (
                    <BotFeedCard
                      key={entry.name}
                      name={entry.name}
                      bot={entry.bot}
                      market={market}
                      lastUpdateMs={lastUpdateMs}
                      now={now}
                      onTail={(source) => setTailSource(source)}
                      onCopy={(target) => setCopyTarget(target)}
                    />
                  ),
                )
              )}
            </div>

            {/* lg and up: the classic card grid (founder feedback) over the SAME
                ranked entries — resurrected DesktopWhaleCard for whales, the
                arena BotCard for bots. Rank chips follow the active sort. */}
            <div className="mx-auto hidden w-full max-w-6xl auto-rows-max grid-cols-2 gap-3 lg:grid xl:grid-cols-3">
              {showSkeletons ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonDesktopWhaleCard key={i} />
                ))
              ) : filteredRanked.length === 0 ? (
                <div className="col-span-full">
                  {searchQuery.trim() ? (
                    <EmptySearch onClear={() => setSearchQuery("")} />
                  ) : (
                    <EmptyFeed
                      filter={filter}
                      arenaConfigured={botNames.length > 0}
                      onReset={() => setFilter("all")}
                    />
                  )}
                </div>
              ) : (
                filteredRanked.map((entry, idx) =>
                  entry.kind === "whale" ? (
                    <DesktopWhaleCard
                      key={entry.whale.payload.whaleId}
                      whale={entry.whale}
                      rank={idx + 1}
                      now={now}
                      sentiment={sentiment[entry.whale.payload.whaleId] ?? null}
                      onTail={(source) => setTailSource(source)}
                      onCopy={(target) => setCopyTarget(target)}
                    />
                  ) : (
                    <GridBotCard
                      key={entry.name}
                      name={entry.name}
                      bot={entry.bot}
                      market={market}
                      lastUpdateMs={lastUpdateMs}
                      now={now}
                      onTail={(source) => setTailSource(source)}
                      onCopy={(target) => setCopyTarget(target)}
                    />
                  ),
                )
              )}
            </div>
          </>
        )}
      </div>

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
      <CopyModal
        open={copyTarget !== null}
        target={copyTarget}
        onClose={() => setCopyTarget(null)}
      />
    </div>
  );
}

// ───────────────────────────── whale card ─────────────────────────────────

function WhaleFeedCard({
  whale,
  sortKey,
  now,
  sentiment,
  onTail,
  onCopy,
}: {
  whale: WhaleTraderSignal;
  sortKey: FeedSortKey;
  now: number;
  sentiment: TraderSentiment | null;
  onTail: (source: TailSource) => void;
  onCopy: (target: CopyModalTarget) => void;
}) {
  const p = whale.payload;
  const name = whaleDisplayName(p.displayName, p.sourceAccount);
  // now starts at 0 (hydration-safe); isSourceFresh treats a future lastSeen
  // as fresh, so the first paint matches what the 1s tick will compute.
  const tail = buildWhaleTailSource(p, now);
  const position =
    (tail &&
      p.openPositions.find(
        (pos) => pos.positionId === tail.sourcePositionId,
      )) ??
    p.bestPosition ??
    p.openPositions[0] ??
    null;

  const header = whaleHeaderPnl(p.stats, sortKey);
  const headerColor = header.usd >= 0 ? GREEN : RED;
  const lastSeenAtMs = p.lastSeenAt === null ? null : Date.parse(p.lastSeenAt);
  const ageMs =
    now > 0 && lastSeenAtMs !== null && Number.isFinite(lastSeenAtMs)
      ? now - lastSeenAtMs
      : null;

  const positionPnl = position?.unrealizedPnlPct ?? null;
  const positionFresh =
    position !== null &&
    now > 0 &&
    position.openedAtKnown !== false &&
    now - position.openedAtMs < FRESH_POSITION_MS;
  // Dormant = newest position is older than the active-trader window; the
  // CTA goes quiet (ghost) so the loud accent slab means "trading NOW".
  const dormant =
    position !== null &&
    now > 0 &&
    (position.openedAtMs <= 0 ||
      now - position.openedAtMs > ACTIVE_TRADER_WINDOW_MS);
  const moreCount = Math.max(0, p.openPositionsCount - 1);
  const closes = useMiniCandles(position?.market ?? null);

  return (
    <article
      className="rounded-2xl border p-3.5"
      style={{ background: PANEL, borderColor: FAINT }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FeedAvatar
            avatarUrl={p.avatarUrl}
            sourceAccount={p.sourceAccount}
            label={name}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-black uppercase leading-tight">
                {name}
              </span>
              <RealWalletBadge />
              <SourceChip label={sourceChipLabel(p.source)} />
            </div>
            <div
              className="mt-1 flex items-center gap-2.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest tabular-nums"
              style={{ color: DIM }}
            >
              <span>Equity {formatCompactUsd(p.stats.equityUsdc)}</span>
              <span>{p.openPositionsCount} open</span>
              {ageMs !== null && (
                <span className="flex shrink-0 items-center gap-1">
                  {ageMs < FRESH_POSITION_MS && (
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full"
                      style={{ background: GREEN }}
                      aria-hidden
                    />
                  )}
                  {formatFeedAge(ageMs)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Whale payloads carry no wins/losses counts (winRatePct1d is null
            from every stats path) — so no W/L block here, P&L only. */}
        <div className="flex shrink-0 items-start gap-2 text-right">
          <div>
            <div
              className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {header.label}
            </div>
            <div
              className="mt-0.5 text-[15px] font-black tabular-nums leading-none"
              style={{ color: headerColor }}
            >
              {formatCompactSignedUsd(header.usd)}
            </div>
          </div>
          <BotCopyButton
            onClick={() =>
              onCopy({
                kind: "whale",
                key: `${p.source}:${p.sourceAccount}`,
                label: name,
                emoji: "🐋",
              })
            }
          />
        </div>
      </div>

      {sentiment && sentiment.total > 0 ? (
        <SentimentRow sentiment={sentiment} />
      ) : null}

      {position ? (
        <PositionPanel
          asset={position.market}
          side={position.side}
          leverage={position.leverage}
          entryPrice={position.entryPrice}
          markPrice={position.currentMark}
          pnlPct={positionPnl}
          moreCount={moreCount}
          fresh={positionFresh}
          closes={closes}
          notionalUsd={position.notionalUsd ?? null}
          chartLabel={`${position.market} · 1m`}
          footer={whalePositionFooter(position, now)}
          cta={
            tail ? (
              // Dormant positions (nothing opened in 24h) drop the loud
              // accent slab — five identical yellow CTAs in a row is how
              // users stop seeing any of them. Live action stays loud.
              dormant ? (
                <button
                  type="button"
                  onClick={() => onTail(tail)}
                  className="w-full rounded-xl border py-2.5 text-[11px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.98]"
                  style={{ background: PANEL_2, borderColor: FAINT, color: FG }}
                >
                  Copy now
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onTail(tail)}
                  className="w-full rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.98]"
                  style={{
                    background: ACCENT,
                    color: BG,
                    boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
                  }}
                >
                  Copy now
                </button>
              )
            ) : (
              <DisabledCta label="Copy now — unavailable" />
            )
          }
        />
      ) : (
        <FlatLine />
      )}
    </article>
  );
}

function whalePositionFooter(
  position: NonNullable<WhaleTraderSignal["payload"]["bestPosition"]>,
  now: number,
): string {
  if (position.openedAtKnown === false) {
    // Entry time unconfirmed — surface tape time instead of claiming an age.
    return `Position · seen ${formatWhalePositionAge(position.openedAtMs, now)} ago`;
  }
  const fresh = now > 0 && now - position.openedAtMs < FRESH_POSITION_MS;
  const age = formatWhalePositionAge(position.openedAtMs, now);
  return fresh
    ? `New position · opened ${age} ago`
    : `Position · opened ${age} ago`;
}

// ────────────────────────────── bot card ──────────────────────────────────

function BotFeedCard({
  name,
  bot,
  market,
  lastUpdateMs,
  now,
  onTail,
  onCopy,
}: {
  name: string;
  bot: ArenaBot | null;
  market: ArenaMarketState | null;
  lastUpdateMs: number;
  now: number;
  onTail: (source: TailSource) => void;
  onCopy: (target: CopyModalTarget) => void;
}) {
  const persona = ARENA_PERSONAS[name];
  const display = persona?.display ?? name;

  if (bot === null) return <SkeletonFeedCard />;

  const copyCta = botCopyCta({ name, bot, market, lastUpdateMs, nowMs: now });

  const wins = bot.wins;
  const losses = Math.max(0, bot.trades - bot.wins);
  const pnlPct = botPnlPct(bot);
  const pnlColor = pnlPct > 0 ? GREEN : pnlPct < 0 ? RED : DIM;

  const position = primaryBotPosition(bot);
  const markPrice =
    position !== null && market !== null && market.marketId === position.marketId
      ? market.lastPrice
      : null;
  const positionPnl = position ? botPositionPnlPct(position, markPrice) : null;
  const positionFresh =
    position !== null && now > 0 && now - position.openedTsMs < FRESH_POSITION_MS;
  const moreCount = position
    ? Math.max(0, bot.positions.filter((p) => p.active).length - 1)
    : 0;
  // Real on-chain sparkline: the ER market candle ring (15s buckets).
  const ringCloses =
    position !== null && market !== null && market.marketId === position.marketId
      ? ringClosesChronological(market)
      : null;
  const openStakeUsd = bot.positions
    .filter((p) => p.active)
    .reduce((s, p) => s + p.stakeUsd, 0);

  return (
    <article
      className="rounded-2xl p-3.5"
      style={{ background: AI_DIM, border: `1px solid ${AI_BORDER}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[20px] leading-none"
            style={{
              background: AI_TINT,
              boxShadow: `0 0 0 2px ${AI}`,
            }}
            aria-hidden
          >
            {persona?.emoji ?? "🤖"}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-black uppercase leading-tight">
                {display}
              </span>
              <AiBotBadge />
              <BotFreshness lastUpdateMs={lastUpdateMs} now={now} />
            </div>
            <div
              className="mt-1 flex items-center gap-2.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest tabular-nums"
              style={{ color: DIM }}
            >
              <span>
                Equity {formatCompactUsd(bot.balanceUsd + openStakeUsd)}
              </span>
              <span className="flex items-center gap-1">
                <WinLossSquare value={wins} color={GREEN} label="wins" />
                <WinLossSquare value={losses} color={RED} label="losses" />
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-2 text-right">
          <div>
            <div
              className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              P&L
            </div>
            <div
              className="mt-0.5 text-[15px] font-black tabular-nums leading-none"
              style={{ color: pnlColor }}
            >
              {formatSignedPct(pnlPct)}
            </div>
          </div>
          <BotCopyButton
            onClick={() =>
              onCopy({
                kind: "arena-bot",
                key: name,
                label: display,
                emoji: persona?.emoji,
              })
            }
          />
        </div>
      </div>

      {position ? (
        <PositionPanel
          asset={arenaMarketTicker(position.marketId)}
          side={position.side}
          leverage={position.leverage}
          entryPrice={position.entryPrice}
          markPrice={markPrice}
          pnlPct={positionPnl}
          moreCount={moreCount}
          fresh={positionFresh}
          closes={ringCloses}
          liqPrice={position.liqPrice}
          chartLabel={`${arenaMarketTicker(position.marketId)} · 15s on-chain`}
          footer={
            positionFresh
              ? `New position · opened ${formatWhalePositionAge(position.openedTsMs, now)} ago`
              : `Position · opened ${formatWhalePositionAge(position.openedTsMs, now)} ago`
          }
          cta={<BotTailCta cta={copyCta} onTail={onTail} />}
        />
      ) : (
        <FlatLine />
      )}
    </article>
  );
}

/** Standing-copy entry point — present whether or not the bot currently
 *  holds a position (arming BEFORE the next entry is the whole point). */
function BotCopyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-2 py-1.5 text-[9px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.97]"
      style={{ background: PANEL_2, borderColor: FAINT, color: FG }}
      aria-label="Auto-copy this trader"
    >
      Auto-copy
    </button>
  );
}

/** CTA slot for a bot position, shared by the stacked card and the desktop
 *  grid. "tail" gets the same accent button the whale card uses; frozen data
 *  degrades to an honest disabled label instead of a live-looking copy. */
function BotTailCta({
  cta,
  onTail,
}: {
  cta: BotCopyCta;
  onTail: (source: TailSource) => void;
}) {
  if (cta.state === "none") return null;
  if (cta.state === "tail") {
    return (
      <button
        type="button"
        onClick={() => onTail(cta.source)}
        className="w-full rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.98]"
        style={{
          background: ACCENT,
          color: BG,
          boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
        }}
      >
        Copy now
      </button>
    );
  }
  return (
    <DisabledCta
      label={cta.state === "stale" ? "Copy — stale" : "Copy — unavailable"}
    />
  );
}

/** Desktop-grid wrapper: computes the copy CTA and hands it to the arena
 *  BotCard via its optional tailCta slot (/arena keeps rendering without). */
function GridBotCard({
  name,
  bot,
  market,
  lastUpdateMs,
  now,
  onTail,
  onCopy,
}: {
  name: string;
  bot: ArenaBot | null;
  market: ArenaMarketState | null;
  lastUpdateMs: number;
  now: number;
  onTail: (source: TailSource) => void;
  onCopy: (target: CopyModalTarget) => void;
}) {
  const cta = botCopyCta({ name, bot, market, lastUpdateMs, nowMs: now });
  const persona = ARENA_PERSONAS[name];
  const copyButton = (
    <button
      type="button"
      onClick={() =>
        onCopy({
          kind: "arena-bot",
          key: name,
          label: persona?.display ?? name,
          emoji: persona?.emoji,
        })
      }
      className="w-full rounded-xl border py-2.5 text-[11px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.98]"
      style={{ background: PANEL_2, borderColor: FAINT, color: FG }}
    >
      Auto-copy
    </button>
  );
  return (
    <BotCard
      name={name}
      bot={bot}
      now={now}
      tailCta={
        cta.state === "none" ? (
          copyButton
        ) : (
          <div className="flex flex-col gap-2">
            <BotTailCta cta={cta} onTail={onTail} />
            {copyButton}
          </div>
        )
      }
    />
  );
}

function BotFreshness({ lastUpdateMs, now }: { lastUpdateMs: number; now: number }) {
  if (lastUpdateMs <= 0 || now <= 0) return null;
  // An update that landed between ticks can sit "in the future" for up to
  // a second — clamp instead of rendering the negative-age dash.
  return (
    <span className="shrink-0 text-[11px] font-bold" style={{ color: DIM }}>
      · {formatFeedAge(Math.max(0, now - lastUpdateMs))}
    </span>
  );
}

function WinLossSquare({
  value,
  color,
  label,
}: {
  value: number;
  color: string;
  label: string;
}) {
  return (
    <span
      className="inline-flex min-w-[20px] items-center justify-center rounded-[5px] px-1 py-0.5 text-[10px] font-black tabular-nums leading-none"
      style={{ background: `${color}1f`, color }}
      aria-label={`${value} ${label}`}
    >
      {value}
    </span>
  );
}

// ─────────────────────────── shared card bits ─────────────────────────────

function FeedAvatar({
  avatarUrl,
  sourceAccount,
  label,
}: {
  avatarUrl: string | null;
  sourceAccount: string;
  label: string;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={label}
        className="h-10 w-10 shrink-0 rounded-xl border object-cover"
        style={{ borderColor: FAINT }}
        draggable={false}
      />
    );
  }
  return (
    <WhaleFingerprintAvatar sourceAccount={sourceAccount} label={label} size={40} />
  );
}

function SourceChip({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest leading-none"
      style={{ color: DIM, borderColor: FAINT, background: PANEL_2 }}
    >
      {label}
    </span>
  );
}

// AiBotBadge and RealWalletBadge are now imported from @/components/v2/ui.

function PositionPanel({
  asset,
  side,
  leverage,
  entryPrice,
  markPrice,
  pnlPct,
  moreCount,
  fresh,
  footer,
  cta,
  closes,
  liqPrice,
  notionalUsd,
  chartLabel,
}: {
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  markPrice: number | null;
  pnlPct: number | null;
  moreCount: number;
  fresh: boolean;
  footer: string;
  cta: ReactNode;
  /** Close series for the mini chart; omit/empty = no chart row. */
  closes?: number[] | null;
  liqPrice?: number | null;
  notionalUsd?: number | null;
  chartLabel?: string;
}) {
  const long = side === "long";
  const sideColor = long ? GREEN : RED;
  const pnlColor = pnlPct === null ? DIM : pnlPct >= 0 ? GREEN : RED;

  // Flat by design (founder feedback): hairline-separated section, no
  // nested panel-in-panel.
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: FAINT }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-black uppercase leading-none">
              {asset}
            </span>
            <span
              className="rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest leading-none"
              style={{ background: `${sideColor}1f`, color: sideColor }}
            >
              {leverage}X {long ? "Long" : "Short"}
            </span>
            {moreCount > 0 && (
              <span
                className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                +{moreCount} more
              </span>
            )}
          </div>
          <div
            className="mt-1.5 text-[11px] font-bold tabular-nums"
            style={{ color: DIM }}
          >
            Entry {formatPriceUsd(entryPrice)}
            {markPrice !== null && (
              <>
                {" "}
                →{" "}
                <span key={markPrice} className="mark-flash">
                  Mark {formatPriceUsd(markPrice)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            This trade
          </div>
          <div
            className="mt-0.5 text-[13px] font-black tabular-nums leading-none"
            style={{ color: pnlColor }}
          >
            {pnlPct === null ? "—" : formatSignedPct(pnlPct)}
          </div>
          <div
            className="mt-1.5 text-[11px] font-bold tabular-nums"
            style={{ color: DIM }}
          >
            {liqPrice != null && Number.isFinite(liqPrice) && liqPrice > 0 ? (
              <>Liq {formatPriceUsd(liqPrice)}</>
            ) : notionalUsd != null && Number.isFinite(notionalUsd) ? (
              <>Size {formatCompactUsd(notionalUsd)}</>
            ) : null}
          </div>
        </div>
      </div>

      {closes && closes.length >= 2 && (
        <div className="relative mt-2.5">
          <Sparkline
            closes={closes}
            entryPrice={entryPrice}
            color={pnlColor === DIM ? "rgba(250,250,242,0.45)" : pnlColor}
            height={40}
            live={fresh}
          />
          {chartLabel && (
            <span
              className="absolute right-0 top-0 text-[8px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {chartLabel}
            </span>
          )}
        </div>
      )}

      <div className="mt-3">{cta}</div>

      <div
        className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: DIM }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: fresh ? GREEN : DIM }}
          aria-hidden
        />
        {footer}
      </div>
    </div>
  );
}

function DisabledCta({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="w-full cursor-not-allowed rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest"
      style={{ background: "rgba(250,250,242,0.08)", color: DIM }}
    >
      {label}
    </button>
  );
}

function FlatLine() {
  return (
    <div
      className="mt-3 text-[11px] font-bold uppercase tracking-widest"
      style={{ color: DIM }}
    >
      flat — no open positions
    </div>
  );
}

// ─────────────────────────────── chrome ───────────────────────────────────

function EntityPills({
  filter,
  onChange,
}: {
  filter: FeedEntityFilter;
  onChange: (key: FeedEntityFilter) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center gap-1 rounded-full border p-1"
      style={{ background: PANEL, borderColor: FAINT }}
      role="group"
      aria-label="Filter feed"
    >
      {FEED_ENTITY_OPTIONS.map((option) => {
        const active = option.key === filter;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{
              background: active ? ACCENT : "transparent",
              color: active ? BG : DIM,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SortControl({
  sortKey,
  onChange,
}: {
  sortKey: FeedSortKey;
  onChange: (key: FeedSortKey) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center rounded-lg border p-0.5"
      style={{ background: PANEL, borderColor: FAINT }}
      role="group"
      aria-label="Sort feed"
    >
      {FEED_SORT_OPTIONS.map((option) => {
        const active = option.key === sortKey;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className="rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-widest tabular-nums transition active:scale-[0.97]"
            style={{
              background: active ? PANEL_2 : "transparent",
              color: active ? FG : DIM,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyFeed({
  filter,
  arenaConfigured,
  onReset,
}: {
  filter: FeedEntityFilter;
  arenaConfigured: boolean;
  onReset: () => void;
}) {
  if (filter === "bots" && !arenaConfigured) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-5 text-center">
        <Headline size={24}>ARENA OFFLINE</Headline>
        <p
          className="mt-3 text-[11px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          Set NEXT_PUBLIC_ARENA_PROGRAM_ID to connect the rollup
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-5 text-center">
      <Headline size={24}>{`"NOTHING HERE"`}</Headline>
      <p
        className="mt-3 text-[11px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        Waiting for sources to refresh
      </p>
      {filter !== "all" && (
        <button
          type="button"
          onClick={onReset}
          className="mt-5 rounded-2xl px-5 py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
          style={{ background: ACCENT, color: BG }}
        >
          Show everything
        </button>
      )}
    </div>
  );
}

function SkeletonFeedCard() {
  return (
    <div
      className="rounded-2xl border p-3.5"
      style={{ background: PANEL, borderColor: FAINT }}
      aria-hidden
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2.5">
          <div className="skeleton-block h-10 w-10 rounded-xl" />
          <div className="skeleton-block h-4 w-2/5 rounded-md" />
        </div>
        <div className="skeleton-block h-7 w-16 rounded-md" />
      </div>
      <div className="skeleton-block mt-3 h-28 w-full rounded-2xl" />
    </div>
  );
}

/** Visibility-aware poll loop (salvaged from WhaleRoster): run immediately
 *  when visible, tick on the interval, pause entirely while hidden. */
function useVisiblePoll(load: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void load().finally(() => {
        inFlight = false;
      });
    };
    const start = () => {
      if (timer) return;
      if (typeof document === "undefined" || !document.hidden) run();
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, intervalMs]);
}

/** Shared 1s wall clock. Starts at 0 so server render and first client
 *  paint agree (no hydration mismatch); ages render once it ticks. */
function useNowTick(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─────────────────────────── search bar ───────────────────────────────────

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
        style={{ color: DIM }}
        aria-hidden
      >
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search traders, assets, or paste a wallet"
        className="w-full rounded-xl border bg-transparent py-2 pl-9 pr-3 text-[12px] font-bold uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal placeholder:font-normal focus:outline-none"
        style={{
          background: PANEL,
          borderColor: FAINT,
          color: FG,
        }}
        aria-label="Search traders"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-black uppercase tracking-widest transition hover:opacity-80"
          style={{ color: DIM }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─────────────────────── wallet address result ────────────────────────────

/** Shown when the search query classifies as a Solana wallet address. */
function WalletResultCard({
  address,
  onCopy,
}: {
  address: string;
  onCopy: (target: CopyModalTarget) => void;
}) {
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return (
    <article
      className="rounded-2xl border p-3.5"
      style={{ background: PANEL, borderColor: FAINT }}
    >
      <div className="flex items-center gap-2.5">
        <WhaleFingerprintAvatar sourceAccount={address} label={short} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate font-mono text-[12px] font-bold"
              style={{ color: FG }}
            >
              {address}
            </span>
          </div>
          <div
            className="mt-1 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: DIM }}
          >
            Paste-a-wallet result
          </div>
        </div>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={() =>
            onCopy({
              kind: "flash-wallet",
              key: address,
              label: short,
              emoji: "👤",
            })
          }
          className="w-full rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.98]"
          style={{
            background: ACCENT,
            color: BG,
            boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
          }}
        >
          Auto-copy this wallet
        </button>
      </div>
    </article>
  );
}

// ─────────────────────── empty search state ───────────────────────────────

function EmptySearch({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-5 text-center">
      <Headline size={24}>NO MATCHES</Headline>
      <p
        className="mt-3 text-[11px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        Nothing matches. Try an asset like &quot;SOL&quot;, a name, or paste a Solana wallet address.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 rounded-2xl px-5 py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
        style={{ background: ACCENT, color: BG }}
      >
        Clear search
      </button>
    </div>
  );
}

// ─────────────────────── sentiment aggregation ────────────────────────────

type PulseApiSocial = Record<
  string,
  { reactionCounts: { Bullish?: number; Bearish?: number; Tailing?: number } }
>;

const SENTIMENT_CHUNK_SIZE = 100;

/** Fetches reaction counts for all whale open positions and aggregates them
 *  per whale. Refreshes once when the whale roster changes.
 *
 *  Fix 1: sentiment is bullish-vs-bearish only (Tailing excluded from
 *  percentage and total). Row hides when subtotal === 0.
 *  Fix 2: latch fetchedKeyRef only on success; stale-response guard drops
 *  results that arrived after the roster changed.
 *  Fix 3: position IDs are chunked into ≤100-id batches so the server-side
 *  100-id cap never silently truncates a large roster. */
function useWhaleSentiment(
  whales: WhaleTraderSignal[],
): Record<string, TraderSentiment> {
  // Build a stable "all position IDs" key to detect roster changes.
  const positionIdsKey = useMemo(() => {
    return whales
      .flatMap((w) => w.payload.openPositions.map((pos) => pos.positionId))
      .sort()
      .join(",");
  }, [whales]);

  // Map positionId → whaleId for aggregation.
  const positionToWhale = useMemo(() => {
    const map = new Map<string, string>();
    for (const whale of whales) {
      for (const pos of whale.payload.openPositions) {
        map.set(pos.positionId, whale.payload.whaleId);
      }
    }
    return map;
  }, [whales]);

  const fetchedKeyRef = useRef<string>("");
  const [sentiment, setSentiment] = useState<Record<string, TraderSentiment>>({});

  useEffect(() => {
    if (!positionIdsKey || fetchedKeyRef.current === positionIdsKey) return;

    const capturedKey = positionIdsKey;
    const positionIds = capturedKey.split(",").filter(Boolean);
    if (positionIds.length === 0) return;

    // Stale-guard: cancelled = true when the effect re-runs (positionIdsKey
    // changed) before the fetch resolves.
    let cancelled = false;

    // Chunk into ≤100-id batches to stay within the server-side cap.
    const chunks: string[][] = [];
    for (let i = 0; i < positionIds.length; i += SENTIMENT_CHUNK_SIZE) {
      chunks.push(positionIds.slice(i, i + SENTIMENT_CHUNK_SIZE));
    }

    void Promise.all(
      chunks.map((chunk) => {
        const encoded = chunk.map(encodeURIComponent).join(",");
        return fetch(`/api/pulse/social?positionIds=${encoded}`, {
          cache: "no-store",
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ social?: PulseApiSocial } | null>) : null))
          .catch(() => null);
      }),
    )
      .then((responses) => {
        // Stale-guard: drop if the effect was cleaned up while fetches were in flight.
        if (cancelled) return;

        // Merge all chunk payloads into one social map.
        const merged: PulseApiSocial = {};
        for (const data of responses) {
          if (!data?.social) continue;
          Object.assign(merged, data.social);
        }

        // Aggregate bullish-vs-bearish per whale (Tailing excluded from math).
        const agg = new Map<string, { bullish: number; total: number }>();
        for (const [positionId, record] of Object.entries(merged)) {
          const whaleId = positionToWhale.get(positionId);
          if (!whaleId) continue;
          const counts = record.reactionCounts;
          const bullish = counts.Bullish ?? 0;
          const bearish = counts.Bearish ?? 0;
          // Fix 1: subtotal excludes Tailing — percentage and vote count are
          // bullish-vs-bearish only.
          const subtotal = bullish + bearish;
          if (subtotal === 0) continue;
          const existing = agg.get(whaleId) ?? { bullish: 0, total: 0 };
          agg.set(whaleId, {
            bullish: existing.bullish + bullish,
            total: existing.total + subtotal,
          });
        }

        const result: Record<string, TraderSentiment> = {};
        for (const [whaleId, counts] of agg) {
          result[whaleId] = counts;
        }

        // Latch the key only after a successful, non-cancelled commit.
        fetchedKeyRef.current = capturedKey;
        setSentiment(result);
      })
      .catch(() => {
        // Sentiment is non-critical — silently ignore unexpected failures.
      });

    return () => {
      cancelled = true;
    };
  }, [positionIdsKey, positionToWhale]);

  return sentiment;
}
