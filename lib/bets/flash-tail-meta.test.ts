import { describe, expect, it } from "vitest";
import {
  buildFlashTailMeta,
  parseFlashTailMeta,
  parseTailLineage,
} from "./flash-tail-meta";

const lineage = {
  sourceKind: "whale" as const,
  whaleId: "whale-1",
  botId: null,
  sourceName: "Big Whale",
  sourcePositionId: "pos-1",
};

describe("flash-tail meta", () => {
  it("round-trips build -> parse", () => {
    const meta = buildFlashTailMeta({
      lineage,
      market: "SOL",
      side: "long",
      leverage: 20,
      mode: "standard",
      walletAddress: "wallet-1",
      entryPriceUsd: 160,
      notionalUsd: 20,
      openFeeUsd: 0.01,
    });
    expect(meta.sourceType).toBe("flash-tail");
    expect(meta.openSignature).toBeNull();
    expect(parseFlashTailMeta(meta)).toEqual(meta);
  });

  it("rejects junk", () => {
    expect(parseFlashTailMeta(null)).toBeNull();
    expect(parseFlashTailMeta({ sourceType: "whale" })).toBeNull();
    expect(parseFlashTailMeta({ sourceType: "flash-tail" })).toBeNull();
  });

  it("rejects single-field corruption of otherwise valid meta", () => {
    const valid = buildFlashTailMeta({
      lineage,
      market: "SOL",
      side: "long",
      leverage: 20,
      mode: "standard",
      walletAddress: "wallet-1",
      entryPriceUsd: 160,
      notionalUsd: 20,
      openFeeUsd: 0.01,
    });
    expect(parseFlashTailMeta({ ...valid, side: "up" })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, mode: "turbo" })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, walletAddress: "" })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, leverage: Number.NaN })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, closeReason: "auto" })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, proceedsSource: "guess" })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, openSignature: 5 })).toBeNull();
    expect(parseFlashTailMeta({ ...valid, entryPriceUsd: "160" })).toBeNull();
  });

  it("parses tail lineage from a request body", () => {
    expect(parseTailLineage(lineage)).toEqual(lineage);
    expect(
      parseTailLineage({ sourceKind: "bot", botId: "pulse" }),
    ).toEqual({
      sourceKind: "bot",
      whaleId: null,
      botId: "pulse",
      sourceName: null,
      sourcePositionId: null,
    });
    expect(parseTailLineage({ sourceKind: "nope" })).toBeNull();
    expect(parseTailLineage(undefined)).toBeNull();
    expect(parseTailLineage({ sourceKind: "whale" })).toBeNull(); // whale needs whaleId
    expect(parseTailLineage({ sourceKind: "bot" })).toBeNull(); // bot needs botId
  });
});
