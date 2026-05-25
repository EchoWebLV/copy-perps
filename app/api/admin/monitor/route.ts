import { NextResponse } from "next/server";
import { isAdminEnabled } from "@/lib/admin/auth";
import { getMonitorSnapshot } from "@/lib/ops/monitor-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdminEnabled()) return new NextResponse("Not found", { status: 404 });

  try {
    return NextResponse.json(await getMonitorSnapshot());
  } catch (err) {
    return NextResponse.json(
      { error: `monitor unavailable: ${String(err)}` },
      { status: 502 },
    );
  }
}
