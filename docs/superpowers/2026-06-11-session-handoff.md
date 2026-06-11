# Session handoff — 2026-06-11 (flash-tail persistence + Scalp Autopilot)

For the next session: everything below is committed on **`feat/flash-tail-persistence`**
(42 commits on top of `feat/ui-mint`@`a8b8875`). Gates at HEAD: `npm run typecheck`
clean, `npm test` 647/647 (129 files), `npx next build` passes. There is NO lint
script (CLAUDE.md is stale about that, and about much else — trust
[docs/architecture.md](architecture.md)).

## What was built

### 1. Phase 1 — Flash tail persistence (spec Phase 1, plan: [plans/2026-06-11-flash-tail-persistence.md](plans/2026-06-11-flash-tail-persistence.md))

Before: a Flash tail wrote ZERO db rows (betId was a client-side `flash:${sig}` that
died on reload). Now:

- `fills` table + `flash-tail` bets rows with whale/bot lineage
  ([lib/bets/flash-tail-meta.ts](../../lib/bets/flash-tail-meta.ts),
  [lib/bets/flash-tail.ts](../../lib/bets/flash-tail.ts) — CAS confirms).
- `/api/flash/perp` records lineage opens (Scalp path byte-identical, tested);
  confirm postbacks at `/api/flash/perp/confirm` + `/close/confirm`;
  close route resolves the owning betId.
- TailModal sends lineage + confirms; CopyRow confirms closes.
- Portfolio attributes live Flash positions to their bet (name + betId survive
  reload); closed/`closed-external` rows render as history
  ([lib/positions/flash-tail-closed.ts](../../lib/positions/flash-tail-closed.ts)).
- Reconcile sweep ([lib/bets/flash-reconcile.ts](../../lib/bets/flash-reconcile.ts))
  rides the WHALE ticker: verifies sigs on-chain, upgrades quote-estimates to chain
  truth (USDC balance deltas), reverts failed closes, kills failed opens, reaps stale
  pendings, and a liveness pass expires positions closed externally
  (liquidation/trigger/lost postback → `closed-external`).

### 2. Phase 3c — Scalp Autopilot (spec Phase 3c, plan: [plans/2026-06-11-scalp-autopilot.md](plans/2026-06-11-scalp-autopilot.md))

AI trades the USER's own wallet in the Scalp game via the Privy instant stack:

- `lib/autopilot/`: `tiers` (cruise 50x / sweat 150x / degen 500x, $1–10 degen caps),
  `brain` (Blitz 15m momentum port, fail-closed gates), `shell` (budget = absolute
  loss bound, open-stake reservation, tilt guard), `sessions` (CRUD + stats from bets
  rows; one active session per user via partial unique index), `engine`
  (record-before-send, mandatory SL else emergency close, CAS tick claim,
  cross-source stacking guard), `ticker` + lease (third loop, cheap idle,
  `DISABLE_AUTOPILOT_TICKER`).
- `/api/autopilot/session` (POST start / GET status incl. ended sessions / DELETE
  stop — stop does NOT close open positions, documented).
- `AutopilotPanel` + Manual/Autopilot toggle in FastPerpsGame; binding consent copy;
  ended-session banner; manual-trade warning while a session runs.
- Autopilot trades are `flash-tail` bets with `meta.sourceKind:'autopilot'`
  (HTTP forgery rejected) → ALL Phase-1 reconcile/liveness machinery covers them
  free, and they'll flow into the Phase-4 ER receipts journal unchanged.

### DB changes applied to live Neon (additive only)
`fills`, `autopilot_sessions` (+ `autopilot_sessions_one_active_per_user_idx`
partial unique), runtime `autopilot_ticker_lease`. drizzle-kit push hangs without a
TTY — DDL was applied via `npx tsx --env-file=.env.local` + postgres-js (promise
chains, no top-level await).

### Local env (.env.local) — added this session
`NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID` + `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`
(Privy instant trading / Autopilot). No policy IDs yet — signer is UNSCOPED.

## What to do now (in order)

1. **Live verification, Phase 1** (plan Task 10): dev server `npm run dev`
   (`.claude/launch.json` `dev-local` disables tickers — note the reconcile sweep
   then doesn't run; trigger `runFlashReconcileSweep()` manually via tsx). Flow:
   `/feed` → $1 whale tail → bets/fills rows appear → `/portfolio` name survives
   reload → close → reconcile flips `proceedsSource` to `chain`.
2. **Live verification, Autopilot** (plan Task 12): `/trade` → Autopilot toggle →
   $5 Cruise → consent → Start → Privy session-signer modal once → watch
   `[autopilot]` logs. Quiet for hours = normal (needs a real 15m breakout).
   Wallet needs ~$6 USDC; engine does NOT preflight balance.
3. **Merge + deploy**: merge `feat/flash-tail-persistence` → `feat/ui-mint` (→ main
   per repo flow). Deploy is MANUAL: `railway up` (no GitHub auto-deploy). Before
   prod Autopilot works, set in Railway: the two Privy vars above (+ policy id, see
   4). NOTE: prod Railway currently lacks them entirely — prod Scalp "instant mode"
   has been silently unconfigured all along. Also delete orphaned Railway vars
   `SCALP_ER_ENDPOINT` / `SCALP_PROGRAM_ID` (read by nothing, ever).
4. **Privy policy scoping** (binding spec item before real users): create a policy
   in the Privy Dashboard restricting the session signer to the Flash program;
   set `NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS`. Consider rotating the authorization
   key shared in chat this session.
5. **Roadmap next** (spec: [specs/2026-06-11-live-ai-leaders-receipts-design.md](specs/2026-06-11-live-ai-leaders-receipts-design.md)):
   - Phase 2 — Pulse trades live on Flash (restore bot kit from git: resolver/paper
     @ `810f7d1`, Pulse persona @ `369d0ce`; bot_wallets custody; OI signal feed).
   - Phase 3/3b — bot leader cards + position-copy, then subscription tailing.
   - **Phase 4 — ER receipts journal: the DIRECT MagicBlock integration** (delegate
     journal PDA to an ephemeral rollup; in-ER mirror verification; ms tape;
     commits to mainnet). This is the Blitz v6 / Magic Incubator entry artifact.
     MagicBlock today is inherited-only (Flash runs on it); we have written zero
     MagicBlock code.

## Known limitations (documented in architecture.md §7 tail)

- SL-trigger exits book as worst-case full-stake loss until chain-priced (UI says
  "worst-case"); chain-pricing trigger executions is an open follow-up.
- Engine dep calls have no abort timeouts → the 30s tick-claim window assumes a
  single Railway replica.
- The reconcile sweep lives on the WHALE ticker: `DISABLE_WHALE_TICKER=true` +
  autopilot on = no external-close/chain-verify safety net.
- Orphaned-position edge: send succeeds but confirm fails → pending row reaped while
  the position lives (SL/TP still bound it). Grep logs for `confirm failed post-send`.

## Process notes for the next session

- Subagent-driven dev with two-stage reviews caught ~15 real defects across both
  features (several in the plans themselves) — keep the discipline.
- NEVER run `scripts/reset-*.ts` (CLAUDE.md hard rule). DDL = additive only.
- Two background-task chips from this session were completed by parallel sessions
  (external-close liveness + closed-history) and are merged into this branch.
