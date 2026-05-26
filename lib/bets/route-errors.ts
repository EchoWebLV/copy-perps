import { NextResponse } from "next/server";

export function marketDataErrorResponse(err: unknown): NextResponse | null {
  if (!/HTTP 429|rate.?limit/i.test(String(err))) return null;
  return NextResponse.json(
    {
      error: "Market data is busy. Retrying shortly.",
      retryable: true,
      retryAfterMs: 5000,
    },
    { status: 409 },
  );
}
