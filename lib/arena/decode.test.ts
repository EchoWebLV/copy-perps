// lib/arena/decode.test.ts
//
// Round-trip tests for the client-side zero-copy decoders. The synthetic
// buffer builders below place values at offsets hand-transcribed from the
// layout comment tables in arena-program/programs/arena/src/state.rs —
// deliberately NOT imported from decode.ts, so a transcription slip in the
// implementation's OFF block fails these tests instead of agreeing with it.
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  ARENA_ACTIONS,
  arenaAction,
  decodeBot,
  decodeMarketState,
  ringClosesChronological,
  tapeNewestFirst,
} from "./decode";
import { ARENA_PERSONAS, botPda, personaIdBytes } from "./personas";

// ───────────────────────── synthetic buffer builders ──────────────────────
// Account data = 8-byte Anchor discriminator + struct (state.rs doc tables).

const DISC = 8;
const BOT_STRUCT = 2328;
const MARKET_STRUCT = 3608;

// Struct-relative offsets straight from the state.rs tables.
const BOT = {
  balance: 0x00,
  pnl: 0x08,
  fees: 0x10,
  eqHigh: 0x18,
  seq: 0x20,
  positions: 0x28, // [Position; 4], 48 B each
  tape: 0xe8, // [TapeEntry; 64], 32 B each
  params: 0x8e8, // StrategyParams, 16 B
  persona: 0x8f8, // [u8; 16]
  trades: 0x908,
  wins: 0x90c,
  tapeHead: 0x910,
  bump: 0x912,
};
const POS_SIZE = 48;
const POS = {
  entry: 0x00,
  stake: 0x08,
  opened: 0x10,
  liq: 0x18,
  ticks: 0x20,
  lev: 0x24,
  active: 0x26,
  market: 0x27,
  side: 0x28,
};
const TAPE_SIZE = 32;
const TAPE = {
  ts: 0x00,
  price: 0x08,
  stake: 0x10,
  market: 0x18,
  action: 0x19,
  conviction: 0x1a,
};
const PARAMS = {
  maxHold: 0x00,
  breakout: 0x04,
  activity: 0x06,
  stakeFrac: 0x08,
  lev: 0x0a,
  exitFav: 0x0c,
  readSpan: 0x0e,
  trend: 0x0f,
};
const MKT = {
  lastPrice: 0x00,
  lastPublishTs: 0x08,
  ring: 0x10, // [Bucket; 64], 56 B each
  head: 0xe10,
  marketId: 0xe12,
  bump: 0xe13,
};
const BUCKET_SIZE = 56;
const BKT = {
  open: 0x00,
  high: 0x08,
  low: 0x10,
  close: 0x18,
  startTs: 0x20,
  pathLen: 0x28,
  updates: 0x30,
};

function blank(structSize: number): { data: Uint8Array; dv: DataView } {
  const data = new Uint8Array(DISC + structSize);
  data.fill(0xaa, 0, DISC); // nonzero discriminator: decoders must skip it
  return { data, dv: new DataView(data.buffer) };
}
// Writers take STRUCT-relative offsets and shift by the discriminator.
const w64 = (dv: DataView, off: number, v: bigint) =>
  dv.setBigUint64(DISC + off, v, true);
const wi64 = (dv: DataView, off: number, v: bigint) =>
  dv.setBigInt64(DISC + off, v, true);
const w32 = (dv: DataView, off: number, v: number) =>
  dv.setUint32(DISC + off, v, true);
const w16 = (dv: DataView, off: number, v: number) =>
  dv.setUint16(DISC + off, v, true);
const w8 = (dv: DataView, off: number, v: number) =>
  dv.setUint8(DISC + off, v);

interface PositionSpec {
  slot: number;
  entryPrice: bigint; // 1e8-scaled
  stakeMicro: bigint;
  openedTs: bigint; // unix seconds
  liqPrice: bigint; // 1e8-scaled
  ticksHeld: number;
  leverage: number;
  active: number;
  marketId: number;
  side: number;
}
interface TapeSpec {
  slot: number;
  ts: bigint; // unix seconds
  price: bigint; // 1e8-scaled
  stakeMicro: bigint;
  marketId: number;
  action: number;
  conviction: number;
}
interface BotSpec {
  balanceMicro?: bigint;
  grossPnlMicro?: bigint;
  feesMicro?: bigint;
  equityHighMicro?: bigint;
  seq?: bigint;
  persona?: string;
  trades?: number;
  wins?: number;
  tapeHead?: number;
  bump?: number;
  positions?: PositionSpec[];
  tape?: TapeSpec[];
}

