// lib/arena/decode.ts
//
// Client-side byte decoders for the arena program's zero-copy accounts.
//
// SOURCE OF TRUTH: arena-program/programs/arena/src/state.rs — the layout
// comment tables on Bucket / MarketState / Position / TapeEntry /
// StrategyParams / Bot, locked by the Rust `zero_copy_layouts_locked` test.
// Offsets in OFF below are struct-relative; account data = 8-byte Anchor
// discriminator + struct bytes. If a field there moves, this file MUST move
// with it (and vice versa — change them together, never independently).
//
// Deliberately ZERO imports: pure DataView/Uint8Array reads keep the app
// bundle free of anchor/Borsh AND @solana/web3.js (PDA derivation lives in
// ./personas). Units are JS-friendly on the way out: micro-USD → USD numbers,
// 1e8-scaled prices → USD numbers, i64 unix seconds → epoch milliseconds.

export const ACCOUNT_DISC = 8; // Anchor account discriminator

export const RING_LEN = 64;
export const TAPE_LEN = 64;
export const MAX_POSITIONS = 4;

export const BUCKET_SIZE = 56;
export const POSITION_SIZE = 48;
export const TAPE_ENTRY_SIZE = 32;
export const PARAMS_SIZE = 16;
export const BOT_STRUCT_SIZE = 2328; // account data = 8 + this
export const MARKET_STATE_STRUCT_SIZE = 3608; // account data = 8 + this
// LLM oracle-bot tier (state.rs LlmBot/LlmPosition/LlmParams, locked by
// llm_bot_layout_locked). account data = 8 + LLM_BOT_STRUCT_SIZE.
export const LLM_POSITION_SIZE = 72;
export const LLM_PARAMS_SIZE = 24;
export const LLM_BOT_STRUCT_SIZE = 2496;

