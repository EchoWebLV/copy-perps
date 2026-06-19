import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users, agentWallets, paperPositions } from "@/lib/db/schema";
import { Keypair } from "@solana/web3.js";
import { getClearinghouseState } from "@/lib/hyperliquid/client";
import { getPositions } from "@/lib/pacifica/client";
import { closeCopyOrder } from "@/lib/pacifica/orders";
import { realizedPnlForOrder } from "@/lib/bets/copy-pnl";
import { shouldAutoCloseWhaleCopy } from "@/lib/bets/source-close";
import { parseWhaleCopyMeta } from "@/lib/bets/whale-meta";
import { copyMetaVenue } from "@/lib/bets/copy-meta";
import { getBotPositionSignal, personaFromBotId } from "@/lib/arena/bot-position";
import { getActiveSessionKey } from "@/lib/flash-v2/session-store";
import { executeSessionClose } from "@/lib/flash-v2/session-trade";
import { flashV2Venue } from "@/lib/flash-v2/venue";
import { patchMonitorStatus } from "@/lib/ops/monitor-store";
import { makeWhalePositionId } from "@/lib/whales/identity";
import { getWhaleLivePositionsForAccount } from "@/lib/whales/live-cache";
import {
  hyperliquidSideToWhaleSide,
  makeHyperliquidPositionId,
} from "@/lib/whales/hyperliquid-source";
import { pacificaSideToWhaleSide } from "@/lib/whales/pacifica-source";
import type { AgentWalletRecord } from "@/lib/wallets/agent";
import type { WhaleCopyMeta } from "@/lib/bets/whale-meta";
import type { PacificaPosition } from "@/lib/pacifica/types";
import type { WhalePositionRecord } from "@/lib/whales/types";
import { createDecipheriv } from "crypto";

interface BetMeta {
  leaderAddress?: string;
  leaderMarket: string;
  leaderSide: "long" | "short";
  leverage: number;
  botId?: string;
  autoCloseOnSourceClose?: boolean;
}

function decryptSeed(enc: string): Uint8Array {
  const key = Buffer.from(process.env.AGENT_WALLET_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) {
    throw new Error("AGENT_WALLET_ENCRYPTION_KEY missing or wrong length");
  }
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}

interface MirrorResult {
  scannedLeaders: number;
  closesAttempted: number;
  closesSucceeded: number;
  errors: Array<{ betId: string; message: string }>;
}

export interface MirrorCloseSweepOptions {
  forceSourceFetch?: boolean;
  reason?: string;
}

type OpenBetRow = {
  betId: string;
  userId: string;
  amountUsdc: number;
  feeUsdc: number | null;
  meta: unknown;
  userMainPubkey: string | null;
  // Null for flash-v2 followers (no Pacifica agent wallet) — closed via session.
  agentPubkey: string | null;
  agentSecretEnc: string | null;
};

type AutoCloseReason = Extract<
  WhaleCopyMeta["closeReason"],
  "source_closed" | "already_flat"
>;

/** Merges a leaderClosedAt stamp into the bet's existing meta JSON, so the
 *  close is attributable to the leader/bot/source exiting (not a manual close). */
function withLeaderClosedAt(
  meta: unknown,
  closeReason?: AutoCloseReason,
): Record<string, unknown> {
  const nextMeta = {
    ...((meta as Record<string, unknown> | null) ?? {}),
    leaderClosedAt: new Date().toISOString(),
  };
  if (closeReason !== undefined) {
    return {
      ...nextMeta,
      closeReason,
    };
  }
  return nextMeta;
}

type CloseFollowerBetOptions = {
  closeReason?: AutoCloseReason;
  alreadyFlatCloseReason?: AutoCloseReason;
};

/**
 * Server-driven flash-v2 close for an auto-close follower. Uses the user's bound
 * session key (NEVER user-signing in a background sweep): when the session is
 * expired/absent we log + skip so the bet stays open for a manual close. Routes
 * by position presence — a missing position is treated as already-flat.
 */
