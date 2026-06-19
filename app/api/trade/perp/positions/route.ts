import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { venuePositionToFlashShape } from "@/lib/flash-v2/self-position";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  walletAddress?: string;
}

// Self-directed Flash v2 positions for the Trade tab. v2-only: with the flag off
// the client polls the v1 /api/flash/perp/positions instead, so this returns 404.
// Recordless rail — positions come straight from the venue, never a bet row.
export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flashV2 = getFlashV2Venue();
  if (!flashV2) return NextResponse.json({ error: "not available" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const positions = await flashV2.getPositions(user.solanaPubkey);
    return NextResponse.json({ positions: positions.map(venuePositionToFlashShape) });
  } catch (err) {
    console.error("[trade/perp/positions] flash-v2 positions fetch failed:", err);
    return NextResponse.json(
      { error: "Could not load positions. Try again." },
      { status: 502 },
    );
  }
}
