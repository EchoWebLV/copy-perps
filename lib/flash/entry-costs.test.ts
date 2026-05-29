import { describe, expect, it } from "vitest";

import {
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
