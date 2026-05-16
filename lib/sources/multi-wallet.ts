// lib/sources/multi-wallet.ts
//
// Composite source adapter — bundles several wallet sources (across
// exchanges) behind one Source. getCurrentPositions() fans out to
// every child wallet, merges their books, and returns at most one
// position per asset: when more than one whale holds the same asset,
// the larger-notional position wins (and its side, so long/short
// disagreements resolve to the heavier hand).
//
// The mirror strategy treats this exactly like a single wallet — it
// has no idea its source is a pool. The payoff: if one whale goes
// dormant or blows up, the others keep the bot trading; only ALL of
// them going quiet at once silences it. A flaky exchange API for one
// wallet (Promise.allSettled below) likewise can't blank the pool.
//
// Each returned position is tagged in `meta.sourceWallet` with the
// child wallet it came from, so narration can name the specific whale.

import type { Source, SourcePosition } from "./types";

interface MultiWalletSourceParams {
  /** Unique source id, e.g. "whale-pack". */
  id: string;
  /** Display name for the bundle as a whole. */
  displayName: string;
  /** The child wallet sources to bundle. At least one required. */
  sources: Source[];
}

export function createMultiWalletSource(
  p: MultiWalletSourceParams,
): Source {
  if (p.sources.length === 0) {
    throw new Error("createMultiWalletSource: needs at least one source");
  }
  return {
    id: p.id,
    displayName: p.displayName,
    // No single canonical URL for a bundle — point at the first child.
    externalUrl: p.sources[0].externalUrl,
    async getCurrentPositions(): Promise<SourcePosition[]> {
      // allSettled, not all — one whale's API hiccup must never blank
      // the whole pool. A rejected child just contributes nothing.
      const results = await Promise.allSettled(
        p.sources.map((s) => s.getCurrentPositions()),
      );
      const merged: SourcePosition[] = [];
      results.forEach((r, i) => {
        const child = p.sources[i];
        if (r.status === "fulfilled") {
          for (const pos of r.value) {
            merged.push({
              ...pos,
              meta: { ...(pos.meta ?? {}), sourceWallet: child.displayName },
            });
          }
        } else {
          console.warn(
            `[${p.id}] child source ${child.id} failed:`,
            r.reason,
          );
        }
      });
      // Collapse to one position per asset — the mirror holds at most
      // one position per asset, so when whales disagree we follow the
      // heaviest notional (and therefore that whale's side).
      const byAsset = new Map<string, SourcePosition>();
      for (const pos of merged) {
        const cur = byAsset.get(pos.asset);
        if (!cur || pos.notionalUsd > cur.notionalUsd) {
          byAsset.set(pos.asset, pos);
        }
      }
      return [...byAsset.values()];
    },
  };
}
