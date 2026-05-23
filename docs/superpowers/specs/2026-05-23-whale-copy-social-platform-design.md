# Whale Copy Social Platform Design

**Date:** 2026-05-23  
**Status:** draft for review  
**Pivot:** Replace the paper-bot-first arena with a social copy-trading platform built around whale traders and their live perp positions.

## Goal

Turn the current paper-bot copy app into a whale-led social copy-trading product.

The feed is no longer primarily bots. It is whales: trader profiles, open positions, live PnL, activity, social proof, and AI context. The sliding live view is a position-by-position stream of open whale trades. Chatter becomes an analysis surface that explains why each whale may have opened a position, what confirms or weakens the thesis, and what risk a follower should understand before tailing.

Users can tail any whale with real money through the existing Pacifica execution stack. When tailing, the user can optionally enable close listening: if the whale closes the source position, the app automatically closes the user's copied position.

## Product Model

### `/feed`: whale roster

`/feed` becomes the social whale roster. Each row or card represents one tracked trader, not an AI bot.

Each whale card should show:

- Display name or derived handle.
- Source venue label, initially Pacifica.
- Current open positions count.
- Best current position preview: market, side, leverage, entry, live PnL.
- Recent performance: realized PnL, win rate, total trades, average hold time.
- Copy status: not tailed, tailing one position, or following with auto-close.
- Trust and freshness signals: last active time, data source, whether the position is still verified live.

Default ranking should prioritize whales with currently open positions, recent activity, and strong recent PnL. Empty or stale whales should fall down the list.

### `/live`: open position slides

`/live` becomes a swipeable stream of open whale positions.

Each slide represents one source position:

- Whale identity.
- Market, side, leverage, entry, current mark, unrealized PnL.
- Position age.
- Size or notional when available.
- AI commentary in plain English.
- Tailing controls: $5, $10, $20, $50, custom stake.
- Close-listening toggle in the tail modal.

The slide should be honest about entry mismatch. The user enters at the current live mark, not the whale's original entry. If the whale is already far in profit or loss, the UI should surface that gap before the user tails.

### `/chatter`: AI position analysis

`/chatter` becomes the analysis stream for currently open whale positions.

This is not just trade narration. It should explain:

- What likely triggered the whale's position.
- Whether the whale appears to be momentum chasing, fading, hedging, adding, or rotating.
- What market context supports the trade.
- What would make the setup weaker.
- Whether the follower is late relative to the whale's entry.
- Whether the whale has a history of fast closes or long holds.

Every analysis item must carry caveats. AI can infer from flow, timing, and market context, but it does not know the whale's intent.

### `/portfolio`: copied positions

The portfolio keeps the current open and closed position model, but the copy rows become whale-centric.

Open copy rows should show:

- Source whale.
- Source position.
- User fill.
- User unrealized PnL.
- Whether auto-close is enabled.
- Whether the whale has already closed.
- Manual close action.

Closed copy rows should show whether the close was manual, auto-closed from whale close, or force-closed by risk guard.

## Source Strategy

V1 uses a staged hybrid source plan.

### V1: Pacifica-native whales

The first reliable version should track Pacifica-native traders and copy them on Pacifica. This keeps source venue and execution venue aligned.

Benefits:

- Close listening can be reliable because the leader and follower are on the same venue.
- Position shape maps cleanly: market, side, amount, entry, and close state.
- The existing Pacifica agent-wallet execution code remains the foundation.
- Fewer cross-venue edge cases.

The initial whale set can be curated manually, then expanded with Pacifica leaderboard and activity discovery.

### V2: Hyperliquid whale signal rail

After V1 works, add Hyperliquid whales as an additional signal rail. These whales can still be copied on Pacifica when the market is supported, but the UI must label them as cross-venue.

Cross-venue constraints:

- The copied trade is a Pacifica approximation, not the original venue position.
- Source leverage may need clamping to Pacifica market limits.
- Close listening depends on polling or streaming Hyperliquid source positions.
- Market availability may differ.
- Entry and PnL will diverge more than Pacifica-native copy.

