// Shared logic for the invite-code wall. Imported by both the Edge middleware
// and the Node API route, so it sticks to Web-standard APIs (crypto.subtle,
// TextEncoder) available in both runtimes.

const DEFAULT_INVITE_CODE = "gwakgwak";

export const INVITE_COOKIE_NAME = "gwak_invite";
// ~1 year.
export const INVITE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The active invite code: `INVITE_CODE` env var, else the default `gwakgwak`. */
export function getInviteCode(): string {
  const fromEnv = process.env.INVITE_CODE?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_INVITE_CODE;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidInviteCode(input: string | null | undefined): boolean {
  if (!input) return false;
  return normalize(input) === normalize(getInviteCode());
}

/**
 * Opaque cookie value proving the code was entered: the SHA-256 hex of the
 * current code. Not the raw code (so it isn't readable) and not a guessable
 * marker like `1`. Middleware admits a request iff its cookie equals this.
 */
export async function inviteCookieToken(): Promise<string> {
  const data = new TextEncoder().encode(getInviteCode());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ALLOWLIST_EXACT = new Set(["/invite", "/api/invite", "/api/health"]);
const ALLOWLIST_PREFIXES = ["/_next", "/api/cron", "/invite"];

/**
 * Whether a path should sit behind the invite wall. Everything is gated except
 * the invite screen + its API, the Railway healthcheck, cron triggers, Next
 * internals, and any path with a file extension (static assets).
 */
export function isGatedPath(pathname: string): boolean {
  if (ALLOWLIST_EXACT.has(pathname)) return false;
  if (
    ALLOWLIST_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return false;
  }
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return false;
  return true;
}
