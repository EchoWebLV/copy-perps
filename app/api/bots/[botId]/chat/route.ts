// app/api/bots/[botId]/chat/route.ts
//
// POST  send a message to the bot, get a reply. Rate-limited per user.
// GET   list this user's chat history with this bot, oldest → newest.

import { NextResponse } from "next/server";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { botChats, bots, paperPositions } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { chatWithBot } from "@/lib/bots/chat";
import { getMarksSnapshot } from "@/lib/data/marks";
import { computeLivePaperPnlPct } from "@/lib/bots/paper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 40;
const RATE_LIMIT_PER_HOUR = 30;
const MAX_USER_MSG_CHARS = 500;

interface Params {
  params: Promise<{ botId: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { botId } = await params;
  const user = await ensureUser(claims.userId, null);

  const rows = await db
    .select({
      id: botChats.id,
      role: botChats.role,
      content: botChats.content,
      createdAt: botChats.createdAt,
    })
    .from(botChats)
    .where(and(eq(botChats.userId, user.id), eq(botChats.botId, botId)))
    .orderBy(desc(botChats.createdAt))
    .limit(HISTORY_LIMIT);

  // Return ASC for the UI (oldest first).
  rows.reverse();
  return NextResponse.json({ messages: rows });
}

export async function POST(request: Request, { params }: Params) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { botId } = await params;
  const user = await ensureUser(claims.userId, null);

  const body = (await request.json().catch(() => null)) as {
    message?: string;
  } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > MAX_USER_MSG_CHARS) {
    return NextResponse.json(
      { error: `message too long (max ${MAX_USER_MSG_CHARS} chars)` },
      { status: 400 },
    );
  }

  // Rate limit: count user messages in last hour.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentRows = await db
    .select({ id: botChats.id })
    .from(botChats)
    .where(
      and(
        eq(botChats.userId, user.id),
        eq(botChats.role, "user"),
        gt(botChats.createdAt, oneHourAgo),
      ),
    );
  if (recentRows.length >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      {
        error: `rate limited: max ${RATE_LIMIT_PER_HOUR} messages per hour. Try again later.`,
      },
      { status: 429 },
    );
  }

  // Load bot + its open positions for context.
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) {
    return NextResponse.json({ error: "bot not found" }, { status: 404 });
  }
  const openRows = await db
    .select()
    .from(paperPositions)
    .where(
      and(eq(paperPositions.botId, botId), eq(paperPositions.status, "open")),
    );

  const marks = await getMarksSnapshot();
  const positions = openRows.map((r) => {
    const currentMark = marks.get(r.asset) ?? r.entryMark;
    const stakePnlPct = computeLivePaperPnlPct({
      side: r.side as "long" | "short",
      leverage: r.leverage,
      entryMark: r.entryMark,
      currentMark,
      asset: r.asset,
      stakeUsd: r.stakeUsd,
    });
    return {
      asset: r.asset,
      side: r.side as "long" | "short",
      leverage: r.leverage,
      entryMark: r.entryMark,
      currentMark,
      stakePnlPct,
      stakeUsd: r.stakeUsd,
    };
  });

  // Load chat history (last N messages, ASC for the LLM).
  const historyRows = await db
    .select({ role: botChats.role, content: botChats.content })
    .from(botChats)
    .where(and(eq(botChats.userId, user.id), eq(botChats.botId, botId)))
    .orderBy(asc(botChats.createdAt))
    .limit(HISTORY_LIMIT);
  const history = historyRows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));

  let reply: string;
  try {
    reply = await chatWithBot({
      personaKey: bot.personaVoiceKey,
      positions,
      history,
      userMessage: message,
      bankrollUsd: bot.balanceUsd,
    });
  } catch (err) {
    console.error(`[bot-chat] xAI failed for ${bot.id}:`, err);
    return NextResponse.json(
      { error: "chat backend unavailable, try again in a moment" },
      { status: 503 },
    );
  }
  if (!reply) {
    return NextResponse.json(
      { error: "empty reply from model" },
      { status: 502 },
    );
  }

  // Persist both turns atomically-enough. If the assistant insert fails the
  // user message will still be there — acceptable; client can retry.
  await db.insert(botChats).values([
    { userId: user.id, botId, role: "user", content: message },
    { userId: user.id, botId, role: "assistant", content: reply },
  ]);

  return NextResponse.json({ reply });
}
