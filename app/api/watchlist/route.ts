import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { db } from "@/lib/db";
import { watchlistItems } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, user.id))
    .orderBy(desc(watchlistItems.addedAt));
  return NextResponse.json({
    items: rows.map((r) => ({
      signalId: r.signalId,
      signalType: r.signalType,
      payload: r.payload,
      addedAt: r.addedAt,
    })),
  });
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    signalId?: string;
    signalType?: string;
    payload?: unknown;
  } | null;
  if (
    !body ||
    typeof body.signalId !== "string" ||
    typeof body.signalType !== "string" ||
    !body.payload
  ) {
    return NextResponse.json(
      { error: "signalId, signalType, payload required" },
      { status: 400 },
    );
  }
  const user = await ensureUser(claims.userId, null);
  await db
    .insert(watchlistItems)
    .values({
      userId: user.id,
      signalId: body.signalId,
      signalType: body.signalType,
      payload: body.payload,
    })
    .onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const signalId = url.searchParams.get("signalId");
  if (!signalId) {
    return NextResponse.json(
      { error: "signalId query param required" },
      { status: 400 },
    );
  }
  const user = await ensureUser(claims.userId, null);
  await db
    .delete(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, user.id),
        eq(watchlistItems.signalId, signalId),
      ),
    );
  return NextResponse.json({ ok: true });
}
