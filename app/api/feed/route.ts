import { NextResponse } from "next/server";
import { getFeedSignals } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);

  try {
    const signals = await getFeedSignals(limit);
    return NextResponse.json({ signals });
  } catch (err) {
    console.error("[/api/feed] failed:", err);
    return NextResponse.json(
      { error: "Failed to load feed" },
      { status: 500 },
    );
  }
}
