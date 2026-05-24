import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  addPulseComment,
  getPulseSocial,
  normalizePulseCommentBody,
  normalizePulseReaction,
  setPulseReaction,
} from "@/lib/pulse/social-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const positionIds = (url.searchParams.get("positionIds") ?? "")
    .split(",")
    .map((id) => decodeURIComponent(id).trim())
    .filter(Boolean);

  const claims = await verifyPrivyRequest(request);
  const user = claims ? await ensureUser(claims.userId, null) : null;
  const social = await getPulseSocial({
    positionIds,
    userId: user?.id ?? null,
  });

  return NextResponse.json({ social });
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await ensureUser(claims.userId, null);
  const body = (await request.json().catch(() => null)) as {
    positionId?: unknown;
    reaction?: unknown;
    comment?: unknown;
  } | null;
  const positionId =
    typeof body?.positionId === "string" ? body.positionId.trim() : "";
  if (!positionId) {
    return NextResponse.json({ error: "positionId required" }, { status: 400 });
  }

  if (Object.prototype.hasOwnProperty.call(body ?? {}, "reaction")) {
    const reaction =
      body?.reaction === null ? null : normalizePulseReaction(body?.reaction);
    if (body?.reaction !== null && !reaction) {
      return NextResponse.json({ error: "invalid reaction" }, { status: 400 });
    }

    await setPulseReaction({
      positionId,
      userId: user.id,
      reaction,
    });
    return NextResponse.json({
      social: await getPulseSocial({
        positionIds: [positionId],
        userId: user.id,
      }),
    });
  }

  const comment = normalizePulseCommentBody(body?.comment);
  if (!comment) {
    return NextResponse.json({ error: "comment required" }, { status: 400 });
  }

  await addPulseComment({
    positionId,
    userId: user.id,
    body: comment,
  });
  return NextResponse.json({
    social: await getPulseSocial({
      positionIds: [positionId],
      userId: user.id,
    }),
  });
}