async function closeFollowerBetFlashV2(
  row: OpenBetRow,
  meta: BetMeta,
  result: MirrorResult,
  options: CloseFollowerBetOptions,
): Promise<void> {
  // getActiveSessionKey decrypts the session seed — a corrupt/tampered seed or a
  // transient DB read can throw. Wrap it so one bad follower becomes a per-bet
  // error, not an unhandled rejection that aborts the whole sweep (the Pacifica
  // branch decrypts inside its own try for the same reason).
  let session;
  try {
    session = await getActiveSessionKey(row.userId);
  } catch (err) {
    result.errors.push({
      betId: row.betId,
      message: `flash-v2 session load failed: ${err}`,
    });
    return;
  }
  if (!session) {
    // Do NOT fall back to user-signing in a background sweep. Surface it so the
    // user can re-enable auto-copy; the bet stays confirmed for a manual close.
    result.errors.push({
      betId: row.betId,
      message: "flash-v2 session inactive — auto-close skipped",
    });
    return;
  }
  result.closesAttempted++;
  try {
    const openFeeUsdc =
      row.feeUsdc != null && Number.isFinite(row.feeUsdc) ? row.feeUsdc : 0;
    const closeResult = await executeSessionClose({
      venue: flashV2Venue(),
      session,
      owner: row.userMainPubkey!,
      market: meta.leaderMarket,
      side: meta.leaderSide,
    });
    if (!closeResult.found) {
      // Position already gone (manual close or liquidation beat us). Proceeds
      // unknown — leave proceedsUsdc null.
      await db
        .update(bets)
        .set({
          status: "closed",
          closedAt: new Date(),
          meta: withLeaderClosedAt(
            row.meta,
            options.alreadyFlatCloseReason ?? options.closeReason,
          ),
        })
        .where(and(eq(bets.id, row.betId), eq(bets.status, "confirmed")));
      result.closesSucceeded++;
      return;
    }
    // estPnlUsd null ⇒ indexer hasn't populated entry/mark price; leave proceeds
    // unset rather than persisting NaN into proceeds_usdc.
    const proceedsUsdc =
      closeResult.estPnlUsd == null
        ? null
        : row.amountUsdc + closeResult.estPnlUsd - openFeeUsdc;
    await db
      .update(bets)
      .set({
        status: "closed",
        closedAt: new Date(),
        closeTxHash: `flashv2:${closeResult.signature}`,
        meta: withLeaderClosedAt(row.meta, options.closeReason),
        ...(proceedsUsdc != null ? { proceedsUsdc } : {}),
      })
      .where(and(eq(bets.id, row.betId), eq(bets.status, "confirmed")));
    result.closesSucceeded++;
  } catch (err) {
    result.errors.push({ betId: row.betId, message: String(err) });
  }
}

/** Shared close logic: routes flash-v2 followers to the session-signed close,
 *  else looks up the user's live position on Pacifica and submits a reduce-only
 *  close order. Updates the bet row on success — recording realized PnL and
 *  stamping leaderClosedAt. */
