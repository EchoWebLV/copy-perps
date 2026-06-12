import { describe, expect, it } from "vitest";
import {
  FLASH_ORACLE_FEED_PDAS,
  decodeLazerFeed,
  mergeMark,
  PRICE_OFFSET,
  PUBLISH_TS_OFFSET,
} from "./oracle-marks";

function synthFeed({
  price,
  publishTs,
  len = 134,
  junkAtExponentField = false,
}: {
  price: bigint;
  publishTs: number;
  len?: number;
  junkAtExponentField?: boolean;
}): Uint8Array {
  const buf = Buffer.alloc(len);
  buf.writeBigInt64LE(price, PRICE_OFFSET);
  // The pusher never writes the exponent field (verified live) — optionally
  // fill it with garbage to pin that decode must ignore those bytes.
  if (junkAtExponentField) buf.writeInt32LE(8, 89);
  buf.writeBigInt64LE(BigInt(publishTs), PUBLISH_TS_OFFSET);
  return new Uint8Array(buf);
}

describe("decodeLazerFeed", () => {
  it("decodes price at the fixed 1e-8 Lazer scale, publish time in ms", () => {
    const mark = decodeLazerFeed(
      synthFeed({ price: 6_674_000_000n, publishTs: 1_781_200_000 }),
    );
    expect(mark).toEqual({
      priceUsd: 66.74,
      publishTimeMs: 1_781_200_000_000,
    });
  });

  it("ignores the unwritten exponent field bytes entirely", () => {
    const mark = decodeLazerFeed(
      synthFeed({
        price: 166_811_000_000n, // ETH ~$1668.11 at 1e8
        publishTs: 1_781_200_000,
        junkAtExponentField: true,
      }),
    );
    expect(mark?.priceUsd).toBeCloseTo(1668.11, 6);
  });

  it("fails closed on malformed accounts", () => {
    // Too short for the layout.
    expect(decodeLazerFeed(new Uint8Array(64))).toBeNull();
    // Non-positive price.
    expect(
      decodeLazerFeed(synthFeed({ price: 0n, publishTs: 1_781_200_000 })),
    ).toBeNull();
    expect(
      decodeLazerFeed(synthFeed({ price: -5n, publishTs: 1_781_200_000 })),
    ).toBeNull();
    // Nonsensical publish time (zero/negative).
    expect(decodeLazerFeed(synthFeed({ price: 1n, publishTs: 0 }))).toBeNull();
    // Outside the sanity window: sub-micro-dollar and >$1e9 prices.
    expect(
      decodeLazerFeed(synthFeed({ price: 1n, publishTs: 1_781_200_000 })),
    ).toBeNull();
    expect(
      decodeLazerFeed(
        synthFeed({
          price: 200_000_000_000_000_000n, // $2e9 at 1e8 scale
          publishTs: 1_781_200_000,
        }),
      ),
    ).toBeNull();
  });
});

describe("mergeMark (freshest wins across ER ws and Hermes SSE)", () => {
  const older = { priceUsd: 66.7, publishTimeMs: 1_000 };
  const newer = { priceUsd: 66.8, publishTimeMs: 2_000 };

  it("takes the incoming mark when no current exists", () => {
    expect(mergeMark(undefined, newer)).toBe(newer);
  });

  it("keeps the freshest publish time regardless of source order", () => {
    expect(mergeMark(older, newer)).toBe(newer);
    expect(mergeMark(newer, older)).toBe(newer);
  });

  it("equal timestamps prefer the incoming mark (latest delivery)", () => {
    const same = { priceUsd: 66.9, publishTimeMs: 2_000 };
    expect(mergeMark(newer, same)).toBe(same);
  });
});

describe("FLASH_ORACLE_FEED_PDAS", () => {
  it("covers exactly the Flash live-price symbols", () => {
    expect(Object.keys(FLASH_ORACLE_FEED_PDAS).sort()).toEqual([
      "BTC",
      "ETH",
      "SOL",
    ]);
  });
});
