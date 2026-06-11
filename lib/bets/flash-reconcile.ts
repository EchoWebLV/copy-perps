import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { Connection } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, fills } from "@/lib/db/schema";
import { getFlashPerpsService } from "@/lib/flash/perps";
import {
  parseFlashTailMeta,
  type FlashTailMeta,
} from "./flash-tail-meta";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STALE_PENDING_MS = 5 * 60_000;
const BATCH = 10;
// A landed tx is visible to getTransaction within seconds and a dropped
// blockhash expires in ~2 minutes — an open sig still unfindable this long
// after the bet was created never executed.
const OPEN_SIG_MAX_AGE_MS = 30 * 60_000;
// Don't liveness-check a tail until the open has had ample time to settle
// and show up in positionsOf.
const EXTERNAL_CLOSE_MIN_AGE_MS = 15 * 60_000;
const LIVENESS_BATCH = 10;

const RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

type TokenBalance = {
  owner?: string;
  mint?: string;
  uiTokenAmount?: { uiAmount?: number | null };
};

type TxMetaLike = {
  err: unknown;
  preTokenBalances?: TokenBalance[] | null;
  postTokenBalances?: TokenBalance[] | null;
};

/** USDC balance change for `owner` across a parsed tx. Null = owner had no USDC account in the tx. */
export function usdcDeltaForOwner(
  meta: TxMetaLike,
  owner: string,
): number | null {
  const sum = (balances: TokenBalance[] | null | undefined) => {
    let total: number | null = null;
    for (const b of balances ?? []) {
      if (b.owner !== owner || b.mint !== USDC_MINT) continue;
      total = (total ?? 0) + (b.uiTokenAmount?.uiAmount ?? 0);
    }
    return total;
  };
  const pre = sum(meta.preTokenBalances);
  const post = sum(meta.postTokenBalances);
  if (pre === null && post === null) return null;
  return (post ?? 0) - (pre ?? 0);
}

type ReconcileBet = {
  id: string;
  userId: string;
  status: string;
  amountUsdc: number;
  createdAt: Date;
  meta: FlashTailMeta;
};

type LivePositionKey = { market: string; side: "long" | "short" };

type ChainTruth = {
  betId: string;
  action: "open" | "close";
  txSig: string;
  usdcDelta: number | null;
  txFailed: boolean;
  meta: FlashTailMeta;
  nowIso: string;
};

export type ReconcileDeps = {
  listBetsToReconcile: () => Promise<ReconcileBet[]>;
  listLivenessCandidates: (olderThan: Date) => Promise<ReconcileBet[]>;
  reapStalePending: () => Promise<number>;
  getTx: (sig: string) => Promise<{ meta: TxMetaLike | null } | null>;
  getLivePositions: (walletAddress: string) => Promise<LivePositionKey[]>;
  applyChainTruth: (truth: ChainTruth) => Promise<void>;
  markClosedExternal: (args: {
    betId: string;
    meta: FlashTailMeta;
    nowIso: string;
  }) => Promise<void>;
  now: () => Date;
};

function toReconcileBets(rows: (typeof bets.$inferSelect)[]): ReconcileBet[] {
  const out: ReconcileBet[] = [];
  for (const row of rows) {
    const meta = parseFlashTailMeta(row.meta);
    if (!meta) continue;
    out.push({
      id: row.id,
      userId: row.userId,
      status: row.status,
      amountUsdc: row.amountUsdc,
      createdAt: row.createdAt,
      meta,
    });
  }
  return out;
}

