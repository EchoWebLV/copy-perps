import { NextResponse } from "next/server";

import { buildPythHermesStreamUrl } from "@/lib/flash/live-prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.PYTH_HERMES_API_KEY ?? process.env.PYTH_API_KEY;
  const headers: HeadersInit = {
    Accept: "text/event-stream",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const upstream = await fetch(
    buildPythHermesStreamUrl(process.env.PYTH_HERMES_URL),
    {
      cache: "no-store",
      headers,
    },
  );

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Could not connect to Pyth Hermes price stream." },
      { status: upstream.status || 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