// Struct-relative byte offsets, transcribed from the state.rs layout tables.
const OFF = {
  bot: {
    balanceMicro: 0x00, // u64
    grossPnlMicro: 0x08, // i64
    feesMicro: 0x10, // u64
    equityHighMicro: 0x18, // u64
    seq: 0x20, // u64
    positions: 0x28, // [Position; 4] — 192 B
    tape: 0xe8, // [TapeEntry; 64] — 2048 B
    params: 0x8e8, // StrategyParams — 16 B
    personaId: 0x8f8, // [u8; 16]
    trades: 0x908, // u32
    wins: 0x90c, // u32
    tapeHead: 0x910, // u16
    bump: 0x912, // u8 (+5 pad → 2328)
  },
  position: {
    entryPrice: 0x00, // u64, 1e8-scaled
    stakeMicro: 0x08, // u64
    openedTs: 0x10, // i64 unix secs
    liqPrice: 0x18, // u64, 1e8-scaled
    ticksHeld: 0x20, // u32
    leverage: 0x24, // u16
    active: 0x26, // u8 0/1
    marketId: 0x27, // u8
    side: 0x28, // u8 0=long 1=short (+7 pad → 48)
  },
  tapeEntry: {
    ts: 0x00, // i64 unix secs
    price: 0x08, // u64, 1e8-scaled
    stakeMicro: 0x10, // u64
    marketId: 0x18, // u8
    action: 0x19, // u8 — see ARENA_ACTIONS
    conviction: 0x1a, // u8 (+5 pad → 32)
  },
  params: {
    maxHoldTicks: 0x00, // u32
    breakoutBps: 0x04, // u16
    activityMultBps: 0x06, // u16
    stakeFracBps: 0x08, // u16
    leverage: 0x0a, // u16
    exitFavorableBps: 0x0c, // u16
    readSpan: 0x0e, // u8
    trendFilter: 0x0f, // u8 0/1 (→ 16, zero padding)
  },
  market: {
    lastPrice: 0x00, // u64, 1e8-scaled
    lastPublishTs: 0x08, // i64 unix secs
    ring: 0x10, // [Bucket; 64] — 3584 B
    head: 0xe10, // u16 — index of the in-progress bucket
    marketId: 0xe12, // u8
    bump: 0xe13, // u8 (+4 pad → 3608)
  },
  bucket: {
    open: 0x00, // u64, 1e8-scaled
    high: 0x08, // u64, 1e8-scaled
    low: 0x10, // u64, 1e8-scaled
    close: 0x18, // u64, 1e8-scaled
    startTs: 0x20, // i64 unix secs
    pathLen: 0x28, // u64, Σ|Δprice| in 1e8 price units
    updates: 0x30, // u32 (+4 pad → 56)
  },
  llmBot: {
    operator: 0x00, // Pubkey [u8;32]
    balanceMicro: 0x20, // u64
    grossPnlMicro: 0x28, // i64
    feesMicro: 0x30, // u64
    fundingPaidMicro: 0x38, // u64
    equityHighMicro: 0x40, // u64
    dayStartEquityMicro: 0x48, // u64
    seq: 0x50, // u64
    dayStartTs: 0x58, // i64 unix secs
    lastDecisionTs: 0x60, // i64 unix secs
    positions: 0x68, // [LlmPosition; 4] — 288 B
    tape: 0x188, // [TapeEntry; 64] — 2048 B
    params: 0x988, // LlmParams — 24 B
    personaId: 0x9a0, // [u8; 16]
    trades: 0x9b0, // u32
    wins: 0x9b4, // u32
    tradesToday: 0x9b8, // u16
    tapeHead: 0x9ba, // u16
    halted: 0x9bc, // u8 0/1
    bump: 0x9bd, // u8 (+2 pad → 2496)
  },
  llmPosition: {
    entryPrice: 0x00, // u64, 1e8-scaled
    stakeMicro: 0x08, // u64
    stopPrice: 0x10, // u64, 1e8-scaled
    tpPrice: 0x18, // u64, 1e8-scaled (0 = none)
    liqPrice: 0x20, // u64, 1e8-scaled
    openedTs: 0x28, // i64 unix secs
    lastFundingTs: 0x30, // i64 unix secs
    ticksHeld: 0x38, // u32
    leverage: 0x3c, // u16
    active: 0x3e, // u8 0/1
    marketId: 0x3f, // u8
    side: 0x40, // u8 0=long 1=short (+7 pad → 72)
  },
  llmParams: {
    maxHoldTicks: 0x00, // u32
    decisionCooldownSecs: 0x04, // u32
    maxLeverage: 0x08, // u16
    minStopBps: 0x0a, // u16
    maxStopBps: 0x0c, // u16
    maxStakeFracBps: 0x0e, // u16
    maxTradesPerDay: 0x10, // u16
    dailyLossLimitBps: 0x12, // u16
    fundingBpsPerHour: 0x14, // u16
    confidenceFloor: 0x16, // u8 0..100
    riskSizing: 0x17, // u8 0/1 (→ 24, zero padding)
  },
} as const;

// ───────────────────────────── public types ───────────────────────────────

export type ArenaSide = "long" | "short";

export interface ArenaPosition {
  active: boolean;
  marketId: number;
  side: ArenaSide;
  entryPrice: number; // USD
  stakeUsd: number;
  leverage: number;
  openedTsMs: number; // epoch ms
  ticksHeld: number;
  liqPrice: number; // USD
}

export interface ArenaTapeEntry {
  tsMs: number; // epoch ms
  price: number; // USD
  stakeUsd: number;
  marketId: number;
  action: number; // raw code — display via arenaAction()
  conviction: number;
}

export interface ArenaStrategyParams {
  maxHoldTicks: number;
  breakoutBps: number;
  activityMultBps: number;
  stakeFracBps: number;
  leverage: number;
  exitFavorableBps: number;
  readSpan: number;
  trendFilter: boolean;
}

