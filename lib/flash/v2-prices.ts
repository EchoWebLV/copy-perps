// lib/flash/v2-prices.ts
//
// Flash V2 hosted-API price reads (flashapi.trade/v2) — REST, no auth.
// Covers EVERY Flash-listed symbol (XAU/FX/equities included), which our
// oracle marks (BTC/ETH/SOL Lazer feeds + Hermes) don't. Used as the
// mid-chain fallback in the copy engine's entry-gap guard:
//   our marks → V2 prices → the source venue's own mark.
//
// Source: flash-trade/examples-v2 — GET /v2/prices/{symbol} returns
// `{ priceUi, exponent, timestamp }`-shaped objects; unknown symbols 404;
// trading endpoints report errors as 200-with-`err` (GOTCHAS §1), so the
// parser checks `err` before trusting any field.

const BASE_URL =
  process.env.FLASH_V2_BASE_URL ?? "https://flashapi.trade/v2";

const PRICE_TTL_MS = 2_500; // copy ticks every ~3s; one fetch per symbol/tick
const NEGATIVE_TTL_MS = 60_000; // unknown symbols stay unknown for a while
const FETCH_TIMEOUT_MS = 1_500; // guard path — never stall the tick on this

interface CacheEntry {
  priceUsd: number | null;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>();

/** Tolerant parse of a /v2/prices/{symbol} body. Exported for tests.
 *  Live shape (verified 2026-06-12): `{ price: 4219330, exponent: -3,
 *  priceUi: 4219.33, … }` — `price` is a RAW MANTISSA. Prefer priceUi;
 *  only use `price` with its exponent applied, never bare. */
export function parseFlashV2Price(body: unknown): number | null {
  if (body === null || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (obj.err) return null; // GOTCHAS §1: errors can arrive inside HTTP 200

  const ui = obj.priceUi;
  const uiPrice =
    typeof ui === "string" ? Number.parseFloat(ui) : typeof ui === "number" ? ui : NaN;
  if (Number.isFinite(uiPrice) && uiPrice > 0) return uiPrice;

  if (typeof obj.price === "number" && typeof obj.exponent === "number") {
    const scaled = obj.price * Math.pow(10, obj.exponent);
    if (Number.isFinite(scaled) && scaled > 0) return scaled;
  }
  return null;
}

/** USD price for any Flash symbol via the hosted V2 API, TTL-cached.
 *  Returns null on 404/timeout/parse failure — callers treat null as
 *  "this source has no opinion", never as a tradable zero. */
export async function fetchFlashV2PriceUsd(
  symbol: string,
  nowMs = Date.now(),
): Promise<number | null> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAtMs > nowMs) return hit.priceUsd;

  let priceUsd: number | null = null;
  let ttl = NEGATIVE_TTL_MS;
  try {
    const res = await fetch(`${BASE_URL}/prices/${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      priceUsd = parseFlashV2Price(await res.json());
      if (priceUsd !== null) ttl = PRICE_TTL_MS;
    }
    // non-OK (404 unknown symbol, 5xx) → negative-cache
  } catch {
    // network/timeout → treat as no-opinion, short negative cache so a
    // blip doesn't blind the guard for a full minute
    ttl = PRICE_TTL_MS;
  }
  cache.set(key, { priceUsd, expiresAtMs: nowMs + ttl });
  return priceUsd;
}

/** Test hook. */
export function clearFlashV2PriceCache(): void {
  cache.clear();
}