function mkBot(spec: BotSpec = {}): Uint8Array {
  const { data, dv } = blank(BOT_STRUCT);
  w64(dv, BOT.balance, spec.balanceMicro ?? 0n);
  wi64(dv, BOT.pnl, spec.grossPnlMicro ?? 0n);
  w64(dv, BOT.fees, spec.feesMicro ?? 0n);
  w64(dv, BOT.eqHigh, spec.equityHighMicro ?? 0n);
  w64(dv, BOT.seq, spec.seq ?? 0n);
  for (const p of spec.positions ?? []) {
    const base = BOT.positions + p.slot * POS_SIZE;
    w64(dv, base + POS.entry, p.entryPrice);
    w64(dv, base + POS.stake, p.stakeMicro);
    wi64(dv, base + POS.opened, p.openedTs);
    w64(dv, base + POS.liq, p.liqPrice);
    w32(dv, base + POS.ticks, p.ticksHeld);
    w16(dv, base + POS.lev, p.leverage);
    w8(dv, base + POS.active, p.active);
    w8(dv, base + POS.market, p.marketId);
    w8(dv, base + POS.side, p.side);
  }
  for (const t of spec.tape ?? []) {
    const base = BOT.tape + t.slot * TAPE_SIZE;
    wi64(dv, base + TAPE.ts, t.ts);
    w64(dv, base + TAPE.price, t.price);
    w64(dv, base + TAPE.stake, t.stakeMicro);
    w8(dv, base + TAPE.market, t.marketId);
    w8(dv, base + TAPE.action, t.action);
    w8(dv, base + TAPE.conviction, t.conviction);
  }
  if (spec.persona) {
    const utf8 = new TextEncoder().encode(spec.persona);
    data.set(utf8.subarray(0, 16), DISC + BOT.persona);
  }
  w32(dv, BOT.trades, spec.trades ?? 0);
  w32(dv, BOT.wins, spec.wins ?? 0);
  w16(dv, BOT.tapeHead, spec.tapeHead ?? 0);
  w8(dv, BOT.bump, spec.bump ?? 255);
  return data;
}

interface BucketSpec {
  slot: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  startTs: bigint;
  pathLen: bigint;
  updates: number;
}
interface MarketSpec {
  lastPrice?: bigint;
  lastPublishTs?: bigint;
  head?: number;
  marketId?: number;
  bump?: number;
  buckets?: BucketSpec[];
}

function mkMarket(spec: MarketSpec = {}): Uint8Array {
  const { data, dv } = blank(MARKET_STRUCT);
  w64(dv, MKT.lastPrice, spec.lastPrice ?? 0n);
  wi64(dv, MKT.lastPublishTs, spec.lastPublishTs ?? 0n);
  for (const b of spec.buckets ?? []) {
    const base = MKT.ring + b.slot * BUCKET_SIZE;
    w64(dv, base + BKT.open, b.open);
    w64(dv, base + BKT.high, b.high);
    w64(dv, base + BKT.low, b.low);
    w64(dv, base + BKT.close, b.close);
    wi64(dv, base + BKT.startTs, b.startTs);
    w64(dv, base + BKT.pathLen, b.pathLen);
    w32(dv, base + BKT.updates, b.updates);
  }
  w16(dv, MKT.head, spec.head ?? 0);
  w8(dv, MKT.marketId, spec.marketId ?? 0);
  w8(dv, MKT.bump, spec.bump ?? 255);
  return data;
}

// ───────────────────────────── decodeBot ──────────────────────────────────