function defaultDeps(): ReconcileDeps {
  const conn = new Connection(RPC, "confirmed");
  return {
    async listBetsToReconcile() {
      const rows = await db
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.type, "flash-tail"),
            or(
              // closes still on the quote estimate
              and(
                eq(bets.status, "closed"),
                sql`${bets.meta} ->> 'proceedsSource' = 'quote-estimate'`,
                sql`${bets.meta} ->> 'closeSignature' IS NOT NULL`,
              ),
              // opens never chain-verified
              and(
                eq(bets.status, "confirmed"),
                sql`${bets.meta} ->> 'reconciledAt' IS NULL`,
                sql`${bets.meta} ->> 'openSignature' IS NOT NULL`,
              ),
            ),
          ),
        )
        // Newest first: fresh work always outranks rows whose tx never
        // landed (dropped blockhash) and would otherwise camp in the
        // BATCH window forever.
        .orderBy(desc(bets.createdAt))
        .limit(BATCH);
      return toReconcileBets(rows);
    },
    async listLivenessCandidates(olderThan: Date) {
      const rows = await db
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.type, "flash-tail"),
            eq(bets.status, "confirmed"),
            // Only chain-verified opens: the position provably existed, so
            // its absence now means it died externally. Unverified opens are
            // the signature-verify queue's job (failed if the tx never lands).
            sql`${bets.meta} ->> 'reconciledAt' IS NOT NULL`,
            lt(bets.createdAt, olderThan),
          ),
        )
        // Random sample per sweep: live positions never leave this set, so
        // any deterministic order would let the same rows camp in the
        // LIVENESS_BATCH window and starve the rest.
        .orderBy(sql`random()`)
        .limit(LIVENESS_BATCH);
      return toReconcileBets(rows);
    },
    async reapStalePending() {
      const cutoff = new Date(Date.now() - STALE_PENDING_MS);
      const reaped = await db
        .update(bets)
        .set({ status: "abandoned" })
        .where(
          and(
            eq(bets.type, "flash-tail"),
            eq(bets.status, "pending"),
            lt(bets.createdAt, cutoff),
          ),
        )
        .returning();
      return reaped.length;
    },
    async getTx(sig: string) {
      const tx = await conn.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      return tx ? { meta: tx.meta } : null;
    },
    async getLivePositions(walletAddress: string) {
      const positions = await getFlashPerpsService().positionsOf(walletAddress);
      return positions.map((p) => ({ market: p.symbol, side: p.side }));
    },
    async markClosedExternal({ betId, meta, nowIso }) {
      // No proceeds, no fill: we know the position is gone but not what it
      // paid out — stamping a guess here is exactly the corruption this
      // status exists to prevent.
      await db
        .update(bets)
        .set({
          status: "closed-external",
          closedAt: new Date(nowIso),
          meta: { ...meta, closeReason: "external" },
        })
        // CAS: a manual close postback landing between the liveness read and
        // this write wins — it carries the real signature and proceeds.
        .where(and(eq(bets.id, betId), eq(bets.status, "confirmed")));
    },
    async applyChainTruth(truth: ChainTruth) {
      if (truth.txFailed) {
        // The estimate fill written at confirm time references a tx that
        // failed on-chain — delete it, or a later retry double-counts in
        // any aggregation over fills.
        await db
          .delete(fills)
          .where(
            and(eq(fills.txSig, truth.txSig), eq(fills.action, truth.action)),
          );
        if (truth.action === "open") {
          // open never landed → bet is dead
          await db
            .update(bets)
            .set({
              status: "failed",
              meta: { ...truth.meta, reconciledAt: truth.nowIso },
            })
            // CAS: only while still 'confirmed' — a concurrent close confirm
            // must not be clobbered by this stale meta snapshot.
            .where(and(eq(bets.id, truth.betId), eq(bets.status, "confirmed")));
        } else {
          // close tx failed → the position is still open
          await db
            .update(bets)
            .set({
              status: "confirmed",
              closedAt: null,
              closeTxHash: null,
              proceedsUsdc: null,
              meta: {
                ...truth.meta,
                closeSignature: null,
                closeReason: null,
                proceedsSource: null,
              },
            })
            .where(and(eq(bets.id, truth.betId), eq(bets.status, "closed")));
        }
        return;
      }

      if (truth.action === "close") {
        if (truth.usdcDelta === null) {
          // Tx landed but the owner's USDC account never appeared in it —
          // we cannot derive proceeds. Keep the quote estimate rather than
          // stamping an unknown as chain truth; mark reconciled so the row
          // exits the queue.
          console.warn(
            "[flash-reconcile] landed close with no derivable USDC delta:",
            truth.txSig,
          );
          await db
            .update(bets)
            .set({
              meta: {
                ...truth.meta,
                proceedsSource: "chain",
                reconciledAt: truth.nowIso,
              },
            })
            .where(and(eq(bets.id, truth.betId), eq(bets.status, "closed")));
          return;
        }
        await db
          .update(bets)
          .set({
            proceedsUsdc: truth.usdcDelta,
            meta: {
              ...truth.meta,
              proceedsSource: "chain",
              reconciledAt: truth.nowIso,
            },
          })
          .where(and(eq(bets.id, truth.betId), eq(bets.status, "closed")));
      } else {
        await db
          .update(bets)
          .set({ meta: { ...truth.meta, reconciledAt: truth.nowIso } })
          // CAS: skip if a close confirm landed since the snapshot — the
          // close-reconcile pass will verify this bet instead.
          .where(and(eq(bets.id, truth.betId), eq(bets.status, "confirmed")));
      }

      if (truth.usdcDelta !== null) {
        // Note: for opens the chain value is collateral spent (stake+fee),
        // not notional — fills.source distinguishes the units.
        await db
          .update(fills)
          .set({
            fillUsd: Math.abs(truth.usdcDelta),
            source: "chain",
          })
          .where(
            and(eq(fills.txSig, truth.txSig), eq(fills.action, truth.action)),
          );
      }
    },
    now: () => new Date(),
  };
}