async function closeFollowerBet(
  row: OpenBetRow,
  meta: BetMeta,
  result: MirrorResult,
  options: CloseFollowerBetOptions = {},
): Promise<void> {
  if (copyMetaVenue(row.meta) === "flash-v2") {
    await closeFollowerBetFlashV2(row, meta, result, options);
    return;
  }
  // A Pacifica follower with no agent wallet was silently dropped by the old
  // innerJoin (now leftJoin, to admit flash-v2 followers). Preserve that exactly
  // — no attempt, no error — so the flag-off sweep is byte-for-byte unchanged.
  if (!row.agentSecretEnc || !row.agentPubkey) return;
  result.closesAttempted++;
  try {
    const seed = decryptSeed(row.agentSecretEnc);
    const kp = Keypair.fromSeed(seed);
    const agent: AgentWalletRecord = {
      userId: row.userId,
      mainPubkey: row.userMainPubkey!,
      agentPubkey: row.agentPubkey,
      agentSecretKey: kp.secretKey,
    };
    // Look up user's current position to know how much to close.
    const userPositions = await getPositions(row.userMainPubkey!);
    const userPos = userPositions.find(
      (p) =>
        p.symbol === meta.leaderMarket &&
        ((meta.leaderSide === "long" && p.side === "bid") ||
          (meta.leaderSide === "short" && p.side === "ask")),
    );
    if (!userPos) {
      // Position already gone on user side (manual close or liquidation
      // beat us). Proceeds unknown — leave proceedsUsdc null.
      await db
        .update(bets)
        .set({
          status: "closed",
          closedAt: new Date(),
          meta: withLeaderClosedAt(
            row.meta,
            options.alreadyFlatCloseReason ?? options.closeReason,
          ),
        })
        .where(
          and(eq(bets.id, row.betId), eq(bets.status, "confirmed")),
        );
      result.closesSucceeded++;
      return;
    }
    const fill = await closeCopyOrder({
      agent,
      symbol: meta.leaderMarket,
      positionSide: meta.leaderSide,
      amountBase: userPos.amount,
    });
    // Record realized PnL so the auto-closed tail shows true PnL in the
    // portfolio rather than a fabricated total loss.
    const realized = await realizedPnlForOrder({
      account: row.userMainPubkey!,
      orderId: fill.order_id,
    });
    const openFeeUsdc =
      row.feeUsdc != null && Number.isFinite(row.feeUsdc) ? row.feeUsdc : 0;
    await db
      .update(bets)
      .set({
        status: "closed",
        closedAt: new Date(),
        closeTxHash: `pacifica:${fill.order_id}`,
        meta: withLeaderClosedAt(row.meta, options.closeReason),
        ...(realized != null
          ? { proceedsUsdc: row.amountUsdc + realized - openFeeUsdc }
          : {}),
      })
      .where(
        and(eq(bets.id, row.betId), eq(bets.status, "confirmed")),
      );
    result.closesSucceeded++;
  } catch (err) {
    result.errors.push({ betId: row.betId, message: String(err) });
  }
}

/** Wallet-leader close path: groups by leaderAddress, fetches each leader's
 *  live Pacifica positions once, and closes any follower bet where the leader
 *  has exited. */
async function closeLeaderFollowers(
  openBets: OpenBetRow[],
  result: MirrorResult,
): Promise<void> {
  // Group by leaderAddress so we only fetch each leader's positions once.
  const byLeader = new Map<string, OpenBetRow[]>();
  for (const row of openBets) {
    if (parseWhaleCopyMeta(row.meta) !== null) continue;
    const meta = row.meta as BetMeta | null;
    if (!meta?.leaderAddress) continue;
    const list = byLeader.get(meta.leaderAddress) ?? [];
    list.push(row);
    byLeader.set(meta.leaderAddress, list);
  }

  for (const [leaderAddress, followers] of byLeader.entries()) {
    result.scannedLeaders++;
    let leaderPositions;
    try {
      leaderPositions = await getPositions(leaderAddress);
    } catch (err) {
      for (const f of followers) {
        result.errors.push({ betId: f.betId, message: `leader fetch: ${err}` });
      }
      continue;
    }

    for (const row of followers) {
      const meta = row.meta as BetMeta;
      // Pacifica positions have no per-position id; identify by
      // (account, market, side). If the leader still has any matching
      // position in the same direction, treat it as the same trade.
      const stillOpen = leaderPositions.find(
        (p) =>
          p.symbol === meta.leaderMarket &&
          ((meta.leaderSide === "long" && p.side === "bid") ||
            (meta.leaderSide === "short" && p.side === "ask")),
      );
      if (stillOpen) continue;

      // Leader closed → close follower.
      await closeFollowerBet(row, meta, result);
    }
  }
}

/** Bot-keyed close path: groups by meta.botId, checks whether the bot has
 *  exited its position, and closes any follower bet that opted into auto-close.
 *  Source of the flat signal depends on the bot kind:
 *   - `arena:<persona>` → the on-chain LlmBot position (getBotPositionSignal).
 *   - any other id      → the paper_positions table (paper-bot experiment).
 *  Positive-signal-only on BOTH paths: we close only on a definite "flat", never
 *  on "unknown" (missing data, RPC error, decode/fetch failure). */
