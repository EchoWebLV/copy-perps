// lib/db/errors.ts
//
// Postgres error-code detection that survives drizzle's wrapping. postgres-js
// raises a PostgresError with the SQLSTATE on `.code`. When the query goes
// through drizzle (db.insert/update/...), drizzle rethrows its own "Failed
// query" error and nests the original PostgresError under `.cause` — so the
// SQLSTATE is no longer at the top level. Callers that only checked the top
// level silently missed real violations (e.g. a duplicate insert fell through
// to a generic 500 instead of a clean 409). Walk the cause chain so the code is
// caught whether the throw came from raw `sql` or from drizzle.

/** True if `err` (or anything in its `.cause` chain) carries SQLSTATE `code`. */
export function hasPgErrorCode(err: unknown, code: string): boolean {
  // Bounded walk — defends against a (pathological) cyclic cause chain.
  for (
    let e: unknown = err, depth = 0;
    e != null && depth < 10;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: unknown }).code === code
    ) {
      return true;
    }
  }
  return false;
}

/** Postgres unique_violation (SQLSTATE 23505), via raw `sql` OR drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  return hasPgErrorCode(err, "23505");
}
