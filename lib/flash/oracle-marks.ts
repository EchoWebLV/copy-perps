// lib/flash/oracle-marks.ts
//
// MagicBlock ER Lazer feed decoding for the Scalp live mark. The ephemeral
// oracle (program PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd) pushes Pyth
// Lazer prices into PriceUpdateV2-layout accounts inside the Ephemeral Rollup
// at ~50ms cadence — the same oracle tier Flash executes against. Verified
// live on all three mainnet ER regions 2026-06-12 (arena-program/PINS.md);
// the PDAs are cluster-independent (same addresses on devnet and mainnet).
//
// Layout offsets (verified by spike + the dumped fixture
// arena-program/tests/fixtures/solusd-feed.json): discriminator 8 +
// write_authority 32 + verification_level 1 + feed_id 32 = price i64 @ 73,
// conf u64 @ 81, exponent i32 @ 89, publish_time i64 @ 93.

import type { FlashLiveMark, FlashLivePriceSymbol } from "./live-prices";

export const PRICE_OFFSET = 73;
export const PUBLISH_TS_OFFSET = 93;
/** Fixed Lazer scale for these feeds (ids 1/2/6 are exponent −8). The
 *  account's exponent FIELD is never written by MagicBlock's pusher (it
 *  stores only the quantized i64 — verified live: the byte at offset 89 is
 *  garbage), so decoding must NOT read it. */
export const LAZER_SCALE = 1e-8;
/** Sanity window: a decoded USD price outside this range is treated as a
 *  malformed account, not a market move. */
export const MIN_SANE_PRICE_USD = 1e-6;
export const MAX_SANE_PRICE_USD = 1e9;

/** Cluster-independent ephemeral-oracle feed PDAs
 *  (seeds ["price_feed", "pyth-lazer", symbol+"USD"]). */
export const FLASH_ORACLE_FEED_PDAS: Record<FlashLivePriceSymbol, string> = {
  SOL: "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
  BTC: "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr",
  ETH: "5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG",
};

/** Decode a PriceUpdateV2-layout feed account. Fail-closed: any malformed,
 *  non-positive, or non-finite read returns null — a bad oracle account must
 *  never become a rendered price. */
export function decodeLazerFeed(data: Uint8Array): FlashLiveMark | null {
  if (data.length < PUBLISH_TS_OFFSET + 8) return null;
  // DataView, not Buffer: the browser Buffer polyfill lacks readBigInt64LE
  // (verified live — same reason lib/arena/decode.ts is DataView-based).
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const priceRaw = view.getBigInt64(PRICE_OFFSET, true);
  const publishTs = view.getBigInt64(PUBLISH_TS_OFFSET, true);
  if (priceRaw <= 0n || publishTs <= 0n) return null;
  const priceUsd = Number(priceRaw) * LAZER_SCALE;
  if (
    !Number.isFinite(priceUsd) ||
    priceUsd < MIN_SANE_PRICE_USD ||
    priceUsd > MAX_SANE_PRICE_USD
  ) {
    return null;
  }
  const publishTimeMs = Number(publishTs) * 1000;
  if (!Number.isFinite(publishTimeMs)) return null;
  return { priceUsd, publishTimeMs };
}

/** Freshest-wins merge across the two mark sources (ER ws + Hermes SSE).
 *  Ties go to the incoming mark — latest delivery is the better estimate. */
export function mergeMark(
  current: FlashLiveMark | undefined,
  incoming: FlashLiveMark,
): FlashLiveMark {
  if (!current || incoming.publishTimeMs >= current.publishTimeMs) {
    return incoming;
  }
  return current;
}
