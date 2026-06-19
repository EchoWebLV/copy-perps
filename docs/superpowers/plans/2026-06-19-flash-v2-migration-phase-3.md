# Flash v2 Migration — Phase 3: Route rewiring (execution onto the venue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Rewire the production execution routes to the Flash v2 venue behind `FEATURE_FLASH_V2`,
keeping Pacifica as the untouched flag-off default, in the safe order read → self-directed → copy →
server-driven.

**Architecture:** Each handler branches on `FEATURE_FLASH_V2` for opens/onboard/deposit and on the
persisted `bet.meta.venue` for closes/sweeps. The new `lib/flash-v2/venue.ts` is the only execution
surface the routes touch. Decisions + current-state are pinned in
[../flash-v2-phase3-route-map.md](../flash-v2-phase3-route-map.md).

**Tech Stack:** Next.js App Router routes, the Phase 1/2 `lib/flash-v2/*` venue + session libs,
Drizzle, Vitest.

**Hard rule:** When `FEATURE_FLASH_V2 !== 'true'`, every path executes exactly the current Pacifica
code with zero behavior change. Money-moving slices (Tasks 4-7) land green + flag-gated, but should
only be flipped on after the **devnet smokes** (`smoke-lifecycle.ts`, `smoke-session.ts`) pass.

---

## Sequencing (blast-radius ascending)

1. **Task 1 — Portfolio read-only** (no money moves; proves query/marks plumbing).
2. **Task 2 — Deposit + onboarding** (base-layer, user-signed; precondition for trades).
3. **Task 3 — Session enable flow** (the missing piece; unblocks server-driven copy).
4. **Task 4 — trade/perp self-directed** (user-signed open/close; simplest write).
5. **Task 5 — bet/copy + close** (meta.venue; user-signed).
6. **Task 6 — bet/whale** (meta.venue + WhaleCopyMeta.venue).
7. **Task 7 — mirror-close sweep** (server-signed via session; LAST).
8. **Task 8 — Phase 3 verification** (suite + typecheck + adversarial review).

`/api/withdraw/pacifica` is OUT of Phase 3 (decision §6 in the map) — stays Pacifica.

---

### Task 1: Venue resolver + portfolio read-only rewire

**Files:** Create `lib/flash-v2/resolve.ts` (+test); Modify `app/api/portfolio/route.ts`.

- [ ] **Step 1** — `resolve.ts`: a single place routes ask for the venue.

```ts
import { FEATURE_FLASH_V2 } from "./constants";
import { flashV2Venue, type FlashV2Venue } from "./venue";

/** The flash-v2 venue when the flag is on, else null (caller keeps Pacifica). */
export function getFlashV2Venue(): FlashV2Venue | null {
  return FEATURE_FLASH_V2 ? flashV2Venue() : null;
}
```

- [ ] **Step 2 (test)** — with `FEATURE_FLASH_V2` unset, `getFlashV2Venue()` returns null. (Flag is read at import; test via a focused module-reset or assert the null default.)
- [ ] **Step 3** — In `app/api/portfolio/route.ts`, after the Pacifica + Flash-v1 reads, add a flag-gated block: `const v2 = getFlashV2Venue(); if (v2) { const [p, m] = await Promise.all([v2.getPositions(owner).catch(()=>[]), v2.getMarks().catch(()=>({}))]); merge p into positions (tagged venue:'flash-v2'), spread m into the marks map }`. Wrap in try/catch so a flash-v2 read failure never breaks the Pacifica portfolio. Pacifica branch unchanged.
- [ ] **Step 4** — `npx vitest run lib/flash-v2/resolve`; `npx tsc --noEmit | grep flash-v2` empty. Commit.

### Task 2: Deposit + onboarding (flash-v2 branch, base-layer, user-signed)

**Files:** Modify `app/api/users/me/deposit/route.ts`; Create `app/api/users/me/onboard/route.ts` (or extend deposit preflight). Reference: `venue.ensureOnboarded` (`onboard.ts:30`), `venue.deposit`.

- [ ] **Step 1** — Onboarding route: `POST /api/users/me/onboard` → if `getFlashV2Venue()`, return `{ steps: OnboardStep[] }` (init-basket → init-deposit-ledger → delegate-basket, all `layer:'base'`); the client signs each via Privy and submits to base. Idempotent (empty steps when `basketPubkey` already exists).
- [ ] **Step 2** — Deposit route: flag-branch → `v2.deposit({ owner, amountUsdc, tokenMint: FLASH_V2_USDC_MINT })` returns `{ depositTransaction, layer:'base' }`; else current Pacifica `buildDepositTx`. Keep sponsorship off.
- [ ] **Step 3** — Client (`deposit-signing.ts` is venue-agnostic; reuse). For onboarding the client signs the step array in order, base layer.
- [ ] **Step 4** — Tests for the route branch (flag on → calls venue; flag off → Pacifica untouched). Typecheck. Commit.

### Task 3: Session enable flow (unblocks server-driven copy)

**Files:** Create `app/api/users/me/session/route.ts` (POST build + POST confirm), client "enable auto-copy" action. Reference: `buildCreateSessionTx`, `createPendingSessionKey`, `markSessionKeyBound`, `getActiveSessionKey`, `assertSessionReplaceable`.

