// lib/autopilot/engine.ts
//
// One tick of one autopilot session. Pure orchestration over injectable
// deps (tests stub them all; buildEngineDeps() wires the real Flash +
// Privy + DB calls). Errors are contained at the per-bet / per-market
// level — a tick can partially fail but never throws past tickSession,
// and the ticker additionally try/catches per session.
//
// Trigger facts (lib/flash/triggers.ts): TriggerKind is 'tp' | 'sl';
// roiPct clamps are TP 1..10000 and SL -95..-1 — every tier's values sit
// inside those bounds (asserted in tiers.test.ts).

import type { Candle, Timeframe } from "@/lib/data/candles";
import type { FlashMarketSymbol, FlashTradeMode } from "@/lib/flash/markets";
import {
  buildFlashTailMeta,
  type FlashTailMeta,
} from "@/lib/bets/flash-tail-meta";
import type { TriggerKind } from "@/lib/flash/triggers";
import {
  AUTOPILOT_CANDLE_COUNT,
  AUTOPILOT_TIMEFRAME,
  decide,
  shouldExit,
} from "./brain";
import {
  evaluateShell,
  sessionPhase,
  type RecentClose,
  type ShellSessionState,
} from "./shell";
import { getTier } from "./tiers";
import type {
  ActiveSessionWithIdentity,
  ClosedAutopilotResult,
  OpenAutopilotBet,
} from "./sessions";

export const AUTOPILOT_MARKETS = [
  "BTC",
  "ETH",
  "SOL",
] as const satisfies readonly FlashMarketSymbol[];
export type AutopilotMarket = (typeof AUTOPILOT_MARKETS)[number];

export interface BuiltOpen {
  transactionB64: string;
  entryPriceUsd: number | null;
  notionalUsd: number | null;
  openFeeUsd: number | null;
}

export interface BuiltClose {
  transactionB64: string;
  receiveUsd: number | null;
}

export interface EngineDeps {
  getCandles(
    asset: string,
    timeframe: Timeframe,
    count: number,
  ): Promise<Candle[]>;
  getMark(symbol: string): Promise<number | null>;
  /** Builds the open tx (does NOT send — ordering matters, see tickSession). */
  openTrade(args: {
    walletAddress: string;
    market: AutopilotMarket;
    side: "long" | "short";
    stakeUsdc: number;
    leverage: number;
    mode: FlashTradeMode;
  }): Promise<BuiltOpen>;
  /** Builds the close tx. */
  closeTrade(args: {
    walletAddress: string;
    market: string;
    side: "long" | "short";
  }): Promise<BuiltClose>;
  /** Builds a TP/SL trigger tx (roiPct pre-clamped by the tier). */
  placeTrigger(args: {
    walletAddress: string;
    market: string;
    side: "long" | "short";
    kind: TriggerKind;
    roiPct: number;
  }): Promise<{ transactionB64: string }>;
  /** Privy instant sign-and-send. */
  sendTransaction(args: {
    privyUserId: string;
    walletAddress: string;
    transactionB64: string;
  }): Promise<{ signature: string }>;
  /** CAS tick claim — false means another process ticked this session
   * inside the claim window; skip it entirely (double-tick guard). */
  claimTick(sessionId: string): Promise<boolean>;
  /** ALL live Flash positions on the wallet (any source — manual Scalp,
   * whale tails, autopilot). Cross-source stacking guard: Flash merges
   * positions per (owner, market, side), which would corrupt accounting. */
  getWalletPositions(
    walletAddress: string,
  ): Promise<Array<{ market: string; side: "long" | "short" }>>;
  listOpenBets(sessionId: string): Promise<OpenAutopilotBet[]>;
  recentCloses(
    sessionId: string,
    limit: number,
  ): Promise<ClosedAutopilotResult[]>;
  recordOpen(args: {
    userId: string;
    stakeUsdc: number;
    meta: FlashTailMeta;
  }): Promise<string>;
  confirmOpen(args: {
    betId: string;
    userId: string;
    signature: string;
  }): Promise<boolean>;
  confirmClose(args: {
    betId: string;
    userId: string;
    signature: string;
    receiveUsdEstimate: number | null;
  }): Promise<boolean>;
  /** Realized PnL recomputed from bets rows (sessionStats). */
  sessionRealizedPnl(sessionId: string): Promise<number>;
  endSession(args: {
    sessionId: string;
    status: "exhausted" | "target";
  }): Promise<void>;
  touchSession(sessionId: string): Promise<void>;
  now(): Date;
}

export interface TickResult {
  sessionId: string;
  exited: number;
  opened: number;
  ended: "exhausted" | "target" | null;
  /** Decision log lines for this tick (skipped entries and why). */
  skipped: string[];
}

