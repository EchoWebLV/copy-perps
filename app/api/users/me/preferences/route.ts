import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type FeedPrefs } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS: FeedPrefs = { meme: true, prediction: true, whale: true };

function sanitize(input: unknown): FeedPrefs {
  const raw = (input ?? {}) as Partial<Record<keyof FeedPrefs, unknown>>;
  return {
    meme: typeof raw.meme === "boolean" ? raw.meme : DEFAULTS.meme,
    prediction:
      typeof raw.prediction === "boolean" ? raw.prediction : DEFAULTS.prediction,
    whale: typeof raw.whale === "boolean" ? raw.whale : DEFAULTS.whale,
  };
}

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await ensureUser(claims.userId, null);
  return NextResponse.json({
    prefs: user.feedPrefs ?? DEFAULTS,
    onboardingCompletedAt: user.onboardingCompletedAt,
  });
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const prefs = sanitize(body);

  const user = await ensureUser(claims.userId, null);

  const [updated] = await db
    .update(users)
    .set({
      feedPrefs: prefs,
      onboardingCompletedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  return NextResponse.json({
    prefs: updated.feedPrefs ?? prefs,
    onboardingCompletedAt: updated.onboardingCompletedAt,
  });
}
