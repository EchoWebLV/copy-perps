import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── POST /api/push/subscribe ──────────────────────────────────────────────────
// Upserts a PushSubscription for the authenticated user.
// Body: { endpoint: string; keys: { p256dh: string; auth: string } }
export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "endpoint, keys.p256dh, and keys.auth are required" },
      { status: 400 },
    );
  }

  // Upsert: on conflict (same endpoint) update userId + keys so a re-subscribe
  // after a wallet switch updates the ownership without orphaning the row.
  await db
    .insert(pushSubscriptions)
    .values({ userId: user.id, endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh, auth },
    });

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/push/subscribe ────────────────────────────────────────────────
// Removes a push subscription for the authenticated user.
// Body: { endpoint: string }
export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const endpoint = body?.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, user.id),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );

  return NextResponse.json({ ok: true });
}
