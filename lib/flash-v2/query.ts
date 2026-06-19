import { FLASH_V2_REST_BASE } from "./constants";
import type { VenueMarket, VenuePosition } from "./types";

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${FLASH_V2_REST_BASE}${path}`);
  return res.json().catch(() => null);
}

/** GET /prices → { SYMBOL: markPrice }. */
export async function getPrices(): Promise<Record<string, number>> {
  const data = (await getJson("/prices")) as
    | Array<{ symbol?: string; price?: string | number }>
    | null;
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row?.symbol != null && row.price != null) out[row.symbol] = Number(row.price);
  }
  return out;
}

/** GET /raw/markets → [{ symbol, maxLeverage }]. */
export async function getMarkets(): Promise<VenueMarket[]> {
  const data = (await getJson("/raw/markets")) as
    | Array<{ symbol?: string; maxLeverage?: number | string }>
    | null;
  return (data ?? [])
    .filter((m) => m?.symbol != null)
    .map((m) => ({ symbol: String(m.symbol), maxLeverage: Number(m.maxLeverage ?? 0) }));
}

/** GET /owner/{owner}: the wallet snapshot (basket + positions). */
async function getOwnerSnapshot(
  owner: string,
): Promise<{ basketPubkey?: string | null; positions?: VenuePosition[] } | null> {
  return (await getJson(`/owner/${owner}`)) as
    | { basketPubkey?: string | null; positions?: VenuePosition[] }
    | null;
}

export async function getPositions(owner: string): Promise<VenuePosition[]> {
  const snap = await getOwnerSnapshot(owner);
  return Array.isArray(snap?.positions) ? snap!.positions! : [];
}

/** null basketPubkey ⇒ owner has not onboarded. */
export async function getBasketPubkey(owner: string): Promise<string | null> {
  const snap = await getOwnerSnapshot(owner);
  return snap?.basketPubkey ?? null;
}
