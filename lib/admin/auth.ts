// lib/admin/auth.ts
//
// Dev-only gate for the bot admin console at /admin/bots. The whole subtree
// (pages + APIs) 404s in production. To enable in prod later, swap this for
// a Privy-auth + email allowlist check.

export function isAdminEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}
