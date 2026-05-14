import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { runMirrorCloseSweep } from "@/lib/bets/mirror-close";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth) return auth;
  try {
    const result = await runMirrorCloseSweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/mirror-close] failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
