# Hidden Execution Funding Design

## Goal

Users should see one simple trading balance and should not need to understand the split between their app wallet and the execution venue. When a copy trade needs funding, the app should move usable wallet USDC into the execution account behind the existing signing flow, wait for credit, then open the trade.

## Current Problem

The current funding planner deposits only the minimum amount needed for the current trade, subject to the execution venue's $10 minimum deposit. That leaves small wallet balances stranded after the first trade. A user can see enough total money in the app while the next trade fails because the wallet side cannot satisfy another $10 deposit.

Example:

- Wallet USDC: $4.31
- Execution available: $3.97
- App displays available: $8.28
- A $5 trade needs only about $1.03 more execution collateral, but the venue requires a $10 deposit, so the trade fails with a wallet-only balance error.

## Product Behavior

The app will keep the execution venue hidden from normal user copy.

- The trade modal uses generic states: "Preparing account", "Funding trade", "Opening position".
- Funding and settling errors avoid venue names unless the issue is an operator-facing outage log.
- The portfolio can still compute wallet plus execution value internally, but user-facing funding failures should describe the missing app funds plainly.

## Funding Behavior

When a trade route detects insufficient execution available balance:

1. Compute the stake collateral required for the trade.
2. Compute the shortfall against execution available balance.
3. If no shortfall exists, open the order directly.
4. If a shortfall exists, inspect wallet USDC.
5. If wallet USDC is at least the venue's minimum deposit, build a deposit transaction for the wallet's usable USDC balance, not just the shortfall.
6. If wallet USDC is below the minimum deposit, return a plain insufficient-funds error that includes the amount needed to continue.
7. The client signs and submits the deposit, waits for credit, and retries the trade request.

Sweeping the wallet balance on trade-triggered funding prevents small leftovers from causing the next trade to fail. It also keeps funds inside the execution account where future copies can use them directly.

## Boundaries

This design does not add unattended server-side signing for user wallet transfers. The browser still signs the deposit transaction through the existing wallet flow. Background auto-sweep when a user passively receives funds can be added later with a dedicated delegated-signing design.

This design does not promise trades can never fail. External RPC errors, venue credit delays, rate limits, market order failures, and genuine insufficient funds remain possible. The app should make those failures understandable and avoid exposing implementation details.

## Tests

Add funding planner tests for these cases:

- When execution available is below the stake and wallet USDC is above the minimum, the planner builds a deposit using the wallet USDC balance instead of only the $10 minimum.
- When execution available is below the stake and wallet USDC is below the minimum, the planner returns a plain insufficient-funds error.
- Existing behavior still skips deposits when execution available already covers the selected stake.

Client copy changes should be verified with typecheck and targeted tests for the touched funding code.
