// lib/flash/lazer-relay.ts
//
// Pyth Lazer ("Pyth Pro") real-time price stream — the 1-50ms feed that drives
// the super-dynamic scalp graph. Lazer is a separate, much faster product than
// Pyth Hermes (~2-4/s): the `real_time` channel pushes a fresh tick every few
// milliseconds straight over a WebSocket. The token must stay server-side
// ("never expose access tokens in frontend applications" — Pyth), so the
// browser talks to /api/flash/perp/prices/lazer, which holds the token and
// rebroadcasts over SSE.
//
// To avoid a second client-side decoder, the relay transcodes each Lazer tick
// into the exact Pyth Hermes "parsed" JSON shape the browser already decodes
// (parsePythPriceUpdate in live-prices.ts). The pure functions here are unit
// tested; the I/O lives in the route.
//
// Feed-id mapping mirrors perps-games/redline3d/src/main.ts (BTC=1, ETH=2,
// SOL=6, all exponent -8).

import { FLASH_LIVE_PRICE_FEEDS, type FlashLivePriceSymbol } from "./live-prices";

/** Pyth Lazer real-time WebSocket endpoints (round-robin failover). */
export const LAZER_STREAM_ENDPOINTS = [
  "wss://pyth-lazer-0.dourolabs.app/v1/stream",
  "wss://pyth-lazer-1.dourolabs.app/v1/stream",
  "wss://pyth-lazer-2.dourolabs.app/v1/stream",
] as const;

/** Lazer numeric feed ids for our three markets. */
export const LAZER_FEED_IDS: Record<FlashLivePriceSymbol, number> = {
  BTC: 1,
  ETH: 2,
  SOL: 6,
};

/** Default Lazer exponent for ids 1/2/6 — used only when a tick omits its own
 *  exponent. Matches the Hermes feed scale so transcoded prices stay correct. */
const DEFAULT_LAZER_EXPONENT = -8;

const LAZER_SYMBOL_BY_ID = new Map<number, FlashLivePriceSymbol>(
  (Object.entries(LAZER_FEED_IDS) as Array<[FlashLivePriceSymbol, number]>).map(
    ([symbol, id]) => [id, symbol],
  ),
);

export type LazerChannel =
  | "real_time"
  | "fixed_rate@1ms"
  | "fixed_rate@50ms"
  | "fixed_rate@200ms"
  | "fixed_rate@1000ms";

export const DEFAULT_LAZER_CHANNEL: LazerChannel = "real_time";

/** Authenticated upstream URL. Lazer accepts the token as a query param, which
 *  avoids the custom-header limitation of the WHATWG WebSocket constructor. */
export function buildLazerStreamUrl(endpoint: string, token: string): string {
  return token
    ? `${endpoint}?ACCESS_TOKEN=${encodeURIComponent(token)}`
    : endpoint;
}

/** The subscribe frame the relay sends once the upstream socket opens. */
export function buildLazerSubscribeMessage(
  subscriptionId = 1,
  channel: LazerChannel = DEFAULT_LAZER_CHANNEL,
): string {
  return JSON.stringify({
    type: "subscribe",
    subscriptionId,
    priceFeedIds: Object.values(LAZER_FEED_IDS),
    properties: ["price", "exponent"],
    formats: [],
    channel,
    ignoreInvalidFeeds: true,
  });
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface LazerPriceFeed {
  priceFeedId?: unknown;
  price_feed_id?: unknown;
  price?: unknown;
  exponent?: unknown;
}

interface LazerParsed {
  priceFeeds?: unknown;
  price_feeds?: unknown;
  timestampUs?: unknown;
  timestamp_us?: unknown;
}

function extractParsed(payload: unknown): LazerParsed | null {
  if (payload == null || typeof payload !== "object") return null;
  const direct = (payload as { parsed?: unknown }).parsed;
  if (direct && typeof direct === "object") return direct as LazerParsed;
  const streamUpdated = (payload as { streamUpdated?: { parsed?: unknown } })
    .streamUpdated;
  if (
    streamUpdated &&
    typeof streamUpdated === "object" &&
    streamUpdated.parsed &&
    typeof streamUpdated.parsed === "object"
  ) {
    return streamUpdated.parsed as LazerParsed;
  }
  return null;
}

/** Transcode a raw Lazer stream message into the Pyth Hermes "parsed" JSON
 *  shape the client already decodes (parsePythPriceUpdate). Returns null when
 *  the message carries no usable price for our markets — subscribe ACKs,
 *  errors, heartbeats, and unknown feeds are all skipped so the relay never
 *  enqueues an empty SSE frame. */
export function transcodeLazerToHermes(raw: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = extractParsed(payload);
  if (!parsed) return null;

  const list = parsed.priceFeeds ?? parsed.price_feeds;
  if (!Array.isArray(list) || list.length === 0) return null;

  const tsUs = finiteNumber(parsed.timestampUs ?? parsed.timestamp_us);
  // Hermes parser reads publish_time in SECONDS (it multiplies by 1000).
  const publishTimeSec = tsUs != null ? tsUs / 1_000_000 : null;

  const rows: Array<{
    id: string;
    price: { price: string; expo: number; publish_time: number };
  }> = [];

  for (const entry of list as LazerPriceFeed[]) {
    if (entry == null || typeof entry !== "object") continue;
    const idRaw = entry.priceFeedId ?? entry.price_feed_id;
    const id = finiteNumber(idRaw);
    if (id == null) continue;
    const symbol = LAZER_SYMBOL_BY_ID.get(id);
    if (!symbol) continue;
    const priceNumber = finiteNumber(entry.price);
    if (priceNumber == null) continue;
    const expo = finiteNumber(entry.exponent) ?? DEFAULT_LAZER_EXPONENT;
    if (publishTimeSec == null) continue;
    rows.push({
      id: FLASH_LIVE_PRICE_FEEDS[symbol],
      price: {
        // Pass the quantized integer through as a string; the Hermes parser
        // applies `price * 10**expo` itself.
        price: String(priceNumber),
        expo,
        publish_time: publishTimeSec,
      },
    });
  }

  if (rows.length === 0) return null;
  return JSON.stringify({ parsed: rows });
}