This should not block V1.

## Copy Trade Flow

### Tail open

1. User taps tail on a whale position.
2. Tail modal shows stake, notional, estimated fees, entry gap, and close-listening toggle.
3. Server revalidates that the source position is still open.
4. Server checks Pacifica onboarding and deposit readiness.
5. If the user has no bound agent wallet, reuse the current onboarding flow.
6. If the user needs collateral on Pacifica, return a deposit phase.
7. Server places the copied Pacifica market order through the user's agent wallet.
8. Insert a `bets` row with `type: "copy"` and source metadata.

### Optional close listening

Close listening is set per copied position at open time.

If enabled:

- A background sweep checks whether the source whale position is still open.
- When the source closes, the app submits a reduce-only close for the user's matching Pacifica position.
- The bet is marked closed with `closeReason: "source_closed"`.
- If realized PnL is available, record it in `proceedsUsdc`.

If disabled:

- The user keeps the position until manual close or risk guard.
- The UI can still warn that the whale has exited.

### Guardrails

V1 should keep the existing one-open-tail-per-market rule. Pacifica nets positions by account and symbol, so allowing two copied BTC tails would merge them and make attribution unreliable.

Recommended V1 guardrails:

- Minimum stake: $5.
- Maximum stake: $1000.
- One open copied position per market per user.
- Revalidate source still open before placing an order.
- Reject copy if market is unsupported.
- Clamp leverage to Pacifica market limits.
- Display entry gap before copy.
- Optional auto-close from source close.
- Manual close always available.

Hard stop-loss automation can remain out of V1 unless product risk demands it before launch.

## Data Model

The current `bets` table can stay as the user copy-trade ledger. The main new persistence should be source-oriented.

### New `whales` table

Fields:

- `id`: stable text id.
- `source`: `pacifica` or `hyperliquid`.
- `sourceAccount`: venue account address.
- `displayName`.
- `avatarUrl` or generated avatar seed.
- `status`: `active`, `hidden`, `retired`.
- `tags`: JSONB for labels such as scalper, swing, high leverage.
- `createdAt`.
- `updatedAt`.

### New `whale_positions` table

Fields:

- `id`: stable source position id when available, otherwise derived from source, account, market, side, and open timestamp.
- `whaleId`.
- `source`.
- `sourceAccount`.
- `market`.
- `side`: long or short.
- `leverage`.
- `amountBase`.
- `notionalUsd`.
- `entryPrice`.
- `currentMark`.
- `unrealizedPnlPct`.
- `openedAt`.
- `closedAt`.
- `status`: `open` or `closed`.
- `raw`: JSONB source payload.
- `lastSeenAt`.

### New `whale_position_analysis` table

Fields:

- `positionId`.
- `summary`.
- `thesis`.
- `risk`.
- `entryGapWarning`.
- `confidence`.
- `model`.
- `createdAt`.
- `updatedAt`.

The analysis should be cacheable and refreshed only when position state materially changes, for example when PnL crosses a threshold, size changes, or the whale closes.

### `bets.meta` extension

For whale copy rows:

```json
{
  "sourceType": "whale",
  "whaleId": "pacifica:abc",
  "source": "pacifica",
  "sourceAccount": "abc",
  "sourcePositionId": "pos123",
  "leaderMarket": "BTC",
  "leaderSide": "long",
  "leverage": 10,
  "autoCloseOnSourceClose": true,
  "userEntryPrice": 64200.5,
  "sourceEntryPriceAtCopy": 64010.1,
  "pacificaOrderId": "123",
  "closeReason": null
}
```

## Services

### Whale refresh

Add a whale refresh service that populates `whales` and `whale_positions`.

For Pacifica V1:

- Pull curated accounts and leaderboard accounts.
- Fetch account positions.
- Upsert current open positions.
- Mark missing previously-open positions as closed only after a confirmation grace window.
- Keep raw payloads for debugging.

