"use client";

// Live arena roster: consumes useArenaLive() (REST seed → ER ws → poll
// fallback) and renders one BotCard per configured persona, on the v2
// tokens. NOTE the hook contract:
// `bots` is pre-keyed per persona with null placeholders, and mode "loading"
// can still carry data after the REST seed — loading-with-data is renderable,
// only the transport indicator stays a skeleton.

import { useEffect, useState } from "react";
import { isStale, parseArenaEnv, useArenaLive } from "@/lib/arena/use-arena-live";
import { isDevnetEndpoint } from "@/lib/arena/solscan";
import {
  AiBotBadge,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  Headline,
  STREAK,
} from "@/components/v2/ui";
import { BotCard, fmtArenaPrice } from "./BotCard";
import { BotProfile } from "./BotProfile";

// Literal process.env access so Next.js inlines it at build time.
const CLUSTER_LABEL =
  process.env.NEXT_PUBLIC_ARENA_CLUSTER_LABEL?.trim() || "devnet";

export function ArenaRoster() {
  const { bots, market, mode } = useArenaLive();
  const now = useNowTick();
  const botNames = Object.keys(bots);
  const [selected, setSelected] = useState<string | null>(null);

  const oracleTsMs = market?.lastPublishTsMs ?? 0;
  const oracleStale = now > 0 && market !== null && isStale(oracleTsMs, now);
  const staleSecs = Math.max(0, Math.floor((now - oracleTsMs) / 1000));

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div
        className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-4 lg:px-6"
        style={{ borderColor: FAINT }}
      >
        <div>
          <div className="flex items-center gap-2">
            <AiBotBadge>AI BOTS</AiBotBadge>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Headline size={22}>Arena</Headline>
            <span
              className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
              style={{
                color: STREAK,
                borderColor: `${STREAK}55`,
                background: `${STREAK}14`,
              }}
            >
              {CLUSTER_LABEL} demo
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {oracleStale && (
            <span
              className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest tabular-nums"
              style={{
                color: STREAK,
                borderColor: `${STREAK}55`,
                background: `${STREAK}14`,
              }}
            >
              oracle stale {staleSecs > 999 ? "999s+" : `${staleSecs}s`}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest tabular-nums">
            <span style={{ color: DIM }}>SOL</span>
            {market ? (
              <span>{fmtArenaPrice(market.lastPrice)}</span>
            ) : (
              <span
                className="skeleton-block inline-block h-3.5 w-14 rounded-md"
                aria-hidden
              />
            )}
          </span>
          <ModeBadge mode={mode} />
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-24 lg:px-6 lg:py-5">
        {botNames.length === 0 ? (
          <Unconfigured />
        ) : (
          <>
            {/* Mobile: full-width stat-card stack (these are dashboards, not
                stories — no 100vh snap). Desktop: card grid. */}
            <div className="flex flex-col gap-3 lg:grid lg:auto-rows-max lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
              {botNames.map((name) => (
                <BotCard
                  key={name}
                  name={name}
                  bot={bots[name]}
                  now={now}
                  market={market}
                  onOpen={() => setSelected(name)}
                />
              ))}
            </div>
            <p
              className="mt-4 max-w-2xl pb-2 text-[10px] leading-relaxed"
              style={{ color: DIM }}
            >
              Decisions are made by program code running in a MagicBlock
              Ephemeral Rollup; prices come from the Pyth Lazer oracle feed
              operated by MagicBlock.{" "}
              {isDevnetEndpoint(parseArenaEnv()?.endpoint)
                ? "Devnet demo."
                : "State is committed to Solana mainnet."}
            </p>
          </>
        )}
      </div>

      {selected && (
        <BotProfile
          name={selected}
          bot={bots[selected] ?? null}
          now={now}
          market={market}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: "ws" | "poll" | "loading" }) {
  if (mode === "loading") {
    return (
      <span
        className="skeleton-block inline-block h-3.5 w-12 rounded-md"
        aria-hidden
      />
    );
  }
  const live = mode === "ws";
  const color = live ? GREEN : DIM;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest"
      style={{ color }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse" : ""}`}
        style={{ background: color }}
      />
      {live ? "LIVE" : "POLL"}
    </span>
  );
}

function Unconfigured() {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center px-5 text-center">
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

/** Shared 1s wall clock for staleness seconds + position ages. Starts at 0
 *  (server render and first client paint agree → no hydration mismatch). */
function useNowTick(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
