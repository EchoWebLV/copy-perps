import type { CuratedWhale } from "@/lib/hyperliquid/whales";

/**
 * Merge the Hyperliquid whale sources into one refresh roster.
 *
 * Curated whales are hand-picked for *currently holding* positions — they hold
 * ~94% of observed HL open interest. Leaderboard discovery ranks by past PnL and
 * skews to traders who already took profits and are now flat. So we track BOTH:
 * curated first (guaranteed live positions), then pinned, then discovered (fresh
 * winners) — deduped by address (case-insensitive) and capped so the per-tick
 * clearinghouse fan-out stays within the HL rate budget.
 */
export function mergeHyperliquidRoster(
  curated: CuratedWhale[],
  pinned: CuratedWhale[],
  discovered: CuratedWhale[] | null,
  limit: number,
): CuratedWhale[] {
  const seen = new Set<string>();
  const out: CuratedWhale[] = [];
  for (const whale of [...curated, ...pinned, ...(discovered ?? [])]) {
    const key = whale.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(whale);
  }
  return out.slice(0, Math.max(0, limit));
}
