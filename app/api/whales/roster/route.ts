import { NextResponse } from "next/server";
import { whaleSocialEnabled } from "@/lib/features";
import { buildCompactRoster } from "@/lib/signals/roster-compact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!whaleSocialEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const whales = await buildCompactRoster();
  const response = NextResponse.json({ whales });
  response.headers.set(
    "Cache-Control",
    "public, max-age=10, stale-while-revalidate=30",
  );
  return response;
}