export async function tickSession(
  session: ActiveSessionWithIdentity,
  deps: EngineDeps,
): Promise<TickResult> {
  const result: TickResult = {
    sessionId: session.id,
    exited: 0,
    opened: 0,
    ended: null,
    skipped: [],
  };
  if (!session.privyUserId || !session.walletAddress) {
    result.skipped.push("user has no wallet identity");
    return result;
  }
  const privyUserId = session.privyUserId;
  const walletAddress = session.walletAddress;
  const tier = getTier(session.tier);
  const now = deps.now();

  // (0) Double-tick guard: claim the session or stand down.
  try {
    const claimed = await deps.claimTick(session.id);
    if (!claimed) {
      result.skipped.push("tick already claimed by another process");
      return result;
    }
  } catch (err) {
    console.error(`[autopilot] claimTick failed session=${session.id}:`, err);
    return result;
  }

  // (1) Open autopilot bets for this session.
  let openBets: OpenAutopilotBet[] = [];
  try {
    openBets = await deps.listOpenBets(session.id);
  } catch (err) {
    console.error(`[autopilot] listOpenBets failed session=${session.id}:`, err);
    await safeTouch(deps, session.id);
    return result;
  }

  // (2) Exit pass. On-chain triggers own the hard TP/SL; this pass banks
  // the Blitz-style 1% favorable move and enforces the tier's max hold.
  for (const bet of openBets) {
    try {
      const mark = await deps.getMark(bet.market);
      const ageMin = (now.getTime() - bet.createdAt.getTime()) / 60_000;
      const exit = shouldExit({
        entryPrice: bet.entryPriceUsd,
        side: bet.side,
        markPrice: mark,
        ageMin,
        maxHoldMin: tier.maxHoldMin,
      });
      if (!exit) continue;
      const built = await deps.closeTrade({
        walletAddress,
        market: bet.market,
        side: bet.side,
      });
      const sent = await deps.sendTransaction({
        privyUserId,
        walletAddress,
        transactionB64: built.transactionB64,
      });
      const closeOk = await deps.confirmClose({
        betId: bet.betId,
        userId: session.userId,
        signature: sent.signature,
        receiveUsdEstimate: built.receiveUsd,
      });
      if (!closeOk) {
        console.warn(
          `[autopilot] confirmClose CAS miss bet=${bet.betId} (already closed/externalized)`,
        );
      }
      openBets = openBets.filter((b) => b.betId !== bet.betId);
      result.exited += 1;
    } catch (err) {
      console.error(
        `[autopilot] exit failed session=${session.id} bet=${bet.betId}:`,
        err,
      );
    }
  }

  // (3) Budget phase from realized PnL (recomputed from bets rows).
  let realizedPnlUsd = session.realizedPnlUsd;
  try {
    realizedPnlUsd = await deps.sessionRealizedPnl(session.id);
  } catch (err) {
    console.error(
      `[autopilot] realized PnL recompute failed session=${session.id} — using cached value:`,
      err,
    );
  }
  const shellSession: ShellSessionState = {
    budgetUsd: session.budgetUsd,
    realizedPnlUsd,
    tier: session.tier,
  };
  const phase = sessionPhase(shellSession);
  if (phase !== "active") {
    try {
      await deps.endSession({ sessionId: session.id, status: phase });
      result.ended = phase;
    } catch (err) {
      console.error(`[autopilot] endSession failed session=${session.id}:`, err);
    }
    await safeTouch(deps, session.id);
    return result;
  }

  // (4) Entry pass: at most ONE new position per tick.
  if (openBets.length < tier.maxConcurrent) {
    let recentCloses: RecentClose[] = [];
    try {
      recentCloses = await deps.recentCloses(session.id, 5);
    } catch (err) {
      console.error(
        `[autopilot] recentCloses failed session=${session.id} — skipping entries this tick:`,
        err,
      );
      await safeTouch(deps, session.id);
      return result;
    }
    // Cross-source guard: fail CLOSED — if we cannot see the wallet's
    // live positions we must not open anything (Flash would silently
    // merge a stacked position and corrupt both rows' accounting).
    let walletHeldMarkets: Set<string>;
    try {
      const live = await deps.getWalletPositions(walletAddress);
      walletHeldMarkets = new Set(live.map((pos) => pos.market));
    } catch (err) {
      console.error(
        `[autopilot] getWalletPositions failed session=${session.id} — skipping entries this tick:`,
        err,
      );
      await safeTouch(deps, session.id);
      return result;
    }
    const heldMarkets = new Set(openBets.map((b) => b.market));
    for (const market of AUTOPILOT_MARKETS) {
      if (heldMarkets.has(market)) continue; // never hedge/stack a market
      if (walletHeldMarkets.has(market)) {
        result.skipped.push(
          `${market}: wallet already holds a position (manual/tail)`,
        );
        continue;
      }
      try {
        const [candles, mark] = await Promise.all([
          deps.getCandles(market, AUTOPILOT_TIMEFRAME, AUTOPILOT_CANDLE_COUNT),
          deps.getMark(market),
        ]);
        if (mark == null) continue;
        const decision = decide({ candles, markPrice: mark });
        if (!decision) continue;
        const verdict = evaluateShell({
          session: shellSession,
          openCount: openBets.length,
          // Reserve open stakes against the budget (review fix: concurrent
          // opens must never overshoot the loss bound).
          openStakesUsd: openBets.reduce((sum, b) => sum + b.stakeUsdc, 0),
          recentCloses,
          decision,
          now,
        });
        if (!verdict.allow) {
          // Shell denials are session-wide (budget/tilt/concurrency) —
          // no point asking about the remaining markets.
          result.skipped.push(`${market} ${decision.side}: ${verdict.reason}`);
          break;
        }

        const built = await deps.openTrade({
          walletAddress,
          market,
          side: decision.side,
          stakeUsdc: verdict.stakeUsdc,
          leverage: verdict.leverage,
          mode: verdict.mode,
        });
        const meta = buildFlashTailMeta({
          lineage: {
            sourceKind: "autopilot",
            whaleId: null,
            botId: null,
            sourceName: "Autopilot",
            sourcePositionId: null,
          },
          market,
          side: decision.side,
          leverage: verdict.leverage,
          mode: verdict.mode,
          walletAddress,
          entryPriceUsd: built.entryPriceUsd,
          notionalUsd: built.notionalUsd,
          openFeeUsd: built.openFeeUsd,
          autopilotSessionId: session.id,
        });
        // Record BEFORE send (mirrors /api/flash/perp): a crash between
        // the two leaves a pending row the portfolio reaper abandons;
        // the reverse order risks a landed trade with no receipt.
        const betId = await deps.recordOpen({
          userId: session.userId,
          stakeUsdc: verdict.stakeUsdc,
          meta,
        });
        const sent = await deps.sendTransaction({
          privyUserId,
          walletAddress,
          transactionB64: built.transactionB64,
        });
        try {
          const openOk = await deps.confirmOpen({
            betId,
            userId: session.userId,
            signature: sent.signature,
          });
          if (!openOk) {
            console.warn(
              `[autopilot] confirmOpen CAS miss bet=${betId} (already confirmed/reaped)`,
            );
          }
        } catch (err) {
          // Never let bookkeeping turn a landed trade into a tick failure;
          // the reconcile sweep picks the row up later.
          console.error(
            `[autopilot] confirmOpen failed post-send bet=${betId}:`,
            err,
          );
        }
        result.opened += 1;
        console.log(
          `[autopilot] OPEN session=${session.id} ${market} ${decision.side} ` +
            `$${verdict.stakeUsdc} @ ${verdict.leverage}x (${decision.reason})`,
        );

        // Mandatory SL. If it cannot be attached the position must not
        // live — close it immediately rather than run naked at leverage.
        try {
          const sl = await deps.placeTrigger({
            walletAddress,
            market,
            side: decision.side,
            kind: "sl",
            roiPct: verdict.slRoiPct,
          });
          await deps.sendTransaction({
            privyUserId,
            walletAddress,
            transactionB64: sl.transactionB64,
          });
        } catch (slErr) {
          console.error(
            `[autopilot] SL placement failed session=${session.id} — emergency close:`,
            slErr,
          );
          try {
            const closeBuilt = await deps.closeTrade({
              walletAddress,
              market,
              side: decision.side,
            });
            const closeSent = await deps.sendTransaction({
              privyUserId,
              walletAddress,
              transactionB64: closeBuilt.transactionB64,
            });
            await deps.confirmClose({
              betId,
              userId: session.userId,
              signature: closeSent.signature,
              receiveUsdEstimate: closeBuilt.receiveUsd,
            });
          } catch (closeErr) {
            console.error(
              "[autopilot] emergency close after SL failure also failed (reconcile sweep will catch the position):",
              closeErr,
            );
          }
          break;
        }
        // TP is best-effort: the exit pass banks wins even without it.
        try {
          const tp = await deps.placeTrigger({
            walletAddress,
            market,
            side: decision.side,
            kind: "tp",
            roiPct: verdict.tpRoiPct,
          });
          await deps.sendTransaction({
            privyUserId,
            walletAddress,
            transactionB64: tp.transactionB64,
          });
        } catch (tpErr) {
          console.error(
            "[autopilot] TP placement failed (exit pass still banks wins):",
            tpErr,
          );
        }
        break; // one entry per tick
      } catch (err) {
        console.error(
          `[autopilot] entry attempt failed session=${session.id} market=${market}:`,
          err,
        );
      }
    }
  }

  // (5) Heartbeat.
  await safeTouch(deps, session.id);
  return result;
}

