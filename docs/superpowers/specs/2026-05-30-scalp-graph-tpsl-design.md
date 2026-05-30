# Scalp page: live money-line graph + TP/SL trigger orders

**Date:** 2026-05-30
**Status:** Design approved (visual brainstorm), pending spec review
**Topic:** Make the Scalp (Flash perps) page more exciting — graph + utility

## Problem

The Scalp page (`components/trade/FastPerpsGame.tsx`) is the one-tap leveraged
perps game ($1–$50 stake, 100x–500x). Its live graph (`LivePerpGraph`) plots the
position's **value** as a single calm line. It's correct but inert: no sense of
danger, no market context, no reason to lean in. Asked "how do we make it more
exciting," the user prioritised the **graph** and, once we got into it, **TP/SL**
as the first utility to ship.

## Goal & non-goals

**Goal:** Turn the graph into a live, legible "money channel" that conveys
stakes at a glance, and add opt-in take-profit / stop-loss as real Flash trigger
orders — optimised for both mobile and desktop.

**Non-goals (explicitly deferred):**
- Real price candlesticks. At 100x–500x the price move that doubles or liquidates
  you is < 0.5% — invisible on candles, dramatic on a money-line. Value-space is
  the correct metaphor for this product; candles were considered and rejected.
- The other "excitement" axes (UI juice/sound/haptics, streaks/XP, price ticker,
  more markets). Separate future specs.
- Trailing stops, multi-rung TP ladders, partial-size triggers.

## Why value-space, not candles (the core decision)

Price-space and money-space decouple at high leverage. The graph stays in
**money-space** (Y axis = position value in USD). Every meaningful level is a
horizontal line at a value, and value maps linearly from ROI:

```
valueAtRoi(stake, roi) = stake * (1 + roi)
  entry  → roi   0%  → value = stake
  TP     → roi +100% → value = stake * 2.00
  SL     → roi  −50% → value = stake * 0.50
  liq    → roi −100% → value ≈ 0
```

This is why the channel reads instantly and why drawing TP/SL needs no price math
on the chart — only the order placement does.

## Part A — The graph: a money channel

### Visual model

A clean value line living inside a vertical channel, top to bottom:

- **TP ceiling** (green, dashed) — auto take-profit level. Faint green band above.
- **Live value line** (green/red) + soft P/L gradient fill, **pulsing live dot** at
  the tip, current-value tag (e.g. `$1.84 ▲`).
- **Entry baseline** (gray, dashed) at `value = stake`.
- **SL floor** (amber, dashed) — auto stop-out. Faint amber band below.
- **Liquidation death-zone** (red) at the bottom (`value ≈ 0`). Always present.
- **$ value ladder** on the right edge; short role labels (`TP / entry / SL / LIQ`)
  on the left; **BTC mark + 24h%** readout top-left for market context.

### Behaviour

- **Responsive, not shaky.** Drop most of the current smoothing (lerp 0.18) so the
  tip snaps to each Flash mark the instant it arrives — it feels live. Explicitly
  **no jitter/vibration** (the user rejected a shaking treatment). The only motion
  is the soft heartbeat pulse on the live dot (and even that is a toggleable
  constant we can set to still).
- **Tension comes from the walls, not animation.** The closer the line drifts to a
  channel wall, the more loaded it reads; the danger comes from the red floor.

### Default vs configured (TP/SL are opt-in)

- **Default (fresh position):** value line + entry + **liq floor only**. No TP/SL
  lines. The controls render as ghost `+ Add TP` / `+ Add SL` chips. No orders, no
  extra transactions.
- **Configured:** once the user adds a level, its line appears and the chip becomes
  `TP +100% ✕` / `SL −50% ✕`; tapping ✕ cancels the order and the line vanishes.
- **Liq is never optional** — it's inherent to a leveraged position and always
  drawn.

### Responsive layout

The page is already mobile-first (`max-w-md`) with a desktop split
(`lg:grid lg:grid-cols-[minmax(0,1fr)_360px]`).

- **Mobile (one column):** graph is a compact hero. $ ladder compresses
  (`$2.00 / $1.00 / $.50 / $0`). The existing **Stake / Total / P/L** trio sits
  below, then a **TP / SL tap-row**, then the big action button. Setting a level =
  **tap a %** (a small sheet with suggested presets + adjust). Dragging a 1px line
  on a phone is too fiddly.
- **Desktop (graph column + 360px ticket):** the graph gets the full left column to
  breathe; you can **drag the TP/SL lines directly on the chart**, and the ticket
  on the right also exposes TP/SL fields. Order ticket stays pinned at 360px.

### Components / files (Part A)

- `components/trade/FastPerpsGame.tsx` — rewrite `LivePerpGraph` to the channel
  model; add ghost/active TP-SL chips; add mobile tap-sheet + desktop drag
  handles; thread the new trigger state into render. Reuse `graphValue`
  (`selectedPositionView.valueUsd`), `roiPct`, `stakeUsd`, `liquidationMovePct`,
  `entryPriceUsd` from `computeFlashLivePositionView`.
- Extract the channel math (ROI→value, value→Y scale incl. liq at 0 and headroom
  above TP) into a **pure helper module** (e.g. `lib/flash/graph-channel.ts`) so it
  is unit-testable without rendering React.

## Part B — TP/SL as native Flash trigger orders

### Decision: native triggers, no new contract, no watcher

