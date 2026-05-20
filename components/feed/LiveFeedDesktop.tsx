"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, Zap } from "lucide-react";
import type { BotSignal } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  GREEN,
  Headline,
  PANEL,
  PANEL_2,
  RED,
  Stamp,
  StoryAvatar,
} from "@/components/v2/ui";
import { computeLivePaperPnlPct } from "@/lib/bots/pnl";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { BotChatSheet } from "./BotChatSheet";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { flattenBotPositions, type FlatPosition } from "./live-positions";

export function LiveFeedDesktop({
  bots,
  botFilter,
}: {
  bots: BotSignal[];
  botFilter: string | null;
}) {
  const liveMarks = useLiveMarks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatBotId, setChatBotId] = useState<string | null>(null);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const positions = useMemo(() => {
    return flattenBotPositions(bots, botFilter).map((pos) => {
      const liveMark = liveMarks[pos.asset] ?? pos.currentMark;
      const livePct = computeLivePaperPnlPct({
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        currentMark: liveMark,
        asset: pos.asset,
        stakeUsd: pos.stakeUsd,
      });
      return {
        ...pos,
        currentMark: liveMark,
        livePaperPnlPct: livePct,
        livePaperPnlUsd: livePct * pos.stakeUsd,
      };
    });
  }, [bots, botFilter, liveMarks]);

  const fallbackPosition = positions[0] ?? null;
  const selected =
    positions.find((position) => position.positionId === selectedId) ??
    fallbackPosition;
  const chatBot = bots.find((bot) => bot.payload.botId === chatBotId) ?? null;

  useEffect(() => {
    const fallbackId = fallbackPosition?.positionId ?? null;
    if (selectedId === null) {
      if (fallbackId !== null) setSelectedId(fallbackId);
      return;
    }
    if (!positions.some((position) => position.positionId === selectedId)) {
      setSelectedId(fallbackId);
    }
  }, [fallbackPosition?.positionId, positions, selectedId]);

  return (
    <AppShell
      rail={
        selected ? (
          <LiveRail
            pos={selected}
            onTail={() => setTailSource(toTailSource(selected))}
            onChat={() => setChatBotId(selected.bot.botId)}
          />
        ) : null
      }
      railTitle="Position Context"
      mainClassName="overflow-hidden"
    >
      <div className="grid h-full grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-4 p-4">
        <section
          className="min-h-0 overflow-hidden rounded-2xl"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          <div className="border-b px-4 py-3" style={{ borderColor: FAINT }}>
            <Headline size={30}>{`"LIVE"`}</Headline>
          </div>
          <div className="no-scrollbar h-[calc(100%-60px)] overflow-y-auto p-3">
            {positions.map((pos) => (
              <button
                key={pos.positionId}
                type="button"
                onClick={() => setSelectedId(pos.positionId)}
                aria-pressed={pos.positionId === selected?.positionId}
                className="mb-2 w-full rounded-xl p-3 text-left"
                style={{
                  background:
                    pos.positionId === selected?.positionId
                      ? PANEL_2
                      : "transparent",
                  border: `1px solid ${
                    pos.positionId === selected?.positionId ? ACCENT : FAINT
                  }`,
                }}
              >
                <div className="flex items-center gap-3">
                  <StoryAvatar
                    emoji={pos.bot.avatarEmoji}
                    imageUrl={pos.bot.avatarImageUrl}
                    mood={pos.bot.mood ?? "DORMANT"}
                    size={38}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-black uppercase">
                      {pos.bot.botName}
                    </div>
                    <div
                      className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      {pos.asset} · {pos.side} ×{pos.leverage}
                    </div>
                  </div>
                  <span
                    className="text-[13px] font-black"
                    style={{
                      color: pos.livePaperPnlPct >= 0 ? GREEN : RED,
                    }}
                  >
                    {pos.livePaperPnlPct >= 0 ? "+" : ""}
                    {(pos.livePaperPnlPct * 100).toFixed(1)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
        <section
          className="min-h-0 overflow-hidden rounded-2xl p-5"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          {selected ? (
            <LivePositionHero
              pos={selected}
              onTail={() => setTailSource(toTailSource(selected))}
              onChat={() => setChatBotId(selected.bot.botId)}
            />
          ) : (
            <EmptyLive />
          )}
        </section>
      </div>

      {chatBot && (
        <BotChatSheet
          botId={chatBot.payload.botId}
          botName={chatBot.payload.botName}
          avatarEmoji={chatBot.payload.avatarEmoji}
          avatarImageUrl={chatBot.payload.avatarImageUrl}
          openingThoughts={chatBot.payload.currentPositions.map((position) => ({
            asset: position.asset,
            side: position.side,
            narration: position.narrationOpen,
          }))}
          onClose={() => setChatBotId(null)}
        />
      )}
      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </AppShell>
  );
}

function LivePositionHero({
  pos,
  onTail,
  onChat,
}: {
  pos: FlatPosition;
  onTail: () => void;
  onChat: () => void;
}) {
  const profit = pos.livePaperPnlPct >= 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 pb-4">
        <Stamp
          label="Selected Position"
          value={pos.bot.botName.toUpperCase()}
        />
        <div className="mt-5 flex items-center gap-4">
          <StoryAvatar
            emoji={pos.bot.avatarEmoji}
            imageUrl={pos.bot.avatarImageUrl}
            mood={pos.bot.mood ?? "DORMANT"}
            size={70}
          />
          <div>
            <Headline size={52}>{pos.asset}</Headline>
            <div
              className="mt-2 text-[13px] font-black uppercase tracking-widest"
              style={{ color: pos.side === "long" ? GREEN : RED }}
            >
              {pos.side} ×{pos.leverage}
            </div>
          </div>
        </div>
        <div
          className="mt-8 rounded-2xl p-5"
          style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
        >
          <div
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            Live P/L
          </div>
          <div
            className="mt-2 text-[46px] font-black tabular-nums"
            style={{ color: profit ? GREEN : RED }}
          >
            {profit ? "+" : ""}
            {(pos.livePaperPnlPct * 100).toFixed(2)}%
          </div>
        </div>
        {pos.narrationOpen && (
          <p className="mt-5 text-lg leading-snug italic">
            "{pos.narrationOpen}"
          </p>
        )}
      </div>
      <div className="shrink-0 pt-3 flex gap-3">
        <button
          type="button"
          onClick={onTail}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-black uppercase tracking-widest"
          style={{ background: ACCENT, color: BG }}
        >
          <Zap size={14} fill={BG} /> Tail
        </button>
        <button
          type="button"
          onClick={onChat}
          className="rounded-2xl px-4 py-3"
          aria-label="Open chat"
          style={{
            background: PANEL_2,
            color: FG,
            border: `1px solid ${FAINT}`,
          }}
        >
          <MessageCircle size={16} />
        </button>
      </div>
    </div>
  );
}

function LiveRail({
  pos,
  onTail,
  onChat,
}: {
  pos: FlatPosition;
  onTail: () => void;
  onChat: () => void;
}) {
  return <LivePositionHero pos={pos} onTail={onTail} onChat={onChat} />;
}

function EmptyLive() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Headline size={34}>{`"WATCHING THE TAPE"`}</Headline>
      <Link
        href="/feed"
        className="mt-5 rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest"
        style={{
          background: PANEL_2,
          color: FG,
          border: `1px solid ${FAINT}`,
        }}
      >
        Back to roster
      </Link>
    </div>
  );
}

function toTailSource(pos: FlatPosition): TailSource {
  return {
    kind: "bot",
    botId: pos.bot.botId,
    botName: pos.bot.botName,
    avatarEmoji: pos.bot.avatarEmoji,
    avatarImageUrl: pos.bot.avatarImageUrl,
    asset: pos.asset,
    side: pos.side,
    leverage: pos.leverage,
    entryMark: pos.entryMark,
    positionId: pos.positionId,
  };
}
