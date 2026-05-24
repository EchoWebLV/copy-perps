import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  const sql = neon(process.env.DATABASE_URL);

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS handle text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed text`;
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `;

  await sql`
    WITH profile_defaults AS (
      SELECT
        id,
        CASE
          WHEN NULLIF(BTRIM(solana_pubkey), '') IS NOT NULL
            THEN 'gwk_' || substring(BTRIM(solana_pubkey) from 1 for 4)
          ELSE 'gwk_' || substring(regexp_replace(id::text, '[^a-zA-Z0-9]', '', 'g') from 1 for 4)
        END AS fallback_handle,
        COALESCE(NULLIF(BTRIM(solana_pubkey), ''), id::text) AS fallback_avatar_seed
      FROM users
    )
    UPDATE users
    SET
      handle = COALESCE(NULLIF(BTRIM(users.handle), ''), profile_defaults.fallback_handle),
      display_name = COALESCE(
        NULLIF(BTRIM(users.display_name), ''),
        NULLIF(BTRIM(users.handle), ''),
        profile_defaults.fallback_handle
      ),
      avatar_seed = COALESCE(
        NULLIF(BTRIM(users.avatar_seed), ''),
        profile_defaults.fallback_avatar_seed
      ),
      updated_at = now()
    FROM profile_defaults
    WHERE users.id = profile_defaults.id
      AND (
        NULLIF(BTRIM(users.handle), '') IS NULL
        OR NULLIF(BTRIM(users.display_name), '') IS NULL
        OR NULLIF(BTRIM(users.avatar_seed), '') IS NULL
      )
  `;

  const rows = await sql`
    SELECT
      COUNT(*)::int AS users,
      COUNT(handle)::int AS handles,
      COUNT(display_name)::int AS display_names,
      COUNT(avatar_seed)::int AS avatar_seeds
    FROM users
  `;
  console.log("user profile columns:", rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
