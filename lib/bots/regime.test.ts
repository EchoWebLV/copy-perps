// lib/bots/regime.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/data/candles", () => ({
  getCandles: vi.fn(),
}));
vi.mock("@/lib/xai/responses", () => ({
  XAI_RESPONSES_MODEL_ID: "grok-4.3",
  generateXaiText: vi.fn(),
}));

import { getRegime } from "./regime";
import { getCandles } from "@/lib/data/candles";
import { generateXaiText } from "@/lib/xai/responses";

function flatCandles(price: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ts: 1_000 + i * 60_000,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }));
}

function trendingCandles(start: number, step: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const close = start + step * i;
    return {
      ts: 1_000 + i * 60_000,
      open: close - step,
      high: close,
      low: close - step,
      close,
      volume: 1,
    };
  });
}

describe("getRegime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when xAI errors", async () => {
    vi.mocked(getCandles).mockResolvedValue(flatCandles(100, 30));
    vi.mocked(generateXaiText).mockRejectedValue(new Error("xAI down"));
    const result = await getRegime("SOL");
    expect(result).toBeNull();
  });

  it("returns null when xAI response is not valid JSON", async () => {
    vi.mocked(getCandles).mockResolvedValue(flatCandles(100, 30));
    vi.mocked(generateXaiText).mockResolvedValue("not json at all");
    const result = await getRegime("BTC");
    expect(result).toBeNull();
  });

  it("returns null when candles fetch returns empty", async () => {
    vi.mocked(getCandles).mockResolvedValue([]);
    const result = await getRegime("HYPE");
    expect(result).toBeNull();
    // Should not have called xAI when candles are insufficient.
    expect(generateXaiText).not.toHaveBeenCalled();
  });

  it("parses a valid xAI response into a RegimeSnapshot", async () => {
    vi.mocked(getCandles).mockResolvedValue(trendingCandles(100, 0.5, 30));
    vi.mocked(generateXaiText).mockResolvedValue(
      '{"regime": "trending-up", "confidence": 0.85}',
    );
    const result = await getRegime("ETH");
    expect(result).not.toBeNull();
    expect(result!.regime).toBe("trending-up");
    expect(result!.confidence).toBeCloseTo(0.85);
    expect(typeof result!.sampledAtMs).toBe("number");
  });

  it("rejects unknown regime labels from xAI", async () => {
    vi.mocked(getCandles).mockResolvedValue(flatCandles(100, 30));
    vi.mocked(generateXaiText).mockResolvedValue(
      '{"regime": "made-up-label", "confidence": 0.5}',
    );
    const result = await getRegime("XRP");
    expect(result).toBeNull();
  });

  it("clamps confidence to [0, 1]", async () => {
    vi.mocked(getCandles).mockResolvedValue(flatCandles(100, 30));
    vi.mocked(generateXaiText).mockResolvedValue(
      '{"regime": "chop", "confidence": 1.5}',
    );
    const result = await getRegime("DOGE");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1);
  });

  it("caches per asset (second call within TTL doesn't hit xAI again)", async () => {
    vi.mocked(getCandles).mockResolvedValue(flatCandles(100, 30));
    vi.mocked(generateXaiText).mockResolvedValue(
      '{"regime": "chop", "confidence": 0.7}',
    );
    await getRegime("AVAX");
    await getRegime("AVAX");
    expect(generateXaiText).toHaveBeenCalledTimes(1);
  });
});
