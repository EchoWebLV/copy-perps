import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS watchlist_items (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signal_id text NOT NULL,
      signal_type text NOT NULL,
      payload jsonb NOT NULL,
      added_at timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, signal_id)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS watchlist_user_idx
      ON watchlist_items (user_id, added_at)
  `);
  console.log("OK: watchlist_items table ready");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
