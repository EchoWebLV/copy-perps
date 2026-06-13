// lib/copy/engine.ts
//
// One tick of the Flash copy engine: mirror new target positions into
// followers' wallets (open pass) and close follower positions whose copied
// source exited (close pass). Pure orchestration over injectable deps —
// tests stub everything; buildCopyEngineDeps() wires Flash + Privy + DB.
//
// Money-safety invariants:
//  - A failed target fetch means "unknown", never "flat" — the close pass
//    skips that target entirely for the tick.
//  - record-before-send (autopilot rationale): a crash between the two
//    leaves a pending row the portfolio reaper abandons; the reverse order
//    risks a landed trade with no receipt.
//  - One attempt per (subscription, source position), ever: in-memory
//    `attempted` within a process, bets-row dedup across restarts. Missed
//    entries stay missed — re-chasing a moved price is the entry-gap trap.

import {
  FLASH_MIN_NOTIONAL_USD,
} from "@/lib/flash/perps";
import { buildEvent, type NotificationEventPayload } from "@/lib/notifications/emit";
import {
  flashLeverageBoundsForMarket,
  flashTradeModeForLeverage,
  type FlashTradeMode,
} from "@/lib/flash/markets";
import {
  buildFlashTailMeta,
  type FlashTailMeta,
  type TailLineage,
} from "@/lib/bets/flash-tail-meta";
import type { BuiltClose, BuiltOpen } from "@/lib/autopilot/engine";
import type { AutoCloseBetRow, CopySubscriptionRow } from "./store";
import { parseWhaleTargetKey } from "./sources";
import {
  copyTargetId,
  type CopyTargetRef,
  type SourcePosition,
} from "./types";

/** Positions older than this are never copied — covers restart catch-up
 *  windows and clock skew without chasing stale entries. */
export const MAX_COPY_AGE_MS = 90_000;

export interface CopyEngineDeps {
  listActiveSubscriptions(): Promise<CopySubscriptionRow[]>;
  listOpenAutoCloseBets(): Promise<AutoCloseBetRow[]>;
  fetchSourcePositions(ref: CopyTargetRef): Promise<SourcePosition[]>;
  getMark(symbol: string): Promise<number | null>;
  /** Builds the open tx (does NOT send). */
  openTrade(args: {
    walletAddress: string;
    market: string;
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
  sendTransaction(args: {
    privyUserId: string;
    walletAddress: string;
    transactionB64: string;
  }): Promise<{ signature: string }>;
  /** ALL live Flash positions on the wallet — stacking guard (Flash merges
   *  per owner+market+side, which would corrupt both rows' accounting). */
  getWalletPositions(
    walletAddress: string,
  ): Promise<Array<{ market: string; side: "long" | "short" }>>;
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
    closeReason: "source-closed";
  }): Promise<boolean>;
  hasCopiedSourcePosition(
    subscriptionId: string,
    sourcePositionId: string,
  ): Promise<boolean>;
  countOpenCopies(subscriptionId: string): Promise<number>;
  spentLast24hUsd(subscriptionId: string): Promise<number>;
  touchLastCopy(subscriptionId: string): Promise<void>;
  /** Full pipeline, log-only: no opens, no closes, no DB writes. */
  dryRun: boolean;
  now(): Date;
  /**
   * Optional notification emitter. Called AFTER a money operation succeeds.
   * Must never throw into the tick — callers also wrap in try/catch.
   */
  emit?: (event: NotificationEventPayload) => void;
}

export interface CopyEngineState {
  /** targetId → position keys seen on the previous successful fetch. */
  prevKeys: Map<string, Set<string>>;
  /** Targets with at least one successful fetch (diff baseline exists). */
  primed: Set<string>;
  /** `${subscriptionId}:${sourceKey}` pairs this process already acted on. */
  attempted: Set<string>;
}

export function createCopyEngineState(): CopyEngineState {
  return { prevKeys: new Map(), primed: new Set(), attempted: new Set() };
}

export interface CopyTickResult {
  targets: number;
  opened: number;
  closed: number;
  /** Dry-run: actions the engine would have taken. */
  planned: string[];
  skipped: string[];
  errors: string[];
}

