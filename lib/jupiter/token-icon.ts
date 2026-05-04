// Resolve token icons from Jupiter's v2 search endpoint. Accepts a
// batch of SPL mints in one call (`?query=mint1,mint2,...`) and returns
// a map { mint -> iconUrl|null } so callers can attach the icon without
// a separate request per token.

const JUP_BASE = "https://lite-api.jup.ag";
const BATCH_SIZE = 25; // Jupiter accepts comma-separated lookups; cap to a sane chunk

interface JupTokenSearchEntry {
  id: string;
  icon?: string | null;
}

export async function getJupiterTokenIcons(
  mints: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (mints.length === 0) return out;

  const unique = Array.from(new Set(mints));
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    try {
      const r = await fetch(
        `${JUP_BASE}/tokens/v2/search?query=${chunk.join(",")}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        console.warn(`[jupiter token-icon] ${r.status} for ${chunk.length} mints`);
        continue;
      }
      const arr = (await r.json()) as JupTokenSearchEntry[];
      for (const entry of arr) {
        if (entry?.id) out[entry.id] = entry.icon ?? null;
      }
    } catch (e) {
      console.warn(`[jupiter token-icon] fetch failed:`, e);
    }
  }
  return out;
}