Flash's deployed program already supports stop-loss and take-profit as on-chain
**trigger orders** (verified in `flash-sdk`):

- `PerpetualsClient.placeTriggerOrder(..., isStopLoss)` — `true` = SL, `false` = TP.
- `editTriggerOrder` / `cancelTriggerOrder` / `cancelAllTriggerOrders`.
- `executeTriggerOrder` / `executeTriggerWithSwap` — run by Flash's keepers when the
  oracle crosses the trigger. Self-collateralised Crypto.1 markets settle via the
  swap variant, same as our `closeAndSwap`.
- `getTriggerPriceFromRoiSync(roi, ...)` — converts a target ROI directly into the
  trigger price. The UI works in **% ROI**; this does the price conversion.
- `OrderAccount.takeProfitOrders[] / stopLossOrders[]` — on-chain source of truth.

Because execution is Flash's keepers on-chain, **TP/SL fire even when our app and
server are closed**. We considered an off-chain price-watcher using our session
signer; rejected because native triggers are strictly more robust and need no
infra to babysit.

### What we build

1. **`lib/flash/perps.ts`** — add `buildPlaceTriggerOrderTx` and
   `buildCancelTriggerOrderTx` to `FlashPerpsService`, mirroring the existing
   `swapAndOpen`/`closeAndSwap` build pattern (same `PerpetualsClient`, pool config,
   returns an unsigned tx → `transactionB64`). Add a pure helper that maps user
   `roiPct` → trigger price via `getTriggerPriceFromRoiSync`, with validation
   (TP must be in profit, SL between entry and liq for the side).
2. **`app/api/flash/perp/trigger/route.ts`** — new authed route. `POST` places (or
   replaces) a TP or SL for a position; `DELETE` (or `POST {cancel}`) cancels.
   Returns `transactionB64` for the standard sign-and-send, exactly like open/close.
3. **`app/api/flash/perp/positions/route.ts`** — surface each position's active
   trigger orders (TP/SL price + derived ROI) so the client renders the channel
   lines and chip state from on-chain truth, not local guesses.
4. **Auto-sign via the existing instant path.** When Privy session-signer / TEE
   instant trading is configured (`ensureInstantTrading`, the `requestOpen`/
   `requestClose` instant flow already in `FastPerpsGame.tsx`), adding/removing a
   TP/SL auto-signs with **no wallet prompt** — one tap. When instant trading is
   off, fall back to the user-signed `signAndSendFlashTransaction` + `transactionB64`
   path. Reuse the same `result.phase` plumbing (add `"sent-trigger"` /
   `"sent-trigger-cancel"`).

### Data flow

```
Set TP/SL:
  user taps "+ Add TP" (mobile) / drags line (desktop)
    → pick roi% (preset, adjustable)
    → POST /api/flash/perp/trigger { positionId, kind: "tp"|"sl", roiPct }
      server: roi% → trigger price (getTriggerPriceFromRoiSync)
              → buildPlaceTriggerOrderTx → unsigned tx
    → client: instant auto-sign (or user sign) → send → confirm
    → positions route now reports the active trigger
    → graph draws the line; chip flips to "TP +100% ✕"

Trigger fires (no app needed):
  Flash keeper runs executeTriggerWithSwap when oracle crosses
    → position closes, collateral returns
    → next positions poll shows it closed; graph clears

Cancel:
  tap ✕ → DELETE /api/flash/perp/trigger → cancelTriggerOrder tx → line vanishes
```

## Error handling & edge cases

- **Trigger tx fails:** toast, graph stays in its prior state (no phantom line).
- **Per-position cap (`triggerOrderLimit`):** model as **one TP + one SL** per
  position. Adding a second of the same kind = `editTriggerOrder` (replace), not a
  new order.
- **Invalid level:** validate client-side and server-side — TP must be in profit;
  SL must sit between entry and liq for the side; reject/clamp with a clear message.
- **Instant signer not configured:** fall back to an explicit wallet sign; never
  silently no-op.
- **Not guaranteed exact fills:** triggers are oracle-crossing market exits, subject
  to keeper latency and slippage. Copy says "auto-close near" — never promise an
  exact price.
- **Self-collateral settle:** Crypto.1 is self-collateralised; execution uses the
  swap variant (Flash keeper's job), consistent with our existing close path.

## Testing (TDD)

- **Pure helpers first (unit):** `lib/flash/graph-channel.ts` (ROI↔value, Y scale
  with liq=0 + TP headroom, default-vs-configured line set) and the ROI→trigger
  price + validation helper in `lib/flash/perps.ts`. Red → green for each.
- **Route contract:** `app/api/flash/perp/trigger` — auth required, place/cancel
  shapes, returns `transactionB64`, replace-on-second-of-kind.
- **Client source-contract:** extend
  `components/trade/flash-perps-game-contract.test.ts` (the established grep-the-
  source pattern) for the channel render, ghost `+ Add TP/SL` default state,
  active chip + `✕` cancel, mobile tap-row vs desktop drag, and the instant
  auto-sign `"sent-trigger"` phases.
- **Verification gate:** `npx vitest run` + `npm run typecheck` (no lint script in
  this repo).

## Out of scope / future

UI juice (sound, haptics, count-ups, win/loss flash), streaks/XP/missions,
price-ticker & funding, more markets, trailing stops, TP ladders. Each is its own
spec once this lands.
