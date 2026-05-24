import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  buildDefaultUserProfileValues,
  buildPublicUserProfile,
} from "@/lib/users/profile";

export async function ensureUser(privyId: string, solanaPubkey: string | null) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.privyId, privyId))
    .limit(1);

  if (existing[0]) {
    const nextSolanaPubkey = solanaPubkey ?? existing[0].solanaPubkey;
    const profile = buildPublicUserProfile({
      ...existing[0],
      solanaPubkey: nextSolanaPubkey,
    });
    const patch: Partial<typeof users.$inferInsert> = {};

    if (solanaPubkey && existing[0].solanaPubkey !== solanaPubkey) {
      patch.solanaPubkey = solanaPubkey;
    }
    if (!existing[0].displayName) patch.displayName = profile.displayName;
    if (!existing[0].handle) patch.handle = profile.handle;
    if (!existing[0].avatarSeed) patch.avatarSeed = profile.avatarSeed;

    if (Object.keys(patch).length > 0) {
      const [updated] = await db
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, existing[0].id))
        .returning();
      return updated;
    }
    return existing[0];
  }

  const [created] = await db
    .insert(users)
    .values({ privyId, solanaPubkey })
    .returning();
  if (!created) throw new Error("user insert failed");

  const profile = buildDefaultUserProfileValues(created);
  const [updated] = await db
    .update(users)
    .set({ ...profile, updatedAt: new Date() })
    .where(eq(users.id, created.id))
    .returning();
  return updated ?? created;
}