export interface ArenaBot {
  balanceUsd: number;
  grossPnlUsd: number; // signed
  feesUsd: number;
  equityHighUsd: number;
  seq: number;
  positions: ArenaPosition[]; // all 4 slots — filter on .active
  tape: ArenaTapeEntry[]; // all 64 slots in storage order
  params: ArenaStrategyParams;
  personaName: string; // utf8 persona_id up to the first NUL
  trades: number;
  wins: number;
  tapeHead: number; // NEXT tape write slot (paper.rs)
  bump: number;
}

export interface ArenaLlmPosition {
  active: boolean;
  marketId: number;
  side: ArenaSide;
  entryPrice: number; // USD
  stakeUsd: number;
  stopPrice: number; // USD
  tpPrice: number; // USD (0 = none)
  liqPrice: number; // USD
  leverage: number;
  openedTsMs: number;
  ticksHeld: number;
}

export interface ArenaLlmParams {
  maxHoldTicks: number;
  decisionCooldownSecs: number;
  maxLeverage: number;
  minStopBps: number;
  maxStopBps: number;
  maxStakeFracBps: number;
  maxTradesPerDay: number;
  dailyLossLimitBps: number;
  fundingBpsPerHour: number;
  confidenceFloor: number; // 0..100
  riskSizing: boolean;
}

export interface ArenaLlmBot {
  balanceUsd: number;
  grossPnlUsd: number; // signed
  feesUsd: number;
  fundingPaidUsd: number;
  equityHighUsd: number;
  dayStartEquityUsd: number;
  seq: number;
  dayStartTsMs: number;
  lastDecisionTsMs: number;
  positions: ArenaLlmPosition[]; // all 4 slots — filter on .active
  tape: ArenaTapeEntry[]; // shares the Bot TapeEntry layout
  params: ArenaLlmParams;
  personaName: string;
  trades: number;
  wins: number;
  tradesToday: number;
  halted: boolean;
  tapeHead: number;
  bump: number;
}

export interface ArenaBucket {
  open: number; // USD
  high: number;
  low: number;
  close: number;
  startTsMs: number; // epoch ms
  pathLen: number; // price units traveled within the bucket
  updates: number;
}

export interface ArenaMarketState {
  lastPrice: number; // USD
  lastPublishTsMs: number; // epoch ms
  head: number;
  marketId: number;
  bump: number;
  ring: ArenaBucket[]; // all 64 buckets in storage order
  headBucket: ArenaBucket; // ring[head] — the in-progress bucket
}

// ───────────────────────────── action map ─────────────────────────────────

// `color` names a color export of components/v2/ui.tsx (GREEN / RED / DIM).
// decode.ts stays React-free, so components resolve the token themselves:
//   import { GREEN, RED, DIM } from "@/components/v2/ui";
//   const css = { GREEN, RED, DIM }[arenaAction(code).color];
export type ArenaColorToken = "GREEN" | "RED" | "DIM";

export interface ArenaActionDisplay {
  label: string;
  color: ArenaColorToken;
}

// Codes per state.rs TapeEntry.action:
// 0 OPEN_LONG, 1 OPEN_SHORT, 2 EXIT_FAVORABLE, 3 EXIT_MAX_HOLD, 4 LIQUIDATED.
export const ARENA_ACTIONS: Readonly<Record<number, ArenaActionDisplay>> = {
  0: { label: "OPEN LONG", color: "GREEN" },
  1: { label: "OPEN SHORT", color: "RED" },
  2: { label: "EXIT FAVORABLE", color: "GREEN" },
  3: { label: "EXIT MAX HOLD", color: "DIM" },
  4: { label: "LIQUIDATED", color: "RED" },
};

export function arenaAction(code: number): ArenaActionDisplay {
  return ARENA_ACTIONS[code] ?? { label: `UNKNOWN(${code})`, color: "DIM" };
}

