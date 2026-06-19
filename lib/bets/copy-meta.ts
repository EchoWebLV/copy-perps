// lib/bets/copy-meta.ts
//
// The execution venue a `copy` bet was opened on, read back from bet.meta.venue.
// Legacy rows (opened before Flash v2) have no `venue` field and default to
// 'pacifica' so closes/guards keep routing them to Pacifica after the flag flips.
export type CopyMetaVenue = "pacifica" | "flash-v2";

export function copyMetaVenue(meta: unknown): CopyMetaVenue {
  if (
    meta != null &&
    typeof meta === "object" &&
    (meta as { venue?: unknown }).venue === "flash-v2"
  ) {
    return "flash-v2";
  }
  return "pacifica";
}
