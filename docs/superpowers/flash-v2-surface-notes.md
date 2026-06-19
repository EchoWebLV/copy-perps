# Flash Trade v2 — confirmed integration surface (Task 0)

REST base: `https://flashapi.trade/v2` (public, no API key).

Sources cross-checked:
- Typed client `flash-trade/examples-v2` → `packages/flash-v2/src/{client,types,lifecycle}.ts` (raw.githubusercontent.com, `main`)
- `flash-trade/examples-v2` → `GOTCHAS.md`, `README.md`
- Docs: `docs.flash.trade/.../flash-trade-v2/{transactionflow,managepositions,apireference}.md`

## Confirmed unsigned-tx response field

**`transactionBase64`** — confirmed by all three source classes (typed `types.ts`, `GOTCHAS.md`, and `transactionflow.md`: *"Each returns `{ "transactionBase64": "…" }`"*). It is a base64 **v0 `VersionedTransaction`** that comes back **partially signed** by the server's signer slots; the client adds only its own signature and never touches the blockhash. On `OpenPositionResponse` / `ClosePositionResponse` it is typed `transactionBase64?: string | null` (nullable — `open-position` with no `owner` is preview-only and returns `null`).

NOT `transaction`. The spec §4 assumption (`transactionBase64`) is **correct**.

## Confirmed onboarding-state detection

The wallet snapshot (`GET /v2/owner/{owner}`, response type `BasketSnapshot` / `MbBasketSnapshotDto`) carries **`basketPubkey?: string | null`**. `basketPubkey == null` ⇒ un-onboarded wallet that still needs the lifecycle sequence. There is also a sibling `basketData?: string | null`. The spec §4 assumption (onboarding via `basketPubkey`) is **correct**, but see the path divergence below.

## Endpoint table

| Endpoint | Method | Request fields | Response: tx field | Response: quote / other fields |
|---|---|---|---|---|
| `/transaction-builder/init-basket` | POST | `owner` | `transactionBase64` | — (TxOnlyResponse) |
| `/transaction-builder/init-deposit-ledger` | POST | `owner` | `transactionBase64` | — (TxOnlyResponse) |
| `/transaction-builder/delegate-basket` | POST | `payer`, `owner` | `transactionBase64` | — (TxOnlyResponse) |
| `/transaction-builder/deposit-direct` | POST | `owner`, `tokenMint`, `amount` | `transactionBase64` | — (TxOnlyResponse) |
| `/transaction-builder/open-position` | POST | `inputTokenSymbol`, `outputTokenSymbol`, `inputAmountUi`, `leverage`, `tradeType`, `orderType?`, `limitPrice?`, `takeProfit?`, `stopLoss?`, `owner?`, `slippagePercentage?`, `signer?`, `sessionToken?` | `transactionBase64?` (nullable) | `youPayUsdUi`, `youRecieveUsdUi` (sic), `newEntryPrice`, `entryFee`, `newLiquidationPrice`, `marginFeePercentage`, `takeProfitQuote?`, `stopLossQuote?`; swap fields (`swapInPriceUi?`, `swapOutPriceUi?`, `swapFeeUsdUi?`) always `null` on v2 |
| `/transaction-builder/close-position` | POST | `marketSymbol`, `side`, `inputUsdUi`, `withdrawTokenSymbol`, `owner`, `slippagePercentage?`, `signer?`, `sessionToken?` | `transactionBase64?` | `receiveTokenAmountUi`, `receiveTokenSymbol`, `settledPnl` |
| `/owner/{owner}` | GET | — (path param) | n/a | `basketPubkey?`, `basketData?`, `positionMetrics: Record<string,PositionMetrics>`, `orderMetrics: Record<string,OrderMetrics>`; per-position `marketSymbol`, `sideUi`, `sizeUsdUi`, `entryPriceUi`, `collateralUsdUi`, `pnlWithFeeUsdUi`, `pnlPercentageWithFee`, `liquidationPriceUi`, `leverageUi` |
| `/prices` | GET | — | n/a | `Record<symbol, PriceInfo>`; `PriceInfo` = `price`, `exponent`, `confidence`, `priceUi`, `timestampUs`, `marketSession` |
| `/raw/markets` | GET | — | n/a | `RawAccount[]`; `RawAccount` = `{ pubkey: string, account }` |

