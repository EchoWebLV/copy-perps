# Finish Real-Money Tailing — Implementation Plan

> **For agentic workers:** Execute task-by-task. Verify with
> `npm run typecheck 2>&1 | grep "error TS" | grep -v "^\.next"` (empty = pass)
> and `npm run build` after each task. No mainnet calls in verification.

**Goal:** Make the real-money tailing loop completable end-to-end — withdraw,
realized PnL, auto-close, durable onboarding, live PnL.

**Context:** Real-money tailing is ~70% built. The open path works (real
Pacifica orders signed by a server-held agent wallet; `TailModal` wired into
the feed + live pages). A verified audit (2026-05-17) found 4 holes that block
the loop end-to-end, plus 1 missing UX piece.

## Verified Pacifica facts (from docs.pacifica.fi + pacifica-fi/python-sdk)

- **Signed requests:** canonical JSON `{type,timestamp,expiry_window,data:payload}`,
  Ed25519, base58 sig. Implemented in `lib/pacifica/sign.ts`; posted via
  `postSigned(path, signed)` in `lib/pacifica/client.ts` (body =
  `{account,signature,timestamp,expiry_window,...payload, agent_wallet?}`).
- **Withdraw:** `POST /api/v1/account/withdraw`. Signature `type: "withdraw"`.
  Payload `{ amount: "<USDC decimal string>" }`. Optional `agent_wallet` field
  ⇒ **the agent wallet may sign it.** No destination field — funds return to
  the account owner's wallet on-chain. Structurally identical to
  `placeMarketOrder`. (The `type` string is inferred from the SDK naming
  convention — `create_market_order`, `update_leverage`, `bind_agent_wallet`;
  there is no `withdraw.py` example. Confirm against the live API on first call;
  a wrong type yields a clear signature error.)
- **Realized PnL:** `getPositionsHistory(account, limit)` → rows with
  `order_id`, `pnl` (realized PnL of that fill, decimal string), `fee`. Group
  rows by `order_id`, sum `pnl`.
- **Withdrawable balance:** `getAccountInfo(account).available_to_withdraw`.

## Build order

4 (schema) → 1 → 2 → 5 → 3. Task 2 depends on Task 1's helper.

---

### Task 1 — Record realized PnL on tail close

**Files:**
- Create: `lib/bets/copy-pnl.ts`
- Modify: `app/api/bet/copy/close/route.ts`

**Approach:** New helper `realizedProceedsForOrder({ mainPubkey, orderId, stakeUsdc })`:
calls `getPositionsHistory(mainPubkey, 100)`, filters rows where
`String(order_id) === orderId`, sums `pnl` minus `fee` → `realizedPnl`, returns
`proceedsUsdc = stakeUsdc + realizedPnl`. Pacifica history can lag the close
fill by ~1s — retry up to 3× with a 1s gap until matching rows appear. If still
none, return `null` (caller leaves `proceedsUsdc` null rather than writing a
fabricated value). In `bet/copy/close`, after `closeCopyOrder` succeeds, call
the helper and include `proceedsUsdc` in the `bets` row update.

**Verify:** typecheck + build. The close route's update sets `proceedsUsdc`.

---

### Task 2 — Auto-close a tail when its bot exits

**Files:**
- Modify: `lib/bets/mirror-close.ts`
- Modify: `lib/bots/resolver.ts` (the `tick()` loop)
- Modify: `lib/bots/ticker.ts` (stale comment on line ~11)

**Approach:** `runMirrorCloseSweep()` already exists and is correct (closes
bot-followers and leader-followers). It has zero callers. Wire it:
- In `closeFollowerBet` (mirror-close.ts), on a successful close also (a) write
  `proceedsUsdc` via the Task 1 helper, and (b) merge `leaderClosedAt:
  <ISO now>` into the existing `bets.meta` JSON so the portfolio "leader exited"
  banner can fire.
- In `tick()` (resolver.ts), after the per-bot evaluation, `await
  runMirrorCloseSweep()` inside a `try/catch` so a sweep failure cannot abort
  the tick. The sweep early-returns when there are no open `copy` bets, so the
  per-tick cost is one cheap DB query in the common case.
- Fix the stale comment in `ticker.ts` that claims mirror-close fires inside
  `tick()` — it will, once this task lands; update it to describe reality.

