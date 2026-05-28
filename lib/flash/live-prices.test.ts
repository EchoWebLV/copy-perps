import { describe, expect, it } from "vitest";

import {
  FLASH_LIVE_PRICE_FEEDS,
  buildPythHermesStreamUrl,
  parsePythPriceUpdate,
} from "./live-prices";

describe("Flash live Pyth price helpers", () => {
  it("builds a Hermes stream URL for BTC ETH SOL", () => {
    const url = buildPythHermesStreamUrl("https://hermes.pyth.network");

    expect(url).toContain("/v2/updates/price/stream?");
    expect(url).toContain(`ids%5B%5D=${FLASH_LIVE_PRICE_FEEDS.BTC}`);
    expect(url).toContain(`ids%5B%5D=${FLASH_LIVE_PRICE_FEEDS.ETH}`);
    expect(url).toContain(`ids%5B%5D=${FLASH_LIVE_PRICE_FEEDS.SOL}`);
  });

  it("parses Pyth parsed price updates into symbol marks", () => {
    const marks = parsePythPriceUpdate(
      JSON.stringify({
        parsed: [
          {
            id: FLASH_LIVE_PRICE_FEEDS.BTC,
            price: { price: "10512345678900", expo: -8, publish_time: 1 },
          },
          {
            id: FLASH_LIVE_PRICE_FEEDS.SOL,
            price: { price: "17234000000", expo: -8, publish_time: 2 },
          },
        ],
      }),
    );

    expect(marks.BTC?.priceUsd).toBeCloseTo(105123.456789);
    expect(marks.BTC?.publishTimeMs).toBe(1000);
    expect(marks.SOL?.priceUsd).toBeCloseTo(172.34);
    expect(marks.SOL?.publishTimeMs).toBe(2000);
  });
});