- [ ] **Step 1** — `POST /api/users/me/session` (build): server generates a session keypair, derives the PDA, `assertSessionReplaceable` (throw 409 if a bound session exists ⇒ client revokes first), `buildCreateSessionTx` (validUntil = now + DEFAULT_SESSION_TTL_SECONDS), `createPendingSessionKey`, return `{ createSessionTransaction, sessionPubkey, sessionToken }`. The tx is already session-co-signed; the client adds the wallet signature.
- [ ] **Step 2** — `POST /api/users/me/session/confirm`: client posts the submitted sig; server confirms on base + `markSessionKeyBound`. (A `POST .../session/revoke` builds `buildRevokeSessionTx` for refresh.)
- [ ] **Step 3** — Client action: "Enable auto-copy" → POST build → Privy sign the base tx → submit base → POST confirm. Surface expiry (`isSessionExpiringSoon`) → prompt re-enable.
- [ ] **Step 4** — Route + store tests (build returns a tx + persists pending; confirm flips bound). Typecheck. Commit.

### Task 4: trade/perp self-directed (user-signed open/close)

**Files:** Modify `app/api/trade/perp/route.ts`, `app/api/trade/perp/close/route.ts`. Decision §1: `/api/trade/perp` is the v2 self-directed entry; `/api/flash/perp` stays v1.

- [ ] **Step 1** — Open: flag-branch → `v2.openPosition({ owner, symbol: market, collateralUsd: stakeUsdc, leverage, side })` → `{ phase:'open', transactionB64, quote, layer:'er' }` (user-signed, no session). Persist a `bet` row with `meta.venue='flash-v2'`. Else Pacifica.
- [ ] **Step 2** — Close: branch on `meta.venue` → `v2.closePosition({ owner, symbol, side })`; PnL via `lib/flash-v2/pnl.ts`. Else Pacifica.
- [ ] **Step 3** — Client submits the `er`-layer tx to the ER RPC (route by `layer`). Tests + typecheck. Commit.

### Task 5: bet/copy + close (user-signed, meta.venue)

**Files:** Modify `app/api/bet/copy/route.ts`, `app/api/bet/copy/close/route.ts`; add `venue` to the copy bet meta (decision §5/§9: `meta.venue='flash-v2'`, optionally `bet.type='flash-v2-tail'`).

- [ ] **Step 1** — Open fork (route ~:210): flag → onboard/deposit branch to venue, open via `v2.openPosition`; persist `meta.venue`. Else Pacifica.
- [ ] **Step 2** — Close: branch on persisted `meta.venue` → `v2.closePosition`; flash-v2 PnL. Legacy/no-venue ⇒ Pacifica.
- [ ] **Step 3** — `copy-guard` keyed on `(user, market, venue)` (decision §4). Tests + typecheck. Commit.

### Task 6: bet/whale (meta.venue + WhaleCopyMeta.venue)

**Files:** Modify `app/api/bet/whale/route.ts`, `lib/bets/whale-meta.ts` (add `venue:'pacifica'|'flash-v2'`, default `'pacifica'`).

- [ ] **Step 1** — Add `venue` to `WhaleCopyMeta` + `buildWhaleCopyMeta`/`parseWhaleCopyMeta`. Pacifica-source whales only (Hyperliquid-source copy is separate). Same open split as copy; reservation (`tail-reservation.ts`) stays venue-agnostic, before the branch.
- [ ] **Step 2** — Tests + typecheck. Commit.

### Task 7: mirror-close sweep (server-signed via session) — LAST

**Files:** Modify `lib/bets/mirror-close.ts` (`closeFollowerBet` branch on `meta.venue`).

- [ ] **Step 1** — When `meta.venue==='flash-v2'`: `getActiveSessionKey(userId)` → if null, log + skip (session expired/not enabled — do NOT fall back to user-signing in a background sweep); else `v2.closePosition({ owner, symbol, side, session: { signer, sessionToken } })`, `signTradeWithSession`, `submitErTx`; write flash-v2 PnL. Pacifica branch unchanged.
- [ ] **Step 2** — Tests (flash-v2 venue close called with session; null-session ⇒ skip not crash). Typecheck. Commit.

### Task 8: Phase 3 verification

- [ ] **Step 1** — `npx vitest run` shows no NEW failures vs the known pre-existing 2; flash-v2 + touched-route tests green.
- [ ] **Step 2** — `npx tsc --noEmit` clean (sans stale `.next` artifact).
- [ ] **Step 3** — Adversarial review (workflow) of the Phase 3 diff: focus on the flag-off Pacifica path being byte-unchanged, close-routing by `meta.venue`, and the mirror-close null-session safety. Fix confirmed findings. Commit.

---

## Self-Review

- **Spec coverage:** implements spec §10 per-route migration (execution onto the venue) + §9 session
  enable; defers withdraw (§6 decision) and Pacifica deletion (Phase 4).
- **Safety:** flag-off path is the unchanged Pacifica code in every task; closes route by persisted
  venue so in-flight positions never strand; mirror-close never user-signs in the background.
- **Devnet gate:** Tasks 4-7 move money; they land flag-gated + green but should be enabled only
  after the devnet smokes validate the venue + session path end to end.
- **Open risk:** the exact request/response contracts of the copy/whale/trade routes are read at
  execution time from the live route code; each task re-confirms the handler shape before editing so
  the flag-off branch stays identical.
