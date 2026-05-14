// lib/bots/thoughts/settings.ts
//
// Singleton row in thought_settings. We always upsert into id='singleton',
// so the table has at most one row. Callers should treat the returned
// object as cache-stale-OK; the orchestrator reads once per tick.

import { db } from "@/lib/db";
import { thoughtSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type ThoughtSettings = typeof thoughtSettings.$inferSelect;

const SINGLETON_ID = "singleton";

export async function getThoughtSettings(): Promise<ThoughtSettings> {
  const existing = await db
    .select()
    .from(thoughtSettings)
    .where(eq(thoughtSettings.id, SINGLETON_ID))
    .limit(1);
  if (existing[0]) return existing[0];

  // First read — create the row using DB column defaults.
  await db.insert(thoughtSettings).values({ id: SINGLETON_ID }).onConflictDoNothing();
  const after = await db
    .select()
    .from(thoughtSettings)
    .where(eq(thoughtSettings.id, SINGLETON_ID))
    .limit(1);
  if (!after[0]) {
    throw new Error("thought_settings row missing after insert");
  }
  return after[0];
}

export async function updateThoughtSettings(
  patch: Partial<Omit<ThoughtSettings, "id" | "updatedAt">>,
): Promise<void> {
  await db
    .update(thoughtSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(thoughtSettings.id, SINGLETON_ID));
}
