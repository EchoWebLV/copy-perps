import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  pulseComments,
  pulseReactions,
  users,
} from "@/lib/db/schema";
import {
  buildPublicUserProfile,
  type PublicUserProfile,
} from "@/lib/users/profile";

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
  profile: PublicUserProfile;
  body: string;
  createdAt: string;
}

export interface PersistedPulseReactor {
  reaction: PulseSocialReaction;
  profile: PublicUserProfile;
}

export interface PulseSocialRecord {
  reactionCounts: Record<PulseSocialReaction, number>;
  commentsCount: number;
  myReaction: PulseSocialReaction | null;
  comments: PersistedPulseComment[];
  recentReactors: PersistedPulseReactor[];
}

export type PulseSocialByPosition = Record<string, PulseSocialRecord>;

const MAX_COMMENT_LENGTH = 280;
const COMMENT_LIMIT_PER_POSITION = 3;
const RECENT_REACTOR_LIMIT_PER_POSITION = 3;

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
    recentReactors: [],
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

  const recentReactionRows = await db
    .select({
      positionId: pulseReactions.positionId,
      reaction: pulseReactions.reaction,
      userId: users.id,
      privyId: users.privyId,
      solanaPubkey: users.solanaPubkey,
      displayName: users.displayName,
      handle: users.handle,
      avatarSeed: users.avatarSeed,
      updatedAt: pulseReactions.updatedAt,
    })
    .from(pulseReactions)
    .innerJoin(users, eq(users.id, pulseReactions.userId))
    .where(inArray(pulseReactions.positionId, positionIds))
    .orderBy(desc(pulseReactions.updatedAt))
    .limit(positionIds.length * RECENT_REACTOR_LIMIT_PER_POSITION * 2);

  const seenReactorsByPosition = new Map<string, number>();
  for (const row of recentReactionRows) {
    const seen = seenReactorsByPosition.get(row.positionId) ?? 0;
    if (seen >= RECENT_REACTOR_LIMIT_PER_POSITION) continue;
    const record = social[row.positionId];
    const reaction = normalizePulseReaction(row.reaction);
    if (!record || !reaction) continue;
    record.recentReactors.push({
      reaction,
      profile: profileFromRow(row),
    });
    seenReactorsByPosition.set(row.positionId, seen + 1);
  }

  const commentRows = await db
    .select({
      id: pulseComments.id,
      positionId: pulseComments.positionId,
      userId: users.id,
      privyId: users.privyId,
      solanaPubkey: users.solanaPubkey,
      displayName: users.displayName,
      handle: users.handle,
      avatarSeed: users.avatarSeed,
      body: pulseComments.body,
      createdAt: pulseComments.createdAt,
    })
    .from(pulseComments)
    .innerJoin(users, eq(users.id, pulseComments.userId))
    .where(inArray(pulseComments.positionId, positionIds))
    .orderBy(desc(pulseComments.createdAt))
    .limit(positionIds.length * COMMENT_LIMIT_PER_POSITION * 2);

  const seenByPosition = new Map<string, number>();
  for (const row of commentRows) {
    const seen = seenByPosition.get(row.positionId) ?? 0;
    if (seen >= COMMENT_LIMIT_PER_POSITION) continue;
    const record = social[row.positionId];
    if (!record) continue;
    const profile = profileFromRow(row);
    record.comments.push({
      id: row.id,
      positionId: row.positionId,
      author: profile.displayName,
      profile,
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
  const profileRow = await getUserProfileRow(args.userId);
  const profile = profileRow
    ? profileFromRow(profileRow)
    : buildPublicUserProfile({ id: args.userId });
  return {
    id: row.id,
    positionId: row.positionId,
    author: profile.displayName,
    profile,
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

function profileFromRow(row: {
  userId: string;
  privyId: string;
  solanaPubkey: string | null;
  displayName: string | null;
  handle: string | null;
  avatarSeed: string | null;
}): PublicUserProfile {
  return buildPublicUserProfile({
    id: row.userId,
    privyId: row.privyId,
    solanaPubkey: row.solanaPubkey,
    displayName: row.displayName,
    handle: row.handle,
    avatarSeed: row.avatarSeed,
  });
}

async function getUserProfileRow(userId: string): Promise<{
  userId: string;
  privyId: string;
  solanaPubkey: string | null;
  displayName: string | null;
  handle: string | null;
  avatarSeed: string | null;
} | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      userId: users.id,
      privyId: users.privyId,
      solanaPubkey: users.solanaPubkey,
      displayName: users.displayName,
      handle: users.handle,
      avatarSeed: users.avatarSeed,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

async function getDb() {
  const mod = await import("@/lib/db");
  return mod.db;
}
