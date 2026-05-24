import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  pulseComments,
  pulseReactions,
} from "@/lib/db/schema";

export const PULSE_SOCIAL_REACTIONS = [
  "Tailing",
  "Bullish",
  "Bearish",
] as const;

export type PulseSocialReaction = (typeof PULSE_SOCIAL_REACTIONS)[number];
export type PulseUserId = string;

export interface PersistedPulseComment {
  id: string;
  positionId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface PulseSocialRecord {
  reactionCounts: Record<PulseSocialReaction, number>;
  commentsCount: number;
  myReaction: PulseSocialReaction | null;
  comments: PersistedPulseComment[];
}

export type PulseSocialByPosition = Record<string, PulseSocialRecord>;

const MAX_COMMENT_LENGTH = 280;
const COMMENT_LIMIT_PER_POSITION = 3;

export function normalizePulseReaction(
  value: unknown,
): PulseSocialReaction | null {
  return PULSE_SOCIAL_REACTIONS.includes(value as PulseSocialReaction)
    ? (value as PulseSocialReaction)
    : null;
}

export function normalizePulseCommentBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  if (body.length === 0 || body.length > MAX_COMMENT_LENGTH) return null;
  return body;
}

export function emptyPulseSocialRecord(): PulseSocialRecord {
  return {
    reactionCounts: {
      Tailing: 0,
      Bullish: 0,
      Bearish: 0,
    },
    commentsCount: 0,
    myReaction: null,
    comments: [],
  };
}

export async function getPulseSocial(args: {
  positionIds: string[];
  userId?: PulseUserId | null;
}): Promise<PulseSocialByPosition> {
  const db = await getDb();
  const positionIds = uniquePositionIds(args.positionIds);
  const social = Object.fromEntries(
    positionIds.map((positionId) => [positionId, emptyPulseSocialRecord()]),
  ) as PulseSocialByPosition;
  if (positionIds.length === 0) return social;

  const reactionRows = await db
    .select({
      positionId: pulseReactions.positionId,
      reaction: pulseReactions.reaction,
      n: count(),
    })
    .from(pulseReactions)
    .where(inArray(pulseReactions.positionId, positionIds))
    .groupBy(pulseReactions.positionId, pulseReactions.reaction);

  for (const row of reactionRows) {
    const reaction = normalizePulseReaction(row.reaction);
    if (!reaction) continue;
    const record = social[row.positionId];
    if (record) record.reactionCounts[reaction] = Number(row.n);
  }

  const commentCountRows = await db
    .select({
      positionId: pulseComments.positionId,
      n: count(),
    })
    .from(pulseComments)
    .where(inArray(pulseComments.positionId, positionIds))
    .groupBy(pulseComments.positionId);

  for (const row of commentCountRows) {
    const record = social[row.positionId];
    if (record) record.commentsCount = Number(row.n);
  }

  if (args.userId) {
    const mine = await db
      .select({
        positionId: pulseReactions.positionId,
        reaction: pulseReactions.reaction,
      })
      .from(pulseReactions)
      .where(
        and(
          eq(pulseReactions.userId, args.userId),
          inArray(pulseReactions.positionId, positionIds),
        ),
      );

    for (const row of mine) {
      const record = social[row.positionId];
      if (record) record.myReaction = normalizePulseReaction(row.reaction);
    }
  }

  const commentRows = await db
    .select({
      id: pulseComments.id,
      positionId: pulseComments.positionId,
      userId: pulseComments.userId,
      body: pulseComments.body,
      createdAt: pulseComments.createdAt,
    })
    .from(pulseComments)
    .where(inArray(pulseComments.positionId, positionIds))
    .orderBy(desc(pulseComments.createdAt))
    .limit(positionIds.length * COMMENT_LIMIT_PER_POSITION * 2);

  const seenByPosition = new Map<string, number>();
  for (const row of commentRows) {
    const seen = seenByPosition.get(row.positionId) ?? 0;
    if (seen >= COMMENT_LIMIT_PER_POSITION) continue;
    const record = social[row.positionId];
    if (!record) continue;
    record.comments.push({
      id: row.id,
      positionId: row.positionId,
      author: args.userId === row.userId ? "You" : traderAlias(row.userId),
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    });
    seenByPosition.set(row.positionId, seen + 1);
  }

  return social;
}

export async function setPulseReaction(args: {
  positionId: string;
  userId: PulseUserId;
  reaction: PulseSocialReaction | null;
}): Promise<void> {
  const db = await getDb();
  if (!args.reaction) {
    await db
      .delete(pulseReactions)
      .where(
        and(
          eq(pulseReactions.positionId, args.positionId),
          eq(pulseReactions.userId, args.userId),
        ),
      );
    return;
  }

  const now = new Date();
  await db
    .insert(pulseReactions)
    .values({
      positionId: args.positionId,
      userId: args.userId,
      reaction: args.reaction,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [pulseReactions.positionId, pulseReactions.userId],
      set: {
        reaction: args.reaction,
        updatedAt: now,
      },
    });
}

export async function addPulseComment(args: {
  positionId: string;
  userId: PulseUserId;
  body: string;
}): Promise<PersistedPulseComment> {
  const db = await getDb();
  const [row] = await db
    .insert(pulseComments)
    .values({
      positionId: args.positionId,
      userId: args.userId,
      body: args.body,
    })
    .returning({
      id: pulseComments.id,
      positionId: pulseComments.positionId,
      userId: pulseComments.userId,
      body: pulseComments.body,
      createdAt: pulseComments.createdAt,
    });

  if (!row) throw new Error("pulse comment insert failed");
  return {
    id: row.id,
    positionId: row.positionId,
    author: "You",
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

function uniquePositionIds(positionIds: string[]): string[] {
  return [...new Set(positionIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    100,
  );
}

function traderAlias(userId: string): string {
  return `Trader ${userId.replace(/-/g, "").slice(0, 6)}`;
}

async function getDb() {
  const mod = await import("@/lib/db");
  return mod.db;
}
