"use client";

import { useMemo, useState } from "react";
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

  const selected = useMemo(
    () => bots.find((bot) => bot.payload.botId === selectedId) ?? bots[0] ?? null,
    [bots, selectedId],
  );
  const chatBot = bots.find((bot) => bot.payload.botId === chatBotId) ?? null;
  const selectedPosition = selected?.payload.currentPositions[0] ?? null;

  const rail = selected ? (
    <div className="space-y-3">
      <div
        className="rounded-xl p-4"
        style={{ background: PANEL, border: `1px solid ${FAINT}` }}
      >
        <Stamp label="Selected Bot" />
        <div className="mt-3 flex items-center gap-3">
          <StoryAvatar
            emoji={selected.payload.avatarEmoji}
            imageUrl={selected.payload.avatarImageUrl}
            mood={selected.payload.mood ?? "DORMANT"}
            size={52}
          />
          <div className="min-w-0">
            <Headline size={24}>{selected.payload.botName}</Headline>
            <p
              className="mt-1 text-[10px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {selected.payload.currentPositions.length} open positions
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setChatBotId(selected.payload.botId)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest"
          style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
        >
          <MessageCircle size={13} /> Chat
        </button>
      </div>
      {selectedPosition && (
        <button
          type="button"
          onClick={() =>
            setTailSource({
              kind: "bot",
              botId: selected.payload.botId,
              botName: selected.payload.botName,
              avatarEmoji: selected.payload.avatarEmoji,
              avatarImageUrl: selected.payload.avatarImageUrl,
              asset: selectedPosition.asset,
              side: selectedPosition.side,
              leverage: selectedPosition.leverage,
              entryMark: selectedPosition.entryMark,
              positionId: selectedPosition.positionId,
            })
          }
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
            {bots.map((bot, index) => (
              <button
                key={bot.payload.botId}
                type="button"
                onClick={() => setSelectedId(bot.payload.botId)}
                className="mb-2 flex w-full items-center gap-3 rounded-xl p-3 text-left transition active:scale-[0.99]"
                style={{
                  background:
                    bot.payload.botId === selected?.payload.botId
                      ? PANEL_2
                      : "transparent",
                  border: `1px solid ${
                    bot.payload.botId === selected?.payload.botId
                      ? ACCENT
                      : FAINT
                  }`,
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
                    {bot.payload.currentPositions.length} open ·{" "}
                    {bot.payload.stats.totalTrades} trades
                  </div>
                </div>
                <BigNum
                  size={18}
                  color={
                    bot.payload.balanceUsd >= bot.payload.startingBalanceUsd
                      ? GREEN
                      : RED
                  }
                >
                  ${bot.payload.balanceUsd.toFixed(0)}
                </BigNum>
              </button>
            ))}
          </div>
        </section>

        <section
          className="min-h-0 overflow-hidden rounded-2xl p-5"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          {selected ? (
            <div className="flex h-full flex-col">
              <Stamp
                label="Command Center"
                value={selected.payload.botName.toUpperCase()}
              />
              <div className="mt-5 flex items-center gap-4">
                <StoryAvatar
                  emoji={selected.payload.avatarEmoji}
                  imageUrl={selected.payload.avatarImageUrl}
                  mood={selected.payload.mood ?? "DORMANT"}
                  size={76}
                />
                <div>
                  <Headline size={44}>{selected.payload.botName}</Headline>
                  <p
                    className="mt-2 text-[11px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    Live equity ${selected.payload.balanceUsd.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-4 gap-2">
                <Metric
                  label="24H"
                  value={`${selected.payload.stats.paperPnl24hUsd >= 0 ? "+" : "-"}$${Math.abs(
                    selected.payload.stats.paperPnl24hUsd,
                  ).toFixed(0)}`}
                  color={
                    selected.payload.stats.paperPnl24hUsd >= 0 ? GREEN : RED
                  }
                />
                <Metric
                  label="Win Rate"
                  value={
                    selected.payload.stats.winRate == null
                      ? "-"
                      : `${(selected.payload.stats.winRate * 100).toFixed(0)}%`
                  }
                />
                <Metric
                  label="Trades"
                  value={String(selected.payload.stats.totalTrades)}
                />
                <Metric
                  label="Open"
                  value={String(selected.payload.currentPositions.length)}
                />
              </div>
              <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
                {selected.payload.currentPositions.length === 0 ? (
                  <div
                    className="rounded-xl p-5 text-[12px] font-black uppercase tracking-widest"
                    style={{ background: PANEL_2, color: DIM }}
                  >
                    Watching the tape. No open position.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selected.payload.currentPositions.map((position) => (
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
