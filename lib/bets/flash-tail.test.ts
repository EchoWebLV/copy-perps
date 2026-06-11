import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    select: mocks.select,
  },
}));

import {
  confirmFlashTailClose,
  confirmFlashTailOpen,
  findOpenFlashTailBet,
  recordFlashTailOpen,
} from "./flash-tail";
import { buildFlashTailMeta } from "./flash-tail-meta";

const meta = buildFlashTailMeta({
  lineage: {
    sourceKind: "whale",
    whaleId: "whale-1",
    botId: null,
    sourceName: "Big Whale",
    sourcePositionId: "pos-1",
  },
  market: "SOL",
  side: "long",
  leverage: 20,
  mode: "standard",
  walletAddress: "wallet-1",
  entryPriceUsd: 160,
  notionalUsd: 20,
  openFeeUsd: 0.01,
});

function betRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    userId: "user-1",
    type: "flash-tail",
    status: "pending",
    amountUsdc: 1,
    meta,
    ...overrides,
  };
}

describe("flash-tail db helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([betRow()]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mocks.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([betRow({ status: "confirmed" })]),
        }),
      }),
    });
    mocks.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([betRow({ status: "confirmed" })]),
          }),
          limit: vi.fn().mockResolvedValue([betRow({ status: "confirmed" })]),
        }),
      }),
    });
  });

  it("recordFlashTailOpen inserts a pending flash-tail bet and returns its id", async () => {
    const betId = await recordFlashTailOpen({
      userId: "user-1",
      stakeUsdc: 1,
      meta,
    });
    expect(betId).toBe("bet-1");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("confirmFlashTailOpen flips status and writes an estimate fill", async () => {
    // confirmFlashTailOpen requires the loaded bet to have status "pending"
    mocks.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([betRow()]),
          }),
          limit: vi.fn().mockResolvedValue([betRow()]),
        }),
      }),
    });

    const ok = await confirmFlashTailOpen({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-open",
    });
    expect(ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1); // bets row
    expect(mocks.insert).toHaveBeenCalledTimes(1); // fills row
  });

  it("confirmFlashTailClose stamps close fields and writes a close fill", async () => {
    const ok = await confirmFlashTailClose({
      betId: "bet-1",
      userId: "user-1",
      signature: "sig-close",
      receiveUsdEstimate: 1.24,
    });
    expect(ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("findOpenFlashTailBet returns the newest confirmed bet for market+side", async () => {
    const bet = await findOpenFlashTailBet({
      userId: "user-1",
      market: "SOL",
      side: "long",
    });
    expect(bet?.id).toBe("bet-1");
  });
});