async function closeBotFollowers(
  openBets: OpenBetRow[],
  result: MirrorResult,
): Promise<void> {
  const byBot = new Map<string, OpenBetRow[]>();
  for (const row of openBets) {
    if (parseWhaleCopyMeta(row.meta) !== null) continue;
    const meta = row.meta as BetMeta | null;
    if (!meta?.botId) continue;
    const arr = byBot.get(meta.botId) ?? [];
    arr.push(row);
    byBot.set(meta.botId, arr);
  }

  for (const [botId, followers] of byBot.entries()) {
    if (personaFromBotId(botId)) {
      // On-chain LLM arena bot: read its real position. getBotPositionSignal is
      // total (never throws) — "active"/"unknown" both keep the tail open.
      if ((await getBotPositionSignal(botId)) !== "flat") continue;
    } else {
      // Paper-bot experiment: positive-signal via paper_positions. A bot with
      // NO rows here is "unknown", NOT "flat", so we never close blind.
      let rows: { status: string }[];
      try {
        rows = await db
          .select({ status: paperPositions.status })
          .from(paperPositions)
          .where(eq(paperPositions.botId, botId))
          .limit(50);
      } catch (err) {
        for (const f of followers) {
          result.errors.push({
            betId: f.betId,
            message: `bot paper-position fetch: ${err}`,
          });
        }
        continue;
      }
      if (rows.length === 0) continue;
      if (rows.some((r) => r.status === "open")) continue; // still in position
    }

    // Bot is positively flat → close each follower that opted into auto-close.
    for (const row of followers) {
      const meta = row.meta as BetMeta;
      if (meta.autoCloseOnSourceClose === false) continue;
      await closeFollowerBet(row, meta, result);
    }
  }
}

function pacificaSourcePositionId(
  sourceAccount: string,
  position: PacificaPosition,
): string | null {
  const openedAtMs = Number(position.created_at);
  if (!Number.isFinite(openedAtMs)) return null;
  return makeWhalePositionId({
    source: "pacifica",
    sourceAccount,
    market: position.symbol,
    side: pacificaSideToWhaleSide(position.side),
    openedAtMs,
  });
}

function isWhaleSourcePositionStillOpen(
  meta: WhaleCopyMeta,
  sourcePositions: PacificaPosition[],
): boolean {
  return sourcePositions.some(
    (position) =>
      pacificaSourcePositionId(meta.sourceAccount, position) ===
      meta.sourcePositionId,
  );
}

async function getHyperliquidOpenPositionIds(
  sourceAccount: string,
): Promise<Set<string>> {
  const state = await getClearinghouseState(sourceAccount);
  return new Set((state.assetPositions ?? []).flatMap((assetPosition) => {
    try {
      const position = assetPosition.position;
      const entryPrice = Number(position.entryPx);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) return [];
      const side = hyperliquidSideToWhaleSide(position.szi);
      return [
        makeHyperliquidPositionId({
          sourceAccount,
          market: position.coin,
          side,
          entryPrice,
        }),
      ];
    } catch {
      return [];
    }
  }));
}

function isCachedWhaleSourcePositionStillOpen(
  meta: WhaleCopyMeta,
  sourcePositions: WhalePositionRecord[],
): boolean {
  return sourcePositions.some(
    (position) =>
      position.id === meta.sourcePositionId && position.status === "open",
  );
}

/** Whale-source close path: if the copied source position has disappeared and
 *  the user opted into source-close listening, close the follower position. */
