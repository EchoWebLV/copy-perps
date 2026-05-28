import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { portfolioSnapshots } from "@/lib/db/schema";
import {
  buildPortfolioSummary,
  mergePortfolioSnapshotPayload,
  type PortfolioSnapshotMeta,
  type PortfolioSnapshotPayload,
  type PortfolioSnapshotStatus,
  type PortfolioSummary,
} from "@/lib/positions/portfolio-snapshot";

export interface StoredPortfolioSnapshot {
  payload: PortfolioSnapshotPayload;
  summary: PortfolioSummary;
  snapshot: PortfolioSnapshotMeta;
}

function normalizeSnapshotRow(
  row: typeof portfolioSnapshots.$inferSelect,
  source: "cache" | "live" = "cache",
): StoredPortfolioSnapshot {
  return {
    payload: row.payload as PortfolioSnapshotPayload,
    summary: row.summary as PortfolioSummary,
    snapshot: {
      source,
      status: row.status as PortfolioSnapshotStatus,
      updatedAt: row.refreshedAt?.toISOString() ?? null,
      staleReason: row.staleReason,
    },
  };
}

export async function loadPortfolioSnapshotForUser(
  userId: string,
): Promise<StoredPortfolioSnapshot | null> {
  const [row] = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .limit(1);
  return row ? normalizeSnapshotRow(row) : null;
}

export async function savePortfolioSnapshotForUser({
  userId,
  payload,
  status,
  staleReason,
}: {
  userId: string;
  payload: PortfolioSnapshotPayload;
  status: Exclude<PortfolioSnapshotStatus, "empty">;
  staleReason: string | null;
}): Promise<StoredPortfolioSnapshot> {
  const previous = await loadPortfolioSnapshotForUser(userId);
  const mergedPayload = mergePortfolioSnapshotPayload(previous?.payload ?? null, payload, {
    preserveMissingOpenRows: status !== "live",
  });
  const summary = buildPortfolioSummary(mergedPayload);
  const now = new Date();
  const [row] = await db
    .insert(portfolioSnapshots)
    .values({
      userId,
      payload: mergedPayload,
      summary,
      status,
      staleReason,
      refreshedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: portfolioSnapshots.userId,
      set: {
        payload: mergedPayload,
        summary,
        status,
        staleReason,
        refreshedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return normalizeSnapshotRow(row, "live");
}