export async function runFlashReconcileSweep(args?: {
  timeBoxMs?: number;
  deps?: ReconcileDeps;
}): Promise<{ checked: number; reaped: number; externalized: number }> {
  const timeBoxMs = args?.timeBoxMs ?? 10_000;
  const deps = args?.deps ?? defaultDeps();
  const deadline = Date.now() + timeBoxMs;
  const now = deps.now();
  const nowIso = now.toISOString();

  const reaped = await deps.reapStalePending();

  let checked = 0;
  const candidates = await deps.listBetsToReconcile();
  for (const bet of candidates) {
    if (Date.now() > deadline) break;

    const isClose =
      bet.status === "closed" && bet.meta.proceedsSource === "quote-estimate";
    const action: "open" | "close" = isClose ? "close" : "open";
    const sig = isClose ? bet.meta.closeSignature : bet.meta.openSignature;
    if (!sig) continue;

    let tx: { meta: TxMetaLike | null } | null = null;
    try {
      tx = await deps.getTx(sig);
    } catch (err) {
      console.warn("[flash-reconcile] getTransaction failed:", err);
      continue;
    }
    if (!tx?.meta) {
      // Not yet visible; retry next sweep — except an open past the age
      // cutoff, where absence IS the chain truth: the tx never landed, and
      // without a cutoff the row retries every sweep forever and camps in
      // the BATCH window.
      if (
        action === "open" &&
        now.getTime() - bet.createdAt.getTime() > OPEN_SIG_MAX_AGE_MS
      ) {
        checked += 1;
        await deps.applyChainTruth({
          betId: bet.id,
          action,
          txSig: sig,
          usdcDelta: null,
          txFailed: true,
          meta: bet.meta,
          nowIso,
        });
      }
      continue;
    }

    checked += 1;
    const txFailed = tx.meta.err != null;
    await deps.applyChainTruth({
      betId: bet.id,
      action,
      txSig: sig,
      usdcDelta: txFailed
        ? null
        : usdcDeltaForOwner(tx.meta, bet.meta.walletAddress),
      txFailed,
      meta: bet.meta,
      nowIso,
    });
  }

  // Liveness pass: a confirmed tail whose verified position no longer shows
  // up in positionsOf died externally (liquidation, TP/SL trigger, lost close
  // postback). Left 'confirmed', it mis-attributes the next Scalp open on the
  // same (market, side) and that position's close stamps it with wrong
  // proceeds — expire it instead.
  let externalized = 0;
  const livenessCutoff = new Date(now.getTime() - EXTERNAL_CLOSE_MIN_AGE_MS);
  const livenessCandidates = await deps.listLivenessCandidates(livenessCutoff);
  const positionsByWallet = new Map<string, LivePositionKey[] | null>();
  for (const bet of livenessCandidates) {
    if (Date.now() > deadline) break;

    let positions = positionsByWallet.get(bet.meta.walletAddress);
    if (positions === undefined) {
      try {
        positions = await deps.getLivePositions(bet.meta.walletAddress);
      } catch (err) {
        console.warn("[flash-reconcile] live position fetch failed:", err);
        positions = null;
      }
      positionsByWallet.set(bet.meta.walletAddress, positions);
    }
    // Unreadable ≠ dead: only a successful read may expire a bet.
    if (positions === null) continue;

    const alive = positions.some(
      (p) => p.market === bet.meta.market && p.side === bet.meta.side,
    );
    if (alive) continue;

    await deps.markClosedExternal({ betId: bet.id, meta: bet.meta, nowIso });
    externalized += 1;
  }

  return { checked, reaped, externalized };
}
