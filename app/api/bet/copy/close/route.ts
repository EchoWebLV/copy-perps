import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { closeCopyOrder } from "@/lib/pacifica/orders";
import { getPositions } from "@/lib/pacifica/client";
import { realizedPnlForOrder } from "@/lib/bets/copy-pnl";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { copyMetaVenue } from "@/lib/bets/copy-meta";
import { closeCopyFlashV2 } from "@/lib/bets/copy-flash-v2";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  betId?: string;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.betId) return NextResponse.json({ error: "betId required" }, { status: 400 });

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });

  // Flash v2 copy bets close via the session key (no agent wallet). Peek the
  // bet's persisted venue so a Pacifica bet still closes on Pacifica after the
  // flag flips. Gated on the flag: when it's off this block is skipped entirely
  // and the Pacifica path below runs byte-for-byte (no extra query).
  const flashV2 = getFlashV2Venue();
  if (flashV2) {
    const [peek] = await db
      .select({
        id: bets.id,
        status: bets.status,
        amountUsdc: bets.amountUsdc,
        feeUsdc: bets.feeUsdc,
        meta: bets.meta,
      })
      .from(bets)
      .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
      .limit(1);
    if (peek && copyMetaVenue(peek.meta) === "flash-v2") {
      if (peek.status !== "confirmed") {
        return NextResponse.json(
          { error: `cannot close bet with status ${peek.status}` },
          { status: 409 },
        );
      }
      const meta = peek.meta as { leaderMarket: string; leaderSide: "long" | "short" };
      let result;
      try {
        result = await closeCopyFlashV2({
          venue: flashV2,
          userId: user.id,
          owner: user.solanaPubkey,
          market: meta.leaderMarket,
          side: meta.leaderSide,
        });
      } catch (err) {
        console.error("[bet/copy/close] flash-v2 close failed:", err);
        return NextResponse.json(
          { error: "Position could not close. Try again." },
          { status: 502 },
        );
      }
      if (result.kind === "no-session") {
        return NextResponse.json(
          { error: "Re-enable auto-copy to close this position." },
          { status: 409 },
        );
      }
      if (result.kind === "not-found") {
        await db
          .update(bets)
          .set({ status: "closed", closedAt: new Date() })
          .where(eq(bets.id, peek.id));
        return NextResponse.json({ ok: true, alreadyClosed: true });
      }
      const openFeeUsdc =
        peek.feeUsdc != null && Number.isFinite(peek.feeUsdc) ? peek.feeUsdc : 0;
      const proceedsUsdc = peek.amountUsdc + result.estPnlUsd - openFeeUsdc;
      await db
        .update(bets)
        .set({
          status: "closed",
          closedAt: new Date(),
          closeTxHash: `flashv2:${result.signature}`,
          proceedsUsdc,
        })
        .where(eq(bets.id, peek.id));
      return NextResponse.json({ ok: true, txSig: result.signature, proceedsUsdc });
    }
  }

  const agent = await getAgentWallet(user.id);
  if (!agent) {
    return NextResponse.json(
      { error: "Trading account is not ready." },
      { status: 409 },
    );
  }

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) return NextResponse.json({ error: "bet not found" }, { status: 404 });
  if (bet.status !== "confirmed") {
    return NextResponse.json(
      { error: `cannot close bet with status ${bet.status}` },
      { status: 409 },
    );
  }

  const meta = bet.meta as {
    leaderMarket: string;
    leaderSide: "long" | "short";
  };

  // Look up the user's current position on Pacifica to get the exact
  // amount to reduce. If the position is already gone, mark closed
  // and return success.
  let userPositions;
  try {
    userPositions = await getPositions(user.solanaPubkey);
  } catch (err) {
    console.error("[bet/copy/close] position lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load your open position. Try again." },
      { status: 502 },
    );
  }
  const userPos = userPositions.find(
    (p) =>
      p.symbol === meta.leaderMarket &&
      ((meta.leaderSide === "long" && p.side === "bid") ||
        (meta.leaderSide === "short" && p.side === "ask")),
  );
  if (!userPos) {
    await db
      .update(bets)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(bets.id, bet.id));
    return NextResponse.json({ ok: true, alreadyClosed: true });
  }

  let fill;
  try {
    fill = await closeCopyOrder({
      agent,
      symbol: meta.leaderMarket,
      positionSide: meta.leaderSide,
      amountBase: userPos.amount,
    });
  } catch (err) {
    console.error("[bet/copy/close] failed:", err);
    return NextResponse.json(
      { error: "Position could not close. Try again." },
      { status: 502 },
    );
  }

  // Realized PnL of the close (net of fees) so the portfolio shows true
  // closed PnL — without it, a null proceeds renders as a 100% loss.
  const realized = await realizedPnlForOrder({
    account: user.solanaPubkey,
    orderId: fill.order_id,
  });
  if (realized == null) {
    console.warn(
      `[bet/copy/close] realized PnL unavailable for order ${fill.order_id}; proceeds left unset`,
    );
  }
  const openFeeUsdc =
    bet.feeUsdc != null && Number.isFinite(bet.feeUsdc) ? bet.feeUsdc : 0;
  const proceedsUsdc =
    realized == null ? null : bet.amountUsdc + realized - openFeeUsdc;

  await db
    .update(bets)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeTxHash: `pacifica:${fill.order_id}`,
      ...(proceedsUsdc != null ? { proceedsUsdc } : {}),
    })
    .where(eq(bets.id, bet.id));

  return NextResponse.json({ ok: true, orderId: fill.order_id, proceedsUsdc });
}