describe("decodeBot", () => {
  it("decodes balances/pnl/fees/seq + trades/wins/tapeHead/bump/persona", () => {
    const bot = decodeBot(
      mkBot({
        balanceMicro: 1_234_560_000n, // $1,234.56
        grossPnlMicro: -45_670_000n, // -$45.67 (signed i64)
        feesMicro: 7_890_000n, // $7.89
        equityHighMicro: 2_000_000_000n, // $2,000
        seq: 12_345n,
        persona: "scalper-v1",
        trades: 42,
        wins: 21,
        tapeHead: 5,
        bump: 254,
      }),
    );
    expect(bot).not.toBeNull();
    expect(bot!.balanceUsd).toBe(1234.56);
    expect(bot!.grossPnlUsd).toBe(-45.67);
    expect(bot!.feesUsd).toBe(7.89);
    expect(bot!.equityHighUsd).toBe(2000);
    expect(bot!.seq).toBe(12345);
    expect(bot!.personaName).toBe("scalper-v1");
    expect(bot!.trades).toBe(42);
    expect(bot!.wins).toBe(21);
    expect(bot!.tapeHead).toBe(5);
    expect(bot!.bump).toBe(254);
  });

  it("decodes all four position slots at the documented offsets", () => {
    const bot = decodeBot(
      mkBot({
        positions: [
          {
            slot: 0,
            entryPrice: 6_706_300_000n, // $67.063
            stakeMicro: 100_000_000n, // $100
            openedTs: 1_760_000_000n,
            liqPrice: 6_650_000_000n, // $66.50
            ticksHeld: 7,
            leverage: 100,
            active: 1,
            marketId: 0,
            side: 0, // long
          },
          {
            slot: 3,
            entryPrice: 6_800_000_000n, // $68
            stakeMicro: 25_500_000n, // $25.50
            openedTs: 1_760_000_900n,
            liqPrice: 7_100_000_000n, // $71
            ticksHeld: 3,
            leverage: 20,
            active: 1,
            marketId: 0,
            side: 1, // short
          },
        ],
      }),
    );
    expect(bot).not.toBeNull();
    expect(bot!.positions).toHaveLength(4);

    const p0 = bot!.positions[0];
    expect(p0.active).toBe(true);
    expect(p0.side).toBe("long");
    expect(p0.marketId).toBe(0);
    expect(p0.entryPrice).toBe(67.063);
    expect(p0.stakeUsd).toBe(100);
    expect(p0.leverage).toBe(100);
    expect(p0.openedTsMs).toBe(1_760_000_000_000);
    expect(p0.ticksHeld).toBe(7);
    expect(p0.liqPrice).toBe(66.5);

    const p3 = bot!.positions[3];
    expect(p3.active).toBe(true);
    expect(p3.side).toBe("short");
    expect(p3.entryPrice).toBe(68);
    expect(p3.stakeUsd).toBe(25.5);
    expect(p3.leverage).toBe(20);
    expect(p3.openedTsMs).toBe(1_760_000_900_000);
    expect(p3.ticksHeld).toBe(3);
    expect(p3.liqPrice).toBe(71);

    // Untouched slots decode as inactive defaults.
    expect(bot!.positions[1].active).toBe(false);
    expect(bot!.positions[2].active).toBe(false);
    expect(bot!.positions[1].stakeUsd).toBe(0);
  });

  it("decodes tape entries at slot 0 and slot 63 (full stride coverage)", () => {
    const bot = decodeBot(
      mkBot({
        tape: [
          {
            slot: 0,
            ts: 1_760_000_100n,
            price: 6_700_000_000n,
            stakeMicro: 50_000_000n,
            marketId: 0,
            action: 0,
            conviction: 200,
          },
          {
            slot: 63,
            ts: 1_760_000_200n,
            price: 6_710_000_000n,
            stakeMicro: 75_000_000n,
            marketId: 0,
            action: 4,
            conviction: 90,
          },
        ],
      }),
    );
    expect(bot).not.toBeNull();
    expect(bot!.tape).toHaveLength(64);
    const t0 = bot!.tape[0];
    expect(t0.tsMs).toBe(1_760_000_100_000);
    expect(t0.price).toBe(67);
    expect(t0.stakeUsd).toBe(50);
    expect(t0.marketId).toBe(0);
    expect(t0.action).toBe(0);
    expect(t0.conviction).toBe(200);
    const t63 = bot!.tape[63];
    expect(t63.tsMs).toBe(1_760_000_200_000);
    expect(t63.price).toBe(67.1);
    expect(t63.stakeUsd).toBe(75);
    expect(t63.action).toBe(4);
    expect(t63.conviction).toBe(90);
  });

  it("decodes strategy params", () => {
    // Values = the live scalper-v1 devnet params (init-devnet.ts).
    const data = mkBot();
    const dv = new DataView(data.buffer);
    w32(dv, BOT.params + PARAMS.maxHold, 90);
    w16(dv, BOT.params + PARAMS.breakout, 60);
    w16(dv, BOT.params + PARAMS.activity, 14_000);
    w16(dv, BOT.params + PARAMS.stakeFrac, 1_000);
    w16(dv, BOT.params + PARAMS.lev, 100);
    w16(dv, BOT.params + PARAMS.exitFav, 100);
    w8(dv, BOT.params + PARAMS.readSpan, 1);
    w8(dv, BOT.params + PARAMS.trend, 1);

    const bot = decodeBot(data);
    expect(bot).not.toBeNull();
    expect(bot!.params).toEqual({
      maxHoldTicks: 90,
      breakoutBps: 60,
      activityMultBps: 14_000,
      stakeFracBps: 1_000,
      leverage: 100,
      exitFavorableBps: 100,
      readSpan: 1,
      trendFilter: true,
    });
  });

  it("returns null on a truncated buffer (fail-closed)", () => {
    const full = mkBot({ balanceMicro: 1_000_000n });
    expect(decodeBot(full)).not.toBeNull();
    expect(decodeBot(full.subarray(0, DISC + BOT_STRUCT - 1))).toBeNull();
    expect(decodeBot(new Uint8Array(0))).toBeNull();
    expect(decodeBot(new Uint8Array(DISC))).toBeNull();
  });

  it("reads through a non-zero byteOffset view (Buffer-pool shape)", () => {
    // node Buffers from getAccountInfo often sit at a nonzero byteOffset in a
    // shared pool — a DataView built on .buffer without honoring byteOffset
    // would silently read garbage. Simulate that shape.
    const bot = mkBot({ balanceMicro: 999_000_000n, persona: "rider-v1" });
    const pool = new Uint8Array(bot.length + 13).fill(0x77);
    pool.set(bot, 13);
    const view = pool.subarray(13);
    const decoded = decodeBot(view);
    expect(decoded).not.toBeNull();
    expect(decoded!.balanceUsd).toBe(999);
    expect(decoded!.personaName).toBe("rider-v1");
  });
});

