import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { refreshWhales } from "@/lib/signals/refresh-whales";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const result = await refreshWhales();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[refresh-whales] failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
