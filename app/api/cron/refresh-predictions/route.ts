import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { refreshPredictions } from "@/lib/signals/refresh-predictions";
import { legacyRailsEnabled } from "@/lib/features";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!legacyRailsEnabled()) {
    return NextResponse.json(
      { error: "legacy rail disabled" },
      { status: 410 },
    );
  }

  const authError = checkCronAuth(request);
  if (authError) return authError;

  const start = Date.now();
  try {
    const result = await refreshPredictions();
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - start,
      ...result,
    });
  } catch (err) {
    console.error("[refresh-predictions] failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
