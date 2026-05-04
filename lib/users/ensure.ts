import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function ensureUser(privyId: string, solanaPubkey: string | null) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.privyId, privyId))
    .limit(1);

  if (existing[0]) {
    if (solanaPubkey && existing[0].solanaPubkey !== solanaPubkey) {
      const [updated] = await db
        .update(users)
        .set({ solanaPubkey })
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
  return created;
}
