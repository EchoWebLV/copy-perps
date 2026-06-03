import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { waitlist } from "@/lib/db/schema";

export const runtime = "nodejs";

// Pragmatic email check — not RFC-perfect, just enough to reject obvious junk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === "string") email = body.email.trim().toLowerCase();
  } catch {
    email = "";
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    // Unique email column + onConflictDoNothing => idempotent: a repeat signup
    // is a no-op success, and we never reveal whether the email was already on
    // the list.
    await db.insert(waitlist).values({ email }).onConflictDoNothing();
  } catch (err) {
    console.warn("[waitlist] insert failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
