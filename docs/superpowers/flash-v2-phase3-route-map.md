# Phase 3 — Current-state + rewire map (Flash v2 migration)

Produced by a read-only mapping sweep (4 cluster readers + synthesis), 2026-06-19. The full
synthesized map (per-route table + lib inventory) is the source for the Phase 3 plan
([plans/2026-06-19-flash-v2-migration-phase-3.md](plans/2026-06-19-flash-v2-migration-phase-3.md)).

## ⚠️ CORRECTION (2026-06-19, after Phase 3 backend landed)

**The mapping sweep below was wrong about the LIVE CLIENT.** It mapped the server routes but did
not verify which rails the UI actually calls. Verified after the fact:

- The live copy / whale / self-directed-perp UI (`components/tail/TailModal.tsx`,
  `components/trade/FastPerpsGame.tsx`) opens through **`/api/flash/perp` (Flash v1)**, creating
  `bet.type='flash-tail'`. The product had already moved opens off Pacifica onto Flash v1.
- **`/api/bet/copy` + `/api/bet/whale` OPEN paths have no live client.** `CopyRow` only calls
  `/api/bet/copy/close` (to wind down legacy Pacifica `type='copy'` positions). So the table row
  "copy = `/api/bet/copy`, Pacifica, active" describes a **dormant** rail.

Consequence: Phase 3 Tasks 4–7 correctly rewired `/api/bet/copy`, `/api/bet/whale`,
`/api/trade/perp`, and the mirror-close sweep to flash-v2 behind the flag — but **flipping
`FEATURE_FLASH_V2` does not change live trades**, because the UI never hits those open routes.

**Chosen direction (user, 2026-06-19): OPTION A — repoint the client to the v2 rails.** The UI
will call `/api/bet/copy` / `/api/bet/whale` / `/api/trade/perp` when the flag is on (else stays on
`/api/flash/perp` Flash v1, unchanged). Requires a client-visible flag
(`NEXT_PUBLIC_FEATURE_FLASH_V2`, kept in sync with the server `FEATURE_FLASH_V2`) and rewriting the
TailModal open orchestration for the v2 response shapes (enable-session / onboard-steps /
server-signed open). FastPerpsGame self-directed needs client-side ER signing (sign-only + submit to
the ER RPC) and lands after the copy/whale repoint.

## Current execution architecture (verified)

**Pacifica is the active execution venue for every money path:**

| Path | Today | file:line |
|---|---|---|
| deposit (`/api/users/me/deposit`) | Pacifica `buildDepositTx`, user-signed, sponsorship OFF | `lib/pacifica/deposit.ts:77`; `components/tail/deposit-signing.ts:72` |
| copy (`/api/bet/copy`+close) | Pacifica `openCopyOrder`/`closeCopyOrder`, agent-signed | `lib/pacifica/orders.ts:12,42` |
| whale (`/api/bet/whale`) | same Pacifica open path | `lib/pacifica/orders.ts:12` |
| trade/perp (`/api/trade/perp`+close) | Pacifica, hardcoded (no flag) | `app/api/trade/perp/route.ts` |
| withdraw (`/api/withdraw/pacifica`) | Pacifica `requestWithdraw` | `lib/pacifica/withdraw.ts:5` |
| portfolio (`/api/portfolio`) | Pacifica positions/account + Flash **v1** `positionsOf` + Pacifica marks | `lib/pacifica/client.ts:92,96`; `lib/flash/perps.ts`; `lib/data/marks.ts` |

**`lib/bets/flash-tail.ts` / `flash-reconcile.ts` = Flash v1 ledger for the separate self-directed
`/api/flash/perp` rail. Zero importers on the copy/whale path.** Copy/whale tails are `bet.type='copy'`
on Pacifica. Phase 3 adds a parallel flash-v2 path; it does NOT touch the v1 flash-tail ledger.

**Privy sponsorship is plumbed but dormant** (`deposit-signing.ts:89`, gated by a `preferSponsored`
no caller sets true).

## The session-enable gap (critical)

The session-key lib is complete (Phase 2), but **no frontend/route creates or confirms a session** —
`grep sessionToken` over `components/`+`app/` finds only `lib/flash-v2/*`. `sessionKeys.bound_at` is
always null. So server-driven copy auto-close (`runMirrorCloseSweep`, `lib/bets/mirror-close.ts:439`)
has **no signer** until a one-time "enable auto-copy" client action ships (`buildCreateSessionTx` →
user signs → `markSessionKeyBound`). This gates the copy auto-close promise and must land before
mirror-close is rewired.

## Decisions (pinning the 10 open questions)

1. **Canonical self-directed flash-v2 entry = `/api/trade/perp`** (per spec §10). `/api/flash/perp`
   stays Flash **v1**, untouched.
2. **Server signer = session key, NOT the agent wallet** (per spec §9). Flash-v2 onboarding does NOT
   mint a Pacifica-style agent wallet; `lib/bets/onboard.ts` flash-v2 branch returns
   `ensureOnboarded` steps + drives session creation.
3. **Session enable flow ships in Phase 3** as a new route (`POST /api/users/me/session`, replacing
   the agent-bind role for flash-v2) + a client "enable" action. Server-driven copy depends on it.
4. **copy-guard keys on `(user, market, venue)`** — a Pacifica tail and a flash-v2 tail may coexist
   on the same market (distinct on-chain positions); guard prevents a second tail *on the same venue*.
5. **Add a distinct `'flash-v2'` venue value** (do not overload v1 `'flash'`) in `bet.meta.venue` and
   `copyRows.venue`, so close-routing can tell v1/v2 apart.
6. **Flash-v2 withdraw is DEFERRED** out of Phase 3 (`venue.ts` has no `withdraw` method; the
   two-phase request→execute shape is unconfirmed). `/api/withdraw/pacifica` stays Pacifica.
7. **Realized PnL for flash-v2 closes = mark-price** via `lib/flash-v2/pnl.ts` + `query.ts` (matches
   the Phase 1 "ignore indexer PnL" decision), NOT `getPositionsHistory`.
8. **Privy sponsorship stays OFF** for flash-v2 base-layer txs (matches current deposit).
9. **New `bet.type='flash-v2-tail'`** (+ parallel meta) for flash-v2 copy/whale tails; the v1
   `flash-tail` ledger is left as-is.
10. **`er`-layer submission**: trades return `UnsignedTx{layer:'er'}`; the client/server submit path
    routes by `layer` (`lib/flash-v2/rpc.ts`). Onboard/deposit/session are `'base'`.

## Branch rule

- `FEATURE_FLASH_V2` gates **opens/onboard/deposit** (inside each handler; default off ⇒ Pacifica).
- Persisted `bet.meta.venue` gates **closes + the mirror-close sweep** (a position opened on a venue
  always closes on that venue; legacy rows with no `venue` ⇒ `'pacifica'`).

## What must keep working flag-off (non-negotiable)

Every `lib/pacifica/*` path stays the executed default; existing open Pacifica positions + `type='copy'`
bets close via the unchanged Pacifica path; `runMirrorCloseSweep` Pacifica auto-close does not regress.
