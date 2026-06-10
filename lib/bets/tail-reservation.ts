import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const DEFAULT_TTL_SECONDS = 60;

async function ensureTailReservationTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tail_reservations (
      user_id uuid NOT NULL,
      market text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, market)
    )
  `);
}

export async function reserveTailOnMarket(
  userId: string,
  market: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<boolean> {
  await ensureTailReservationTable();
  const result = await db.execute<{ user_id: string }>(sql`
    INSERT INTO tail_reservations (user_id, market, expires_at)
    VALUES (${userId}, ${market}, now() + (${ttlSeconds}::text || ' seconds')::interval)
    ON CONFLICT (user_id, market) DO UPDATE
      SET expires_at = EXCLUDED.expires_at,
          created_at = now()
      WHERE tail_reservations.expires_at < now()
    RETURNING user_id
  `);

  return result.length > 0;
}

export async function releaseTailReservation(
  userId: string,
  market: string,
): Promise<void> {
  await ensureTailReservationTable();
  await db.execute(sql`
    DELETE FROM tail_reservations
    WHERE user_id = ${userId}
      AND market = ${market}
  `);
}

export async function blockTailReservation(
  userId: string,
  market: string,
): Promise<void> {
  await ensureTailReservationTable();
  await db.execute(sql`
    INSERT INTO tail_reservations (user_id, market, expires_at)
    VALUES (${userId}, ${market}, 'infinity'::timestamptz)
    ON CONFLICT (user_id, market) DO UPDATE
      SET expires_at = 'infinity'::timestamptz,
          created_at = now()
  `);
}
