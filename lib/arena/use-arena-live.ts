// lib/arena/use-arena-live.ts — live ER state for the arena page + /feed.
//
// Seed via one getMultipleAccountsInfo on the ER endpoint, then subscribe to
// every account with onAccountChange (ER ws). The router-ws forwarding gotcha
// (spec §13) applies: if no ws update arrives within WS_GRACE_MS of mount we
// fall back to visibility-aware polling (4s cadence) while keeping the
// subscriptions alive as best-effort — a late ws push upgrades the mode back
// to "ws" and stops the poll. Staleness is a UI state,
// never hidden: consumers run isStale() over market.lastPublishTsMs (oracle
// freshness) and/or lastUpdateMs (transport freshness).
"use client";

import { useEffect, useState } from "react";
import { Buffer } from "buffer";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  decodeBot,
  decodeMarketState,
  type ArenaBot,
  type ArenaMarketState,
} from "./decode";
import { botPda } from "./personas";

/** No ws delivery within this window of mount → assume the ER ws path is
 *  dead-on-arrival (router forwarding gotcha) and start polling. */
export const WS_GRACE_MS = 15_000;
/** Poll cadence while in "poll" mode. */
export const POLL_MS = 4_000;
/** Default isStale() window: 2 missed 15s oracle ticks. */
export const STALE_AFTER_MS = 30_000;

const DEFAULT_ER_ENDPOINT = "https://devnet.magicblock.app";
const DEFAULT_BOT_NAMES = ["scalper-v1", "rider-v1"];

export interface ArenaLive {
  /** Keyed by on-chain persona name; null = not seen yet / account missing /
   *  failed decode (fail-closed — a slot is data or it is nothing). */
  bots: Record<string, ArenaBot | null>;
  market: ArenaMarketState | null;
  /** Transport the numbers are arriving on. "loading" until the first ws
   *  delivery ("ws") or the grace timer expiring ("poll"). */
  mode: "ws" | "poll" | "loading";
  /** Wall-clock ms of the last successfully applied chain read (0 = never). */
  lastUpdateMs: number;
}

export interface ArenaEnvConfig {
  programId: PublicKey;
  endpoint: string;
  botNames: string[];
  /** u8 market id (the market PDA seed byte). Market 0 = the original devnet
   *  market wedged by the 2026-06-12 undelegation incident (PINS.md); its
   *  live successor runs as market 1. */
  marketId: number;
}

export interface RawArenaEnv {
  programId?: string;
  endpoint?: string;
  bots?: string;
  marketId?: string;
}

/** Parse the client arena env. Returns null when the program id is missing
 *  or malformed — the hook then stays in a stable "loading" state and the
 *  page renders its unconfigured fallback. The default argument keeps the
 *  literal process.env.NEXT_PUBLIC_* accesses Next.js needs for build-time
 *  inlining; tests pass explicit raw values. */
export function parseArenaEnv(
  raw: RawArenaEnv = {
    programId: process.env.NEXT_PUBLIC_ARENA_PROGRAM_ID,
    endpoint: process.env.NEXT_PUBLIC_ARENA_ER_ENDPOINT,
    bots: process.env.NEXT_PUBLIC_ARENA_BOTS,
    marketId: process.env.NEXT_PUBLIC_ARENA_MARKET_ID,
  },
): ArenaEnvConfig | null {
  const idStr = raw.programId?.trim();
  if (!idStr) return null;
  let programId: PublicKey;
  try {
    programId = new PublicKey(idStr);
  } catch {
    return null; // fail-closed: a bad id behaves like unconfigured
  }
  const botNames = (raw.bots ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Market id must be a valid PDA seed byte; anything unparseable falls back
  // to 0 (same fail-closed spirit as the defaults above — the page renders,
  // pointed at the canonical market).
  const parsedMarket = Number.parseInt(raw.marketId?.trim() || "0", 10);
  const marketId =
    Number.isInteger(parsedMarket) && parsedMarket >= 0 && parsedMarket <= 255
      ? parsedMarket
      : 0;
  return {
    programId,
    endpoint: raw.endpoint?.trim() || DEFAULT_ER_ENDPOINT,
    botNames: botNames.length > 0 ? botNames : [...DEFAULT_BOT_NAMES],
    marketId,
  };
}

/** Market PDA: seeds ["market", [marketId u8]] (init-devnet.ts). PINS.md
 *  Task 13 pins market 0 = BTk9M99Eh5xjccYpZui4K8CvMesCLkHAWjF9gXSjhhzj. */
export function marketPda(programId: PublicKey, marketId = 0): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([marketId])],
    programId,
  )[0];
}

/** True when a timestamp is more than maxAgeMs old at `nowMs`. Exactly
 *  maxAgeMs old is still fresh; a future ts (ER clock skew) is fresh. */
export function isStale(
  lastPublishTsMs: number,
  nowMs: number,
  maxAgeMs = STALE_AFTER_MS,
): boolean {
  return nowMs - lastPublishTsMs > maxAgeMs;
}

