import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  getWhaleReactions,
  normalizeWhaleReaction,
  setWhaleReaction,
} from "@/lib/whales/whale-reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?whaleIds=a,b,c → { sentiment: { [whaleId]: { bullish, bearish, myReaction } } }
// Unauthenticated reads get counts only (myReaction = null).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const whaleIds = (url.searchParams.get("whaleIds") ?? "")
    .split(",")
    .map((id) => decodeURIComponent(id).trim())
    .filter(Boolean);

  const claims = await verifyPrivyRequest(request);
  const user = claims ? await ensureUser(claims.userId, null) : null;
  const sentiment = await getWhaleReactions({
    whaleIds,
    userId: user?.id ?? null,
  });

  return NextResponse.json({ sentiment });
}

// POST { whaleId, reaction: 'Bullish' | 'Bearish' | null } → updated sentiment.
export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await ensureUser(claims.userId, null);
  const body = (await request.json().catch(() => null)) as {
    whaleId?: unknown;
    reaction?: unknown;
  } | null;

  const whaleId = typeof body?.whaleId === "string" ? body.whaleId.trim() : "";
  if (!whaleId) {
    return NextResponse.json({ error: "whaleId required" }, { status: 400 });
  }

  const reaction =
    body?.reaction === null ? null : normalizeWhaleReaction(body?.reaction);
  if (body?.reaction !== null && !reaction) {
    return NextResponse.json({ error: "invalid reaction" }, { status: 400 });
  }

  await setWhaleReaction({ whaleId, userId: user.id, reaction });
  return NextResponse.json({
    sentiment: await getWhaleReactions({
      whaleIds: [whaleId],
      userId: user.id,
    }),
  });
}
