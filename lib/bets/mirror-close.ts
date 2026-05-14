import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users, agentWallets, paperPositions } from "@/lib/db/schema";
import { Keypair } from "@solana/web3.js";
import { getPositions } from "@/lib/pacifica/client";
import { closeCopyOrder } from "@/lib/pacifica/orders";
import type { AgentWalletRecord } from "@/lib/wallets/agent";
import { createDecipheriv } from "crypto";

interface BetMeta {
  leaderAddress?: string;
  leaderMarket: string;
  leaderSide: "long" | "short";
  leverage: number;
  botId?: string;
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

type OpenBetRow = {
  betId: string;
  userId: string;
  meta: unknown;
  userMainPubkey: string | null;
  agentPubkey: string;
  agentSecretEnc: string;
};

/** Shared close logic: look up the user's live position on Pacifica and submit
 *  a reduce-only close order. Updates the bet row on success. */
async function closeFollowerBet(
  row: OpenBetRow,
  meta: BetMeta,
  result: MirrorResult,
): Promise<void> {
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
      // Position already gone on user side (manual close beat us).
      await db
        .update(bets)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(bets.id, row.betId));
      result.closesSucceeded++;
      return;
    }
    const fill = await closeCopyOrder({
      agent,
      symbol: meta.leaderMarket,
      positionSide: meta.leaderSide,
      amountBase: userPos.amount,
    });
    await db
      .update(bets)
      .set({
        status: "closed",
        closedAt: new Date(),
        closeTxHash: `pacifica:${fill.order_id}`,
      })
      .where(eq(bets.id, row.betId));
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

/** Bot-keyed close path: groups by meta.botId, checks whether the bot's paper
 *  position is still open, and closes any follower bet where the bot has exited. */
async function closeBotFollowers(
  openBets: OpenBetRow[],
  result: MirrorResult,
): Promise<void> {
  const byBot = new Map<string, OpenBetRow[]>();
  for (const row of openBets) {
    const meta = row.meta as BetMeta | null;
    if (!meta?.botId) continue;
    const arr = byBot.get(meta.botId) ?? [];
    arr.push(row);
    byBot.set(meta.botId, arr);
  }

  for (const [botId, followers] of byBot.entries()) {
    // Check whether the bot still has an open paper position.
    let openPos;
    try {
      [openPos] = await db
        .select()
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.botId, botId),
            eq(paperPositions.status, "open"),
          ),
        )
        .limit(1);
    } catch (err) {
      for (const f of followers) {
        result.errors.push({
          betId: f.betId,
          message: `bot paper-position fetch: ${err}`,
        });
      }
      continue;
    }

    if (openPos) continue; // Bot still in position — nothing to do.

    // Bot is flat → close each follower's real Pacifica position.
    for (const row of followers) {
      const meta = row.meta as BetMeta;
      await closeFollowerBet(row, meta, result);
    }
  }
}

export async function runMirrorCloseSweep(): Promise<MirrorResult> {
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
      meta: bets.meta,
      userMainPubkey: users.solanaPubkey,
      agentPubkey: agentWallets.agentPubkey,
      agentSecretEnc: agentWallets.agentSecretEnc,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    .innerJoin(agentWallets, eq(agentWallets.userId, bets.userId))
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

  return result;
}
