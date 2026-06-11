import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { Connection } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, fills } from "@/lib/db/schema";
import {
  parseFlashTailMeta,
  type FlashTailMeta,
} from "./flash-tail-meta";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STALE_PENDING_MS = 5 * 60_000;
const BATCH = 10;

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
  meta: FlashTailMeta;
};

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
  reapStalePending: () => Promise<number>;
  getTx: (sig: string) => Promise<{ meta: TxMetaLike | null } | null>;
  applyChainTruth: (truth: ChainTruth) => Promise<void>;
  now: () => Date;
};

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
      const out: ReconcileBet[] = [];
      for (const row of rows) {
        const meta = parseFlashTailMeta(row.meta);
        if (!meta) continue;
        out.push({
          id: row.id,
          userId: row.userId,
          status: row.status,
          amountUsdc: row.amountUsdc,
          meta,
        });
      }
      return out;
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
}): Promise<{ checked: number; reaped: number }> {
  const timeBoxMs = args?.timeBoxMs ?? 10_000;
  const deps = args?.deps ?? defaultDeps();
  const deadline = Date.now() + timeBoxMs;
  const nowIso = deps.now().toISOString();

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
    if (!tx?.meta) continue; // not yet visible; retry next sweep

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

  return { checked, reaped };
}