// ─────────────────────────── tapeNewestFirst ──────────────────────────────

describe("tapeNewestFirst", () => {
  const entry = (slot: number, ts: bigint): TapeSpec => ({
    slot,
    ts,
    price: 6_700_000_000n,
    stakeMicro: 10_000_000n,
    marketId: 0,
    action: 0,
    conviction: 100,
  });

  it("iterates newest-first across the ring wrap, skipping empty slots", () => {
    // Write order was 62, 63, 0, 1 — tape_head points at the NEXT write slot
    // (paper.rs: write at head, then advance), so head = 2.
    const bot = decodeBot(
      mkBot({
        tapeHead: 2,
        tape: [
          entry(62, 10n),
          entry(63, 20n),
          entry(0, 30n),
          entry(1, 40n),
        ],
      }),
    );
    expect(bot).not.toBeNull();
    const tape = tapeNewestFirst(bot!);
    expect(tape.map((t) => t.tsMs)).toEqual([40_000, 30_000, 20_000, 10_000]);
  });

  it("handles a partially-filled tape without wrap", () => {
    const bot = decodeBot(
      mkBot({ tapeHead: 2, tape: [entry(0, 30n), entry(1, 40n)] }),
    );
    const tape = tapeNewestFirst(bot!);
    expect(tape.map((t) => t.tsMs)).toEqual([40_000, 30_000]);
  });

  it("returns [] for a fresh bot (empty tape)", () => {
    const bot = decodeBot(mkBot());
    expect(tapeNewestFirst(bot!)).toEqual([]);
  });
});

