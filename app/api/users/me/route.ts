import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buildPublicUserProfile } from "@/lib/users/profile";
import { normalizeHandleInput } from "@/lib/users/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    solanaPubkey?: string;
  };

  const user = await ensureUser(claims.userId, body.solanaPubkey ?? null);
  const profile = buildPublicUserProfile(user);
  return NextResponse.json({
    user: {
      id: user.id,
      privyId: user.privyId,
      solanaPubkey: user.solanaPubkey,
      profile,
    },
  });
}

export async function PATCH(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    handle?: unknown;
    solanaPubkey?: string;
  };

  const normalized = normalizeHandleInput(body.handle);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.solanaPubkey ?? null);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.handle, normalized.handle))
    .limit(1);

  if (existing[0] && existing[0].id !== user.id) {
    return NextResponse.json(
      { error: "Handle is already taken." },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(users)
    .set({
      displayName: normalized.handle,
      handle: normalized.handle,
      avatarSeed: normalized.handle,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  const next = updated ?? user;
  const profile = buildPublicUserProfile(next);
  return NextResponse.json({
    user: {
      id: next.id,
      privyId: next.privyId,
      solanaPubkey: next.solanaPubkey,
      profile,
    },
  });
}
