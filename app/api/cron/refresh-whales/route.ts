import { NextResponse } from "next/server";
import { refreshPacificaWhales } from "@/lib/whales/refresh-pacifica";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await refreshPacificaWhales();
  return NextResponse.json({ ok: true, ...result });
}
