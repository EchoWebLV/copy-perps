import { describe, expect, it } from "vitest";
import { hasPgErrorCode, isUniqueViolation } from "./errors";

/** The shape drizzle rethrows: a wrapper Error with the PostgresError nested
 *  under `.cause` (the code lives there, NOT at the top level). */
function drizzleWrapped(code: string): Error {
  const pgError = Object.assign(new Error("duplicate key value"), { code });
  return Object.assign(new Error("Failed query: insert into ..."), {
    cause: pgError,
  });
}

describe("isUniqueViolation", () => {
  it("matches a raw postgres-js error (code at top level)", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("matches a drizzle-wrapped error (code under .cause)", () => {
    // This is the case the old top-level-only check missed: a real db.insert()
    // unique violation fell through to a generic 500 instead of a clean 409.
    expect(isUniqueViolation(drizzleWrapped("23505"))).toBe(true);
  });

  it("does NOT match a different SQLSTATE", () => {
    expect(isUniqueViolation(drizzleWrapped("23503"))).toBe(false); // FK violation
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "42P01" }))).toBe(false);
  });

  it("is safe on non-errors", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
});

describe("hasPgErrorCode", () => {
  it("walks a multi-level cause chain", () => {
    const deep = Object.assign(new Error("outer"), {
      cause: Object.assign(new Error("mid"), {
        cause: Object.assign(new Error("inner"), { code: "40001" }),
      }),
    });
    expect(hasPgErrorCode(deep, "40001")).toBe(true);
    expect(hasPgErrorCode(deep, "23505")).toBe(false);
  });

  it("terminates on a cyclic cause chain", () => {
    const a: { cause?: unknown; code?: string } = { code: "x" };
    const b: { cause?: unknown } = { cause: a };
    a.cause = b; // cycle
    expect(hasPgErrorCode(a, "23505")).toBe(false); // returns, does not hang
  });
});
