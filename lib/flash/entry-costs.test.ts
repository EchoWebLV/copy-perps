import { describe, expect, it } from "vitest";

import {
  mergeFlashEntryCostCache,
  rememberFlashEntryCost,
  seedFlashEntryCostCache,
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

  it("keeps the first observed fallback stake and leverage stable", () => {
    const cache = new Map();

    seedFlashEntryCostCache(
      cache,
      position({ entryCostUsd: 0.83, openFeeUsd: undefined, leverage: 398 }),
    );
    seedFlashEntryCostCache(
      cache,
      position({ entryCostUsd: 0.77, openFeeUsd: undefined, leverage: 328 }),
    );

    const [merged] = mergeFlashEntryCostCache(cache, [
      position({
        entryCostUsd: undefined,
        openFeeUsd: undefined,
        leverage: 328,
      }),
    ]);

    expect(merged).toMatchObject({
      entryCostUsd: 0.83,
      leverage: 398,
    });
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
