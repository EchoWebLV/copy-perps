import { NextResponse } from "next/server";
import { and, eq, isNull, desc } from "drizzle-orm";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { db } from "@/lib/db";
import { notificationEvents } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string; // ISO string
  readAt: string | null; // ISO string or null
}

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);

  const rows = await db
    .select({
      id: notificationEvents.id,
      kind: notificationEvents.kind,
      title: notificationEvents.title,
      body: notificationEvents.body,
      createdAt: notificationEvents.createdAt,
      readAt: notificationEvents.readAt,
    })
    .from(notificationEvents)
    .where(eq(notificationEvents.userId, user.id))
    .orderBy(desc(notificationEvents.createdAt))
    .limit(50);

  const events: NotificationDto[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
  }));

  const unread = events.filter((e) => e.readAt === null).length;

  return NextResponse.json({ events, unread });
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);

  await db
    .update(notificationEvents)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationEvents.userId, user.id),
        isNull(notificationEvents.readAt),
      ),
    );

  return NextResponse.json({ ok: true });
}