async function closeWhaleFollowers(
  openBets: OpenBetRow[],
  result: MirrorResult,
  options: MirrorCloseSweepOptions = {},
): Promise<void> {
  const bySourceAccount = new Map<
    string,
    Array<{ row: OpenBetRow; meta: WhaleCopyMeta }>
  >();
  for (const row of openBets) {
    const meta = parseWhaleCopyMeta(row.meta);
    if (meta === null) continue;
    if (meta.autoCloseOnSourceClose === false) continue;
    const key = `${meta.source}:${meta.sourceAccount}`;
    const followers = bySourceAccount.get(key) ?? [];
    followers.push({ row, meta });
    bySourceAccount.set(key, followers);
  }

  for (const [, followers] of bySourceAccount.entries()) {
    result.scannedLeaders++;
    const first = followers[0];
    if (!first) continue;
    const { source, sourceAccount } = first.meta;

    const cachedSourcePositions = options.forceSourceFetch
      ? null
      : await getWhaleLivePositionsForAccount(sourceAccount, source);
    if (cachedSourcePositions !== null) {
      for (const { row, meta } of followers) {
        const sourceStillOpen = isCachedWhaleSourcePositionStillOpen(
          meta,
          cachedSourcePositions,
        );
        if (!shouldAutoCloseWhaleCopy({ meta, sourceStillOpen })) continue;

        await closeFollowerBet(row, meta, result, {
          closeReason: "source_closed",
          alreadyFlatCloseReason: "already_flat",
        });
      }
      continue;
    }

    if (source === "hyperliquid") {
      let openPositionIds: Set<string>;
      try {
        openPositionIds = await getHyperliquidOpenPositionIds(sourceAccount);
      } catch (err) {
        for (const follower of followers) {
          result.errors.push({
            betId: follower.row.betId,
            message: `source fetch: ${err}`,
          });
        }
        continue;
      }

      for (const { row, meta } of followers) {
        const sourceStillOpen = openPositionIds.has(meta.sourcePositionId);
        if (!shouldAutoCloseWhaleCopy({ meta, sourceStillOpen })) continue;

        await closeFollowerBet(row, meta, result, {
          closeReason: "source_closed",
          alreadyFlatCloseReason: "already_flat",
        });
      }
      continue;
    }

    let sourcePositions;
    try {
      sourcePositions = await getPositions(sourceAccount);
    } catch (err) {
      for (const follower of followers) {
        result.errors.push({
          betId: follower.row.betId,
          message: `source fetch: ${err}`,
        });
      }
      continue;
    }

    for (const { row, meta } of followers) {
      const sourceStillOpen = isWhaleSourcePositionStillOpen(
        meta,
        sourcePositions,
      );
      if (!shouldAutoCloseWhaleCopy({ meta, sourceStillOpen })) continue;

      await closeFollowerBet(row, meta, result, {
        closeReason: "source_closed",
        alreadyFlatCloseReason: "already_flat",
      });
    }
  }
}

export async function runMirrorCloseSweep(
  options: MirrorCloseSweepOptions = {},
): Promise<MirrorResult> {
  const result: MirrorResult = {
    scannedLeaders: 0,
    closesAttempted: 0,
    closesSucceeded: 0,
    errors: [],
  };

  const openBets = await db
    .select({
      betId: bets.id,
      userId: bets.userId,
      amountUsdc: bets.amountUsdc,
      feeUsdc: bets.feeUsdc,
      meta: bets.meta,
      userMainPubkey: users.solanaPubkey,
      agentPubkey: agentWallets.agentPubkey,
      agentSecretEnc: agentWallets.agentSecretEnc,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    // leftJoin (not inner): flash-v2 followers have no agent wallet but must
    // still be swept and closed via their session key.
    .leftJoin(agentWallets, eq(agentWallets.userId, bets.userId))
    .where(
      and(
        eq(bets.type, "copy"),
        eq(bets.status, "confirmed"),
        isNotNull(bets.meta),
      ),
    );
  if (openBets.length === 0) return result;

  // Existing wallet-leader close path (untouched logic).
  await closeLeaderFollowers(openBets, result);

  // New bot-keyed close path.
  await closeBotFollowers(openBets, result);

  // Whale-source close path.
  await closeWhaleFollowers(openBets, result, options);

  await patchMonitorStatus({
    autoClose: {
      lastSweepAt: new Date().toISOString(),
      lastResult: {
        reason: options.reason ?? "scheduled sweep",
        forceSourceFetch: options.forceSourceFetch === true,
        scannedLeaders: result.scannedLeaders,
        closesAttempted: result.closesAttempted,
        closesSucceeded: result.closesSucceeded,
        errors: result.errors,
      },
    },
    recentErrors: result.errors.map((error) => ({
      component: "auto-close",
      message: `bet ${error.betId}: ${error.message}`,
      at: new Date().toISOString(),
    })),
  }).catch((err) => {
    console.warn("[mirror-close] monitor status write failed:", err);
  });

  return result;
}