**Verify:** typecheck + build. Confirm `runMirrorCloseSweep` is imported and
awaited in `tick()`.

---

### Task 3 — Live unrealized PnL on open tails

**Files:**
- Modify: `app/api/portfolio/route.ts`
- Modify: `components/portfolio/CopyRow.tsx` (only if PnL is computed client-side)

**Approach:** `portfolio/route.ts` already fetches the user's live Pacifica
positions then discards them (`void livePos`). Stop discarding: match each open
copy bet to its live position by `(symbol, side)`. `PacificaPosition` exposes
`entry_price` + `amount` but not computed PnL, so return `entryPrice`, `amount`,
and `side` on the copy row and compute `unrealizedPnlPct` in `CopyRow` from the
existing live mark (`lib/pacifica/live-context.tsx` `useLiveMark`):
`pnl = (mark - entry) * amount * dir`, `pct = pnl / stakeUsdc * 100`. If a
client-side mark is not readily available in `CopyRow`, compute server-side
from the marks pipeline instead. Decide when reading the files.

**Verify:** typecheck + build. `unrealizedPnlPct` is no longer hardcoded null.

---

### Task 4 — Durable onboarding (kill the in-process seed Map)

**Files:**
- Modify: `lib/db/schema.ts` (`agentWallets.boundAt` → nullable)
- Modify: `lib/wallets/agent.ts`
- Modify: `lib/bets/onboard.ts`
- Run: `npm run db:push`

**Approach:** Today `planOnboarding` stashes the agent seed in an in-process
`Map` (`pendingAgentSeeds`); a restart or a second instance between plan and
bind orphans the Pacifica bind (bound but never persisted) and double-deposits
on retry. Fix: persist the agent wallet to its DB row **before** the bind.
- `agentWallets.boundAt` becomes nullable — `null` = generated & seed stored,
  not yet bound on Pacifica.
- `planOnboarding`: generate keypair, encrypt seed, INSERT the `agent_wallets`
  row with `boundAt: null`. On retry, reuse an existing unbound row instead of
  minting a second agent. Delete the `pendingAgentSeeds` Map.
- `finalizeAgentBind`: stamp `boundAt = now()`.
- `getAgentWallet` returns only rows with `boundAt` set (bound wallets);
  add a lookup that also sees unbound rows for the re-onboard path.

**Verify:** `npm run db:push` applies cleanly; typecheck + build; the
`pendingAgentSeeds` Map is gone.

---

### Task 5 — Pacifica vault withdraw

**Files:**
- Create: `lib/pacifica/withdraw.ts`
- Create: `app/api/withdraw/pacifica/route.ts`
- Modify: a UI surface (portfolio page or `app/(app)/deposit` settings page) to
  add a "Withdraw" action.

**Approach:** Mirror `closeCopyOrder`.
- `lib/pacifica/withdraw.ts`: `requestWithdraw({ agent, amountUsdc })` —
  `signSolanaMessage({type:"withdraw",timestamp,expiry_window:5000}, {amount},
  agent.agentPubkey, agent.agentSecretKey)` then `postSigned("/account/withdraw",
  {account: agent.mainPubkey, agentWallet: agent.agentPubkey, ...signed})`.
  Also export `getWithdrawable(mainPubkey)` wrapping
  `getAccountInfo().available_to_withdraw`.
- `app/api/withdraw/pacifica/route.ts`: verify Privy, load the user's agent
  wallet, validate `amount` ≤ `available_to_withdraw`, call `requestWithdraw`.
  (Leave the existing `app/api/withdraw/route.ts` untouched — it is the legacy
  main-wallet USDC transfer.)
- UI: a Withdraw button + amount input that shows `available_to_withdraw` and
  POSTs to the new route. No wallet signing modal needed — the agent signs
  server-side; funds return to the user's own wallet.

**Verify:** typecheck + build. Manual: a small withdraw against the live API
returns a success envelope (confirms the `type: "withdraw"` string).

---

## Done criteria

A real user can: log in → onboard (agent wallet persists before bind) → tail a
bot (real order) → see the tail with live PnL → have it auto-close when the bot
exits, with realized PnL recorded → withdraw funds out of Pacifica.