function deriveTargetFromMeta(meta: FlashTailMeta): CopyTargetRef | null {
  if (meta.sourceKind === "bot" && meta.botId?.startsWith("arena:")) {
    return { kind: "arena-bot", key: meta.botId.slice("arena:".length) };
  }
  if (meta.sourceKind === "whale" && meta.whaleId) {
    if (meta.whaleId.startsWith("flash:")) {
      return { kind: "flash-wallet", key: meta.whaleId.slice("flash:".length) };
    }
    // Roster whales: whaleId IS makeWhaleId(`${source}:${sourceAccount}`),
    // which is exactly the whale targetKey format.
    if (parseWhaleTargetKey(meta.whaleId)) {
      return { kind: "whale", key: meta.whaleId };
    }
  }
  return null;
}

function subscriptionTarget(sub: CopySubscriptionRow): CopyTargetRef {
  return { kind: sub.targetKind, key: sub.targetKey };
}

function subscriptionLineage(
  sub: CopySubscriptionRow,
  position: SourcePosition,
): TailLineage {
  if (sub.targetKind === "arena-bot") {
    return {
      sourceKind: "bot",
      botId: `arena:${sub.targetKey}`,
      whaleId: null,
      sourceName: sub.targetLabel ?? sub.targetKey,
      sourcePositionId: position.key,
    };
  }
  if (sub.targetKind === "whale") {
    // targetKey is already the canonical whaleId (`source:account`).
    return {
      sourceKind: "whale",
      whaleId: sub.targetKey,
      botId: null,
      sourceName: sub.targetLabel ?? sub.targetKey,
      sourcePositionId: position.key,
    };
  }
  return {
    sourceKind: "whale",
    whaleId: `flash:${sub.targetKey}`,
    botId: null,
    sourceName: sub.targetLabel ?? `${sub.targetKey.slice(0, 4)}…${sub.targetKey.slice(-4)}`,
    sourcePositionId: position.key,
  };
}

/** Mirror → source leverage, fixed → subscription leverage; clamped into
 *  the venue's standard/degen bounds for the market. Null = uncopyable. */
export function resolveCopyLeverage(args: {
  sub: Pick<CopySubscriptionRow, "leverageMode" | "fixedLeverage">;
  position: Pick<SourcePosition, "market" | "leverage">;
}): { leverage: number; mode: FlashTradeMode } | null {
  const requested =
    args.sub.leverageMode === "fixed"
      ? args.sub.fixedLeverage
      : args.position.leverage;
  if (requested === null || !Number.isFinite(requested) || requested <= 0) {
    return null;
  }
  const exact = flashTradeModeForLeverage(args.position.market, requested);
  if (exact) return { leverage: requested, mode: exact };
  const standard = flashLeverageBoundsForMarket(args.position.market, "standard");
  const degen = flashLeverageBoundsForMarket(args.position.market, "degen");
  if (!standard) return null;
  if (requested < standard.min) {
    return { leverage: standard.min, mode: "standard" };
  }
  if (degen && requested > degen.max) {
    return { leverage: degen.max, mode: "degen" };
  }
  // Between standard max and degen min: snap down to the standard ceiling.
  return { leverage: standard.max, mode: "standard" };
}

