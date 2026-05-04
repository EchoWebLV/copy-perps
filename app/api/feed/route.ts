import { NextResponse } from "next/server";
import { getFeedPool } from "@/lib/feed/pool";
import { seededShuffle, randomSeed } from "@/lib/feed/shuffle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)),
  );
  // Client passes the seed back across pagination requests so the order
  // stays stable. Missing/invalid → random per-request seed.
  const rawSeed = url.searchParams.get("seed");
  const seed =
    rawSeed && /^\d+$/.test(rawSeed) ? Number(rawSeed) : randomSeed();

  try {
    const pool = await getFeedPool();
    const shuffled = seededShuffle(pool, seed);
    const slice = shuffled.slice(cursor, cursor + limit);
    return NextResponse.json({
      signals: slice,
      cursor,
      nextCursor: cursor + slice.length,
      total: shuffled.length,
      seed: seed.toString(),
      done: cursor + slice.length >= shuffled.length,
    });
  } catch (err) {
    console.error("[/api/feed] failed:", err);
    return NextResponse.json(
      { error: "Failed to load feed" },
      { status: 500 },
    );
  }
}
