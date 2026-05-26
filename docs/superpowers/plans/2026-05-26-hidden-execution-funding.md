# Hidden Execution Funding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide execution-account funding details from users and sweep wallet USDC into the execution account when a trade needs funding.

**Architecture:** Keep the existing route-driven deposit flow. Extend the funding planner so it can inspect wallet USDC and choose a sweep amount when a deposit is needed. Update client and API copy so users see generic app funding states instead of execution venue details.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Vitest, Solana web3.js, SPL token account balance reads.

---

## File Structure

- Modify `lib/pacifica/deposit.ts`: export a wallet USDC balance helper and use it from deposit transaction construction.
- Modify `lib/bets/funding.ts`: add a user-facing insufficient app funds error and sweep wallet USDC when a trade-triggered top-up is needed.
- Modify `lib/bets/funding.test.ts`: add red/green tests for sweep funding and plain insufficient-funds behavior.
- Modify `lib/bets/onboard.ts`: keep onboarding using a broad initial deposit by using the existing minimum function for first setup.
- Modify `app/api/bet/bot/route.ts`, `app/api/bet/copy/route.ts`, and `app/api/bet/whale/route.ts`: translate funding errors to generic user copy.
- Modify `components/tail/TailModal.tsx` and `components/tail/tail-settling-retry.ts`: replace visible execution venue wording in the trade flow.

### Task 1: Funding Planner Tests

**Files:**
- Modify: `lib/bets/funding.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests proving that `planPacificaDepositTopUp` sweeps wallet USDC when a deposit is needed and returns a user-facing insufficient-funds error when wallet USDC cannot satisfy the minimum deposit.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/bets/funding.test.ts`

Expected: FAIL because the wallet balance helper and new error do not exist yet.

### Task 2: Funding Planner Implementation

**Files:**
- Modify: `lib/pacifica/deposit.ts`
- Modify: `lib/bets/funding.ts`

- [ ] **Step 1: Export wallet USDC balance helper**

Expose the existing ATA balance read as `getWalletUsdcBalance(userPubkey: PublicKey): Promise<number>`.

- [ ] **Step 2: Add plain insufficient-funds error**

Add `InsufficientAppFundsError` with a user-facing message that does not mention Pacifica.

- [ ] **Step 3: Sweep wallet USDC on needed top-up**

When `topUpUsdc > 0`, read wallet USDC. If wallet USDC is at least the minimum deposit, use wallet USDC as the deposit amount. Otherwise throw `InsufficientAppFundsError`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/bets/funding.test.ts`

Expected: PASS.

### Task 3: User-Facing Copy

**Files:**
- Modify: `app/api/bet/bot/route.ts`
- Modify: `app/api/bet/copy/route.ts`
- Modify: `app/api/bet/whale/route.ts`
- Modify: `components/tail/TailModal.tsx`
- Modify: `components/tail/tail-settling-retry.ts`

- [ ] **Step 1: Route error translation**

Catch `InsufficientAppFundsError` in each trade route and return its plain message with HTTP 400. Replace visible rate-limit and funding-check messages with generic app funding copy.

- [ ] **Step 2: Modal state copy**

Replace visible `Pacifica` status copy with generic account/trade funding states.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

### Task 4: Verification and Commit

**Files:**
- All modified files above.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- lib/bets/funding.test.ts lib/bets/bot-route.test.ts lib/bets/whale-route.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Review diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors, only intended files modified.

- [ ] **Step 4: Commit**

Stage only the spec, plan, and touched implementation/test files. Commit with message `feat: hide execution funding details`.