/** Pure state patch: decode `data` into the slot for `accountIndex`, where
 *  index 0 is the market and index 1+i is botNames[i] (the account order the
 *  hook fetches/subscribes in). Missing accounts and decode failures land as
 *  null — fail-closed, never throw; an index outside the account list returns
 *  the state unchanged. Never mutates the input. */
export function patchArena(
  state: ArenaLive,
  botNames: string[],
  accountIndex: number,
  data: Uint8Array | null,
): ArenaLive {
  if (accountIndex === 0) {
    return { ...state, market: data ? decodeMarketState(data) : null };
  }
  const name = botNames[accountIndex - 1];
  if (name === undefined) return state;
  return {
    ...state,
    bots: { ...state.bots, [name]: data ? decodeBot(data) : null },
  };
}

// Module-level Connection singleton on the ER endpoint (mirrors
// lib/solana/balance.ts getConnection). "processed" commitment: the ER is a
// single validator with no consensus to wait on — take the freshest state.
let cachedConn: Connection | null = null;
let cachedEndpoint: string | null = null;
function getArenaConnection(endpoint: string): Connection {
  if (!cachedConn || cachedEndpoint !== endpoint) {
    cachedConn = new Connection(endpoint, "processed");
    cachedEndpoint = endpoint;
  }
  return cachedConn;
}

/** Live on-chain arena state. Mode machine:
 *  loading ──(first ws delivery)──► ws
 *  loading ──(WS_GRACE_MS, no ws)──► poll (visibility-aware 4s refetch)
 *  poll ──(late ws delivery)──► ws (poll stops; subs were never dropped)
 */
export function useArenaLive(): ArenaLive {
  const [state, setState] = useState<ArenaLive>(() => {
    const env = parseArenaEnv();
    return {
      // Pre-key the roster so cards can render placeholders with zero
      // layout shift between loading/ws/poll.
      bots: env
        ? Object.fromEntries(env.botNames.map((n) => [n, null]))
        : {},
      market: null,
      mode: "loading",
      lastUpdateMs: 0,
    };
  });

  useEffect(() => {
    const env = parseArenaEnv();
    if (!env) return; // unconfigured → stable "loading" state forever

    const conn = getArenaConnection(env.endpoint);
    const accounts = [
      marketPda(env.programId, env.marketId),
      ...env.botNames.map((n) => botPda(n, env.programId)),
    ];

    // Everything below is guarded by `mounted`: no setState after unmount.
    let mounted = true;
    let wsSeen = false; // latches on the first ws delivery
    let polling = false; // in "poll" mode (interval wanted while visible)
    let inFlight = false; // never overlap refetches (useVisiblePoll semantics)
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const subIds: number[] = [];

    const refetch = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const infos = await conn.getMultipleAccountsInfo(accounts);
        if (!mounted) return;
        setState((s) => ({
          ...infos.reduce(
            (acc, info, i) =>
              patchArena(acc, env.botNames, i, info ? info.data : null),
            s,
          ),
          lastUpdateMs: Date.now(),
        }));
      } catch {
        // Transient RPC failure: keep the last good state — the UI surfaces
        // the widening lastUpdateMs gap via isStale(), never frozen numbers.
      } finally {
        inFlight = false;
      }
    };

    // Inline useVisiblePoll semantics (components/feed/UnifiedFeed.tsx):
    // run immediately when visible, tick every POLL_MS, skip ticks while
    // hidden, and tear the interval down entirely on visibilitychange→hidden.
    const startPollTimer = () => {
      if (pollTimer) return;
      if (typeof document === "undefined" || !document.hidden) void refetch();
      pollTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void refetch();
      }, POLL_MS);
    };
    const stopPollTimer = () => {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    };
    const onVisibilityChange = () => {
      if (!polling) return;
      if (document.hidden) stopPollTimer();
      else startPollTimer();
    };

    // One ws subscription per account. ANY delivery proves the ER ws path
    // forwards to us → mode "ws"; if we had fallen back to polling, stop it.
    // Subscriptions stay alive for the whole mount either way.
    accounts.forEach((pk, index) => {
      subIds.push(
        conn.onAccountChange(
          pk,
          (info) => {
            if (!mounted) return;
            wsSeen = true;
            if (polling) {
              polling = false;
              stopPollTimer();
            }
            setState((s) => ({
              ...patchArena(s, env.botNames, index, info.data),
              mode: "ws",
              lastUpdateMs: Date.now(),
            }));
          },
          { commitment: "processed" },
        ),
      );
    });

    // Seed once via REST; ws (or the poll fallback) takes over from here.
    void refetch();

    const graceTimer = setTimeout(() => {
      if (!mounted || wsSeen) return;
      polling = true;
      setState((s) => ({ ...s, mode: "poll" }));
      startPollTimer();
    }, WS_GRACE_MS);

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mounted = false;
      clearTimeout(graceTimer);
      stopPollTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const id of subIds) {
        void conn.removeAccountChangeListener(id);
      }
    };
  }, []);

  return state;
}
