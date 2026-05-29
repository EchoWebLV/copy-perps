import { describe, expect, it } from "vitest";

import {
  deserializeFlashEntryCostCache,
  mergeFlashEntryCostCache,
  rememberFlashEntryCost,
  type FlashEntryCostPosition,
} from "./entry-costs";

const position = (
  overrides: Partial<FlashEntryCostPosition>,
): FlashEntryCostPosition => ({
  positionPubkey: "flash-sol-long",
  openTime: Date.parse("2026-05-29T06:00:00.000Z"),
  ...overrides,
});

describe("Flash entry cost cache", () => {
  it("restores entry cost and open fee onto a refreshed position", () => {
    const cache = new Map();
    rememberFlashEntryCost(
      cache,
      position({ entryCostUsd: 1, openFeeUsd: 0.1 }),
    );

    const [merged] = mergeFlashEntryCostCache(cache, [
      position({ entryCostUsd: undefined, openFeeUsd: undefined }),
    ]);

    expect(merged).toMatchObject({
      positionPubkey: "flash-sol-long",
      entryCostUsd: 1,
      openFeeUsd: 0.1,
    });
  });

  it("restores requested leverage over Flash refreshed effective leverage", () => {
    const cache = new Map();
    rememberFlashEntryCost(
      cache,
      position({ entryCostUsd: 1, openFeeUsd: 0.1, leverage: 500 }),
    );

    const [merged] = mergeFlashEntryCostCache(cache, [
      position({
        entryCostUsd: undefined,
        openFeeUsd: undefined,
        leverage: 1953,
      }),
    ]);

    expect(merged).toMatchObject({
      entryCostUsd: 1,
      openFeeUsd: 0.1,
      leverage: 500,
    });
  });

  it("drops inferred fallback snapshots that were not captured from an open quote", () => {
    const cache = deserializeFlashEntryCostCache([
      {
        positionPubkey: "flash-sol-long",
        openTime: Date.parse("2026-05-29T06:00:00.000Z"),
        entryCostUsd: 0.83,
        leverage: 398,
      },
    ]);

    expect(cache.size).toBe(0);
  });

  it("does not apply stale fees to a later position using the same account", () => {
    const cache = new Map();
    rememberFlashEntryCost(
      cache,
      position({ entryCostUsd: 1, openFeeUsd: 0.1 }),
    );

    const [merged] = mergeFlashEntryCostCache(cache, [
      position({
        openTime: Date.parse("2026-05-29T07:00:00.000Z"),
        entryCostUsd: undefined,
        openFeeUsd: undefined,
      }),
    ]);

    expect(merged.entryCostUsd).toBeUndefined();
    expect(merged.openFeeUsd).toBeUndefined();
  });
});
