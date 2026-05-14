// lib/admin/sync.ts
//
// Bridges DB-persisted bot rows into the in-memory runtime registry. The
// static `lib/bots/index.ts` registers the 12 codebase bots at module init;
// admin-cloned variants live only in the DB. This helper picks up the
// difference so the resolver's `listBots()` sees them on the next tick.
//
// Called from:
//   - /admin/bots index render (visual freshness)
//   - POST /api/admin/bots clone (immediate activation)
//
// Safe to call repeatedly; registerBotDynamic is idempotent.

import { db } from "@/lib/db";
import { bots as botsTable } from "@/lib/db/schema";
import { getBot, registerBotDynamic } from "@/lib/bots";
import type { BotConfig } from "@/lib/bots/types";

interface SyncResult {
  registered: number;
  skipped: number;
  failed: string[];
}

export async function syncDbBotsToRegistry(): Promise<SyncResult> {
  const rows = await db.select().from(botsTable);
  let registered = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const row of rows) {
    // Already in the static registry — nothing to do.
    if (getBot(row.id)) {
      skipped += 1;
      continue;
    }
    const cfg: BotConfig = {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      avatarEmoji: row.avatarEmoji,
      personaVoiceKey: row.personaVoiceKey,
      strategyKey: row.strategyKey,
      config: (row.config as Record<string, unknown>) ?? {},
      status: row.status as BotConfig["status"],
    };
    const strategy = registerBotDynamic(cfg);
    if (strategy) {
      registered += 1;
    } else {
      failed.push(row.id);
    }
  }

  return { registered, skipped, failed };
}
