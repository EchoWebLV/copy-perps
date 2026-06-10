#!/usr/bin/env bash
#
# One-shot Neon -> Railway Postgres data migration (the cutover).
#
# SAFETY MODEL:
#   * READ-ONLY against Neon (pg_dump only).
#   * Writes ONLY into a FRESH, EMPTY Railway database (aborts otherwise).
#   * Never drops Neon, never edits your app config, never flips DATABASE_URL.
#   * Verifies every table's row count matches before declaring success.
#
# PREREQS (do these first):
#   1. Provision Railway Postgres, then export its connection string:
#        export RAILWAY_DATABASE_URL='postgresql://...@...railway...:5432/railway'
#   2. Freeze writes during the cutover so nothing races the dump. Either run
#      in a quiet window, or set DISABLE_WHALE_TICKER=true on the Railway app
#      (the bot ticker is already gone). The whale ticker is the only writer.
#   3. Local pg_dump/psql must be >= the Neon server's major version.
#
# USAGE:
#   export RAILWAY_DATABASE_URL='postgresql://...'
#   bash scripts/migrate-neon-to-railway.sh
#
# AFTER it prints "All tables match":
#   - Point the Railway app's DATABASE_URL at RAILWAY_DATABASE_URL and redeploy.
#   - Keep Neon untouched for a few days as a rollback, THEN delete it.
#
set -euo pipefail

# --- Source (Neon): prefer the DIRECT/unpooled endpoint; pg_dump needs a real
#     session, not the transaction pooler. ---
NEON_URL="${DATABASE_URL_UNPOOLED:-}"
if [[ -z "${NEON_URL}" && -f .env.local ]]; then
  NEON_URL="$(grep -E '^DATABASE_URL_UNPOOLED=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'' || true)"
  [[ -z "${NEON_URL}" ]] && NEON_URL="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
[[ -z "${NEON_URL}" ]] && { echo "ERROR: could not resolve a Neon URL (DATABASE_URL_UNPOOLED / .env.local)"; exit 1; }

: "${RAILWAY_DATABASE_URL:?Set RAILWAY_DATABASE_URL to the new Railway Postgres connection string}"

echo "==> Tooling versions"
pg_dump --version
psql --version

# --- Guard: refuse to write into a non-empty Railway DB ---
echo "==> Checking the Railway target is empty"
EXISTING="$(psql "${RAILWAY_DATABASE_URL}" -At -c \
  "select count(*) from pg_tables where schemaname='public'")"
if [[ "${EXISTING}" != "0" ]]; then
  echo "ERROR: Railway target already has ${EXISTING} public table(s). Aborting to avoid clobbering."
  echo "       Point RAILWAY_DATABASE_URL at a fresh database, or drop its tables first."
  exit 1
fi

DUMP="neon-cutover.dump"
echo "==> Dumping Neon (schema + data, custom format) -> ${DUMP}"
pg_dump "${NEON_URL}" -Fc --no-owner --no-acl -f "${DUMP}"
echo "    dump size: $(du -h "${DUMP}" | cut -f1)"

echo "==> Restoring into Railway Postgres"
pg_restore --no-owner --no-acl -d "${RAILWAY_DATABASE_URL}" "${DUMP}"

echo "==> Verifying row counts table-by-table"
TABLES="$(psql "${NEON_URL}" -At -c \
  "select tablename from pg_tables where schemaname='public' order by tablename")"
fail=0
for t in ${TABLES}; do
  a="$(psql "${NEON_URL}" -At -c "select count(*) from \"${t}\"")"
  b="$(psql "${RAILWAY_DATABASE_URL}" -At -c "select count(*) from \"${t}\"")"
  if [[ "${a}" == "${b}" ]]; then
    printf "    ok   %-28s %s rows\n" "${t}" "${a}"
  else
    printf "    DIFF %-28s neon=%s railway=%s\n" "${t}" "${a}" "${b}"
    fail=1
  fi
done

echo
if [[ "${fail}" == "0" ]]; then
  echo "==> All tables match. Safe to flip the Railway app's DATABASE_URL to the new DB and redeploy."
  echo "    (Keep Neon as a rollback for a few days before deleting it.)"
else
  echo "==> MISMATCH found above — do NOT flip DATABASE_URL. Investigate first."
  exit 1
fi
