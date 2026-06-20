import { describe, expect, it } from "vitest";

import { FLASH_LIVE_PRICE_FEEDS } from "./live-prices";
import { parsePythPriceUpdate } from "./live-prices";
import {
  buildLazerStreamUrl,
  buildLazerSubscribeMessage,
  LAZER_FEED_IDS,
  transcodeLazerToHermes,
} from "./lazer-relay";

// A representative Lazer `streamUpdated` tick for SOL (id 6): quantized price
// 17234500000 at exponent -8 => $172.345, timestamp in microseconds.
function lazerTick({
  id = 6,
  price = "17234500000",
  exponent = -8,
  timestampUs = 1_718_900_000_000_000,
  wrap = "parsed" as "parsed" | "streamUpdated",
}: Partial<{
  id: number;
  price: string;
  exponent: number;
  timestampUs: number;
  wrap: "parsed" | "streamUpdated";
}> = {}): string {
  const parsed = {
    priceFeeds: [{ priceFeedId: id, price, exponent }],
    timestampUs,
  };
  return JSON.stringify(
    wrap === "parsed" ? { parsed } : { type: "streamUpdated", streamUpdated: { parsed } },
  );
}

describe("buildLazerStreamUrl", () => {
  it("appends the token as a query param", () => {
    expect(
      buildLazerStreamUrl("wss://host/v1/stream", "tok en/+"),
    ).toBe("wss://host/v1/stream?ACCESS_TOKEN=tok%20en%2F%2B");
  });
  it("returns the bare endpoint when no token", () => {
    expect(buildLazerStreamUrl("wss://host/v1/stream", "")).toBe(
      "wss://host/v1/stream",
    );
  });
});

describe("buildLazerSubscribeMessage", () => {
  it("subscribes to BTC/ETH/SOL on real_time by default", () => {
    const msg = JSON.parse(buildLazerSubscribeMessage());
    expect(msg.type).toBe("subscribe");
    expect(msg.channel).toBe("real_time");
    expect(msg.priceFeedIds).toEqual(Object.values(LAZER_FEED_IDS));
    expect(msg.properties).toContain("price");
    expect(msg.ignoreInvalidFeeds).toBe(true);
  });
});

describe("transcodeLazerToHermes", () => {
  it("transcodes a tick into a Hermes payload the client parser decodes back", () => {
    const hermes = transcodeLazerToHermes(lazerTick());
    expect(hermes).not.toBeNull();
    const marks = parsePythPriceUpdate(hermes!);
    expect(marks.SOL?.priceUsd).toBeCloseTo(172.345, 3);
    // 1_718_900_000_000_000 us -> seconds -> *1000 ms (round-trip through both layers)
    expect(marks.SOL?.publishTimeMs).toBe(1_718_900_000_000);
  });

  it("maps every Lazer id to the right symbol/feed", () => {
    for (const [symbol, id] of Object.entries(LAZER_FEED_IDS)) {
      const hermes = transcodeLazerToHermes(lazerTick({ id, price: "100000000" }));
      const parsed = JSON.parse(hermes!);
      expect(parsed.parsed[0].id).toBe(
        FLASH_LIVE_PRICE_FEEDS[symbol as keyof typeof FLASH_LIVE_PRICE_FEEDS],
      );
    }
  });

  it("handles the streamUpdated envelope variant", () => {
    const marks = parsePythPriceUpdate(
      transcodeLazerToHermes(lazerTick({ wrap: "streamUpdated" }))!,
    );
    expect(marks.SOL?.priceUsd).toBeCloseTo(172.345, 3);
  });

  it("skips unknown feed ids", () => {
    expect(transcodeLazerToHermes(lazerTick({ id: 999 }))).toBeNull();
  });

  it("skips subscribe ACKs, errors, and malformed JSON", () => {
    expect(transcodeLazerToHermes('{"type":"subscribed","subscriptionId":1}')).toBeNull();
    expect(transcodeLazerToHermes('{"type":"error","error":"nope"}')).toBeNull();
    expect(transcodeLazerToHermes("not json")).toBeNull();
    expect(transcodeLazerToHermes('{"parsed":{"priceFeeds":[]}}')).toBeNull();
  });

  it("skips a tick with no timestamp (cannot order it against other marks)", () => {
    expect(
      transcodeLazerToHermes(
        JSON.stringify({ parsed: { priceFeeds: [{ priceFeedId: 6, price: "1" }] } }),
      ),
    ).toBeNull();
  });
});
