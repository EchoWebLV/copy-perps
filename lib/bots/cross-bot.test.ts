import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const select = vi.fn();
  return { db: { select } };
});

import { db } from "@/lib/db";

function makeRow(botId: string, asset: string, side: "long" | "short") {
  return { botId, asset, side, status: "open" };
}

describe("getCrossBotSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh module state — TTL cache from prior tests would otherwise leak.
    vi.resetModules();
  });

  function setRows(rows: ReturnType<typeof makeRow>[]) {
    // Drizzle pattern: db.select(...).from(...).where(...) resolves to rows.
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ from });
  }

  it("returns empty maps when no open positions", async () => {
    setRows([]);
    const { getCrossBotSnapshot } = await import("./cross-bot");
    const snap = await getCrossBotSnapshot();
    expect(snap.positionsByAssetSide.size).toBe(0);
    expect(snap.botsByAsset.size).toBe(0);
  });

  it("groups same-side positions on the same asset", async () => {
    setRows([
      makeRow("lizard", "SOL", "long"),
      makeRow("mike", "SOL", "long"),
      makeRow("max", "SOL", "long"),
    ]);
    const { getCrossBotSnapshot } = await import("./cross-bot");
    const snap = await getCrossBotSnapshot();
    expect(snap.positionsByAssetSide.get("SOL|long")).toBe(3);
    expect(snap.botsByAsset.get("SOL")?.length).toBe(3);
  });

  it("separates long and short counts on the same asset", async () => {
    setRows([
      makeRow("lizard", "BTC", "long"),
      makeRow("phoebe", "BTC", "short"),
      makeRow("mike", "BTC", "short"),
    ]);
    const { getCrossBotSnapshot } = await import("./cross-bot");
    const snap = await getCrossBotSnapshot();
    expect(snap.positionsByAssetSide.get("BTC|long")).toBe(1);
    expect(snap.positionsByAssetSide.get("BTC|short")).toBe(2);
    const botsOnBtc = snap.botsByAsset.get("BTC") ?? [];
    expect(botsOnBtc.length).toBe(3);
  });
});
