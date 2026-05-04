import { desc } from "drizzle-orm";
import { db } from "./index";
import { signals } from "./schema";
import type { Signal } from "@/lib/types";

export async function getFeedSignals(limit = 50): Promise<Signal[]> {
  const rows = await db
    .select()
    .from(signals)
    .orderBy(desc(signals.heatScore))
    .limit(limit);

  return rows.map((r) => r.payload as Signal);
}
