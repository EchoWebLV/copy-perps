import { NextResponse } from "next/server";
import { getMarketSentimentSnapshot } from "@/lib/data/market-sentiment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MARKETS = ["BTC", "ETH", "SOL", "HYPE", "BNB", "XRP", "DOGE", "AVAX"];
const MAX_MARKETS = 20;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawMarkets = url.searchParams.get("markets");
  const markets = rawMarkets
    ? rawMarkets.split(",").map((value) => value.trim().toUpperCase())
    : DEFAULT_MARKETS;

  if (markets.some((market) => !/^[A-Z0-9]{2,12}$/.test(market))) {
    return NextResponse.json({ error: "Invalid markets" }, { status: 400 });
  }

  const sentiment = await getMarketSentimentSnapshot(markets.slice(0, MAX_MARKETS));
  return NextResponse.json(
    { sentiment },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