export async function tickCopyEngine(
  state: CopyEngineState,
  deps: CopyEngineDeps,
): Promise<CopyTickResult> {
  const result: CopyTickResult = {
    targets: 0,
    opened: 0,
    closed: 0,
    planned: [],
    skipped: [],
    errors: [],
  };

  let subs: CopySubscriptionRow[] = [];
  let autoCloseBets: AutoCloseBetRow[] = [];
  try {
    [subs, autoCloseBets] = await Promise.all([
      deps.listActiveSubscriptions(),
      deps.listOpenAutoCloseBets(),
    ]);
  } catch (err) {
    result.errors.push(`watch-set load failed: ${String(err)}`);
    return result;
  }

  // ── Resolve the union of watched targets, fetch each exactly once. ──────
  const targets = new Map<string, CopyTargetRef>();
  for (const sub of subs) {
    const ref = subscriptionTarget(sub);
    targets.set(copyTargetId(ref), ref);
  }
  for (const bet of autoCloseBets) {
    const ref = deriveTargetFromMeta(bet.meta);
    if (ref) targets.set(copyTargetId(ref), ref);
  }
  if (targets.size === 0) return result;

  const positionsByTarget = new Map<string, SourcePosition[]>();
  for (const [id, ref] of targets) {
    result.targets += 1;
    try {
      positionsByTarget.set(id, await deps.fetchSourcePositions(ref));
    } catch (err) {
      result.errors.push(`fetch ${id} failed: ${String(err)}`);
    }
  }

  // ── Close pass: copied source gone ⇒ close the follower position. ───────
  for (const bet of autoCloseBets) {
    const ref = deriveTargetFromMeta(bet.meta);
    if (!ref) {
      result.skipped.push(`bet ${bet.betId}: unsupported auto-close source`);
      continue;
    }
    const positions = positionsByTarget.get(copyTargetId(ref));
    if (!positions) continue; // fetch failed — unknown ≠ flat
    const sourceKey = bet.meta.sourcePositionId;
    if (!sourceKey) {
      result.skipped.push(`bet ${bet.betId}: no sourcePositionId`);
      continue;
    }
    if (positions.some((p) => p.key === sourceKey)) continue; // still open

    if (deps.dryRun) {
      result.planned.push(
        `close bet=${bet.betId} ${bet.meta.market} ${bet.meta.side} (source ${sourceKey} gone)`,
      );
      continue;
    }
    try {
      const built = await deps.closeTrade({
        walletAddress: bet.meta.walletAddress,
        market: bet.meta.market,
        side: bet.meta.side,
      });
      const sent = await deps.sendTransaction({
        privyUserId: bet.privyUserId,
        walletAddress: bet.meta.walletAddress,
        transactionB64: built.transactionB64,
      });
      const ok = await deps.confirmClose({
        betId: bet.betId,
        userId: bet.userId,
        signature: sent.signature,
        receiveUsdEstimate: built.receiveUsd,
        closeReason: "source-closed",
      });
      if (!ok) {
        result.skipped.push(
          `bet ${bet.betId}: close CAS miss (already closed elsewhere)`,
        );
      }
      // Emit AFTER confirmClose. pnlUsd is not available here (receiveUsd
      // is the gross receive estimate, not net P/L). We emit auto-close
      // without pnl; the reconcile sweep derives chain pnl later.
      try {
        deps.emit?.(
          buildEvent("auto-close", {
            userId: bet.userId,
            source: bet.meta.sourceName ?? sourceKey,
            market: bet.meta.market,
            // pnlUsd intentionally omitted — not available at this seam
          }),
        );
      } catch {}
      result.closed += 1;
      console.log(
        `[copy] CLOSE bet=${bet.betId} ${bet.meta.market} ${bet.meta.side} — source ${sourceKey} exited`,
      );
    } catch (err) {
      // PositionNotOpen ⇒ manual close/liquidation raced us; the flash
      // reconcile sweep stamps those rows. Everything else retries next
      // tick (the source stays gone).
      result.errors.push(`close bet=${bet.betId} failed: ${String(err)}`);
    }
  }

  // ── Open pass: new source positions ⇒ mirror per subscription. ──────────
  const subsByTarget = new Map<string, CopySubscriptionRow[]>();
  for (const sub of subs) {
    const id = copyTargetId(subscriptionTarget(sub));
    const list = subsByTarget.get(id) ?? [];
    list.push(sub);
    subsByTarget.set(id, list);
  }

  const nowMs = deps.now().getTime();
  const walletPositionsCache = new Map<
    string,
    Array<{ market: string; side: "long" | "short" }>
  >();

  for (const [id, subsForTarget] of subsByTarget) {
    const positions = positionsByTarget.get(id);
    if (!positions) continue; // fetch failed
    const prev = state.prevKeys.get(id);
    const isPrimed = state.primed.has(id);

    const fresh = positions.filter((p) => {
      const ageOk =
        p.openedTsMs === null || nowMs - p.openedTsMs <= MAX_COPY_AGE_MS;
      if (isPrimed) return prev !== undefined && !prev.has(p.key) && ageOk;
      // First sight of this target: only bot positions young enough to be
      // an entry we just witnessed; flash wallets have no timestamp, so
      // their pre-existing book is baseline, never copied.
      return p.openedTsMs !== null && ageOk;
    });

    for (const position of fresh) {
      for (const sub of subsForTarget) {
        const attemptKey = `${sub.id}:${position.key}`;
        if (state.attempted.has(attemptKey)) continue;
        state.attempted.add(attemptKey);

        try {
          if (await deps.hasCopiedSourcePosition(sub.id, position.key)) {
            continue;
          }

          const resolved = resolveCopyLeverage({ sub, position });
          if (!resolved) {
            result.skipped.push(`${position.key}: no usable leverage`);
            continue;
          }
          if (sub.stakeUsdc * resolved.leverage < FLASH_MIN_NOTIONAL_USD) {
            result.skipped.push(
              `${position.key}: $${sub.stakeUsdc} × ${resolved.leverage}x under $${FLASH_MIN_NOTIONAL_USD} notional`,
            );
            continue;
          }

          let walletHeld = walletPositionsCache.get(sub.walletAddress);
          if (!walletHeld) {
            walletHeld = await deps.getWalletPositions(sub.walletAddress);
            walletPositionsCache.set(sub.walletAddress, walletHeld);
          }
          if (walletHeld.some((p) => p.market === position.market)) {
            result.skipped.push(
              `${position.key}: wallet already holds ${position.market}`,
            );
            continue;
          }

          if ((await deps.countOpenCopies(sub.id)) >= sub.maxConcurrent) {
            result.skipped.push(`${position.key}: max concurrent reached`);
            continue;
          }
          const spent = await deps.spentLast24hUsd(sub.id);
          if (spent + sub.stakeUsdc > sub.dailyCapUsd) {
            result.skipped.push(
              `${position.key}: daily cap ($${spent.toFixed(2)}/$${sub.dailyCapUsd})`,
            );
            continue;
          }

          // Entry-gap guard: prefer our oracle mark; fall back to the
          // source venue's own mark for markets our marks don't price
          // (XAU/FX/equities whales). No price at all = skip, fail-safe.
          const mark =
            (await deps.getMark(position.market)) ?? position.sourceMarkUsd;
          if (mark === null) {
            result.skipped.push(`${position.key}: no mark price`);
            continue;
          }
          if (position.entryPriceUsd !== null && position.entryPriceUsd > 0) {
            const gapBps =
              (Math.abs(mark - position.entryPriceUsd) /
                position.entryPriceUsd) *
              10_000;
            if (gapBps > sub.maxEntryGapBps) {
              result.skipped.push(
                `${position.key}: entry gap ${gapBps.toFixed(0)}bps > ${sub.maxEntryGapBps}`,
              );
              continue;
            }
          }

          if (deps.dryRun) {
            result.planned.push(
              `open sub=${sub.id} ${position.market} ${position.side} ` +
                `$${sub.stakeUsdc} @ ${resolved.leverage}x ${resolved.mode} (${position.key})`,
            );
            continue;
          }

          const built = await deps.openTrade({
            walletAddress: sub.walletAddress,
            market: position.market,
            side: position.side,
            stakeUsdc: sub.stakeUsdc,
            leverage: resolved.leverage,
            mode: resolved.mode,
          });
          const meta = buildFlashTailMeta({
            lineage: subscriptionLineage(sub, position),
            market: position.market,
            side: position.side,
            leverage: resolved.leverage,
            mode: resolved.mode,
            walletAddress: sub.walletAddress,
            entryPriceUsd: built.entryPriceUsd,
            notionalUsd: built.notionalUsd,
            openFeeUsd: built.openFeeUsd,
            copySubscriptionId: sub.id,
            autoCloseOnSourceClose: sub.autoClose,
          });
          const betId = await deps.recordOpen({
            userId: sub.userId,
            stakeUsdc: sub.stakeUsdc,
            meta,
          });
          const sent = await deps.sendTransaction({
            privyUserId: sub.privyUserId,
            walletAddress: sub.walletAddress,
            transactionB64: built.transactionB64,
          });
          try {
            const ok = await deps.confirmOpen({
              betId,
              userId: sub.userId,
              signature: sent.signature,
            });
            if (!ok) {
              console.warn(`[copy] confirmOpen CAS miss bet=${betId}`);
            }
            // Emit AFTER the money operation succeeds. Non-fatal.
            try {
              deps.emit?.(
                buildEvent("copy-opened", {
                  userId: sub.userId,
                  source: sub.targetLabel ?? sub.targetKey,
                  market: position.market,
                  side: position.side,
                  leverage: resolved.leverage,
                  stakeUsd: sub.stakeUsdc,
                }),
              );
            } catch {}
          } catch (err) {
            // Never let bookkeeping turn a landed trade into a tick error;
            // the row stays pending for the reconcile sweep.
            console.error(`[copy] confirmOpen failed post-send bet=${betId}:`, err);
          }
          await deps.touchLastCopy(sub.id).catch(() => undefined);
          result.opened += 1;
          console.log(
            `[copy] OPEN sub=${sub.id} ${position.market} ${position.side} ` +
              `$${sub.stakeUsdc} @ ${resolved.leverage}x copying ${position.key}`,
          );
        } catch (err) {
          result.errors.push(
            `open ${position.key} for sub=${sub.id} failed: ${String(err)}`,
          );
        }
      }
    }
  }

  // ── Advance diff baselines for every successfully fetched target. ───────
  for (const [id, positions] of positionsByTarget) {
    state.prevKeys.set(id, new Set(positions.map((p) => p.key)));
    state.primed.add(id);
  }

  return result;
}

