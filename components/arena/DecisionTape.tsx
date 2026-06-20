"use client";

// The bot's MagicBlock log: its on-chain decision tape, decoded straight from
// the bot's Ephemeral Rollup account (the unfakeable record — every OPEN/EXIT/
// LIQUIDATED the program wrote). One renderer shared by the feed cards (compact,
// newest few + "show all") and the profile overlay (full 24). The verify link
// opens the bot's account on the MagicBlock ER explorer (Solana Explorer pointed
// at the rollup), where the apply_decision txs actually live — Solscan only
// indexes the base layer and can't see them.

import { useState } from "react";
import type { ArenaBot } from "@/lib/arena/decode";
import { arenaAction, tapeNewestFirst } from "@/lib/arena/decode";
import { isDevnetEndpoint, magicblockExplorerAccountUrl } from "@/lib/arena/solscan";
import type { ArenaThought } from "@/lib/arena/llm/thoughts";
import { DIM, FAINT, GREEN, RED } from "@/components/v2/ui";

const TOKEN_COLORS = { GREEN, RED, DIM } as const;

/** The tape stores 64 slots; never render more than this many decisions. */
const MAX_ENTRIES = 24;

/** $ price: 2dp ≥ $1, 4dp below (memecoin-safe) — mirrors fmtArenaPrice so the
 *  log reads the same as the position rows. Inlined to keep this leaf component
 *  free of a BotCard import cycle. */
function fmtPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  const dp = Math.abs(price) >= 1 ? 2 : 4;
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

function fmtStake(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtWhen(tsMs: number, now: number): string {
  if (now <= 0 || tsMs <= 0) return "—";
  const s = Math.max(0, Math.floor((now - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DecisionTape({
  bot,
  now,
  heading = "MagicBlock log · on-chain",
  initialCount = 3,
  verify = null,
  thoughts = null,
}: {
  /** Live bot account (null = still seeding; renders a skeleton line). */
  bot: Pick<ArenaBot, "tape" | "tapeHead"> | null;
  now: number;
  /** Section label. Cards say "MagicBlock log"; the profile keeps its wording. */
  heading?: string;
  /** Entries shown before the "show all" toggle. Pass MAX_ENTRIES to disable
   *  the toggle (the profile shows the full tape inline). */
  initialCount?: number;
  /** When set, renders a "verify ↗" link to the bot's account (and its
   *  apply_decision tx history) on the MagicBlock ER explorer. */
  verify?: { pda: string | null; endpoint: string | undefined } | null;
  /** Tape tsMs → the model's reasoning for that trade. Matched rows show a
   *  "why" line under the entry; LLM bots only (strategy bots have none). */
  thoughts?: Map<number, ArenaThought> | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = (bot ? tapeNewestFirst(bot) : []).slice(0, MAX_ENTRIES);
  const collapsible = entries.length > initialCount;
  const shown = expanded ? entries : entries.slice(0, initialCount);

  return (
    <div className="mt-3">
      <div
        className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.22em]"
        style={{ color: DIM }}
      >
        <span>{heading}</span>
        {verify?.pda && (
          <a
            href={magicblockExplorerAccountUrl(verify.pda, verify.endpoint)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 underline underline-offset-2"
            style={{ color: DIM }}
          >
            verify ↗{isDevnetEndpoint(verify.endpoint) ? " (devnet)" : ""}
          </a>
        )}
      </div>

      <div className="mt-1.5 flex flex-col gap-1">
        {bot === null ? (
          <span
            className="skeleton-block inline-block h-7 w-full rounded-lg"
            aria-hidden
          />
        ) : entries.length === 0 ? (
          <div
            className="rounded-lg border border-dashed px-2.5 py-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ borderColor: FAINT, color: DIM }}
          >
            no decisions yet — waiting for its setup
          </div>
        ) : (
          shown.map((e, i) => {
            const act = arenaAction(e.action);
            const thought = thoughts?.get(e.tsMs) ?? null;
            return (
              <div
                key={`${e.tsMs}-${i}`}
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: FAINT }}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold tabular-nums">
                  <span
                    className="font-black uppercase tracking-widest"
                    style={{ color: TOKEN_COLORS[act.color] }}
                  >
                    {act.label}
                  </span>
                  <span className="truncate" style={{ color: DIM }}>
                    {fmtPrice(e.price)} · {fmtStake(e.stakeUsd)}
                  </span>
                  <span className="shrink-0" style={{ color: DIM }}>
                    {fmtWhen(e.tsMs, now)}
                  </span>
                </div>
                {thought && <ThoughtLine reasoning={thought.reasoning} />}
              </div>
            );
          })
        )}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-1.5 text-[10px] font-black uppercase tracking-widest underline underline-offset-2"
          style={{ color: DIM }}
        >
          {expanded ? "show less" : `show all (${entries.length})`}
        </button>
      )}
    </div>
  );
}

/** The model's reasoning behind one trade. Clamped to two lines so the log stays
 *  scannable; tap to read the full thought. The 💬 marks it as the AI's words. */
function ThoughtLine({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      className={`mt-1 block w-full text-left text-[10px] italic leading-snug ${open ? "" : "line-clamp-2"}`}
      style={{ color: DIM }}
      title="AI reasoning — tap to expand"
    >
      <span aria-hidden>💬 </span>
      {reasoning}
    </button>
  );
}
