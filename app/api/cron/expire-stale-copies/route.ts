import { NextResponse } from "next/server";
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, agentWallets, users } from "@/lib/db/schema";
import { Keypair } from "@solana/web3.js";
import { createDecipheriv } from "crypto";
import { checkCronAuth } from "@/lib/auth/cron";
import { getPositions } from "@/lib/pacifica/client";
import { closeCopyOrder } from "@/lib/pacifica/orders";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

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

// Force-close any copy bet whose createdAt is older than 24h and is
// still "confirmed". Unlike the Phoenix plan, we can actually submit
// the close (we have agent-wallet authority).
export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth) return auth;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stale = await db
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
        lt(bets.createdAt, cutoff),
        isNotNull(bets.meta),
      ),
    );

  let closed = 0;
  const errors: Array<{ betId: string; message: string }> = [];
  for (const row of stale) {
    try {
      const meta = row.meta as {
        leaderMarket: string;
        leaderSide: "long" | "short";
      };
      const userPositions = await getPositions(row.userMainPubkey!);
      const userPos = userPositions.find(
        (p) =>
          p.symbol === meta.leaderMarket &&
          ((meta.leaderSide === "long" && p.side === "bid") ||
            (meta.leaderSide === "short" && p.side === "ask")),
      );
      if (userPos) {
        const seed = decryptSeed(row.agentSecretEnc);
        const kp = Keypair.fromSeed(seed);
        const fill = await closeCopyOrder({
          agent: {
            userId: row.userId,
            mainPubkey: row.userMainPubkey!,
            agentPubkey: row.agentPubkey,
            agentSecretKey: kp.secretKey,
          },
          symbol: meta.leaderMarket,
          positionSide: meta.leaderSide,
          amountBase: userPos.amount,
        });
        await db
          .update(bets)
          .set({
            status: "expired",
            closedAt: new Date(),
            closeTxHash: `pacifica:${fill.order_id}`,
          })
          .where(eq(bets.id, row.betId));
      } else {
        await db
          .update(bets)
          .set({ status: "expired", closedAt: new Date() })
          .where(eq(bets.id, row.betId));
      }
      closed++;
    } catch (err) {
      errors.push({ betId: row.betId, message: String(err) });
    }
  }
  return NextResponse.json({ ok: true, expired: closed, errors });
}