/**
 * Real deps. Server-only — drags in flash-sdk, web3.js and the Privy wallet
 * API; the ticker imports this lazily so page bundles stay clean.
 */
export function buildCopyEngineDeps(): CopyEngineDeps {
  return {
    listActiveSubscriptions: async () => {
      const { listActiveCopySubscriptions } = await import("./store");
      return listActiveCopySubscriptions();
    },
    listOpenAutoCloseBets: async () => {
      const { listOpenAutoCloseBets } = await import("./store");
      return listOpenAutoCloseBets();
    },
    fetchSourcePositions: async (ref) => {
      const { fetchSourcePositions } = await import("./sources");
      return fetchSourcePositions(ref);
    },
    getMark: async (symbol) => {
      const { getMark } = await import("@/lib/data/marks");
      const ours = await getMark(symbol);
      if (ours !== null) return ours;
      // Exotic markets (XAU/FX/equities whales): the hosted V2 API prices
      // every Flash symbol. Engine still falls to sourceMarkUsd after this.
      const { fetchFlashV2PriceUsd } = await import("@/lib/flash/v2-prices");
      return fetchFlashV2PriceUsd(symbol);
    },
    openTrade: async ({ walletAddress, market, side, stakeUsdc, leverage, mode }) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const { normalizeFlashMarket } = await import("@/lib/flash/markets");
      const normalized = normalizeFlashMarket(market);
      if (!normalized) throw new Error(`unsupported market: ${market}`);
      const result = await getFlashPerpsService().open({
        trader: walletAddress,
        market: normalized,
        side,
        amountUsd: stakeUsdc,
        leverage,
        mode,
      });
      return {
        transactionB64: result.transaction,
        entryPriceUsd:
          result.quote.entryPriceUsd ?? result.position.entryPriceUsd ?? null,
        notionalUsd: result.quote.notionalUsd ?? result.position.sizeUsd ?? null,
        openFeeUsd: result.quote.feesUsd ?? null,
      };
    },
    closeTrade: async ({ walletAddress, market, side }) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const { normalizeFlashMarket } = await import("@/lib/flash/markets");
      const normalized = normalizeFlashMarket(market);
      if (!normalized) throw new Error(`unsupported market: ${market}`);
      const result = await getFlashPerpsService().close({
        trader: walletAddress,
        market: normalized,
        side,
      });
      return {
        transactionB64: result.transaction,
        receiveUsd: result.quote.receiveUsd ?? null,
      };
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
    getWalletPositions: async (walletAddress) => {
      const { getFlashPerpsService } = await import("@/lib/flash/perps");
      const positions = await getFlashPerpsService().positionsOf(walletAddress);
      return positions.map((p) => ({ market: p.symbol, side: p.side }));
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
    hasCopiedSourcePosition: async (subscriptionId, sourcePositionId) => {
      const { hasCopiedSourcePosition } = await import("./store");
      return hasCopiedSourcePosition(subscriptionId, sourcePositionId);
    },
    countOpenCopies: async (subscriptionId) => {
      const { countOpenCopies } = await import("./store");
      return countOpenCopies(subscriptionId);
    },
    spentLast24hUsd: async (subscriptionId) => {
      const { spentLast24hUsd } = await import("./store");
      return spentLast24hUsd(subscriptionId);
    },
    touchLastCopy: async (subscriptionId) => {
      const { touchLastCopy } = await import("./store");
      return touchLastCopy(subscriptionId);
    },
    dryRun: process.env.COPY_DRY_RUN === "true",
    now: () => new Date(),
    emit: (event) => {
      // emitNotification is self-safe (swallows its own errors).
      import("@/lib/notifications/emit").then(({ emitNotification }) => {
        emitNotification(event);
      }).catch(() => undefined);
    },
  };
}
