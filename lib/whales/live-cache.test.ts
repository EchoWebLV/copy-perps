import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhaleLiveSnapshot } from "./live-cache";

function whale(overrides: Partial<WhaleLiveSnapshot["whales"][number]> = {}) {
  const now = new Date("2026-05-23T12:00:00.000Z");
  return {
    id: "pacifica:acct-1",
    source: "pacifica" as const,
    sourceAccount: "acct-1",
    displayName: "Alpha Whale",
    avatarUrl: null,
    status: "active" as const,
    tags: ["leader"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function position(
  overrides: Partial<WhaleLiveSnapshot["positions"][number]> = {},
) {
  return {
    id: "pacifica:acct-1:BTC:long:1779543000000",
    whaleId: "pacifica:acct-1",
    source: "pacifica" as const,
    sourceAccount: "acct-1",
    market: "BTC",
    side: "long" as const,
    leverage: 10,
    amountBase: 0.5,
    notionalUsd: 32500,
    entryPrice: 65000,
    currentMark: 66300,
    unrealizedPnlPct: 2,
    openedAt: new Date("2026-05-23T11:30:00.000Z"),
    closedAt: null,
    status: "open" as const,
    raw: { source: "test" },
    lastSeenAt: new Date("2026-05-23T11:59:45.000Z"),
    ...overrides,
  };
}

describe("whale live cache", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));
    const { clearWhaleLiveSnapshotForTests } = await import("./live-cache");
    await clearWhaleLiveSnapshotForTests();
  });

  it("stores and restores live snapshots with date fields", async () => {
    const {
      getWhaleLiveSnapshot,
      writeWhaleLiveSnapshot,
    } = await import("./live-cache");

    await writeWhaleLiveSnapshot({
      source: "pacifica",
      observedAt: new Date("2026-05-23T11:59:50.000Z"),
      accounts: ["acct-1"],
      whales: [whale()],
      positions: [position()],
    });

    const snapshot = await getWhaleLiveSnapshot();

    expect(snapshot).toEqual({
      source: "pacifica",
      observedAt: new Date("2026-05-23T11:59:50.000Z"),
      accounts: ["acct-1"],
      whales: [whale()],
      positions: [position()],
    });
    expect(snapshot?.positions[0]?.openedAt).toBeInstanceOf(Date);
    expect(snapshot?.positions[0]?.lastSeenAt).toBeInstanceOf(Date);
  });

  it("distinguishes fetched-empty accounts from cache misses", async () => {
    const {
      getWhaleLivePositionsForAccount,
      writeWhaleLiveSnapshot,
    } = await import("./live-cache");

    await writeWhaleLiveSnapshot({
      source: "pacifica",
      observedAt: new Date("2026-05-23T11:59:50.000Z"),
      accounts: ["acct-1", "empty-acct"],
      whales: [
        whale(),
        whale({
          id: "pacifica:empty-acct",
          sourceAccount: "empty-acct",
          displayName: "Flat Whale",
        }),
      ],
      positions: [position()],
    });

    await expect(getWhaleLivePositionsForAccount("acct-1")).resolves.toEqual([
      position(),
    ]);
    await expect(getWhaleLivePositionsForAccount("empty-acct")).resolves.toEqual(
      [],
    );
    await expect(getWhaleLivePositionsForAccount("missing-acct")).resolves.toBe(
      null,
    );
  });

  it("merges source-specific snapshots without dropping the other source", async () => {
    const {
      getWhaleLiveSnapshot,
      getWhaleLivePositionsForAccount,
      writeWhaleLiveSnapshot,
    } = await import("./live-cache");

    await writeWhaleLiveSnapshot({
      source: "pacifica",
      observedAt: new Date("2026-05-23T11:59:40.000Z"),
      accounts: ["acct-1"],
      whales: [whale()],
      positions: [position()],
    });
    await writeWhaleLiveSnapshot({
      source: "hyperliquid",
      observedAt: new Date("2026-05-23T11:59:50.000Z"),
      accounts: ["0xabc"],
      whales: [
        whale({
          id: "hyperliquid:0xabc",
          source: "hyperliquid",
          sourceAccount: "0xabc",
          displayName: "HL Alpha",
        }),
      ],
      positions: [
        position({
          id: "hyperliquid:0xabc:ETH:long:2000000000",
          whaleId: "hyperliquid:0xabc",
          source: "hyperliquid",
          sourceAccount: "0xabc",
          market: "ETH",
        }),
      ],
    });

    const snapshot = await getWhaleLiveSnapshot();

    expect(snapshot?.source).toBe("multi");
    expect(snapshot?.accounts).toEqual(["acct-1", "0xabc"]);
    expect(snapshot?.positions.map((item) => item.id)).toEqual([
      "pacifica:acct-1:BTC:long:1779543000000",
      "hyperliquid:0xabc:ETH:long:2000000000",
    ]);
    await expect(
      getWhaleLivePositionsForAccount("0xabc", "hyperliquid"),
    ).resolves.toEqual([
      position({
        id: "hyperliquid:0xabc:ETH:long:2000000000",
        whaleId: "hyperliquid:0xabc",
        source: "hyperliquid",
        sourceAccount: "0xabc",
        market: "ETH",
      }),
    ]);
  });

  it("keeps same-source accounts that were not part of a partial refresh", async () => {
    const {
      getWhaleLiveSnapshot,
      writeWhaleLiveSnapshot,
    } = await import("./live-cache");

    const alphaWhale = whale({
      id: "hyperliquid:0xabc",
      source: "hyperliquid",
      sourceAccount: "0xabc",
      displayName: "HL Alpha",
    });
    const betaWhale = whale({
      id: "hyperliquid:0xdef",
      source: "hyperliquid",
      sourceAccount: "0xdef",
      displayName: "HL Beta",
    });
    const alphaPosition = position({
      id: "hyperliquid:0xabc:ETH:long:2000000000",
      whaleId: "hyperliquid:0xabc",
      source: "hyperliquid",
      sourceAccount: "0xabc",
      market: "ETH",
      openedAt: new Date("2026-05-23T11:00:00.000Z"),
    });
    const betaPosition = position({
      id: "hyperliquid:0xdef:SOL:short:82000000",
      whaleId: "hyperliquid:0xdef",
      source: "hyperliquid",
      sourceAccount: "0xdef",
      market: "SOL",
      side: "short",
      openedAt: new Date("2026-05-23T10:00:00.000Z"),
    });

    await writeWhaleLiveSnapshot({
      source: "hyperliquid",
      observedAt: new Date("2026-05-23T11:59:40.000Z"),
      accounts: ["0xabc", "0xdef"],
      whales: [alphaWhale, betaWhale],
      positions: [alphaPosition, betaPosition],
    });
    await writeWhaleLiveSnapshot({
      source: "hyperliquid",
      observedAt: new Date("2026-05-23T11:59:50.000Z"),
      accounts: ["0xabc"],
      whales: [alphaWhale],
      positions: [
        {
          ...alphaPosition,
          currentMark: 2100,
          lastSeenAt: new Date("2026-05-23T11:59:50.000Z"),
        },
      ],
    });

    const snapshot = await getWhaleLiveSnapshot();

    expect(snapshot?.accounts).toEqual(["0xdef", "0xabc"]);
    expect(snapshot?.positions.map((item) => item.id)).toEqual([
      "hyperliquid:0xdef:SOL:short:82000000",
      "hyperliquid:0xabc:ETH:long:2000000000",
    ]);
    expect(snapshot?.positions[0]?.openedAt).toEqual(
      new Date("2026-05-23T10:00:00.000Z"),
    );
  });

  it("finds a cached live position with its whale", async () => {
    const {
      getWhaleLivePositionById,
      writeWhaleLiveSnapshot,
    } = await import("./live-cache");

    await writeWhaleLiveSnapshot({
      source: "pacifica",
      observedAt: new Date("2026-05-23T11:59:50.000Z"),
      accounts: ["acct-1"],
      whales: [whale()],
      positions: [position()],
    });

    await expect(
      getWhaleLivePositionById("pacifica:acct-1:BTC:long:1779543000000"),
    ).resolves.toEqual({
      whale: whale(),
      position: position(),
    });
    await expect(getWhaleLivePositionById("missing")).resolves.toBe(null);
  });
});