// ─────────────────────────── decodeMarketState ────────────────────────────

describe("decodeMarketState", () => {
  it("decodes lastPrice/lastPublishTs/head + the head bucket", () => {
    const market = decodeMarketState(
      mkMarket({
        lastPrice: 6_706_300_000n, // $67.063
        lastPublishTs: 1_760_000_111n,
        head: 56,
        marketId: 0,
        bump: 253,
        buckets: [
          {
            slot: 56,
            open: 6_700_000_000n,
            high: 6_720_000_000n,
            low: 6_690_000_000n,
            close: 6_706_300_000n,
            startTs: 1_760_000_100n,
            pathLen: 50_000_000n, // 0.5 price units traveled
            updates: 12,
          },
        ],
      }),
    );
    expect(market).not.toBeNull();
    expect(market!.lastPrice).toBe(67.063);
    expect(market!.lastPublishTsMs).toBe(1_760_000_111_000);
    expect(market!.head).toBe(56);
    expect(market!.marketId).toBe(0);
    expect(market!.bump).toBe(253);

    const b = market!.headBucket;
    expect(b.open).toBe(67);
    expect(b.high).toBe(67.2);
    expect(b.low).toBe(66.9);
    expect(b.close).toBe(67.063);
    expect(b.startTsMs).toBe(1_760_000_100_000);
    expect(b.pathLen).toBe(0.5);
    expect(b.updates).toBe(12);
    expect(market!.ring[56]).toEqual(b);
  });

  it("decodes ring buckets at slot 0 and slot 63 (full stride coverage)", () => {
    const market = decodeMarketState(
      mkMarket({
        head: 0,
        buckets: [
          {
            slot: 0,
            open: 100_000_000n,
            high: 200_000_000n,
            low: 50_000_000n,
            close: 150_000_000n,
            startTs: 1_000n,
            pathLen: 25_000_000n,
            updates: 3,
          },
          {
            slot: 63,
            open: 6_800_000_000n,
            high: 6_900_000_000n,
            low: 6_750_000_000n,
            close: 6_850_000_000n,
            startTs: 2_000n,
            pathLen: 300_000_000n,
            updates: 9,
          },
        ],
      }),
    );
    expect(market).not.toBeNull();
    expect(market!.ring).toHaveLength(64);
    expect(market!.ring[0].open).toBe(1);
    expect(market!.ring[0].close).toBe(1.5);
    expect(market!.ring[0].updates).toBe(3);
    expect(market!.ring[63].high).toBe(69);
    expect(market!.ring[63].low).toBe(67.5);
    expect(market!.ring[63].pathLen).toBe(3);
    expect(market!.ring[63].startTsMs).toBe(2_000_000);
  });

  it("returns null on a truncated buffer (fail-closed)", () => {
    const full = mkMarket({ lastPrice: 1n });
    expect(decodeMarketState(full)).not.toBeNull();
    expect(
      decodeMarketState(full.subarray(0, DISC + MARKET_STRUCT - 1)),
    ).toBeNull();
    // A Bot-sized buffer is far too small for MarketState.
    expect(decodeMarketState(mkBot())).toBeNull();
    expect(decodeMarketState(new Uint8Array(0))).toBeNull();
  });
});

// ──────────────────────── ringClosesChronological ──────────────────────────

