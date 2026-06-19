import { NextResponse } from "next/server";
import { getPositions } from "@/lib/pacifica/client";
import { closeCopyOrder } from "@/lib/pacifica/orders";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { planFlashV2Close } from "@/lib/flash-v2/self-trade";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  market?: string;
  side?: "long" | "short";
  walletAddress?: string;
}

function parseMarket(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const market = value.trim().toUpperCase();
  return market.length > 0 ? market : null;
}

function sideFromPacifica(side: "bid" | "ask"): "long" | "short" {
  return side === "bid" ? "long" : "short";
}

function absAmount(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const market = parseMarket(body?.market);
  if (!market || (body?.side !== "long" && body?.side !== "short") || !body.walletAddress) {
    return NextResponse.json(
      { error: "market, side (long|short), walletAddress required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  // Flash v2 self-directed close. Routes by live position presence so a position
  // opened on Pacifica (flag off) still closes on Pacifica after the flag flips:
  // when the wallet has no matching Flash v2 position we fall through below.
  const flashV2 = getFlashV2Venue();
  if (flashV2) {
    try {
      const result = await planFlashV2Close({
        venue: flashV2,
        owner: user.solanaPubkey,
        market,
        side: body.side,
      });
      if (result.found) return NextResponse.json(result.plan);
    } catch (err) {
      console.error("[trade/perp/close] flash-v2 close failed:", err);
      return NextResponse.json(
        { error: "Could not check live position. Try again." },
        { status: 502 },
      );
    }
  }

  const agent = await getAgentWallet(user.id);
  if (!agent) {
    return NextResponse.json({ error: "trading agent is not ready" }, { status: 409 });
  }

  let livePosition;
  try {
    const positions = await getPositions(user.solanaPubkey);
    livePosition = positions.find(
      (p) => p.symbol === market && sideFromPacifica(p.side) === body.side,
    );
  } catch (err) {
    console.error("[trade/perp/close] position lookup failed:", err);
    return NextResponse.json(
      { error: "Could not check live position. Try again." },
      { status: 502 },
    );
  }

  if (!livePosition) {
    return NextResponse.json(
      { error: `${market} ${body.side} is not open` },
      { status: 409 },
    );
  }

  try {
    const fill = await closeCopyOrder({
      agent,
      symbol: market,
      positionSide: body.side,
      amountBase: absAmount(livePosition.amount),
    });
    return NextResponse.json({
      phase: "closed",
      fill: {
        orderId: fill.order_id,
        avgFillPrice: fill.avg_fill_price,
        filledAmount: fill.filled_amount,
        side: fill.side,
      },
    });
  } catch (err) {
    console.error("[trade/perp/close] close failed:", err);
    return NextResponse.json(
      { error: "Trade could not close. Try again." },
      { status: 502 },
    );
  }
}
