// app/api/admin/bots/[id]/route.ts
//
// PATCH endpoint for editing a single bot. Updates allowed fields on the
// `bots` row and re-registers the strategy in the in-memory registry so the
// next resolver tick picks up new config knobs. Dev-only.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdminEnabled } from "@/lib/admin/auth";
import { reregisterBotDynamic } from "@/lib/bots";
import { familyOf } from "@/lib/bots/wiring";
import type { BotConfig } from "@/lib/bots/types";

interface Params {
  params: Promise<{ id: string }>;
}

const STATUS_VALUES = new Set([
  "paper",
  "retired",
  "backtest-fail",
  "live",
  "busted",
]);

export async function PATCH(req: Request, { params }: Params) {
  if (!isAdminEnabled()) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Field-level allowlist. We deliberately don't accept strategyKey or
  // parentId here — those should only change via the clone flow.
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.avatarEmoji === "string") {
    patch.avatarEmoji = body.avatarEmoji.trim();
  }
  if (typeof body.personaVoiceKey === "string") {
    patch.personaVoiceKey = body.personaVoiceKey.trim();
  }
  if (typeof body.status === "string") {
    if (!STATUS_VALUES.has(body.status)) {
      return NextResponse.json(
        { error: `invalid status: ${body.status}` },
        { status: 400 },
      );
    }
    patch.status = body.status;
  }
  if (body.config && typeof body.config === "object" && !Array.isArray(body.config)) {
    patch.config = body.config;
  }
  if (typeof body.balanceUsd === "number" && Number.isFinite(body.balanceUsd)) {
    patch.balanceUsd = body.balanceUsd;
  }
  if (
    typeof body.startingBalanceUsd === "number" &&
    Number.isFinite(body.startingBalanceUsd) &&
    body.startingBalanceUsd > 0
  ) {
    patch.startingBalanceUsd = body.startingBalanceUsd;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no recognized fields" }, { status: 400 });
  }

  const [updated] = await db
    .update(bots)
    .set(patch)
    .where(eq(bots.id, id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "bot not found" }, { status: 404 });
  }

  // Re-instantiate the strategy in the registry whenever the edit could
  // affect runtime behavior (config knobs or strategyKey-bound state).
  // Safe to always do it — reregisterBotDynamic overwrites the BOTS +
  // STRATEGIES entries so the next resolver tick uses the latest values.
  if (familyOf(updated.strategyKey)) {
    const cfg: BotConfig = {
      id: updated.id,
      parentId: updated.parentId,
      name: updated.name,
      avatarEmoji: updated.avatarEmoji,
      personaVoiceKey: updated.personaVoiceKey,
      strategyKey: updated.strategyKey,
      config: (updated.config as Record<string, unknown>) ?? {},
      status: updated.status as BotConfig["status"],
    };
    reregisterBotDynamic(cfg);
  }

  return NextResponse.json({ ok: true, bot: updated });
}
