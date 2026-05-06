// One-shot: create the waitlist table directly. We bypass drizzle-kit push
// because it tries to enforce a pre-existing FK (bets.signal_id -> signals.id)
// that historical data violates — out of scope for the waitlist change.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS "waitlist" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "waitlist_email_unique" UNIQUE ("email")
  )
`;

console.log("waitlist table ready");
