"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Eye, Flame, MessageCircle, TrendingDown, Zap } from "lucide-react";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";
import { isSourceFresh } from "@/lib/whales/identity";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_BODY,
  FONT_DISPLAY,
  GREEN,
  Headline,
  PANEL,
  PANEL_2,
  RED,
  STREAK,
} from "@/components/v2/ui";
import { WhaleFingerprintAvatar } from "./WhaleFingerprintAvatar";
import {
  getPulseHeadlineBrushVariant,
  splitPulseHeadline,
  type PulseHeadlineTone,
} from "./pulse-headline";
import { buildPulseItems, type PulseItem } from "./pulse-items";
import {
  getPulseReactionTone,
  PULSE_REACTIONS,
  type PulseCommentProfile,
  type PulseReaction,
} from "./pulse-social";
import {
  getVisiblePulsePositionId,
  restoreVisiblePulsePosition,
} from "./pulse-scroll-stability";
import { mergePulsePositionSignals } from "./pulse-position-retention";
import { formatPriceUsd, formatUsd } from "./whale-money";
import { formatWhalePositionTime } from "./whale-position-age";

const POLL_MS = 10_000;
const ROSTER_STATS_POLL_MS = 30_000;
const PERCENTAGE_BRUSH_STYLES = [
  {
    background:
      "linear-gradient(94deg, rgba(255,244,95,0.92) 0%, #fae500 42%, rgba(255,189,47,0.96) 100%)",
    clipPath:
      "polygon(3% 18%, 96% 5%, 100% 47%, 94% 88%, 8% 96%, 0 58%)",
    transform: "rotate(-1.8deg)",
    boxShadow: "0 0 26px rgba(250,229,0,0.34)",
  },
  {
    background:
      "linear-gradient(88deg, rgba(255,216,59,0.94) 0%, #fae500 58%, rgba(255,247,132,0.9) 100%)",
    clipPath:
      "polygon(0 33%, 10% 9%, 88% 0, 100% 28%, 95% 83%, 13% 100%, 3% 75%)",
    transform: "rotate(1.4deg)",
    boxShadow: "0 0 22px rgba(250,229,0,0.3)",
  },
  {
    background:
      "linear-gradient(101deg, rgba(255,247,118,0.94) 0%, #fae500 48%, rgba(255,198,43,0.95) 100%)",
    clipPath:
      "polygon(5% 7%, 91% 14%, 99% 38%, 92% 97%, 2% 85%, 0 32%)",
    transform: "rotate(-0.6deg)",
    boxShadow: "0 0 24px rgba(250,229,0,0.32)",
  },
] satisfies CSSProperties[];

interface Props {
  initialPositions: WhalePositionSignal[];
}

interface PulseApiRecentReactor {
  reaction: PulseReaction;
  profile: PulseCommentProfile;
}

interface PulseApiSocialRecord {
  reactionCounts: Record<PulseReaction, number>;
  commentsCount: number;
  myReaction: PulseReaction | null;
  comments: unknown[];
  recentReactors: PulseApiRecentReactor[];
}

type PulseApiSocial = Record<string, PulseApiSocialRecord>;

interface PulseWhaleStats {
  winRatePct1d: number | null;
  pnl30dUsdc: number;
}