describe("ringClosesChronological", () => {
  const bucket = (slot: number, startTs: bigint, close: bigint): BucketSpec => ({
    slot,
    open: close,
    high: close,
    low: close,
    close,
    startTs,
    pathLen: 0n,
    updates: 1,
  });

  it("walks oldest→newest across the wrap, ending at the head bucket", () => {
    // Write order was 63, 0, 1 — head points at the IN-PROGRESS bucket
    // (newest), so head = 1 and the oldest written slot is 63.
    const market = decodeMarketState(
      mkMarket({
        head: 1,
        buckets: [
          bucket(63, 10n, 6_700_000_000n), // $67 — oldest
          bucket(0, 20n, 6_710_000_000n), // $67.1
          bucket(1, 30n, 6_720_000_000n), // $67.2 — in-progress head
        ],
      }),
    );
    expect(market).not.toBeNull();
    expect(ringClosesChronological(market!)).toEqual([67, 67.1, 67.2]);
  });

  it("skips never-written slots and zeroed closes (fail-closed)", () => {
    const market = decodeMarketState(
      mkMarket({
        head: 2,
        buckets: [
          bucket(0, 10n, 6_700_000_000n),
          bucket(1, 20n, 0n), // written but garbage close — dropped
          bucket(2, 30n, 6_730_000_000n),
        ],
      }),
    );
    expect(ringClosesChronological(market!)).toEqual([67, 67.3]);
  });

  it("returns [] for a fresh market (no buckets written)", () => {
    const market = decodeMarketState(mkMarket());
    expect(ringClosesChronological(market!)).toEqual([]);
  });
});

// ───────────────────────────── action map ─────────────────────────────────

describe("ARENA_ACTIONS", () => {
  it("maps the five on-chain action codes to labels + v2 color tokens", () => {
    expect(ARENA_ACTIONS[0]).toEqual({ label: "OPEN LONG", color: "GREEN" });
    expect(ARENA_ACTIONS[1]).toEqual({ label: "OPEN SHORT", color: "RED" });
    expect(ARENA_ACTIONS[2]).toEqual({
      label: "EXIT FAVORABLE",
      color: "GREEN",
    });
    expect(ARENA_ACTIONS[3]).toEqual({ label: "EXIT MAX HOLD", color: "DIM" });
    expect(ARENA_ACTIONS[4]).toEqual({ label: "LIQUIDATED", color: "RED" });
  });

  it("arenaAction falls back to a DIM unknown for unmapped codes", () => {
    expect(arenaAction(9)).toEqual({ label: "UNKNOWN(9)", color: "DIM" });
    expect(arenaAction(2)).toEqual(ARENA_ACTIONS[2]);
  });
});

// ──────────────────────────── personas / PDAs ─────────────────────────────

describe("personas", () => {
  // PINS.md Task 13: deployed devnet program + recorded init_bot PDAs.
  const PROGRAM_ID = new PublicKey(
    "6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC",
  );

  it("personaIdBytes matches the init-devnet.ts encoding (utf8, zero-padded to 16)", () => {
    const bytes = personaIdBytes("scalper-v1");
    expect(bytes).toHaveLength(16);
    expect(Array.from(bytes.subarray(0, 10))).toEqual(
      Array.from(new TextEncoder().encode("scalper-v1")),
    );
    expect(Array.from(bytes.subarray(10))).toEqual([0, 0, 0, 0, 0, 0]);
    // Over-long names truncate at 16 bytes, like Buffer.write does.
    expect(Array.from(personaIdBytes("scalper-v1-but-longer"))).toEqual(
      Array.from(new TextEncoder().encode("scalper-v1-but-l")),
    );
  });

  it("botPda derives the recorded devnet bot PDAs", () => {
    expect(botPda("scalper-v1", PROGRAM_ID).toBase58()).toBe(
      "Fgbev9Y218a3V74baTRuwpecc4Ae6dddqbTFzkmJ8JkZ",
    );
    expect(botPda("rider-v1", PROGRAM_ID).toBase58()).toBe(
      "Az5PA1SVzC7z6p5ckjXwikoaGgG6oi65iuAhyriNRRHC",
    );
    // The dot-variant personas used by the local Rust suites are DIFFERENT
    // identities (PINS.md Task 13) — the encoding must be seed-exact.
    expect(botPda("scalper.v1", PROGRAM_ID).toBase58()).not.toBe(
      botPda("scalper-v1", PROGRAM_ID).toBase58(),
    );
  });

  it("registers display metadata for both launch bots", () => {
    expect(ARENA_PERSONAS["scalper-v1"]).toEqual({
      display: "Scalper",
      emoji: "⚡",
      blurb: "15s momentum, 100x",
    });
    expect(ARENA_PERSONAS["rider-v1"]).toEqual({
      display: "Trend Rider",
      emoji: "🏄",
      blurb: "1m trend rider, 20x",
    });
  });
});