// ───────────────────────────── byte readers ───────────────────────────────

// All reads little-endian. The DataView is anchored at byteOffset +
// ACCOUNT_DISC so every offset below stays struct-relative — and honoring
// data.byteOffset matters: node Buffers from getAccountInfo usually live at
// a nonzero offset inside a shared pool.
const usd = (dv: DataView, off: number) =>
  Number(dv.getBigUint64(off, true)) / 1e6;
const usdSigned = (dv: DataView, off: number) =>
  Number(dv.getBigInt64(off, true)) / 1e6;
const price = (dv: DataView, off: number) =>
  Number(dv.getBigUint64(off, true)) / 1e8;
const secsToMs = (dv: DataView, off: number) =>
  Number(dv.getBigInt64(off, true)) * 1000;
const u64 = (dv: DataView, off: number) => Number(dv.getBigUint64(off, true));

function structView(data: Uint8Array, structSize: number): DataView | null {
  if (data.byteLength < ACCOUNT_DISC + structSize) return null; // fail-closed
  return new DataView(
    data.buffer,
    data.byteOffset + ACCOUNT_DISC,
    data.byteLength - ACCOUNT_DISC,
  );
}

function readPosition(dv: DataView, base: number): ArenaPosition {
  const o = OFF.position;
  return {
    active: dv.getUint8(base + o.active) === 1,
    marketId: dv.getUint8(base + o.marketId),
    side: dv.getUint8(base + o.side) === 1 ? "short" : "long",
    entryPrice: price(dv, base + o.entryPrice),
    stakeUsd: usd(dv, base + o.stakeMicro),
    leverage: dv.getUint16(base + o.leverage, true),
    openedTsMs: secsToMs(dv, base + o.openedTs),
    ticksHeld: dv.getUint32(base + o.ticksHeld, true),
    liqPrice: price(dv, base + o.liqPrice),
  };
}

function readTapeEntry(dv: DataView, base: number): ArenaTapeEntry {
  const o = OFF.tapeEntry;
  return {
    tsMs: secsToMs(dv, base + o.ts),
    price: price(dv, base + o.price),
    stakeUsd: usd(dv, base + o.stakeMicro),
    marketId: dv.getUint8(base + o.marketId),
    action: dv.getUint8(base + o.action),
    conviction: dv.getUint8(base + o.conviction),
  };
}

function readParams(dv: DataView, base: number): ArenaStrategyParams {
  const o = OFF.params;
  return {
    maxHoldTicks: dv.getUint32(base + o.maxHoldTicks, true),
    breakoutBps: dv.getUint16(base + o.breakoutBps, true),
    activityMultBps: dv.getUint16(base + o.activityMultBps, true),
    stakeFracBps: dv.getUint16(base + o.stakeFracBps, true),
    leverage: dv.getUint16(base + o.leverage, true),
    exitFavorableBps: dv.getUint16(base + o.exitFavorableBps, true),
    readSpan: dv.getUint8(base + o.readSpan),
    trendFilter: dv.getUint8(base + o.trendFilter) === 1,
  };
}

function readBucket(dv: DataView, base: number): ArenaBucket {
  const o = OFF.bucket;
  return {
    open: price(dv, base + o.open),
    high: price(dv, base + o.high),
    low: price(dv, base + o.low),
    close: price(dv, base + o.close),
    startTsMs: secsToMs(dv, base + o.startTs),
    pathLen: price(dv, base + o.pathLen),
    updates: dv.getUint32(base + o.updates, true),
  };
}