Related endpoints seen in the client (not required by Task 0, noted for later tasks): `/transaction-builder/reverse-position`, `/transaction-builder/{add,remove}-collateral`, `/transaction-builder/{request,execute}-withdrawal`, `/transaction-builder/place-tp-sl`, `/prices/{symbol}`, `/raw/markets/{pubkey}`, plus a health endpoint (`health.accounts.baskets`). Full surface is the 36-endpoint `openapi.v2.json` in the repo root.

## Lifecycle ordering (chain-enforced, API does not validate)

`init-basket → init-deposit-ledger → delegate-basket → deposit(-direct) → trade(open/close) → withdraw`.
Setup + funding + withdrawal land on the **base chain**; trading + the `owner` snapshot live on the **Ephemeral Rollup** post-delegation. Some build endpoints require existing on-chain state (the client flags these `expectErrorOnFreshOwner: true`).

## Error-handling gotcha (load-bearing for later tasks)

Trading endpoints can return **HTTP 200 with an error in the body** — always check an `err` field on the response even on a 200 (`GOTCHAS.md` / `llms.txt`: *"trading endpoints 'succeed' with an error in the body — always check `err`"*).

## Divergences from spec §4

1. **Positions snapshot path.** Spec §4 assumes `GET /positions/owner/{wallet}`. The actual confirmed path is **`GET /v2/owner/{owner}`** (typed client `client.ts`, `apireference.md`). There is no `/positions/owner/...` route. **Update the spec/integration to `/owner/{owner}`.**
2. **Open-position body — extra required-ish fields.** Spec §4 body `{owner, inputTokenSymbol, outputTokenSymbol, inputAmountUi, leverage, tradeType, orderType}` matches, but the real type also exposes `slippagePercentage?`, `limitPrice?`, `takeProfit?`, `stopLoss?`, `signer?`, `sessionToken?`. `owner` is **optional** — omitting it makes the call a free preview that returns `transactionBase64: null` with the quote still populated. `orderType` is optional in the type.
3. **Close-position body shape (AMBIGUITY).** The typed client (`ClosePositionRequest`) uses `{ marketSymbol, side, inputUsdUi, withdrawTokenSymbol, owner, slippagePercentage? }` — there is **no** `positionKey`. The `managepositions.md` doc page instead describes close fields as `{ positionKey, inputUsdUi, withdrawTokenSymbol, keepLeverageSame? }`. These two sources disagree on whether the position is addressed by `marketSymbol`+`side` or by `positionKey`. Treat the **typed client (`marketSymbol`+`side`)** as the likely-correct shape since it's the executable reference, but **UNCONFIRMED — validate via devnet smoke** which close-position addressing the live API accepts.
4. **Tx field name confirmed, no divergence.** `transactionBase64` (spec §4 assumption) is correct.
5. **Onboarding field confirmed, no divergence** — `basketPubkey` (spec §4 assumption) is correct; only the *path* it lives on differs (see #1).

## Items NOT directly read (and how to close them)

- `client.ts` / `types.ts` / `lifecycle.ts` were read via WebFetch summarization, not byte-for-byte; field spellings (e.g. `youRecieveUsdUi`) are reproduced as reported. Before encoding, **diff against `openapi.v2.json`** (repo root) which is the canonical contract.
- The exact `close-position` request contract (divergence #3) is **UNCONFIRMED — validate via devnet smoke**.
- Whether `open-position` strictly requires `slippagePercentage` (vs. server default) is **UNCONFIRMED — validate via devnet smoke**.
