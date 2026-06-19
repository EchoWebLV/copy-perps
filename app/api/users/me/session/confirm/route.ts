import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { FEATURE_FLASH_V2 } from "@/lib/flash-v2/constants";
import { markSessionKeyBound } from "@/lib/flash-v2/session-store";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  sessionPubkey?: string;
  walletAddress?: string;
}

/**
 * Confirm a session after its createSessionV2 tx landed: flip bound_at so the
 * server-driven copy path can use it. Scoped by (userId, sessionPubkey).
 */
export async function POST(request: Request) {
  if (!FEATURE_FLASH_V2) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.sessionPubkey) {
    return NextResponse.json({ error: "sessionPubkey required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  const bound = await markSessionKeyBound(user.id, body.sessionPubkey);
  if (!bound) {
    return NextResponse.json({ error: "no pending session to confirm" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
