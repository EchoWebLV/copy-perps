import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { refreshMemes } from "@/lib/signals/refresh-memes";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const start = Date.now();
  try {
    const result = await refreshMemes();
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - start,
      ...result,
    });
  } catch (err) {
    console.error("[refresh-memes] failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
