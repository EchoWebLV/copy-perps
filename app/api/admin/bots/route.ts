// app/api/admin/bots/route.ts
//
// POST endpoint for cloning a bot variant. Picks the parent's strategy
// family, derives a new id from the requested name, inserts a row, and
// registers the strategy in the in-memory registry so the resolver picks
// it up on the next tick. Dev-only.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdminEnabled } from "@/lib/admin/auth";
import { registerBotDynamic } from "@/lib/bots";
import { STRATEGY_FAMILIES } from "@/lib/bots/wiring";
import type { BotConfig } from "@/lib/bots/types";

interface CloneBody {
  parentId: string;
  name: string;
  avatarEmoji: string;
  family: string;
  config: Record<string, unknown>;
  startingBalanceUsd?: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const KNOWN_FAMILIES = new Set(STRATEGY_FAMILIES.map((f) => f.family));

export async function POST(req: Request) {
  if (!isAdminEnabled()) return new NextResponse("Not found", { status: 404 });

  const body = (await req.json().catch(() => null)) as Partial<CloneBody> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const emoji = typeof body.avatarEmoji === "string" ? body.avatarEmoji.trim() : "";
  const family = typeof body.family === "string" ? body.family : "";
  const parentId = typeof body.parentId === "string" ? body.parentId : "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!emoji) {
    return NextResponse.json({ error: "avatarEmoji is required" }, { status: 400 });
  }
  if (!KNOWN_FAMILIES.has(family)) {
    return NextResponse.json(
      { error: `unknown strategy family: ${family}` },
      { status: 400 },
    );
  }

  // Verify the parent exists.
  const [parent] = await db.select().from(bots).where(eq(bots.id, parentId)).limit(1);
  if (!parent) {
    return NextResponse.json({ error: "parent bot not found" }, { status: 404 });
  }

  const newId = slugify(name);
  if (!newId) {
    return NextResponse.json({ error: "name produces empty slug" }, { status: 400 });
  }
  if (newId === parentId || KNOWN_FAMILIES.has(newId)) {
    return NextResponse.json(
      { error: "id collides with a headliner family — pick a different name" },
      { status: 400 },
    );
  }

  // Reject collisions early.
  const [existing] = await db.select().from(bots).where(eq(bots.id, newId)).limit(1);
  if (existing) {
    return NextResponse.json(
      { error: `bot id ${newId} already exists` },
      { status: 409 },
    );
  }

  // The new bot's strategyKey is `${family}-${suffix}` so wiring.familyOf
  // can resolve it back to the right factory. We use the slug minus the
  // family prefix as the suffix; if the slug doesn't start with the
  // family, we prepend it.
  const strategyKey = newId.startsWith(`${family}-`)
    ? newId
    : `${family}-${newId}`;

  const config = body.config && typeof body.config === "object" ? body.config : {};
  const startingBalanceUsd =
    typeof body.startingBalanceUsd === "number" &&
    Number.isFinite(body.startingBalanceUsd) &&
    body.startingBalanceUsd > 0
      ? body.startingBalanceUsd
      : 1000;

  const [inserted] = await db
    .insert(bots)
    .values({
      id: newId,
      parentId: parentId,
      name,
      avatarEmoji: emoji,
      personaVoiceKey: parent.personaVoiceKey,
      strategyKey,
      config,
      status: "paper",
      balanceUsd: startingBalanceUsd,
      startingBalanceUsd,
    })
    .returning();

  // Register in the runtime registry. If this fails the row is still in
  // the DB; the next admin page render will retry via syncDbBotsToRegistry.
  const cfg: BotConfig = {
    id: inserted.id,
    parentId: inserted.parentId,
    name: inserted.name,
    avatarEmoji: inserted.avatarEmoji,
    personaVoiceKey: inserted.personaVoiceKey,
    strategyKey: inserted.strategyKey,
    config: (inserted.config as Record<string, unknown>) ?? {},
    status: inserted.status as BotConfig["status"],
  };
  registerBotDynamic(cfg);

  return NextResponse.json({ ok: true, id: inserted.id });
}
