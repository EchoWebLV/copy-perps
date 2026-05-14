import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { tick } from "@/lib/bots/resolver";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) {
    return authError;
  }
  const start = Date.now();
  const result = await tick();
  const ms = Date.now() - start;
  console.log(`[bots-resolver] tick: ${result.opened} opened, ${result.closed} closed in ${ms}ms`);
  return NextResponse.json({ ok: true, ...result, ms });
}
