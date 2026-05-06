# Landing Waitlist — Design

**Date:** 2026-05-06
**Status:** Draft
**Owner:** @YordanLV

## Problem

The landing page (`app/page.tsx`) currently shows a 2-day countdown to launch, with login buttons hidden behind `SHOW_LOGIN = false`. While the countdown runs, visitors have no way to express interest. We want to capture emails so we can blast a launch announcement when gwak.gg goes live.

## Scope

**In scope**
- A waitlist email input on the landing page, visible only while the countdown is running.
- Server-side validation + spam protection.
- Persistent storage of submitted emails (Postgres).
- Inline success state ("You're on the list").

**Out of scope**
- Sending a confirmation email to the submitter.
- Admin UI for browsing the list (read straight from the DB via `npm run db:studio`).
- Allowlist gating of the actual app (logins are still controlled by `SHOW_LOGIN` and Privy — emails on the waitlist do **not** affect login eligibility).
- Unsubscribe flow (we'll handle this when we set up the launch email blast, not now).

## User flow

1. Visitor lands on `/` while the countdown is still running.
2. Below the countdown, they see an email input + a "Get on the list" button.
3. They type an email and submit.
4. The form posts to `/api/waitlist` with the email + a Vercel BotID token.
5. On success: the input/button is replaced inline by the text **"You're on the list ✓"**.
6. On validation error: a small red error line appears under the input; the input stays editable.
7. On bot rejection: same generic error line — no leak about why.

When the countdown reaches zero (`remaining.reached === true`), the waitlist form is no longer rendered; the page goes back to its existing "Launching now" / login flow per `SHOW_LOGIN`.

## Architecture

### 1. Spam protection — Vercel BotID

We use **Vercel BotID** (GA, June 2025) — invisible bot detection, no checkbox, free.

How the pieces fit together (per the official BotID docs):

- **Rewrites:** wrap `next.config.ts` with `withBotId()` from `botid/next/config`. This adds the proxy rewrites BotID needs so ad-blockers don't break it.
- **Client:** since this repo runs Next.js 16, we use the recommended path — call `initBotId({ protect: [{ path: '/api/waitlist', method: 'POST' }] })` in `instrumentation-client.ts`. The BotID client transparently attaches verification headers to outbound `fetch` calls that match a protected path, so `WaitlistForm` does **not** need to handle a token.
- **Server:** `/api/waitlist/route.ts` calls `await checkBotId()` from `botid/server` with no arguments — it reads the headers off the incoming request. If `verification.isBot` is true, return `403`.

If BotID causes false positives in practice we can swap to Cloudflare Turnstile later — most of the change would be contained to the route handler.

### 2. Database

New `waitlist` table in `lib/db/schema.ts`:

```ts
export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- `email` is **lowercased and trimmed** by the API before insert, so the unique constraint doesn't get fooled by `Foo@Bar.com` vs `foo@bar.com`.
- Apply with `npm run db:push` (drizzle-kit push) — same workflow as every other schema change in this repo.

No relation to the `users` table. Waitlist signups are anonymous; if/when one of these emails later becomes a Privy user, no linking is required.

### 3. API route — `POST /api/waitlist`

File: `app/api/waitlist/route.ts`. `runtime: "nodejs"`, no auth (public).

**Request body**
```json
{ "email": "user@example.com" }
```
The BotID verification is carried in headers attached automatically by the client init script — not in the body.

**Validation pipeline (server-side, in this order)**
1. `await checkBotId()`. If `verification.isBot` → `403 { error: "bot_check_failed" }`.
2. Body parse. If JSON is malformed → `400 { error: "invalid_body" }`.
3. Email shape: trim, lowercase, regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`, length ≤ 254. If fails → `400 { error: "invalid_email" }`.
4. Insert via Drizzle with `.onConflictDoNothing({ target: waitlist.email })`.
5. Return `200 { ok: true }` whether the row was new or a duplicate. Duplicates are not surfaced to the user — same success state either way (avoids leaking which emails are on the list).

(BotID runs first so we never burn a DB roundtrip on bot traffic.)

**Errors**
- DB outages → `500 { error: "server_error" }`. Logged server-side.
- We do not retry on the server. The client may show "try again" on `5xx`.

### 4. UI

**New file:** `components/landing/WaitlistForm.tsx` (client component).

State machine:
- `idle` → input + submit button
- `submitting` → button disabled, shows spinner
- `success` → renders `"You're on the list ✓"` (no way to submit a second time from this view; reload to re-submit)
- `error` → small red error line under the input; input remains editable

Styling matches the existing landing aesthetic:
- Container: `mt-8 flex w-full max-w-sm flex-col items-center gap-3`
- Input: `rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-neutral-500 backdrop-blur-md` — mirrors the countdown cells.
- Button: `rounded-2xl bg-white px-6 py-3 text-base font-bold text-black transition active:scale-[0.97] disabled:opacity-50` — mirrors the (currently hidden) Login button.
- Success text: `mt-8 text-sm font-bold uppercase tracking-[3px] text-[#22c55e]` — mirrors the "Launching now" text, for visual consistency.

**Edits to `app/page.tsx`:**

- Lift the `remaining` state from `Countdown` up into `LandingPage` so one `setInterval` drives both the countdown render and the waitlist-form gating. `Countdown` becomes a presentational component that takes `remaining` as a prop.
- `LandingPage` renders `<WaitlistForm />` as a sibling to `<Countdown />`, **only when `!remaining.reached && !SHOW_LOGIN`**.
- The existing `SHOW_LOGIN`-gated branches (Loading / Log in / Enter) stay as-is so flipping `SHOW_LOGIN = true` post-launch still works without further changes.
- `LAUNCH_AT_MS` stays where it is in `app/page.tsx` — it's only consumed inside that file.

### 5. Client init wiring

We add `instrumentation-client.ts` at the project root with a single `initBotId({ protect: [...] })` call listing `/api/waitlist`. Next.js 16 picks this file up automatically — no edits to `app/layout.tsx` are required.

### 6. Project config

Wrap the existing `next.config.ts` export with `withBotId(...)` from `botid/next/config`. That's the only build-time config change; `vercel.json` is unchanged.

## Data flow (happy path)

```
User types email
  → WaitlistForm calls fetch('/api/waitlist', { method: 'POST', body: { email } })
  → BotID client (registered via initBotId) auto-attaches verification headers
  → server: checkBotId() → parse body → validate email shape → drizzle insert (onConflictDoNothing)
  → 200 { ok: true }
  → client transitions to "success" state
```

## Error handling

| Failure | Server response | Client display |
|---|---|---|
| Malformed JSON | 400 `invalid_body` | "Something went wrong, try again." |
| Bad email shape | 400 `invalid_email` | "That email doesn't look right." |
| BotID rejects | 403 `bot_check_failed` | "Something went wrong, try again." (no bot leak) |
| DB / unknown | 500 `server_error` | "Something went wrong, try again." |
| Duplicate email | 200 `ok` | "You're on the list ✓" (treated as success) |

## File changes

| File | Change |
|---|---|
| `lib/db/schema.ts` | Add `waitlist` table |
| `app/api/waitlist/route.ts` | **New** — POST handler |
| `components/landing/WaitlistForm.tsx` | **New** — client component |
| `app/page.tsx` | Lift `remaining` state into `LandingPage`; render `<WaitlistForm />` while countdown is running |
| `instrumentation-client.ts` | **New** — `initBotId({ protect: [{ path: '/api/waitlist', method: 'POST' }] })` |
| `next.config.ts` | Wrap export with `withBotId(...)` |
| `package.json` | Add `botid` dependency |
| (DB) | Run `npm run db:push` to create the table |

## Verification

There is no test runner in this repo. Acceptance:

1. `npm run typecheck && npm run lint` clean.
2. `npm run dev` → visit `/` → countdown shows → form below it.
3. Submit a valid email → success state renders inline.
4. Submit a malformed email → red error line appears, input still editable.
5. Submit the same email twice → both attempts show success (no duplicate row in DB; verify with `npm run db:studio`).
6. From a separate terminal (no browser, no BotID headers) `curl -X POST http://localhost:3000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"x@y.com"}'`. Note: per the BotID docs, **local dev returns `isBot: false` by default** — so this call will succeed locally. It's the production deployment that will reject curl. We sanity-check the prod behavior after first deploy.
7. Once countdown logic returns `reached: true` (test by temporarily setting `LAUNCH_AT_MS` to a past timestamp), waitlist form is hidden and the existing flow takes over.