export function WhalePulseFeed({ initialPositions }: Props) {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [positions, setPositions] =
    useState<WhalePositionSignal[]>(initialPositions);
  const [statsByWhaleId, setStatsByWhaleId] = useState<
    Record<string, PulseWhaleStats>
  >({});
  const [tailSource, setTailSource] = useState<TailSource | null>(null);
  const [now, setNow] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activePositionIdRef = useRef<string | null>(null);

  const rememberVisiblePulsePosition = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    activePositionIdRef.current =
      getVisiblePulsePositionId(container) ?? activePositionIdRef.current;
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/live?limit=1000", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { positions: WhalePositionSignal[] };
      rememberVisiblePulsePosition();
      setPositions((current) =>
        mergePulsePositionSignals(current, data.positions, Date.now()),
      );
    } catch {
      // Keep the current Pulse tape visible if a refresh misses.
    }
  }, [rememberVisiblePulsePosition]);

  useVisiblePoll(load, POLL_MS);

  const loadWhaleStats = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/roster", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { whales: WhaleTraderSignal[] };
      setStatsByWhaleId(buildPulseWhaleStats(data.whales));
    } catch {
      // Keep cards readable when whale profile stats miss a refresh.
    }
  }, []);

  useEffect(() => {
    void loadWhaleStats();
  }, [loadWhaleStats]);

  useVisiblePoll(loadWhaleStats, ROSTER_STATS_POLL_MS);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => buildPulseItems(positions, now),
    [positions, now],
  );

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || items.length === 0) {
      activePositionIdRef.current = null;
      return;
    }

    const activePositionId = activePositionIdRef.current;
    if (
      activePositionId &&
      restoreVisiblePulsePosition(container, activePositionId)
    ) {
      return;
    }

    activePositionIdRef.current = getVisiblePulsePositionId(container);
  }, [items]);
  const positionIds = useMemo(
    () => [...new Set(items.map((item) => item.position.positionId))],
    [items],
  );
  const positionIdsParam = useMemo(
    () => positionIds.map(encodeURIComponent).join(","),
    [positionIds],
  );
  const [persistedSocial, setPersistedSocial] = useState<PulseApiSocial>({});

  const mergePulseSocial = useCallback((social: PulseApiSocial) => {
    setPersistedSocial((current) => ({ ...current, ...social }));
  }, []);

  const requirePulseAuth = useCallback(() => {
    if (!ready) return false;
    if (!authenticated) {
      login();
      return false;
    }
    return true;
  }, [authenticated, login, ready]);

  useEffect(() => {
    if (!positionIdsParam) return;
    let cancelled = false;

    async function loadPulseSocial() {
      const token = authenticated
        ? await getAccessToken().catch(() => null)
        : null;
      const r = await fetch(`/api/pulse/social?positionIds=${positionIdsParam}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) return;
      const data = (await r.json()) as { social?: PulseApiSocial };
      if (!cancelled && data.social) mergePulseSocial(data.social);
    }

    void loadPulseSocial();
    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken, mergePulseSocial, positionIdsParam]);

  const postPulseSocial = useCallback(
    async (body: {
      positionId: string;
      reaction?: PulseReaction | null;
      comment?: string;
    }): Promise<boolean> => {
      if (!requirePulseAuth()) return false;
      const token = await getAccessToken().catch(() => null);
      if (!token) {
        login();
        return false;
      }

      const r = await fetch("/api/pulse/social", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) return false;
      const data = (await r.json()) as { social?: PulseApiSocial };
      if (data.social) mergePulseSocial(data.social);
      return true;
    },
    [getAccessToken, login, mergePulseSocial, requirePulseAuth],
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      {items.length === 0 ? (
        <EmptyPulse />
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={rememberVisiblePulsePosition}
            className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll lg:hidden"
            style={{ scrollSnapStop: "always" }}
          >
            {items.map((item, index) => (
              <section
                key={item.id}
                data-pulse-position-id={item.position.positionId}
                className="h-full w-full snap-start"
              >
                <PulsePositionCard
                  item={item}
                  now={now}
                  slideIndex={index}
                  total={items.length}
                  whaleStats={statsByWhaleId[item.position.whaleId]}
                  selectedReaction={
                    persistedSocial[item.position.positionId]?.myReaction ??
                    undefined
                  }
                  persistedSocial={persistedSocial[item.position.positionId]}
                  onReact={(reaction) => {
                    if (!requirePulseAuth()) return;
                    const positionId = item.position.positionId;
                    const current = persistedSocial[positionId]?.myReaction;
                    const next = current === reaction ? undefined : reaction;
                    void postPulseSocial({
                      positionId,
                      reaction: next ?? null,
                    });
                  }}
                  onTail={() => {
                    if (!requirePulseAuth()) return;
                    setTailSource(toTailSource(item.position, now));
                  }}
                />
              </section>
            ))}
          </div>

          <div className="hidden h-full min-h-0 flex-col lg:flex">
            <div
              className="flex flex-none items-center justify-between gap-4 border-b px-6 py-4"
              style={{ borderColor: FAINT }}
            >
              <div>
                <div
                  className="text-[10px] font-black uppercase tracking-[0.24em]"
                  style={{ color: DIM }}
                >
                  PULSE TAPE
                </div>
                <div className="mt-1 text-[22px] font-black uppercase leading-none">
                  {items.length} live signals
                </div>
              </div>
              <div
                className="rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
                style={{ background: PANEL, border: `1px solid ${FAINT}`, color: FG }}
              >
                Whale positions
              </div>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid auto-rows-max grid-cols-2 gap-3 xl:grid-cols-3">
                {items.map((item) => (
                  <DesktopPulseCard
                    key={item.id}
                    item={item}
                    now={now}
                    whaleStats={statsByWhaleId[item.position.whaleId]}
                    selectedReaction={
                      persistedSocial[item.position.positionId]?.myReaction ??
                      undefined
                    }
                    persistedSocial={persistedSocial[item.position.positionId]}
                    onReact={(reaction) => {
                      if (!requirePulseAuth()) return;
                      const positionId = item.position.positionId;
                      const current = persistedSocial[positionId]?.myReaction;
                      const next = current === reaction ? undefined : reaction;
                      void postPulseSocial({
                        positionId,
                        reaction: next ?? null,
                      });
                    }}
                    onTail={() => {
                      if (!requirePulseAuth()) return;
                      setTailSource(toTailSource(item.position, now));
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function PulsePositionCard({
  item,
  now,
  slideIndex,
  total,
  whaleStats,
  selectedReaction,
  persistedSocial,
  onReact,
  onTail,
}: {
  item: PulseItem;
  now: number;
  slideIndex: number;
  total: number;
  whaleStats?: PulseWhaleStats;
  selectedReaction?: PulseReaction;
  persistedSocial?: PulseApiSocialRecord;
  onReact: (reaction: PulseReaction) => void;
  onTail: () => void;
}) {
  const rawPosition = item.position;
  const dynamicStale =
    rawPosition.stale ||
    (now > 0 && !isSourceFresh(rawPosition.lastSeenAtMs, undefined, now));
  const p = { ...rawPosition, stale: dynamicStale };
  const sideColor = p.side === "long" ? GREEN : RED;
  const profit = (p.unrealizedPnlPct ?? 0) >= 0;
  const counts = persistedSocial?.reactionCounts ?? emptySocialCounts();
  const aiLine = buildAiLine(item);
  const recentReactors = persistedSocial?.recentReactors ?? [];
  const positionTime = formatWhalePositionTime(p, now);

  return (
    <article className="mx-auto flex h-full w-full max-w-2xl flex-col px-5 pt-5 pb-28 lg:max-w-4xl lg:px-8 lg:py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Headline size={28}>PULSE</Headline>
          <div
            className="mt-1 truncate text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {item.eyebrow} | {p.source}
          </div>
        </div>
        <div
          className="shrink-0 rounded-full px-3 py-1.5 text-right text-[10px] font-black uppercase"
          style={{
            background: p.stale ? `${STREAK}14` : `${GREEN}18`,
            color: p.stale ? STREAK : GREEN,
            border: `1px solid ${p.stale ? `${STREAK}38` : `${GREEN}45`}`,
          }}
        >
          {String(slideIndex + 1).padStart(2, "0")} /{" "}
          {String(total).padStart(2, "0")} {p.stale ? "Mark delayed" : "Live"}
        </div>
      </div>

      <div
        className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl p-4 lg:p-6"
        style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
      >
        <div className="flex items-start gap-3">
          <WhaleFingerprintAvatar
            sourceAccount={p.sourceAccount}
            label={p.displayName}
            mood={p.stale ? "WOUNDED" : "HUNTING"}
            size={52}
            pulse={!p.stale}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="truncate text-[13px] font-black uppercase"
                  style={{ color: FG }}
                >
                  {p.displayName}
                </div>
                <div
                  className="mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
                  style={{
                    background: `${sideColor}18`,
                    color: sideColor,
                    border: `1px solid ${sideColor}45`,
                  }}
                >
                  {p.market} {p.side} {p.leverage}x
                </div>
              </div>
              <div
                className="shrink-0 text-right text-[10px] font-black uppercase"
                style={{ color: DIM }}
              >
                <div>{positionTime.label}</div>
                <div style={{ color: FG }}>
                  {positionTime.value}
                </div>
              </div>
            </div>
          </div>
        </div>

          <h2
            className="mt-4 text-[24px] font-black uppercase leading-[0.98] lg:text-[36px]"
            style={{ color: FG }}
          >
            <PulseHeadlineText headline={item.headline} />
          </h2>

          <p
            className="mt-3 text-[13px] leading-snug lg:text-[15px]"
            style={{ color: FG, fontFamily: FONT_BODY, opacity: 0.88 }}
          >
            {item.context}
          </p>

          {aiLine ? (
            <div
              className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-snug"
              style={{
                background: PANEL,
                border: `1px solid ${FAINT}`,
                color: DIM,
                fontFamily: FONT_BODY,
              }}
            >
              <MessageCircle
                size={14}
                strokeWidth={2.6}
                className="mt-0.5 shrink-0"
                style={{ color: ACCENT }}
              />
              <span>{aiLine}</span>
            </div>
          ) : null}

          {/* Only render stats we actually have — a grid half-full of
              N/A reads as broken, not informative. */}
          <div
            className="mt-4 grid grid-cols-2 gap-2"
            style={{ fontFamily: FONT_BODY }}
          >
            {availableMetrics(p, whaleStats, profit).map((m) => (
              <Metric
                key={m.label}
                label={m.label}
                value={m.value}
                color={m.color}
              />
            ))}
          </div>

          {recentReactors.length > 0 ? (
            <RecentReactions reactors={recentReactors} />
          ) : null}

          <div className="mt-auto flex flex-col gap-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-nowrap gap-1 sm:flex-wrap sm:gap-2">
              {PULSE_REACTIONS.map((reaction) => (
                <ReactionButton
                  key={reaction}
                  label={reaction}
                  count={counts[reaction]}
                  active={selectedReaction === reaction}
                  onClick={() => onReact(reaction)}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={onTail}
              disabled={!item.canTail}
              className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[11px] font-black uppercase transition active:scale-[0.97] disabled:cursor-not-allowed"
              style={{
                background: item.canTail ? ACCENT : "rgba(250,250,242,0.08)",
                color: item.canTail ? BG : DIM,
                border: `1px solid ${item.canTail ? ACCENT : FAINT}`,
              }}
            >
              {item.canTail ? (
                <Zap size={13} strokeWidth={3} fill={BG} />
              ) : (
                <Eye size={13} strokeWidth={3} />
              )}
              {item.canTail ? "Copy now" : "Watch only"}
            </button>
          </div>
      </div>
    </article>
  );
}

function DesktopPulseCard({
  item,
  now,
  whaleStats,
  selectedReaction,
  persistedSocial,
  onReact,
  onTail,
}: {
  item: PulseItem;
  now: number;
  whaleStats?: PulseWhaleStats;
  selectedReaction?: PulseReaction;
  persistedSocial?: PulseApiSocialRecord;
  onReact: (reaction: PulseReaction) => void;
  onTail: () => void;
}) {
  const rawPosition = item.position;
  const dynamicStale =
    rawPosition.stale ||
    (now > 0 && !isSourceFresh(rawPosition.lastSeenAtMs, undefined, now));
  const p = { ...rawPosition, stale: dynamicStale };
  const sideColor = p.side === "long" ? GREEN : RED;
  const profit = (p.unrealizedPnlPct ?? 0) >= 0;
  const counts = persistedSocial?.reactionCounts ?? emptySocialCounts();
  const aiLine = buildAiLine(item);
  const recentReactors = persistedSocial?.recentReactors ?? [];
  const positionTime = formatWhalePositionTime(p, now);

  return (
    <article
      className="flex min-h-[430px] flex-col overflow-hidden p-4"
      style={{
        background: PANEL_2,
        borderRadius: 8,
        border: `1px solid ${FAINT}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {item.eyebrow}
          </div>
          <div
            className="mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
            style={{
              background: `${sideColor}18`,
              color: sideColor,
              border: `1px solid ${sideColor}45`,
            }}
          >
            {p.market} {p.side} {p.leverage}x
          </div>
        </div>
        <div
          className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase"
          style={{
            background: p.stale ? `${STREAK}14` : `${GREEN}18`,
            color: p.stale ? STREAK : GREEN,
            border: `1px solid ${p.stale ? `${STREAK}38` : `${GREEN}45`}`,
          }}
        >
          {p.stale ? "Mark delayed" : "Live"}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <WhaleFingerprintAvatar
          sourceAccount={p.sourceAccount}
          label={p.displayName}
          mood={p.stale ? "WOUNDED" : "HUNTING"}
          size={44}
          pulse={!p.stale}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-black uppercase">
            {p.displayName}
          </div>
          <div
            className="mt-0.5 text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {positionTime.label}{" "}
            <span style={{ color: FG }}>{positionTime.value}</span>
          </div>
        </div>
      </div>

      <h2
        className="mt-4 text-[23px] font-black uppercase leading-[1.02]"
        style={{ color: FG }}
      >
        <PulseHeadlineText headline={item.headline} />
      </h2>

      <p
        className="mt-3 text-[13px] leading-snug"
        style={{ color: FG, fontFamily: FONT_BODY, opacity: 0.86 }}
      >
        {item.context}
      </p>

      {aiLine ? (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-snug"
          style={{
            background: PANEL,
            border: `1px solid ${FAINT}`,
            color: DIM,
            fontFamily: FONT_BODY,
          }}
        >
          <MessageCircle
            size={14}
            strokeWidth={2.6}
            className="mt-0.5 shrink-0"
            style={{ color: ACCENT }}
          />
          <span>{aiLine}</span>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2" style={{ fontFamily: FONT_BODY }}>
        {availableMetrics(p, whaleStats, profit).map((m) => (
          <Metric key={m.label} label={m.label} value={m.value} color={m.color} />
        ))}
      </div>

      {recentReactors.length > 0 ? (
        <RecentReactions reactors={recentReactors} />
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {PULSE_REACTIONS.map((reaction) => (
            <DesktopPulseReactionButton
              key={reaction}
              label={reaction}
              count={counts[reaction]}
              active={selectedReaction === reaction}
              onClick={() => onReact(reaction)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onTail}
          disabled={!item.canTail}
          className="inline-flex w-auto items-center justify-center gap-2 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed"
          style={{
            background: item.canTail ? ACCENT : "rgba(250,250,242,0.08)",
            color: item.canTail ? BG : DIM,
            border: `1px solid ${item.canTail ? ACCENT : FAINT}`,
          }}
        >
          {item.canTail ? (
            <Zap size={13} strokeWidth={3} fill={BG} />
          ) : (
            <Eye size={13} strokeWidth={3} />
          )}
          {item.canTail ? "Copy now" : "Watch"}
        </button>
      </div>
    </article>
  );
}

function PulseHeadlineText({ headline }: { headline: string }) {
  const brushStyle =
    PERCENTAGE_BRUSH_STYLES[getPulseHeadlineBrushVariant(headline)];

  return (
    <>
      {splitPulseHeadline(headline).map((part, index) => (
        <span
          key={`${part.text}:${index}`}
          className={
            part.role === "percentage"
              ? "inline-flex items-center rounded-md px-2 py-0.5 text-[1.12em] leading-none shadow-[0_0_24px_rgba(250,229,0,0.28)]"
              : undefined
          }
          style={
            part.role === "percentage"
              ? {
                  color: BG,
                  marginInline: "0.06em",
                  paddingInline: "0.38em",
                  paddingBlock: "0.09em",
                  textShadow: "0 1px 0 rgba(255,255,255,0.28)",
                  ...brushStyle,
                }
              : part.tone
                ? { color: pulseHeadlineColor(part.tone) }
                : undefined
          }
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

function pulseHeadlineColor(tone: PulseHeadlineTone): string {
  return tone === "green" ? GREEN : RED;
}

function ReactionButton({
  label,
  count,
  active,
  onClick,
}: {
  label: PulseReaction;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = pulseReactionColor(label);
  const mutedColor = label === "Tailing" ? DIM : `${color}cc`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1.5 text-[9px] font-black uppercase transition active:scale-[0.97] sm:flex-none sm:gap-1.5 sm:px-3 sm:text-[10px]"
      style={{
        background: active ? `${color}24` : PANEL_2,
        color: active || label !== "Tailing" ? color : FG,
        border: `1px solid ${active ? `${color}70` : label === "Tailing" ? FAINT : `${color}55`}`,
      }}
    >
      {label === "Bullish" ? (
        <Flame className="shrink-0" size={12} strokeWidth={3} style={{ color }} />
      ) : label === "Bearish" ? (
        <TrendingDown
          className="shrink-0"
          size={12}
          strokeWidth={3}
          style={{ color }}
        />
      ) : (
        <Zap
          className="shrink-0"
          size={12}
          strokeWidth={3}
          fill={active ? ACCENT : "none"}
        />
      )}
      <span>{reactionDisplayLabel(label)}</span>
      {count > 0 ? (
        <span style={{ color: active ? color : mutedColor }}>{count}</span>
      ) : null}
    </button>
  );
}

function DesktopPulseReactionButton({
  label,
  count,
  active,
  onClick,
}: {
  label: PulseReaction;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = pulseReactionColor(label);
  const mutedColor = label === "Tailing" ? DIM : `${color}cc`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-auto items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[10px] font-black uppercase transition hover:opacity-90 active:scale-[0.97]"
      style={{
        background: active ? `${color}24` : PANEL,
        color: active || label !== "Tailing" ? color : FG,
        border: `1px solid ${active ? `${color}70` : label === "Tailing" ? FAINT : `${color}55`}`,
      }}
    >
      {label === "Bullish" ? (
        <Flame className="shrink-0" size={12} strokeWidth={3} style={{ color }} />
      ) : label === "Bearish" ? (
        <TrendingDown
          className="shrink-0"
          size={12}
          strokeWidth={3}
          style={{ color }}
        />
      ) : (
        <Zap
          className="shrink-0"
          size={12}
          strokeWidth={3}
          fill={active ? ACCENT : "none"}
        />
      )}
      <span>{reactionDisplayLabel(label)}</span>
      {count > 0 ? (
        <span style={{ color: active ? color : mutedColor }}>{count}</span>
      ) : null}
    </button>
  );
}

function pulseReactionColor(reaction: PulseReaction): string {
  const tone = getPulseReactionTone(reaction);
  if (tone === "green") return GREEN;
  if (tone === "red") return RED;
  return ACCENT;
}

function RecentReactions({ reactors }: { reactors: PulseApiRecentReactor[] }) {
  const line = reactors
    .slice(0, 3)
    .map((reactor) => `${reactor.profile.handle} ${reactionVerb(reactor.reaction)}`)
    .join(" | ");

  return (
    <div
      className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: PANEL, border: `1px solid ${FAINT}` }}
    >
      <div className="flex -space-x-1">
        {reactors.slice(0, 3).map((reactor) => (
          <CommentAvatar
            key={`${reactor.profile.handle}:${reactor.reaction}`}
            profile={reactor.profile}
            label={reactor.profile.displayName}
          />
        ))}
      </div>
      <div
        className="min-w-0 truncate text-[10px] font-black uppercase"
        style={{ color: DIM }}
      >
        {line}
      </div>
    </div>
  );
}

function CommentAvatar({
  profile,
  label,
}: {
  profile?: PulseCommentProfile;
  label: string;
}) {
  const seed = profile?.avatarSeed ?? label;
  const colors = avatarColors(seed);
  return (
    <span
      aria-hidden="true"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[9px] font-black uppercase"
      style={{
        background: colors.background,
        color: colors.foreground,
        border: `1px solid ${colors.border}`,
      }}
    >
      {avatarLabel(profile?.displayName ?? label)}
    </span>
  );
}

function Metric({
  label,
  value,
  color = FG,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{ background: PANEL, border: `1px solid ${FAINT}` }}
    >
      <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
        {label}
      </div>
      <div
        className="mt-0.5 truncate text-[14px] font-black tabular-nums"
        style={{ color, fontFamily: FONT_DISPLAY }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyPulse() {
  return (
    <div className="px-5 py-20 text-center">
      <Headline size={30}>NO PULSE YET</Headline>
      <p
        className="mx-auto mt-3 max-w-sm text-[12px] leading-relaxed"
        style={{ color: DIM, fontFamily: FONT_BODY }}
      >
        Open whale positions will appear here as soon as the next source refresh
        lands.
      </p>
    </div>
  );
}

function emptySocialCounts(): Record<PulseReaction, number> {
  return {
    Tailing: 0,
    Bullish: 0,
    Bearish: 0,
  };
}

function buildPulseWhaleStats(
  whales: WhaleTraderSignal[],
): Record<string, PulseWhaleStats> {
  return Object.fromEntries(
    whales.map((whale) => [
      whale.payload.whaleId,
      {
        winRatePct1d: whale.payload.stats.winRatePct1d,
        pnl30dUsdc: whale.payload.stats.pnl30dUsdc,
      },
    ]),
  );
}

function buildAiLine(item: PulseItem): string | null {
  const analysis = item.position.analysis;
  if (!analysis) return null;
  if (item.kind === "pain_trade") return shorten(analysis.risk, 148);
  if (item.kind === "entry_gap" && analysis.entryGapWarning) {
    return shorten(analysis.entryGapWarning, 148);
  }
  return shorten(analysis.thesis || analysis.summary, 148);
}

function toTailSource(
  position: WhalePositionSignal["payload"],
  nowMs: number,
): TailSource {
  const agedStale =
    position.stale || !isPulsePositionFresh(position.lastSeenAtMs, nowMs);
  return {
    kind: "whale",
    whaleId: position.whaleId,
    displayName: position.displayName,
    avatarUrl: position.avatarUrl,
    sourceAccount: position.sourceAccount,
    sourcePositionId: position.positionId,
    asset: position.market,
    side: position.side,
    leverage: position.leverage,
    maxLeverage: position.maxLeverage,
    entryMark: position.entryPrice,
    currentMark: position.currentMark,
    stale: agedStale,
    lastSeenAtMs: position.lastSeenAtMs,
    positions: [
      {
        sourcePositionId: position.positionId,
        asset: position.market,
        side: position.side,
        leverage: position.leverage,
        maxLeverage: position.maxLeverage,
        entryMark: position.entryPrice,
        currentMark: position.currentMark,
        stale: agedStale,
        lastSeenAtMs: position.lastSeenAtMs,
        copyableOnPacifica: position.copyableOnPacifica,
        notionalUsd: position.notionalUsd,
        unrealizedPnlPct: position.unrealizedPnlPct,
      },
    ],
  };
}

function isPulsePositionFresh(lastSeenAtMs: number, nowMs: number): boolean {
  return isSourceFresh(lastSeenAtMs, undefined, nowMs);
}

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

const fmtUsd = formatUsd;
const fmtPrice = formatPriceUsd;

/** Stat tiles for a pulse card, omitting anything we can't compute —
 *  a grid half-full of N/A reads as broken, not informative. */
function availableMetrics(
  p: {
    notionalUsd: number;
    unrealizedPnlPct: number | null;
    entryPrice: number;
    currentMark: number | null;
  },
  whaleStats: PulseWhaleStats | undefined,
  profit: boolean,
): { label: string; value: string; color?: string }[] {
  const metrics: { label: string; value: string; color?: string }[] = [
    { label: "Notional", value: fmtUsd(p.notionalUsd) },
  ];
  if (p.unrealizedPnlPct !== null) {
    metrics.push({
      label: "Source P/L",
      value: formatPct(p.unrealizedPnlPct),
      color: profit ? GREEN : RED,
    });
  }
  metrics.push({ label: "Entry", value: fmtPrice(p.entryPrice) });
  if (p.currentMark !== null) {
    metrics.push({ label: "Now", value: fmtPrice(p.currentMark) });
  }
  if (whaleStats?.winRatePct1d != null) {
    metrics.push({
      label: "1D Win Rate",
      value: formatWinRate(whaleStats.winRatePct1d),
    });
  }
  if (whaleStats) {
    metrics.push({
      label: "30D P/L",
      value: formatSignedUsd(whaleStats.pnl30dUsdc),
      color: whaleStats.pnl30dUsdc >= 0 ? GREEN : RED,
    });
  }
  return metrics;
}

function formatPct(value: number | null): string {
  if (value === null) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatWinRate(value: number | null): string {
  if (value === null) return "N/A";
  return `${value.toFixed(0)}%`;
}

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

/** Display-only label for a reaction chip.
 *  The union value "Tailing" is preserved for API/DB use; the display
 *  maps it to the new copy-verb so UI reads "Copying". */
function reactionDisplayLabel(reaction: PulseReaction): string {
  if (reaction === "Tailing") return "Copying";
  return reaction;
}

function reactionVerb(reaction: PulseReaction): string {
  if (reaction === "Tailing") return "is copying";
  if (reaction === "Bullish") return "is bullish";
  return "is bearish";
}

function avatarLabel(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned || "U").slice(0, 2);
}

function avatarColors(seed: string): {
  background: string;
  foreground: string;
  border: string;
} {
  const hash = hashString(seed);
  const hue = hash % 360;
  const accentHue = (hue + 48) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 72% 42%), hsl(${accentHue} 76% 54%))`,
    foreground: "#fffdf0",
    border: `hsl(${hue} 70% 64% / 0.75)`,
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
