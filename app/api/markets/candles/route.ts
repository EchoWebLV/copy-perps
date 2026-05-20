import { NextResponse } from "next/server";
import { getCandles, type Timeframe } from "@/lib/data/candles";

const TIMEFRAMES = new Set<Timeframe>(["1m", "5m", "15m", "1h", "4h", "1d"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = (url.searchParams.get("asset") ?? "").trim().toUpperCase();
  const timeframeParam = url.searchParams.get("timeframe") ?? "1m";
  const countParam = Number(url.searchParams.get("count") ?? "90");

  if (!/^[A-Z0-9]{2,12}$/.test(asset)) {
    return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
  }
  if (!TIMEFRAMES.has(timeframeParam as Timeframe)) {
    return NextResponse.json({ error: "Invalid timeframe" }, { status: 400 });
  }

  const count = Math.max(20, Math.min(180, Number.isFinite(countParam) ? countParam : 90));
  const candles = await getCandles(asset, timeframeParam as Timeframe, count);

  return NextResponse.json(
    { candles },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
