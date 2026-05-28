import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload jsonb NOT NULL,
      summary jsonb NOT NULL,
      status text NOT NULL DEFAULT 'empty',
      stale_reason text,
      refreshed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const rows = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_snapshots'
    ORDER BY ordinal_position
  `;
  console.log("portfolio_snapshots columns:", rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
