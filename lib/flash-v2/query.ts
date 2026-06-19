import { FLASH_V2_REST_BASE } from "./constants";
import type { VenueMarket, VenuePosition, Side } from "./types";

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${FLASH_V2_REST_BASE}${path}`);
  return res.json().catch(() => null);
}

/**
 * GET /prices → Record<symbol, PriceInfo> (Pyth Lazer). We surface the
 * UI-scaled `priceUi` (falling back to raw `price`) as a flat symbol→number map.
 */
export async function getPrices(): Promise<Record<string, number>> {
  const data = (await getJson("/prices")) as
    | Record<string, { priceUi?: number | string; price?: number | string }>
    | null;
  const out: Record<string, number> = {};
  for (const [symbol, info] of Object.entries(data ?? {})) {
    const v = info?.priceUi ?? info?.price;
    if (v != null) out[symbol] = Number(v);
  }
  return out;
}

/**
 * GET /raw/markets returns RawAccount[] (`{ pubkey, account }`); deriving
 * `{ symbol, maxLeverage }` requires decoding the account layout
 * (openapi.v2.json / the v2 SDK). No Phase 1 consumer needs it, so this is
 * deferred to Phase 2 (leverage clamping). Returns [] until then.
 */
export async function getMarkets(): Promise<VenueMarket[]> {
  return [];
}

/** One PositionMetrics entry from the owner snapshot's positionMetrics map. */
interface PositionMetrics {
  marketSymbol?: string;
  sideUi?: string;
  sizeUsdUi?: number | string;
  collateralUsdUi?: number | string;
  entryPriceUi?: number | string;
  liquidationPriceUi?: number | string;
  leverageUi?: number | string;
}

interface OwnerSnapshot {
  basketPubkey?: string | null;
  positionMetrics?: Record<string, PositionMetrics>;
}

/** GET /owner/{owner}: the wallet snapshot (basket + positionMetrics). */
async function getOwnerSnapshot(owner: string): Promise<OwnerSnapshot | null> {
  return (await getJson(`/owner/${owner}`)) as OwnerSnapshot | null;
}

function toSide(sideUi: string | undefined): Side {
  return String(sideUi ?? "").toLowerCase().startsWith("s") ? "short" : "long";
}

/**
 * Map the snapshot's `positionMetrics` (a Record keyed by position, NOT an
 * array) to VenuePosition[]. The snapshot carries no mark price, so we enrich
 * it from /prices (falling back to entry if a symbol is missing). The record
 * key becomes positionKey.
 */
export async function getPositions(owner: string): Promise<VenuePosition[]> {
  const snap = await getOwnerSnapshot(owner);
  const metrics = snap?.positionMetrics ?? {};
  if (Object.keys(metrics).length === 0) return [];
  const marks = await getPrices();
  return Object.entries(metrics).map(([key, m]) => {
    const symbol = String(m.marketSymbol ?? key);
    const entryPrice = Number(m.entryPriceUi ?? 0);
    return {
      positionKey: key,
      symbol,
      side: toSide(m.sideUi),
      sizeUsd: Number(m.sizeUsdUi ?? 0),
      collateralUsd: Number(m.collateralUsdUi ?? 0),
      entryPrice,
      markPrice: marks[symbol] ?? entryPrice,
      liquidationPrice: Number(m.liquidationPriceUi ?? 0),
      leverage: Number(m.leverageUi ?? 0),
    };
  });
}

/** null basketPubkey ⇒ owner has not onboarded. */
export async function getBasketPubkey(owner: string): Promise<string | null> {
  const snap = await getOwnerSnapshot(owner);
  return snap?.basketPubkey ?? null;
}
