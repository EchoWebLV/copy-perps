"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Eye, Flame, MessageCircle, TrendingDown, Zap } from "lucide-react";
import type { WhalePositionSignal } from "@/lib/types";
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
} from "@/components/v2/ui";
import { WhaleFingerprintAvatar } from "./WhaleFingerprintAvatar";
import {
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
import { formatWhalePositionAge } from "./whale-position-age";

const POLL_MS = 10_000;

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

export function WhalePulseFeed({ initialPositions }: Props) {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [positions, setPositions] =
    useState<WhalePositionSignal[]>(initialPositions);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/live?limit=1000", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { positions: WhalePositionSignal[] };
      setPositions(data.positions);
    } catch {
      // Keep the current Pulse tape visible if a refresh misses.
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => buildPulseItems(positions, now),
    [positions, now],
  );
  const positionIds = useMemo(
    () => [...new Set(items.map((item) => item.position.positionId))],
    [items],
  );
  const positionIdsParam = useMemo(
    () => positionIds.map(encodeURIComponent).join(","),
    [positionIds],
  );
  const stats = useMemo(() => buildPulseStats(positions), [positions]);
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
      className="h-full w-full overflow-hidden"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="no-scrollbar mx-auto h-full w-full max-w-2xl overflow-y-auto pb-32 lg:max-w-4xl lg:px-6 lg:pb-8">
        <header
          className="border-b-2 px-5 pt-5 pb-3"
          style={{ background: BG, borderColor: FAINT }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Headline size={28}>PULSE</Headline>
              <p
                className="mt-1 truncate text-[11px]"
                style={{ color: DIM, fontFamily: FONT_BODY }}
              >
                Live tape for whale positions and copyable tails.
              </p>
            </div>
            <div
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase"
              style={{
                background: `${ACCENT}20`,
                color: ACCENT,
                border: `1px solid ${ACCENT}40`,
              }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }}
              />
              Live
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatChip label="Whales" value={stats.whales} />
            <StatChip label="Open" value={stats.positions} />
            <StatChip label="Copyable" value={stats.copyable} />
          </div>
        </header>

        {items.length === 0 ? (
          <EmptyPulse />
        ) : (
          <ul className="divide-y" style={{ borderColor: FAINT }}>
            {items.map((item) => (
              <PulsePost
                key={item.id}
                item={item}
                now={now}
                selectedReaction={
                  persistedSocial[item.position.positionId]?.myReaction ?? undefined
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
                  setTailSource(toTailSource(item.position));
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function PulsePost({
  item,
  now,
  selectedReaction,
  persistedSocial,
  onReact,
  onTail,
}: {
  item: PulseItem;
  now: number;
  selectedReaction?: PulseReaction;
  persistedSocial?: PulseApiSocialRecord;
  onReact: (reaction: PulseReaction) => void;
  onTail: () => void;
}) {
  const p = item.position;
  const sideColor = p.side === "long" ? GREEN : RED;
  const profit = (p.unrealizedPnlPct ?? 0) >= 0;
  const counts = persistedSocial?.reactionCounts ?? emptySocialCounts();
  const aiLine = buildAiLine(item);
  const recentReactors = persistedSocial?.recentReactors ?? [];

  return (
    <li className="px-5 py-4">
      <article className="flex items-start gap-3">
        <WhaleFingerprintAvatar
          sourceAccount={p.sourceAccount}
          label={p.displayName}
          mood={p.stale ? "WOUNDED" : "HUNTING"}
          size={42}
          pulse={!p.stale}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div
                className="truncate text-[12px] font-black uppercase"
                style={{ color: FG }}
              >
                {p.displayName}
              </div>
              <div
                className="mt-0.5 text-[10px] font-black uppercase"
                style={{ color: DIM }}
              >
                {item.eyebrow} | {p.source}
              </div>
            </div>
            <div
              className="shrink-0 text-right text-[10px] font-black uppercase"
              style={{ color: DIM }}
            >
              <div>Holding</div>
              <div style={{ color: FG }}>
                {formatWhalePositionAge(p.openedAtMs, now)}
              </div>
            </div>
          </div>

          <h2
            className="mt-2 text-[18px] font-black uppercase leading-tight"
            style={{ color: FG }}
          >
            <PulseHeadlineText headline={item.headline} />
          </h2>

          <p
            className="mt-2 text-[13px] leading-snug"
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

          <div
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
            style={{ fontFamily: FONT_BODY }}
          >
            <Metric label="Notional" value={fmtUsd(p.notionalUsd)} />
            <Metric
              label="Source P/L"
              value={formatPct(p.unrealizedPnlPct)}
              color={profit ? GREEN : RED}
            />
            <Metric label="Entry" value={fmtPrice(p.entryPrice)} />
            <Metric
              label="Now"
              value={p.currentMark === null ? "N/A" : fmtPrice(p.currentMark)}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
              style={{
                background: `${sideColor}18`,
                color: sideColor,
                border: `1px solid ${sideColor}45`,
              }}
            >
              {p.market} {p.side} {p.leverage}x
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
              style={{
                background: p.stale ? `${RED}18` : `${GREEN}18`,
                color: p.stale ? RED : GREEN,
                border: `1px solid ${p.stale ? `${RED}45` : `${GREEN}45`}`,
              }}
            >
              {p.stale ? "Stale" : "Live"}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
              {item.canTail ? "Tail" : "Watch only"}
            </button>
          </div>

          {recentReactors.length > 0 ? (
            <RecentReactions reactors={recentReactors} />
          ) : null}
        </div>
      </article>
    </li>
  );
}

function PulseHeadlineText({ headline }: { headline: string }) {
  return (
    <>
      {splitPulseHeadline(headline).map((part, index) => (
        <span
          key={`${part.text}:${index}`}
          style={part.tone ? { color: pulseHeadlineColor(part.tone) } : undefined}
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
      <span>{label}</span>
      <span style={{ color: active ? color : mutedColor }}>{count}</span>
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

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{ background: PANEL, border: `1px solid ${FAINT}` }}
    >
      <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
        {label}
      </div>
      <div className="text-[18px] font-black tabular-nums" style={{ color: FG }}>
        {value.toLocaleString("en-US")}
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

function buildPulseStats(positions: WhalePositionSignal[]) {
  const whales = new Set(positions.map((position) => position.payload.whaleId));
  return {
    whales: whales.size,
    positions: positions.length,
    copyable: positions.filter(
      (position) =>
        !position.payload.stale &&
        position.payload.copyableOnPacifica !== false,
    ).length,
  };
}

function emptySocialCounts(): Record<PulseReaction, number> {
  return {
    Tailing: 0,
    Bullish: 0,
    Bearish: 0,
  };
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

function toTailSource(position: WhalePositionSignal["payload"]): TailSource {
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
    stale: position.stale,
    positions: [
      {
        sourcePositionId: position.positionId,
        asset: position.market,
        side: position.side,
        leverage: position.leverage,
        maxLeverage: position.maxLeverage,
        entryMark: position.entryPrice,
        currentMark: position.currentMark,
        stale: position.stale,
        copyableOnPacifica: position.copyableOnPacifica,
        notionalUsd: position.notionalUsd,
        unrealizedPnlPct: position.unrealizedPnlPct,
      },
    ],
  };
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

function fmtUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function reactionVerb(reaction: PulseReaction): string {
  if (reaction === "Tailing") return "is tailing";
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
