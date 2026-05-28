# Flash Degen Scalp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Flash Degen Mode to the manual Scalp screen so users can open BTC, ETH, and SOL positions at up to 500x.

**Architecture:** Keep copy trading on the existing standard Flash leverage path. Add an explicit `mode` value to manual Flash open requests, validate Degen leverage separately, and pass that mode into the Flash service so it uses SDK `degenMinLev` and `degenMaxLev` limits.

**Tech Stack:** Next.js App Router route handlers, React client component, Vitest, `flash-sdk`.

---

### Task 1: Flash Leverage Contracts

**Files:**
- Modify: `lib/flash/markets.ts`
- Modify: `lib/flash/markets.test.ts`
- Modify: `lib/flash/flash-perp-route.test.ts`

- [x] Add tests proving standard copy leverage remains 100x while scalp Degen leverage exposes 125x to 500x.
- [x] Add route test proving `/api/flash/perp` accepts `mode: "degen"` with `500x` and passes it to `getFlashPerpsService().open`.
- [x] Run `npm test -- lib/flash/markets.test.ts lib/flash/flash-perp-route.test.ts` and verify the new tests fail before implementation.

### Task 2: API And Service Support

**Files:**
- Modify: `app/api/flash/perp/route.ts`
- Modify: `lib/flash/perps.ts`
- Modify: `lib/flash/markets.ts`

- [x] Add a `FlashTradeMode` type with `"standard"` and `"degen"`.
- [x] Validate standard leverage as `1x` to `100x`.
- [x] Validate Degen leverage as `125x` to `500x`.
- [x] In `FlashPerpsService.open`, use `market.degenMinLev` and `market.degenMaxLev` when `mode` is `"degen"`, otherwise use `market.maxLev`.
- [x] Run the targeted Flash tests and verify they pass.

### Task 3: Scalp UI

**Files:**
- Modify: `components/trade/FastPerpsGame.tsx`
- Modify: `components/trade/flash-perps-game-contract.test.ts`

- [x] Add a contract test proving the Scalp UI posts `mode` and exposes `125`, `250`, and `500`.
- [x] Default Scalp to Degen Mode at `500x`.
- [x] Add a compact Standard/Degen segmented control in the leverage panel.
- [x] Use standard buttons `20x / 50x / 100x` and Degen buttons `125x / 250x / 500x`.
- [x] Include leverage in the open button label.
- [x] Run the targeted component contract test and verify it passes.

### Task 4: Verification And Commit

**Files:**
- Review all modified files.

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `git diff --check`.
- [x] Smoke check `/trade` in the browser.
- [x] Commit implementation and plan updates.
