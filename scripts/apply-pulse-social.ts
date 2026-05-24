import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS pulse_reactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      position_id text NOT NULL REFERENCES whale_positions(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction text NOT NULL CHECK (reaction IN ('Tailing', 'Bullish', 'Bearish')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pulse_reactions_position_user_idx
      ON pulse_reactions(position_id, user_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS pulse_reactions_position_reaction_idx
      ON pulse_reactions(position_id, reaction)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pulse_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      position_id text NOT NULL REFERENCES whale_positions(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS pulse_comments_position_created_idx
      ON pulse_comments(position_id, created_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS pulse_comments_user_created_idx
      ON pulse_comments(user_id, created_at)
  `;

  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('pulse_reactions', 'pulse_comments')
    ORDER BY table_name
  `;
  console.log("pulse social tables:", rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
