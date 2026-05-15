import { streamText } from "ai";
import { xai } from "@ai-sdk/xai";
import { verifyPrivyRequest } from "@/lib/privy/server";
import type { Signal, MemeSignal, PredictionSignal, WhaleSignal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Direct xAI provider (uses XAI_API_KEY from env). Grok 4.3 is the
// current flagship — fast, capable, 1M context. The 4.20 family was
// retired on 2026-05-15.
const MODEL_ID = "grok-4.3";

const SYSTEM = `You are a sharp, no-fluff crypto/markets analyst writing for a degen trader on a TikTok-style mobile app. Be direct, specific, and conversational. No corporate language, no hedging-by-default disclaimers. 3-4 short paragraphs max. Use specific numbers from the data given. Call out what's bullish, what's bearish, and what would change your mind. Never give financial advice — give signal.`;

function buildPrompt(signal: Signal): string {
  if (signal.type === "meme") {
    const m = signal as MemeSignal;
    return [
      `Analyze this Solana SPL token: ${m.ticker} (${m.name}).`,
      `Contract address: ${m.tokenAddress}`,
      `Current price: $${m.price ?? "?"}`,
      `Market cap: ${m.marketCap ? `$${m.marketCap.toLocaleString()}` : "unknown"}`,
      `24h change: ${m.change24hPct?.toFixed(2) ?? "?"}%`,
      ``,
      `What's happening with this token right now? Why is it trending? Should the user tail this or sit on their hands?`,
    ].join("\n");
  }
  if (signal.type === "prediction" || signal.type === "multiprediction") {
    const p = signal as PredictionSignal;
    const yesCents = Math.round((p.yesProbability ?? 0) * 100);
    return [
      `Analyze this prediction market: "${p.question}"`,
      `Current YES price: ${yesCents}¢ (NO: ${100 - yesCents}¢)`,
      `Resolves: ${p.resolveDate}`,
      `24h volume: $${p.volume24h?.toLocaleString() ?? "?"}`,
      ``,
      `What's driving the current price? What recent news or event(s) make this market interesting? Is YES at ${yesCents}¢ a good buy, a fade, or already efficient?`,
    ].join("\n");
  }
  if (signal.type === "whale") {
    const w = signal as WhaleSignal;
    const ageMs = Date.now() - new Date(w.openedAt).getTime();
    const ageMin = Math.round(ageMs / 60_000);
    return [
      `Analyze this whale perp position on Hyperliquid:`,
      `Wallet: ${w.walletAddress} (account value $${w.walletAccountValue.toLocaleString()})`,
      `Position: ${w.asset} ${w.leverage}× ${w.side.toUpperCase()}`,
      `Size: $${w.size.toLocaleString()}`,
      `Entry: $${w.entry}`,
      `Liquidation: $${w.liquidation}`,
      `Opened: ${ageMin < 60 ? `${ageMin}m ago` : `${(ageMin / 60).toFixed(1)}h ago`}`,
      ``,
      `Is this a smart-money signal? What's the broader context for ${w.asset} right now? Should the user tail (same direction) or fade (opposite)?`,
    ].join("\n");
  }
  return `Analyze this signal: ${JSON.stringify(signal)}`;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signal?: Signal;
  } | null;
  if (!body?.signal) {
    return new Response("signal required", { status: 400 });
  }

  const result = streamText({
    model: xai(MODEL_ID),
    system: SYSTEM,
    prompt: buildPrompt(body.signal),
    onError({ error }) {
      console.error("[analyze] stream error", error);
    },
  });

  return result.toTextStreamResponse();
}