### Close listener

Extend the existing mirror-close sweep into a source-position close listener.

The current `runMirrorCloseSweep` already knows how to close follower bets. It should move from bot-specific logic toward source-specific logic:

- Pacifica source: fetch source account positions and compare by market and side.
- Hyperliquid source later: fetch source account positions from Hyperliquid.
- Bot source can remain only during migration.

The sweep must be idempotent. It should only close bets with `status: "confirmed"` and `autoCloseOnSourceClose: true`.

### Analysis generator

Add a whale analysis service:

- Inputs: source position, market marks, recent candles, source trader history, and follower entry gap.
- Output: short plain-English commentary plus risk caveat.
- Store output in `whale_position_analysis`.
- Never claim to know the whale's private intent.

The UI should degrade gracefully if analysis is missing.

## Migration From Paper Bots

The existing bot system should not be deleted immediately.

Recommended migration:

1. Add whale tables and whale refresh service.
2. Build whale signal shape parallel to current bot signal shape.
3. Switch `/feed` and `/live` to whale data behind a feature flag.
4. Retarget `TailModal` from bot source to whale source.
5. Extend `bets.meta` and mirror-close for whale source positions.
6. Keep bot routes dormant until whale flow is stable.
7. Remove or archive bot UI later.

This reduces risk because the existing Pacifica onboarding, deposit, order, portfolio, and close code remains useful.

## UI Direction

Keep the current dark, dense, trading-desk style from the desktop command center work. Change the content hierarchy from character bots to social traders.

Important copy changes:

- "Tail bot" becomes "Tail whale" or "Copy trade".
- "AI bot opened" becomes "Whale opened".
- "Chatter" becomes analysis, not personality banter.
- "Auto-close" must be explicit and optional.
- Cross-venue copy must be labeled when Hyperliquid is added.

The product should feel like a social trading terminal, not a casino and not an AI roleplay app.

## Error Handling

Key states:

- Source position closed before user confirms tail: reject with "position closed".
- Source market unsupported on Pacifica: disable tail CTA.
- User already has an open tail on same market: reject and show existing position.
- Pacifica deposit is pending: use existing settling messages.
- Auto-close fails: keep bet open, record error, show warning in portfolio.
- Analysis unavailable: show position without analysis.
- Source data stale: suppress copy CTA until refreshed.

## Testing

Unit tests:

- Whale position identity and upsert behavior.
- Source close detection.
- `bets.meta` parsing for whale copies.
- Auto-close eligibility based on `autoCloseOnSourceClose`.
- One-open-tail-per-market guard remains enforced.
- Entry gap calculation.

Integration tests:

- Tail Pacifica whale position with auto-close disabled.
- Tail Pacifica whale position with auto-close enabled.
- Source closes, sweep closes follower.
- Source closes, auto-close disabled, follower remains open with warning.
- Portfolio renders whale metadata and close reason.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build` when route work begins
- Browser check for `/feed`, `/live`, `/chatter`, `/portfolio`, and tail modal

## Non-Goals For V1

- Fully automatic Hyperliquid cross-venue copy.
- Social posting, comments, likes, or direct messaging.
- Multi-position copy portfolios per same market.
- Treasury-funded copy trading.
- Bot-vs-human arena.
- Guaranteed interpretation of whale intent.

## V1 Decisions

These decisions keep implementation focused:

- Initial Pacifica whale discovery uses both a curated allowlist and Pacifica leaderboard data. Curated accounts can be pinned even if leaderboard ranking changes.
- Whale display names are generated from addresses by default, with manual overrides in the curated allowlist.
- `/chatter` launches as a global analysis stream sorted by freshness. Per-whale filtering can be added after the core stream works.
- Close listening is optional and defaults off in the tail modal. The user must deliberately enable automatic close copying.
- Copy is disabled when source data is older than 60 seconds. The UI should show the position as stale instead of allowing a new tail.
