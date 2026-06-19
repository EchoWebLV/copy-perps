import { describe, expect, it, vi } from "vitest";
import { getBotPositionSignal, personaFromBotId } from "./bot-position";
import type { ArenaLlmBot } from "./decode";

// A valid base58 program id so PDA derivation works (System program).
const PROGRAM_ID = "11111111111111111111111111111111";

function bot(over: Partial<ArenaLlmBot> = {}): ArenaLlmBot {
  return {
    positions: [],
    tape: [],
    balanceUsd: 0,
    grossPnlUsd: 0,
    feesUsd: 0,
    fundingPaidUsd: 0,
    equityHighUsd: 0,
    dayStartEquityUsd: 0,
    seq: 0,
    dayStartTsMs: 0,
    lastDecisionTsMs: 0,
    params: {} as ArenaLlmBot["params"],
    personaName: "claude",
    trades: 0,
    wins: 0,
    tradesToday: 0,
    halted: false,
    tapeHead: 0,
    bump: 0,
    ...over,
  };
}

const pos = (active: boolean) =>
  ({ active, marketId: 1, side: "long", entryPrice: 100 }) as ArenaLlmBot["positions"][number];

const data = () => ({ data: new Uint8Array([1, 2, 3]) });

describe("personaFromBotId", () => {
  it("extracts the persona from an arena bot id", () => {
    expect(personaFromBotId("arena:claude")).toBe("claude");
  });
  it("returns null for a non-arena bot id", () => {
    expect(personaFromBotId("paper-bot-7")).toBeNull();
    expect(personaFromBotId("arena:")).toBeNull();
  });
});

describe("getBotPositionSignal", () => {
  it("returns active when the bot has any active position", async () => {
    const signal = await getBotPositionSignal("arena:claude", {
      programId: PROGRAM_ID,
      getAccountInfo: vi.fn(async () => data()),
      decode: () => bot({ positions: [pos(false), pos(true)] }),
    });
    expect(signal).toBe("active");
  });

  it("returns flat when the bot decodes cleanly with no active position", async () => {
    const signal = await getBotPositionSignal("arena:claude", {
      programId: PROGRAM_ID,
      getAccountInfo: vi.fn(async () => data()),
      decode: () => bot({ positions: [pos(false), pos(false)] }),
    });
    expect(signal).toBe("flat");
  });

  it("returns unknown for a non-arena bot id (never reads chain)", async () => {
    const getAccountInfo = vi.fn();
    const signal = await getBotPositionSignal("paper-bot-7", {
      programId: PROGRAM_ID,
      getAccountInfo,
    });
    expect(signal).toBe("unknown");
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it("returns unknown when no program id is configured", async () => {
    const signal = await getBotPositionSignal("arena:claude", {
      programId: undefined,
      getAccountInfo: vi.fn(async () => data()),
    });
    expect(signal).toBe("unknown");
  });

  it("returns unknown when the account is absent", async () => {
    const signal = await getBotPositionSignal("arena:claude", {
      programId: PROGRAM_ID,
      getAccountInfo: vi.fn(async () => null),
    });
    expect(signal).toBe("unknown");
  });

  it("returns unknown when the read throws (RPC error)", async () => {
    const signal = await getBotPositionSignal("arena:claude", {
      programId: PROGRAM_ID,
      getAccountInfo: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });
    expect(signal).toBe("unknown");
  });

  it("returns unknown when the decode fails", async () => {
    const signal = await getBotPositionSignal("arena:claude", {
      programId: PROGRAM_ID,
      getAccountInfo: vi.fn(async () => data()),
      decode: () => null,
    });
    expect(signal).toBe("unknown");
  });
});
