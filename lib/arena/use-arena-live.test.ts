// lib/arena/use-arena-live.test.ts
//
// Pure-helper tests only: env parsing, PDA derivations (pinned to the
// PINS.md Task 13 devnet addresses), staleness boundaries, and the
// patchArena state reducer. The hook body (Connection / ws / timers) is
// exercised in the browser, never here — no Connection is constructed in
// vitest. The synthetic buffer builders are deliberately local (offsets
// hand-transcribed from arena-program/programs/arena/src/state.rs), NOT
// shared with decode.test.ts, so a regression there can't mask one here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  type ArenaLive,
  STALE_AFTER_MS,
  isStale,
  marketPda,
  parseArenaEnv,
  patchArena,
} from "./use-arena-live";
import { botPda } from "./personas";

// PINS.md Task 13: deployed devnet program + recorded init table addresses.
const PROGRAM_ID_B58 = "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_B58);
const MARKET0_PDA = "BTk9M99Eh5xjccYpZui4K8CvMesCLkHAWjF9gXSjhhzj";
const SCALPER_PDA = "Fgbev9Y218a3V74baTRuwpecc4Ae6dddqbTFzkmJ8JkZ";
const RIDER_PDA = "Az5PA1SVzC7z6p5ckjXwikoaGgG6oi65iuAhyriNRRHC";

// ───────────────────────────── parseArenaEnv ──────────────────────────────

describe("parseArenaEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null when the program id is missing or blank", () => {
    expect(parseArenaEnv({})).toBeNull();
    expect(parseArenaEnv({ programId: "" })).toBeNull();
    expect(parseArenaEnv({ programId: "   " })).toBeNull();
  });

  it("returns null on a malformed program id (fail-closed, never throws)", () => {
    expect(parseArenaEnv({ programId: "not-a-base58-pubkey!!" })).toBeNull();
  });

  it("applies endpoint + roster defaults when only the id is set", () => {
    const env = parseArenaEnv({ programId: PROGRAM_ID_B58 });
    expect(env).not.toBeNull();
    expect(env!.programId.toBase58()).toBe(PROGRAM_ID_B58);
    expect(env!.endpoint).toBe("https://devnet.magicblock.app");
    expect(env!.botNames).toEqual(["scalper-v1", "rider-v1"]);
  });

  it("parses + trims the bot list, dropping empty entries", () => {
    const env = parseArenaEnv({
      programId: PROGRAM_ID_B58,
      endpoint: " https://er.example.com ",
      bots: " scalper-v1 , rider-v1 ,, test-aggro-v1 ",
    });
    expect(env!.endpoint).toBe("https://er.example.com");
    expect(env!.botNames).toEqual(["scalper-v1", "rider-v1", "test-aggro-v1"]);
  });

  it("falls back to the default roster when the list parses empty", () => {
    const env = parseArenaEnv({ programId: PROGRAM_ID_B58, bots: " , " });
    expect(env!.botNames).toEqual(["scalper-v1", "rider-v1"]);
  });

  it("parses the market id, defaulting and clamping bad values to 0", () => {
    expect(parseArenaEnv({ programId: PROGRAM_ID_B58 })!.marketId).toBe(0);
    expect(
      parseArenaEnv({ programId: PROGRAM_ID_B58, marketId: "1" })!.marketId,
    ).toBe(1);
    expect(
      parseArenaEnv({ programId: PROGRAM_ID_B58, marketId: " 7 " })!.marketId,
    ).toBe(7);
    // Out-of-u8 or garbage → 0 (fail-closed to the canonical market).
    expect(
      parseArenaEnv({ programId: PROGRAM_ID_B58, marketId: "256" })!.marketId,
    ).toBe(0);
    expect(
      parseArenaEnv({ programId: PROGRAM_ID_B58, marketId: "-1" })!.marketId,
    ).toBe(0);
    expect(
      parseArenaEnv({ programId: PROGRAM_ID_B58, marketId: "abc" })!.marketId,
    ).toBe(0);
  });

  it("reads NEXT_PUBLIC_ARENA_* from process.env by default", () => {
    vi.stubEnv("NEXT_PUBLIC_ARENA_PROGRAM_ID", PROGRAM_ID_B58);
    vi.stubEnv("NEXT_PUBLIC_ARENA_ER_ENDPOINT", "https://er.example.com");
    vi.stubEnv("NEXT_PUBLIC_ARENA_BOTS", "a-bot,b-bot");
    vi.stubEnv("NEXT_PUBLIC_ARENA_MARKET_ID", "1");
    expect(parseArenaEnv()).toMatchObject({
      endpoint: "https://er.example.com",
      botNames: ["a-bot", "b-bot"],
      marketId: 1,
    });
    vi.stubEnv("NEXT_PUBLIC_ARENA_PROGRAM_ID", undefined);
    expect(parseArenaEnv()).toBeNull();
  });
});

// ────────────────────────────── PDA helpers ───────────────────────────────

describe("marketPda / botPda (PINS.md Task 13 devnet addresses)", () => {
  it("derives the recorded market 0 PDA (marketId defaults to 0)", () => {
    expect(marketPda(PROGRAM_ID).toBase58()).toBe(MARKET0_PDA);
    expect(marketPda(PROGRAM_ID, 0).toBase58()).toBe(MARKET0_PDA);
  });

  it("derives a different PDA for a different market id", () => {
    expect(marketPda(PROGRAM_ID, 1).toBase58()).not.toBe(MARKET0_PDA);
  });

  it("botPda derives the recorded PDAs for the default roster", () => {
    expect(botPda("scalper-v1", PROGRAM_ID).toBase58()).toBe(SCALPER_PDA);
    expect(botPda("rider-v1", PROGRAM_ID).toBase58()).toBe(RIDER_PDA);
  });
});

