import type { EnrichedPosition } from "./enrich";

export function splitPortfolioPositions(positions: EnrichedPosition[] | null) {
  const list = positions ?? [];
  return {
    openPositions: list.filter(
      (p) => p.status === "confirmed" && p.type !== "copy",
    ),
    closedPositions: list.filter((p) => p.status === "closed"),
  };
}
