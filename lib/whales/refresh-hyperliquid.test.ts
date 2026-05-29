import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HLClearinghouseState } from "@/lib/hyperliquid/client";

const getClearinghouseState = vi.fn();
const getAllMids = vi.fn();
const getUserFillsByTime = vi.fn();
const upsertWhale = vi.fn();
const upsertWhalePosition = vi.fn();
const markMissingWhalePositionsClosed = vi.fn();
const getOpenWhalePositionsForSource = vi.fn();
const writeWhaleLiveSnapshot = vi.fn();

vi.mock("@/lib/hyperliquid/client", () => ({
  getClearinghouseState,
  getAllMids,
  getUserFillsByTime,
}));

vi.mock("./repository", () => ({
  upsertWhale,
  upsertWhalePosition,
  markMissingWhalePositionsClosed,
  getOpenWhalePositionsForSource,
}));

vi.mock("./live-cache", () => ({
  writeWhaleLiveSnapshot,
}));

vi.mock("@/lib/hyperliquid/whales", () => ({
  CURATED_WHALES: [
    { address: "0xabc", label: "HL Alpha" },
    { address: "0xempty", label: "HL Empty" },
  ],
  truncateEthAddress: (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`,
}));

function clearinghouseState(
  overrides: Partial<HLClearinghouseState> = {},
): HLClearinghouseState {
  return {
    marginSummary: {
      accountValue: "100000",
      totalNtlPos: "5000",
      totalRawUsd: "95000",
      totalMarginUsed: "500",
    },
    assetPositions: [
      {
        type: "oneWay",
        position: {
          coin: "ETH",
          szi: "2",
          leverage: { type: "cross", value: 10 },
          entryPx: "2000",
          positionValue: "4200",
          unrealizedPnl: "200",
          returnOnEquity: "0.5",
          liquidationPx: "1500",
          marginUsed: "420",
          maxLeverage: 25,
        },
      },
    ],
    withdrawable: "90000",
    time: Date.parse("2026-05-23T12:00:00.000Z"),
    ...overrides,
  };
}

describe("refreshHyperliquidWhales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllMids.mockResolvedValue({ ETH: "2100" });
    getClearinghouseState.mockImplementation(async (account: string) =>
      account === "0xempty"
        ? clearinghouseState({ assetPositions: [] })
        : clearinghouseState(),
    );
    getUserFillsByTime.mockResolvedValue([]);
    upsertWhale.mockResolvedValue(undefined);
    upsertWhalePosition.mockResolvedValue(undefined);
    markMissingWhalePositionsClosed.mockResolvedValue(undefined);
    getOpenWhalePositionsForSource.mockResolvedValue([]);
    writeWhaleLiveSnapshot.mockResolvedValue(undefined);
  });

  it("persists curated Hyperliquid whales and writes a source snapshot", async () => {
    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    const result = await refreshHyperliquidWhales();

    expect(result).toEqual({ whalesSeen: 2, positionsSeen: 1 });
    expect(upsertWhale).toHaveBeenCalledWith({
      id: "hyperliquid:0xabc",
      source: "hyperliquid",
      sourceAccount: "0xabc",
      displayName: "HL Alpha",
      avatarUrl: null,
      tags: ["hyperliquid"],
    });
    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hyperliquid:0xabc:ETH:long:1779537600000",
        source: "hyperliquid",
        sourceAccount: "0xabc",
        market: "ETH",
        currentMark: 2100,
        raw: expect.objectContaining({
          copyableOnPacifica: true,
          maxLeverage: 500,
          pacificaMaxLeverage: 500,
        }),
      }),
    );
    expect(markMissingWhalePositionsClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hyperliquid",
        sourceAccount: "0xabc",
        openPositionIds: ["hyperliquid:0xabc:ETH:long:1779537600000"],
      }),
    );
    expect(writeWhaleLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hyperliquid",
        accounts: ["0xabc", "0xempty"],
        whales: [
          expect.objectContaining({ id: "hyperliquid:0xabc" }),
          expect.objectContaining({ id: "hyperliquid:0xempty" }),
        ],
        positions: [
          expect.objectContaining({
            id: "hyperliquid:0xabc:ETH:long:1779537600000",
          }),
        ],
      }),
    );
  });

  it("marks Flash-supported Hyperliquid markets as available for copy routing", async () => {
    getAllMids.mockResolvedValue({ HYPE: "20" });
    getClearinghouseState.mockImplementation(async (account: string) =>
      account === "0xempty"
        ? clearinghouseState({ assetPositions: [] })
        : clearinghouseState({
            assetPositions: [
              {
                type: "oneWay",
                position: {
                  coin: "HYPE",
                  szi: "100",
                  leverage: { type: "cross", value: 5 },
                  entryPx: "18",
                  positionValue: "2000",
                  unrealizedPnl: "200",
                  returnOnEquity: "0.2",
                  liquidationPx: "10",
                  marginUsed: "400",
                  maxLeverage: 10,
                },
              },
            ],
          }),
    );
    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    await refreshHyperliquidWhales();

    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        market: "HYPE",
        raw: expect.objectContaining({
          copyableOnPacifica: true,
          maxLeverage: 20,
          pacificaMaxLeverage: 20,
        }),
      }),
    );
  });

  it("marks non-Flash markets as unavailable for copy routing", async () => {
    getAllMids.mockResolvedValue({ NEAR: "7" });
    getClearinghouseState.mockImplementation(async (account: string) =>
      account === "0xempty"
        ? clearinghouseState({ assetPositions: [] })
        : clearinghouseState({
            assetPositions: [
              {
                type: "oneWay",
                position: {
                  coin: "NEAR",
                  szi: "100",
                  leverage: { type: "cross", value: 5 },
                  entryPx: "6",
                  positionValue: "700",
                  unrealizedPnl: "100",
                  returnOnEquity: "0.2",
                  liquidationPx: "3",
                  marginUsed: "140",
                  maxLeverage: 10,
                },
              },
            ],
          }),
    );
    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    await refreshHyperliquidWhales();

    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        market: "NEAR",
        raw: expect.objectContaining({
          copyableOnPacifica: false,
          maxLeverage: null,
          pacificaMaxLeverage: null,
        }),
      }),
    );
  });

  it("preserves an existing Hyperliquid position open time in the live snapshot", async () => {
    const openedAt = new Date("2026-05-22T12:00:00.000Z");
    getOpenWhalePositionsForSource.mockImplementation(async ({ sourceAccount }) =>
      sourceAccount === "0xabc"
        ? [
            {
              id: "hyperliquid:0xabc:ETH:long:2000000000",
              openedAt,
            },
          ]
        : [],
    );
    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    await refreshHyperliquidWhales();

    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hyperliquid:0xabc:ETH:long:1779451200000",
        openedAt,
      }),
    );
    expect(writeWhaleLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [
          expect.objectContaining({
            id: "hyperliquid:0xabc:ETH:long:1779451200000",
            openedAt,
          }),
        ],
      }),
    );
  });

  it("uses Hyperliquid fills to recover the true current position open time", async () => {
    const openedAt = new Date("2026-05-23T11:42:00.000Z");
    getUserFillsByTime.mockImplementation(async (account: string) =>
      account === "0xabc"
        ? [
            {
              coin: "ETH",
              px: "2000",
              sz: "2",
              side: "B",
              time: openedAt.getTime(),
              startPosition: "0",
              dir: "Open Long",
              closedPnl: "0",
              hash: "0xhash",
              oid: 1,
              crossed: true,
              fee: "1",
              tid: 1,
            },
          ]
        : [],
    );

    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    await refreshHyperliquidWhales();

    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hyperliquid:0xabc:ETH:long:1779536520000",
        openedAt,
      }),
    );
    expect(writeWhaleLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [
          expect.objectContaining({
            id: "hyperliquid:0xabc:ETH:long:1779536520000",
            openedAt,
          }),
        ],
      }),
    );
  });

  it("does not warn for Hyperliquid 429 state rate limits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getClearinghouseState.mockRejectedValue(
      new Error("Hyperliquid clearinghouseState 429: null"),
    );
    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    const result = await refreshHyperliquidWhales();

    expect(result).toEqual({ whalesSeen: 2, positionsSeen: 0 });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Hyperliquid state failed"),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("does not warn for Hyperliquid 429 fills rate limits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getUserFillsByTime.mockRejectedValue(
      new Error("Hyperliquid userFillsByTime 429: null"),
    );
    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    await refreshHyperliquidWhales();

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Hyperliquid fills failed"),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("keeps the same Hyperliquid position id when entry price changes", async () => {
    const openedAt = new Date("2026-05-23T11:42:00.000Z");
    getOpenWhalePositionsForSource.mockImplementation(async ({ sourceAccount }) =>
      sourceAccount === "0xabc"
        ? [
            {
              id: "hyperliquid:0xabc:ETH:long:1779536520000",
              source: "hyperliquid",
              sourceAccount,
              market: "ETH",
              side: "long",
              openedAt,
            },
          ]
        : [],
    );
    getClearinghouseState.mockImplementation(async (account: string) =>
      account === "0xempty"
        ? clearinghouseState({ assetPositions: [] })
        : clearinghouseState({
            assetPositions: [
              {
                type: "oneWay",
                position: {
                  coin: "ETH",
                  szi: "2",
                  leverage: { type: "cross", value: 10 },
                  entryPx: "2010",
                  positionValue: "4200",
                  unrealizedPnl: "200",
                  returnOnEquity: "0.5",
                  liquidationPx: "1500",
                  marginUsed: "420",
                  maxLeverage: 25,
                },
              },
            ],
          }),
    );

    const { refreshHyperliquidWhales } = await import("./refresh-hyperliquid");

    await refreshHyperliquidWhales();

    expect(upsertWhalePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hyperliquid:0xabc:ETH:long:1779536520000",
        entryPrice: 2010,
        openedAt,
      }),
    );
    expect(markMissingWhalePositionsClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        openPositionIds: ["hyperliquid:0xabc:ETH:long:1779536520000"],
      }),
    );
  });
});