// ──────────────────────────────── isStale ─────────────────────────────────

describe("isStale", () => {
  const NOW = 1_760_000_000_000;

  it("is fresh within the window and at exactly the max age", () => {
    expect(isStale(NOW - 1_000, NOW)).toBe(false);
    expect(isStale(NOW - STALE_AFTER_MS, NOW)).toBe(false); // boundary
  });

  it("is stale one ms past the max age", () => {
    expect(isStale(NOW - STALE_AFTER_MS - 1, NOW)).toBe(true);
  });

  it("honors a custom max age", () => {
    expect(isStale(NOW - 5_001, NOW, 5_000)).toBe(true);
    expect(isStale(NOW - 4_999, NOW, 5_000)).toBe(false);
  });

  it("treats a never-published ts (0) as stale and a future ts as fresh", () => {
    expect(isStale(0, NOW)).toBe(true);
    expect(isStale(NOW + 2_000, NOW)).toBe(false); // ER clock-skew tolerance
  });
});

// ─────────────────────────────── patchArena ───────────────────────────────
// Minimal synthetic account buffers: 8-byte discriminator + struct, values
// at the state.rs offsets the decoders read (balance @0x00 / persona @0x8f8
// for Bot; lastPrice @0x00 for MarketState).

const DISC = 8;
const BOT_STRUCT = 2328;
const MARKET_STRUCT = 3608;
const BOT_PERSONA_OFF = 0x8f8;

function botBuf(balanceMicro: bigint, persona: string): Uint8Array {
  const data = new Uint8Array(DISC + BOT_STRUCT);
  new DataView(data.buffer).setBigUint64(DISC, balanceMicro, true);
  data.set(
    new TextEncoder().encode(persona).subarray(0, 16),
    DISC + BOT_PERSONA_OFF,
  );
  return data;
}

function marketBuf(lastPrice1e8: bigint): Uint8Array {
  const data = new Uint8Array(DISC + MARKET_STRUCT);
  new DataView(data.buffer).setBigUint64(DISC, lastPrice1e8, true);
  return data;
}

const NAMES = ["scalper-v1", "rider-v1"];

function baseState(): ArenaLive {
  return {
    bots: { "scalper-v1": null, "rider-v1": null },
    market: null,
    mode: "loading",
    lastUpdateMs: 123,
  };
}

describe("patchArena", () => {
  it("index 0 decodes into the market slot, leaving bots untouched", () => {
    const s = baseState();
    const next = patchArena(s, NAMES, 0, marketBuf(6_700_000_000n));
    expect(next.market?.lastPrice).toBe(67);
    expect(next.bots).toBe(s.bots); // same reference — bots not rebuilt
    // Temporal fields are the hook's job, not the reducer's.
    expect(next.mode).toBe("loading");
    expect(next.lastUpdateMs).toBe(123);
  });

  it("indices 1+ map to botNames order", () => {
    const s = baseState();
    const a = patchArena(s, NAMES, 1, botBuf(1_000_000_000n, "scalper-v1"));
    expect(a.bots["scalper-v1"]?.balanceUsd).toBe(1000);
    expect(a.bots["scalper-v1"]?.personaName).toBe("scalper-v1");
    expect(a.bots["rider-v1"]).toBeNull();
    expect(a.market).toBeNull();

    const b = patchArena(a, NAMES, 2, botBuf(2_000_000_000n, "rider-v1"));
    expect(b.bots["rider-v1"]?.balanceUsd).toBe(2000);
    expect(b.bots["scalper-v1"]?.balanceUsd).toBe(1000); // earlier patch kept
  });

  it("null account data fails closed to a null slot", () => {
    const seeded = patchArena(
      patchArena(baseState(), NAMES, 0, marketBuf(1n)),
      NAMES,
      1,
      botBuf(1n, "scalper-v1"),
    );
    expect(seeded.market).not.toBeNull();
    expect(seeded.bots["scalper-v1"]).not.toBeNull();
    expect(patchArena(seeded, NAMES, 0, null).market).toBeNull();
    expect(patchArena(seeded, NAMES, 1, null).bots["scalper-v1"]).toBeNull();
  });

  it("undecodable bytes fail closed to a null slot, never throw", () => {
    const s = baseState();
    expect(patchArena(s, NAMES, 0, new Uint8Array(10)).market).toBeNull();
    // A Bot-sized buffer in the market slot is too short for MarketState.
    expect(patchArena(s, NAMES, 0, botBuf(1n, "x")).market).toBeNull();
    expect(
      patchArena(s, NAMES, 1, new Uint8Array(DISC + BOT_STRUCT - 1)).bots[
        "scalper-v1"
      ],
    ).toBeNull();
  });

  it("out-of-range account indices return the state unchanged", () => {
    const s = baseState();
    expect(patchArena(s, NAMES, NAMES.length + 1, botBuf(1n, "x"))).toBe(s);
    expect(patchArena(s, NAMES, -1, marketBuf(1n))).toBe(s);
  });

  it("never mutates the input state", () => {
    const s = baseState();
    const snapshot = structuredClone(s);
    patchArena(s, NAMES, 0, marketBuf(6_700_000_000n));
    patchArena(s, NAMES, 1, botBuf(5n, "scalper-v1"));
    patchArena(s, NAMES, 1, null);
    expect(s).toEqual(snapshot);
  });
});
