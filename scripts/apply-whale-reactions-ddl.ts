import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

// Additive-only: creates whale_reactions (whale-level Bullish/Bearish
// sentiment) + its indexes. NEVER alters/drops any existing table.
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS whale_reactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      whale_id text NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction text NOT NULL CHECK (reaction IN ('Bullish', 'Bearish')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS whale_reactions_whale_user_idx
      ON whale_reactions(whale_id, user_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS whale_reactions_whale_reaction_idx
      ON whale_reactions(whale_id, reaction)
  `;

  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('whale_reactions', 'users')
    ORDER BY table_name
  `;
  console.log("verify (new table + sentinel):", rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
