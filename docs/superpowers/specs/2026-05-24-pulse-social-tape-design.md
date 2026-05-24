# Pulse Social Tape Design

**Date:** 2026-05-24  
**Status:** draft for review  
**Scope:** Replace the current `/chatter` analysis stream with a social activity surface for the whale copy-trading app.

## Goal

Make the app feel like a social perps product, not just a whale scanner.

The current `/chatter` route duplicates `/live`: it lists open whale positions and adds AI summary, thesis, and risk blocks. That explanation is useful, but it belongs inside position detail surfaces. The dedicated tab should instead answer: **what is happening right now, what is getting attention, and what can I jump into?**

## Product Role

The route becomes **Pulse**.

- `/feed`: discover whales.
- `/live`: swipe one open position at a time and tail it.
- `/chatter`, labeled **Pulse** in navigation: live social tape around whale positions.
- `/portfolio`: manage copied positions.

V1 keeps the existing `/chatter` URL to avoid routing churn, but all navigation copy changes from `Chatter` to `Pulse`. Do not add a `/pulse` alias in V1.

## V1 Experience

Pulse is a scrolling feed of compact activity posts generated from existing whale data.

Each post should feel like a social update:

- Whale avatar and handle.
- Action line, for example `opened`, `is pressing`, `is deep in profit`, `entry gap warning`, or `copy-ready`.
- Market chip with side and leverage.
- Notional, source P/L, holding time, and source venue.
- One short context sentence. This replaces the current large Summary, Thesis, Risk blocks.
- Primary action: `Open position` or `Tail position`.
- Lightweight reaction row: `Watching`, `Bullish`, `Fading`. In V1 these are local-only toggles for product feel and are not persisted.

The feed should not show long analysis cards. It should be fast to scan, with one post taking roughly 25-35% of a mobile viewport rather than a full screen.

## Generated Pulse Item Types

V1 can be built from `buildWhalePositionSignals()` without new persistence.

1. **Fresh Open**
   - Trigger: recently opened positions.
   - Copy: `lateBdoer opened BTC long 50x with $934K live.`
   - Sort boost: newer positions and larger notional.

2. **Big Position**
   - Trigger: high notional relative to other live positions.
   - Copy: `HL 0x023a...2355 is carrying a $6.3M HYPE long.`
   - Sort boost: notional size and copyability.

3. **Deep In Profit**
   - Trigger: source P/L above a threshold.
   - Copy: `This OP short is already up 58%, tailing now means a late entry.`
   - Sort boost: absolute P/L and entry-gap warning.

4. **Pain Trade**
   - Trigger: source P/L below a threshold.
   - Copy: `This ETH long is underwater. The whale is still holding.`
   - Sort boost: drawdown plus large notional.

5. **Entry Gap Warning**
   - Trigger: existing `analysis.entryGapWarning`.
   - Copy: use a shortened version of the warning.
   - Sort boost: large gap and high leverage.

These item types are enough for the route to feel alive without inventing user activity.

## Future Social Layer

After V1 feels useful, add real social behavior:

- Follow whales.
- React to pulse items.
- Comment on a position.
- Show tail counts and watcher counts.
- Filter Pulse by `Following`, `Copy-ready`, `Big size`, and `High leverage`.
- Position rooms: tapping a Pulse item opens a detail view with chart, full AI context, comments, reaction counts, and the tail modal.

V1 should leave room for these without requiring them.

## UI Rules

- Rename bottom and desktop nav label from `Chatter` to `Pulse`.
- Use the existing fingerprint avatars.
- Keep visual density higher than `/feed`; this is a tape, not one whale per screen.
- No nested scroll cards.
- No large title band that wastes mobile space.
- Keep actions obvious: `Open` for detail, `Tail` for copy.
- Use concise text. Avoid paragraphs except in expanded detail later.

## Data Flow

V1:

1. Server route calls `buildWhalePositionSignals()`.
2. Client component converts each open position into one or more Pulse items.
3. Items are sorted by a pulse score using recency, notional, P/L movement, leverage, and copyability.
4. Client polls `/api/whales/live` on the same cadence as the current Chatter stream.
5. Tail action reuses `TailModal` with the position source.

No new database table is required for V1.

Future:

- Add persisted reactions and comments after the visual surface proves itself.
- Add aggregate copy counts from confirmed copy bets.
- Add follow graph so Pulse can default to a following feed.

## Error And Empty States

- If no whale positions are available, show a compact empty state: `Pulse is waiting for live whale positions`.
- If analysis is missing, still render the post from position data.
- If a position is not copyable on Pacifica, show `Watch only` instead of `Tail`.
- If the source is stale, keep the item visible but mark it `Stale`.

## Testing

Add focused tests for:

- Navigation labels use `Pulse`, not `Chatter`.
- The `/chatter` route renders the Pulse component when whale social mode is enabled.
- Pulse item mapping produces fresh-open, big-position, profit, pain, and entry-gap item variants.
- Pulse cards do not include the old large `Summary`, `Thesis`, and `Risk` block layout.
- Tail buttons only appear for copyable fresh positions.
