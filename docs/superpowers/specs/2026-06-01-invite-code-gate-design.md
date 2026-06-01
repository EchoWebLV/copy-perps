# Invite-code gate — design

**Date:** 2026-06-01
**Status:** approved

## Goal

Lock the entire app behind a single shared invite code (`gwakgwak`) for an
invite-only launch. Server-enforced — not bypassable from the client.

## Flow

1. Next.js **middleware** runs on every request and checks the `gwak_invite` cookie.
   - Valid cookie → request proceeds.
   - Missing/invalid → 307 redirect to `/invite`.
2. **`/invite`** is an on-brand (dark / yellow GWAK) screen: one code input + "Enter".
3. Submit → **`POST /api/invite`** validates the code server-side. On match it sets
   the cookie and the client navigates to `/feed`; on miss it shows "wrong code".

## The code

- Read from `INVITE_CODE` env var, **defaulting to `gwakgwak`** so it works with zero
  env setup and can be rotated later via Railway without a code change.
- Compared case-insensitively, trimmed.

## Cookie

- Name `gwak_invite`, value = **SHA-256 hex of the code** (via Web Crypto, available in
  both the Edge middleware runtime and the Node API route) — not a guessable `=1`.
- `HttpOnly`, `Secure`, `SameSite=Lax`, ~1-year `Max-Age`.
- Middleware allows the request iff the cookie value equals `sha256(currentCode)`.

## Allowlist (MUST NOT be gated)

Enforced via the middleware `config.matcher` negative-lookahead:
- `/api/health` — Railway healthcheck; gating it fails every deploy.
- `/_next/*`, `favicon.ico`, `manifest*`, `icons/*`, og/twitter images — else the gate
  screen renders unstyled.
- `/invite` + `/api/invite` — else redirect loop.
- `/api/cron/*` — external triggers (CRON_SECRET-authed) don't carry the cookie.

## Files

| File | Purpose | Tested |
|---|---|---|
| `lib/invite/gate.ts` | pure helpers: `getInviteCode()`, `isValidInviteCode()`, `inviteCookieToken()`, `isGatedPath()` | TDD unit tests |
| `lib/invite/gate.test.ts` | helper tests | — |
| `middleware.ts` | matcher + cookie check + redirect | integration (browser) |
| `app/api/invite/route.ts` | POST validate + set cookie | integration (browser) |
| `app/invite/page.tsx` | the gate screen | integration (browser) |

## Testing

- Unit (vitest, TDD): code validation (right/wrong/whitespace/case), cookie-token
  round-trip, gated-vs-allowlisted path decisions.
- Integration: local browser — hit `/feed` with no cookie → redirected to `/invite`;
  enter `gwakgwak` → land on `/feed`; reload stays in.

## Notes / accepted trade-offs

- Gates the **whole app**, including the currently-public roster — existing share links
  hit the wall. Intended.
- Single shared code; no per-user invites, no usage tracking (YAGNI for launch gate).
