import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { db } from "@/lib/db";
import { waitlist } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;

export async function POST(request: Request) {
  // 1) BotID first — never burn a DB roundtrip on bot traffic.
  const verification = await checkBotId();
  if (verification.isBot) {
    return NextResponse.json({ error: "bot_check_failed" }, { status: 403 });
  }

  // 2) Parse body.
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 3) Validate email shape.
  const raw = typeof body.email === "string" ? body.email : "";
  const email = raw.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // 4) Insert; duplicates are silently OK.
  try {
    await db
      .insert(waitlist)
      .values({ email })
      .onConflictDoNothing({ target: waitlist.email });
  } catch (err) {
    console.error("[waitlist] insert failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
