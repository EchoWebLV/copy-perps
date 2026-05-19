"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Zap } from "lucide-react";
import type { BotSignal } from "@/lib/types";
import { computeLivePaperPnlPct } from "@/lib/bots/pnl";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { AppShell } from "@/components/shell/AppShell";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
  StoryAvatar,
  BigNum,
  Headline,
  Stamp,
} from "@/components/v2/ui";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { BotChatSheet } from "./BotChatSheet";
import { pickInitialBotId } from "./bot-selection";

export function BotRosterDesktop({ bots }: { bots: BotSignal[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickInitialBotId(bots),
  );
  const [chatBotId, setChatBotId] = useState<string | null>(null);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);
  const liveMarks = useLiveMarks();

  useEffect(() => {
    const selectedExists =
      selectedId === null ||
      bots.some((bot) => bot.payload.botId === selectedId);
    if (!selectedExists) {
      setSelectedId(pickInitialBotId(bots));
    } else if (selectedId === null && bots.length > 0) {
      setSelectedId(pickInitialBotId(bots));
    }
  }, [bots, selectedId]);

  const liveBots = useMemo(
    () =>
      bots.map((bot) => {
        const livePositions = bot.payload.currentPositions.map((position) => {
          const liveMark = liveMarks[position.asset] ?? position.currentMark;
          const livePaperPnlPct = computeLivePaperPnlPct({
            side: position.side,
            leverage: position.leverage,
            entryMark: position.entryMark,
            currentMark: liveMark,
            asset: position.asset,
            stakeUsd: position.stakeUsd,
          });
          return {
            ...position,
            liveMark,
            livePaperPnlPct,
            livePaperPnlUsd: livePaperPnlPct * position.stakeUsd,
          };
        });
        const liveEquity =
          bot.payload.cashUsd +
          livePositions.reduce(
            (sum, position) => sum + position.livePaperPnlUsd,
            0,
          );
        return { bot, liveEquity, livePositions };
      }),
    [bots, liveMarks],
  );

  const selected = useMemo(
    () =>
      liveBots.find((item) => item.bot.payload.botId === selectedId) ??
      liveBots[0] ??
      null,
    [liveBots, selectedId],
  );
  const chatBot = bots.find((bot) => bot.payload.botId === chatBotId) ?? null;
  const selectedBot = selected?.bot ?? null;
  const selectedPosition = selected?.livePositions[0] ?? null;

  const tailSelectedPosition = () => {
    if (!selectedBot || !selectedPosition) return;
    setTailSource({
      kind: "bot",
      botId: selectedBot.payload.botId,
      botName: selectedBot.payload.botName,
      avatarEmoji: selectedBot.payload.avatarEmoji,
      avatarImageUrl: selectedBot.payload.avatarImageUrl,
      asset: selectedPosition.asset,
      side: selectedPosition.side,
      leverage: selectedPosition.leverage,
      entryMark: selectedPosition.entryMark,
      positionId: selectedPosition.positionId,
    });
  };

  const rail = selectedBot ? (
    <div className="space-y-3">
      <div
        className="rounded-xl p-4"
        style={{ background: PANEL, border: `1px solid ${FAINT}` }}
      >
        <Stamp label="Selected Bot" />
        <div className="mt-3 flex items-center gap-3">
          <StoryAvatar
            emoji={selectedBot.payload.avatarEmoji}
            imageUrl={selectedBot.payload.avatarImageUrl}
            mood={selectedBot.payload.mood ?? "DORMANT"}
            size={52}
          />
          <div className="min-w-0">
            <Headline size={24}>{selectedBot.payload.botName}</Headline>
            <p
              className="mt-1 text-[10px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {selected.livePositions.length} open positions
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setChatBotId(selectedBot.payload.botId)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest"
          style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
        >
          <MessageCircle size={13} /> Chat
        </button>
      </div>
      {selectedPosition && (
        <button
          type="button"
          onClick={tailSelectedPosition}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-black uppercase tracking-widest"
          style={{ background: ACCENT, color: BG }}
        >
          <Zap size={14} fill={BG} /> Tail current position
        </button>
      )}
    </div>
  ) : null;

  return (
    <AppShell rail={rail} railTitle="Bot Context" mainClassName="overflow-hidden">
      <div className="grid h-full grid-cols-[minmax(360px,460px)_minmax(0,1fr)] gap-4 p-4">
        <section
          className="min-h-0 overflow-hidden rounded-2xl"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          <div className="border-b px-4 py-3" style={{ borderColor: FAINT }}>
            <Headline size={30}>{`"ROSTER"`}</Headline>
          </div>
          <div className="no-scrollbar h-[calc(100%-60px)] overflow-y-auto p-3">
            {liveBots.map(({ bot, liveEquity, livePositions }, index) => {
              const rowSelected =
                bot.payload.botId === selectedBot?.payload.botId;
              return (
                <button
                  key={bot.payload.botId}
                  type="button"
                  onClick={() => setSelectedId(bot.payload.botId)}
                  aria-pressed={rowSelected}
                  className="mb-2 flex w-full items-center gap-3 rounded-xl p-3 text-left transition active:scale-[0.99]"
                  style={{
                    background: rowSelected ? PANEL_2 : "transparent",
                    border: `1px solid ${rowSelected ? ACCENT : FAINT}`,
                  }}
                >
                  <span
                    className="w-7 text-[10px] font-black"
                    style={{ color: index === 0 ? ACCENT : DIM }}
                  >
                    #{index + 1}
                  </span>
                  <StoryAvatar
                    emoji={bot.payload.avatarEmoji}
                    imageUrl={bot.payload.avatarImageUrl}
                    mood={bot.payload.mood ?? "DORMANT"}
                    size={42}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-black uppercase">
                      {bot.payload.botName}
                    </div>
                    <div
                      className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      {livePositions.length} open ·{" "}
                      {bot.payload.stats.totalTrades} trades
                    </div>
                  </div>
                  <BigNum
                    size={18}
                    color={
                      liveEquity >= bot.payload.startingBalanceUsd ? GREEN : RED
                    }
                  >
                    ${liveEquity.toFixed(0)}
                  </BigNum>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="min-h-0 overflow-hidden rounded-2xl p-5"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          {selected && selectedBot ? (
            <div className="flex h-full flex-col">
              <Stamp
                label="Command Center"
                value={selectedBot.payload.botName.toUpperCase()}
              />
              <div className="mt-5 flex items-center gap-4">
                <StoryAvatar
                  emoji={selectedBot.payload.avatarEmoji}
                  imageUrl={selectedBot.payload.avatarImageUrl}
                  mood={selectedBot.payload.mood ?? "DORMANT"}
                  size={76}
                />
                <div>
                  <Headline size={44}>{selectedBot.payload.botName}</Headline>
                  <p
                    className="mt-2 text-[11px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    Live equity ${selected.liveEquity.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex gap-2 xl:hidden">
                <button
                  type="button"
                  onClick={() => setChatBotId(selectedBot.payload.botId)}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest"
                  style={{
                    background: PANEL_2,
                    color: FG,
                    border: `1px solid ${FAINT}`,
                  }}
                >
                  <MessageCircle size={14} /> Chat
                </button>
                {selectedPosition && (
                  <button
                    type="button"
                    onClick={tailSelectedPosition}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest"
                    style={{ background: ACCENT, color: BG }}
                  >
                    <Zap size={14} fill={BG} /> Tail current position
                  </button>
                )}
              </div>
              <div className="mt-6 grid grid-cols-4 gap-2">
                <Metric
                  label="24H"
                  value={`${selectedBot.payload.stats.paperPnl24hUsd >= 0 ? "+" : "-"}$${Math.abs(
                    selectedBot.payload.stats.paperPnl24hUsd,
                  ).toFixed(0)}`}
                  color={
                    selectedBot.payload.stats.paperPnl24hUsd >= 0 ? GREEN : RED
                  }
                />
                <Metric
                  label="Win Rate"
                  value={
                    selectedBot.payload.stats.winRate == null
                      ? "-"
                      : `${(selectedBot.payload.stats.winRate * 100).toFixed(0)}%`
                  }
                />
                <Metric
                  label="Trades"
                  value={String(selectedBot.payload.stats.totalTrades)}
                />
                <Metric
                  label="Open"
                  value={String(selected.livePositions.length)}
                />
              </div>
              <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
                {selected.livePositions.length === 0 ? (
                  <div
                    className="rounded-xl p-5 text-[12px] font-black uppercase tracking-widest"
                    style={{ background: PANEL_2, color: DIM }}
                  >
                    Watching the tape. No open position.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selected.livePositions.map((position) => (
                      <div
                        key={position.positionId}
                        className="rounded-xl p-4"
                        style={{
                          background: PANEL_2,
                          border: `1px solid ${FAINT}`,
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <Headline size={30}>{position.asset}</Headline>
                          <span
                            className="rounded px-2 py-1 text-[11px] font-black uppercase"
                            style={{
                              color: position.side === "long" ? GREEN : RED,
                            }}
                          >
                            {position.side} ×{position.leverage}
                          </span>
                        </div>
                        <div
                          className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest"
                          style={{ color: DIM }}
                        >
                          <span>Mark ${position.liveMark.toFixed(2)}</span>
                          <span
                            style={{
                              color:
                                position.livePaperPnlPct >= 0 ? GREEN : RED,
                            }}
                          >
                            {position.livePaperPnlPct >= 0 ? "+" : "-"}
                            {Math.abs(position.livePaperPnlPct * 100).toFixed(1)}
                            %
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-snug" style={{ color: FG }}>
                          {position.narrationOpen
                            ? `"${position.narrationOpen}"`
                            : "No thesis text yet."}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="flex h-full items-center justify-center text-[12px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              No bots loaded.
            </div>
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
      className="rounded-xl p-3"
      style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
    >
      <div
        className="text-[9px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div className="mt-1 text-[18px] font-black tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
