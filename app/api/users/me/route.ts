import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buildPublicUserProfile } from "@/lib/users/profile";

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