async function safeTouch(deps: EngineDeps, sessionId: string): Promise<void> {
  try {
    await deps.touchSession(sessionId);
  } catch (err) {
    console.error(`[autopilot] touchSession failed session=${sessionId}:`, err);
  }
}

/**
 * Real deps. Server-only — drags in flash-sdk and the Privy wallet API.
 * The ticker imports this lazily so `next build` page bundles stay clean.
 */
export function buildEngineDeps(): EngineDeps {
  return {
    getCandles: async (asset, timeframe, count) => {
      const { getCandles } = await import("@/lib/data/candles");
      return getCandles(asset, timeframe, count);
    },
    getMark: async (symbol) => {
      const { getMark } = await import("@/lib/data/marks");
      return getMark(symbol);
    },
    openTrade: async ({ walletAddress, market, side, stakeUsdc, leverage, mode }) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const result = await getFlashPerpsService().open({
        trader: walletAddress,
        market,
        side,
        amountUsd: stakeUsdc,
        leverage,
        mode,
      });
      return {
        transactionB64: result.transaction,
        entryPriceUsd:
          result.quote.entryPriceUsd ?? result.position.entryPriceUsd ?? null,
        notionalUsd:
          result.quote.notionalUsd ?? result.position.sizeUsd ?? null,
        openFeeUsd: result.quote.feesUsd ?? null,
      };
    },
    closeTrade: async ({ walletAddress, market, side }) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const result = await getFlashPerpsService().close({
        trader: walletAddress,
        market: market as FlashMarketSymbol,
        side,
      });
      return {
        transactionB64: result.transaction,
        receiveUsd: result.quote.receiveUsd ?? null,
      };
    },
    placeTrigger: async ({ walletAddress, market, side, kind, roiPct }) => {
      const [{ getFlashPerpsService }, { validateTriggerRoi }] =
        await Promise.all([
          import("@/lib/flash/perps"),
          import("@/lib/flash/triggers"),
        ]);
      const validated = validateTriggerRoi(kind, roiPct);
      if (!validated.ok) throw new Error(validated.message);
      const result = await getFlashPerpsService().buildPlaceTriggerOrderTx({
        trader: walletAddress,
        market: market as FlashMarketSymbol,
        side,
        kind,
        roiPct: validated.roiPct,
      });
      return { transactionB64: result.transaction };
    },
    sendTransaction: async ({ privyUserId, walletAddress, transactionB64 }) => {
      const { signAndSendPrivySolanaTransaction } = await import(
        "@/lib/privy/instant-solana"
      );
      return signAndSendPrivySolanaTransaction({
        privyUserId,
        walletAddress,
        transactionB64,
      });
    },
    claimTick: async (sessionId) => {
      const { claimSessionTick } = await import("./sessions");
      return claimSessionTick(sessionId);
    },
    getWalletPositions: async (walletAddress) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const positions = await getFlashPerpsService().positionsOf(walletAddress);
      return positions.map((p) => ({ market: p.symbol, side: p.side }));
    },
    listOpenBets: async (sessionId) => {
      const { listOpenAutopilotBets } = await import("./sessions");
      return listOpenAutopilotBets(sessionId);
    },
    recentCloses: async (sessionId, limit) => {
      const { recentClosedAutopilotResults } = await import("./sessions");
      return recentClosedAutopilotResults(sessionId, limit);
    },
    recordOpen: async (args) => {
      const { recordFlashTailOpen } = await import("@/lib/bets/flash-tail");
      return recordFlashTailOpen(args);
    },
    confirmOpen: async (args) => {
      const { confirmFlashTailOpen } = await import("@/lib/bets/flash-tail");
      return confirmFlashTailOpen(args);
    },
    confirmClose: async (args) => {
      const { confirmFlashTailClose } = await import("@/lib/bets/flash-tail");
      return confirmFlashTailClose(args);
    },
    sessionRealizedPnl: async (sessionId) => {
      const { sessionStats } = await import("./sessions");
      return (await sessionStats(sessionId)).realizedPnlUsd;
    },
    endSession: async (args) => {
      const { endSession } = await import("./sessions");
      return endSession(args);
    },
    touchSession: async (sessionId) => {
      const { touchSession } = await import("./sessions");
      return touchSession(sessionId);
    },
    now: () => new Date(),
  };
}
