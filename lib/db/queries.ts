import { desc, inArray } from "drizzle-orm";
import { db } from "./index";
import { signals } from "./schema";
import type { Signal, SignalType } from "@/lib/types";
import { legacyRailsEnabled } from "@/lib/features";

const PHASE_1_TYPES: SignalType[] = ["pacifica_trader"];
const LEGACY_TYPES: SignalType[] = [
  "meme",
  "prediction",
  "multiprediction",
  "whale",
];

export async function getFeedSignals(limit = 50): Promise<Signal[]> {
  const allowed = legacyRailsEnabled()
    ? [...PHASE_1_TYPES, ...LEGACY_TYPES]
    : PHASE_1_TYPES;
  const rows = await db
    .select()
    .from(signals)
    .where(inArray(signals.type, allowed))
    .orderBy(desc(signals.heatScore))
    .limit(limit);

  return rows.map((r) => r.payload as Signal);
}
