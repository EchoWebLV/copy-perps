"use client";

// Fetches the persisted oracle-bot "thoughts" and indexes them per bot by the
// on-chain tape entry each one wrote, so the MagicBlock log can show the model's
// reasoning under the exact trade it explains. Polls slowly (decisions land on a
// ~4-min worker cadence, so there's nothing to gain from a tight loop) and keeps
// the last good data on any fetch error — the log simply renders without the
// why-line until thoughts exist.

import { useEffect, useState } from "react";
import { indexThoughtsByTape, type ArenaThought } from "./llm/thoughts";

export interface ArenaThoughtsState {
  /** persona → (tape entry tsMs → the thought that wrote it). */
  byPersonaTape: Record<string, Map<number, ArenaThought>>;
  /** persona → newest thought (the bot's latest thinking, trade or not). */
  latestByPersona: Record<string, ArenaThought | null>;
}

const EMPTY: ArenaThoughtsState = { byPersonaTape: {}, latestByPersona: {} };
const POLL_MS = 60_000;

export function useArenaThoughts(personas: string[]): ArenaThoughtsState {
  const key = personas.join(",");
  const [state, setState] = useState<ArenaThoughtsState>(EMPTY);

  useEffect(() => {
    if (!key) {
      setState(EMPTY);
      return;
    }
    let alive = true;

    async function load() {
      try {
        const res = await fetch(
          `/api/arena/decisions?bots=${encodeURIComponent(key)}`,
          { cache: "no-store" },
        );
        if (!res.ok || !alive) return;
        const json = (await res.json()) as {
          bots?: Record<string, ArenaThought[]>;
        };
        if (!alive) return;
        const byPersonaTape: Record<string, Map<number, ArenaThought>> = {};
        const latestByPersona: Record<string, ArenaThought | null> = {};
        for (const [persona, list] of Object.entries(json.bots ?? {})) {
          byPersonaTape[persona] = indexThoughtsByTape(list);
          latestByPersona[persona] = list[0] ?? null; // API returns newest-first
        }
        setState({ byPersonaTape, latestByPersona });
      } catch {
        /* keep last good state */
      }
    }

    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key]);

  return state;
}