function readPersonaName(data: Uint8Array): string {
  const start = data.byteOffset + ACCOUNT_DISC + OFF.bot.personaId;
  const bytes = new Uint8Array(data.buffer, start, 16);
  let end = bytes.indexOf(0);
  if (end === -1) end = 16;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

// ─────────────────────────────── decoders ─────────────────────────────────

/** Decode a Bot account (raw account data incl. discriminator).
 *  Returns null if the buffer is too short — fail-closed, never partial. */
export function decodeBot(data: Uint8Array): ArenaBot | null {
  const dv = structView(data, BOT_STRUCT_SIZE);
  if (!dv) return null;
  const o = OFF.bot;

  const positions: ArenaPosition[] = [];
  for (let i = 0; i < MAX_POSITIONS; i++) {
    positions.push(readPosition(dv, o.positions + i * POSITION_SIZE));
  }
  const tape: ArenaTapeEntry[] = [];
  for (let i = 0; i < TAPE_LEN; i++) {
    tape.push(readTapeEntry(dv, o.tape + i * TAPE_ENTRY_SIZE));
  }

  return {
    balanceUsd: usd(dv, o.balanceMicro),
    grossPnlUsd: usdSigned(dv, o.grossPnlMicro),
    feesUsd: usd(dv, o.feesMicro),
    equityHighUsd: usd(dv, o.equityHighMicro),
    seq: u64(dv, o.seq),
    positions,
    tape,
    params: readParams(dv, o.params),
    personaName: readPersonaName(data),
    trades: dv.getUint32(o.trades, true),
    wins: dv.getUint32(o.wins, true),
    tapeHead: dv.getUint16(o.tapeHead, true),
    bump: dv.getUint8(o.bump),
  };
}

function readLlmPosition(dv: DataView, base: number): ArenaLlmPosition {
  const o = OFF.llmPosition;
  return {
    active: dv.getUint8(base + o.active) === 1,
    marketId: dv.getUint8(base + o.marketId),
    side: dv.getUint8(base + o.side) === 1 ? "short" : "long",
    entryPrice: price(dv, base + o.entryPrice),
    stakeUsd: usd(dv, base + o.stakeMicro),
    stopPrice: price(dv, base + o.stopPrice),
    tpPrice: price(dv, base + o.tpPrice),
    liqPrice: price(dv, base + o.liqPrice),
    leverage: dv.getUint16(base + o.leverage, true),
    openedTsMs: secsToMs(dv, base + o.openedTs),
    ticksHeld: dv.getUint32(base + o.ticksHeld, true),
  };
}

function readLlmParams(dv: DataView, base: number): ArenaLlmParams {
  const o = OFF.llmParams;
  return {
    maxHoldTicks: dv.getUint32(base + o.maxHoldTicks, true),
    decisionCooldownSecs: dv.getUint32(base + o.decisionCooldownSecs, true),
    maxLeverage: dv.getUint16(base + o.maxLeverage, true),
    minStopBps: dv.getUint16(base + o.minStopBps, true),
    maxStopBps: dv.getUint16(base + o.maxStopBps, true),
    maxStakeFracBps: dv.getUint16(base + o.maxStakeFracBps, true),
    maxTradesPerDay: dv.getUint16(base + o.maxTradesPerDay, true),
    dailyLossLimitBps: dv.getUint16(base + o.dailyLossLimitBps, true),
    fundingBpsPerHour: dv.getUint16(base + o.fundingBpsPerHour, true),
    confidenceFloor: dv.getUint8(base + o.confidenceFloor),
    riskSizing: dv.getUint8(base + o.riskSizing) === 1,
  };
}

/** Decode an LlmBot account (raw account data incl. discriminator).
 *  Returns null if the buffer is too short — fail-closed, never partial. */
export function decodeLlmBot(data: Uint8Array): ArenaLlmBot | null {
  const dv = structView(data, LLM_BOT_STRUCT_SIZE);
  if (!dv) return null;
  const o = OFF.llmBot;

  const positions: ArenaLlmPosition[] = [];
  for (let i = 0; i < MAX_POSITIONS; i++) {
    positions.push(readLlmPosition(dv, o.positions + i * LLM_POSITION_SIZE));
  }
  const tape: ArenaTapeEntry[] = [];
  for (let i = 0; i < TAPE_LEN; i++) {
    tape.push(readTapeEntry(dv, o.tape + i * TAPE_ENTRY_SIZE));
  }

  const start = data.byteOffset + ACCOUNT_DISC + o.personaId;
  const personaBytes = new Uint8Array(data.buffer, start, 16);
  let end = personaBytes.indexOf(0);
  if (end === -1) end = 16;

  return {
    balanceUsd: usd(dv, o.balanceMicro),
    grossPnlUsd: usdSigned(dv, o.grossPnlMicro),
    feesUsd: usd(dv, o.feesMicro),
    fundingPaidUsd: usd(dv, o.fundingPaidMicro),
    equityHighUsd: usd(dv, o.equityHighMicro),
    dayStartEquityUsd: usd(dv, o.dayStartEquityMicro),
    seq: u64(dv, o.seq),
    dayStartTsMs: secsToMs(dv, o.dayStartTs),
    lastDecisionTsMs: secsToMs(dv, o.lastDecisionTs),
    positions,
    tape,
    params: readLlmParams(dv, o.params),
    personaName: new TextDecoder().decode(personaBytes.subarray(0, end)),
    trades: dv.getUint32(o.trades, true),
    wins: dv.getUint32(o.wins, true),
    tradesToday: dv.getUint16(o.tradesToday, true),
    halted: dv.getUint8(o.halted) === 1,
    tapeHead: dv.getUint16(o.tapeHead, true),
    bump: dv.getUint8(o.bump),
  };
}

/** Decode a MarketState account (raw account data incl. discriminator).
 *  Returns null if the buffer is too short — fail-closed, never partial. */
export function decodeMarketState(data: Uint8Array): ArenaMarketState | null {
  const dv = structView(data, MARKET_STATE_STRUCT_SIZE);
  if (!dv) return null;
  const o = OFF.market;

  const ring: ArenaBucket[] = [];
  for (let i = 0; i < RING_LEN; i++) {
    ring.push(readBucket(dv, o.ring + i * BUCKET_SIZE));
  }
  const head = dv.getUint16(o.head, true);

  return {
    lastPrice: price(dv, o.lastPrice),
    lastPublishTsMs: secsToMs(dv, o.lastPublishTs),
    head,
    marketId: dv.getUint8(o.marketId),
    bump: dv.getUint8(o.bump),
    ring,
    headBucket: ring[head % RING_LEN],
  };
}

/** Ring closes in chronological order (oldest → newest), ending at the
 *  in-progress head bucket — `head` is the NEWEST bucket (the crank writes
 *  into ring[head] and only advances on rollover), so chronological order
 *  walks head+1 … wrap … head. Never-written slots (startTs == 0) and
 *  zeroed closes are skipped — fail-closed, the sparkline gets data or
 *  nothing. */
export function ringClosesChronological(
  market: Pick<ArenaMarketState, "ring" | "head">,
): number[] {
  const n = market.ring.length;
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    const bucket = market.ring[(market.head + i) % n];
    if (
      bucket.startTsMs !== 0 &&
      Number.isFinite(bucket.close) &&
      bucket.close > 0
    ) {
      out.push(bucket.close);
    }
  }
  return out;
}

/** Bot decision tape in newest-first order. tape_head points at the NEXT
 *  write slot (paper.rs: write at head, then advance), so the newest entry
 *  sits at (head - 1) mod 64; never-written slots (ts == 0) are skipped. */
export function tapeNewestFirst(
  bot: Pick<ArenaBot, "tape" | "tapeHead">,
): ArenaTapeEntry[] {
  const n = bot.tape.length;
  const out: ArenaTapeEntry[] = [];
  for (let i = 1; i <= n; i++) {
    const entry = bot.tape[(((bot.tapeHead - i) % n) + n) % n];
    if (entry.tsMs !== 0) out.push(entry);
  }
  return out;
}
