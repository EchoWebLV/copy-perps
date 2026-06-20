// lib/arena/llm/decision-store.ts
//
// Server-only persistence for oracle-bot decisions (the "AI thought" layer).
// The operator worker writes one row per decision via insertArenaDecision; the
// /api/arena/decisions route reads recent thoughts back via getRecentArenaThoughts.
// Pure join logic + the wire shape live in ./thoughts (client-safe); this file
// is the only place that touches the db.

import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { arenaDecisions } from "@/lib/db/schema";
import type { DecisionRecord } from "./loop";
import type { ArenaThought } from "./thoughts";

/** Persist one decision. `tapeTsMs` is the epoch-ms of the on-chain tape entry
 *  the apply wrote (read back after confirm); null for HOLD/skip or a missed
 *  read-back. Side/leverage are nulled where they carry no meaning. */
export async function insertArenaDecision(
  rec: DecisionRecord,
  opts: { marketId: number; tapeTsMs: number | null },
): Promise<void> {
  const d = rec.decision;
  await db.insert(arenaDecisions).values({
    persona: rec.persona,
    marketId: opts.marketId,
    action: d.action,
    side: d.action === "hold" ? null : d.side,
    asset: d.asset ?? null,
    leverage: d.action === "open" ? d.leverage : null,
    confidence: d.confidence,
    reasoning: d.reasoning,
    sent: rec.sent,
    rejectReason: rec.reason ?? null,
    signature: rec.signature ?? null,
    tapeTsMs: opts.tapeTsMs,
  });
}

/**
 * Recent thoughts for a set of personas, newest first, capped per persona.
 * One query (no per-persona round-trips); the cap is applied in JS since N is
 * small. Returns a persona→thoughts map; missing personas simply have no key.
 */
export async function getRecentArenaThoughts(
  personas: string[],
  perPersonaLimit = 40,
): Promise<Record<string, ArenaThought[]>> {
  if (personas.length === 0) return {};
  const rows = await db
    .select()
    .from(arenaDecisions)
    .where(inArray(arenaDecisions.persona, personas))
    .orderBy(desc(arenaDecisions.createdAt))
    .limit(personas.length * perPersonaLimit * 2);

  const out: Record<string, ArenaThought[]> = {};
  for (const r of rows) {
    const list = (out[r.persona] ??= []);
    if (list.length >= perPersonaLimit) continue;
    list.push({
      persona: r.persona,
      action: r.action as ArenaThought["action"],
      side: (r.side as ArenaThought["side"]) ?? null,
      asset: r.asset ?? null,
      leverage: r.leverage ?? null,
      confidence: r.confidence ?? null,
      reasoning: r.reasoning,
      sent: r.sent,
      rejectReason: r.rejectReason ?? null,
      signature: r.signature ?? null,
      tapeTsMs: r.tapeTsMs ?? null,
      createdAtMs: r.createdAt.getTime(),
    });
  }
  return out;
}
