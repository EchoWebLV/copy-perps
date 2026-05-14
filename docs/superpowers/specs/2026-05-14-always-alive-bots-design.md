# Always-Alive Bots Design

**Status:** spec draft
**Date:** 2026-05-14
**Author:** controller session
**Worktree:** `perps-maxxing-paper-bots` (branch `paper-bots-phase-1`)

---

## Problem

The paper-bot feed is "dead" 80% of the time. Each bot card shows trade-driven
narrations on open and close, then nothing. When 8 of 12 bots have no active
position — which is the normal state for signal-conditioned strategies — the
feed reads as a graveyard. A vertical-scroll product whose cards say "Watching
the tape" cannot sustain engagement.

The strategy logic is correct: bots should not trade unless their edge is
present. The product gap is that **silence is being interpreted as
inactivity**. Real Twitch streamers make one trade per hour and talk the
whole time; the product is the voice, not the trades.

## Goals

1. Every bot card on `/feed` always shows fresh, in-character content.
2. The Chatter timeline becomes a continuous stream (not gated on trades).
3. Each content type ships behind a kill-switch the user can flip from admin.
4. Cost is bounded and observable.
5. Mood badges add visible state for every bot independent of LLM availability.

## Non-goals

- Voice / audio output.
- Animated sprite emotes.
- Per-bot lore or backstory rewrites.
- "Bot dreams" content type (deferred).
- Inverse user bets / drama mechanics (deferred).
- Dedicated bot profile pages.
- Replacing the existing narration on open/close — that stays.

## Scope (this spec)

| Content type | Build now? | Default | Admin checkbox |
|---|---|---|---|
| `near_trade` | yes | **off** | enabled |
| `banter` | yes | **off** | enabled |
| `market_react` | no — stub only | off | disabled, "coming soon" |
| `position_color` | no — stub only | off | disabled, "coming soon" |
| `mood_state` (badge) | yes | **on** | enabled (separate toggle) |

The two unimplemented checkboxes render in the admin UI but are visually
disabled and cannot be toggled. This preserves the planned surface area
without shipping unfinished logic.

All thought toggles default off at install. The user explicitly enables
them via `/admin/thoughts`. Mood badges default on because they are
deterministic, free, and a separate concept from LLM-generated thoughts.

## Architecture

```
                      ┌─────────────────────────┐
                      │  /api/cron/bots-resolver │  (every minute)
                      └────────────┬────────────┘
                                   │
                          tick()  ─┴──► strategy evaluation (existing)
                                   │
                          publishThoughts()  ─── new module
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
       near_trade               banter               position_color
       detector                 detector             (deferred)
            │                      │
            └──────────┬───────────┘
                       │ each fires up to N thoughts/tick
                       ▼
              ┌─────────────────┐
              │  thoughts.ts    │  shared helper
              │  - check toggle │
              │  - check cooldown │
              │  - call xAI     │
              │  - insert row   │
              └────────┬────────┘
                       │
                       ▼
               bot_thoughts (DB)
                       │
            ┌──────────┴──────────┐
            │                     │
       /feed bot card        /chatter timeline
       (rotating headline)   (interleaved with trades)
```

A new file `lib/bots/thoughts.ts` holds the orchestration. The resolver
tick calls `publishThoughts({ tickContext })` after the trade-evaluation
phases. tickContext carries this tick's opens/closes (needed by banter)
and the strategy state per bot (needed by near_trade).

Each content type lives in `lib/bots/thoughts/<kind>.ts` with two
exports: a detector (returns candidates) and a generator (calls xAI to
flesh out the candidate's prompt). The orchestrator wires them together.

## Data model

New table `bot_thoughts`:

```ts
export const botThoughts = pgTable(
  "bot_thoughts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    // 'near_trade' | 'banter' | 'market_react' | 'position_color' | 'mood_state'
    content: text("content").notNull(),
    // refMeta records what triggered this thought so the UI can show
    // evidence and we can correlate thoughts back to source data.
    refMeta: jsonb("ref_meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    botTsIdx: index("bot_thoughts_bot_ts_idx").on(t.botId, t.createdAt),
    tsIdx: index("bot_thoughts_ts_idx").on(t.createdAt),
  }),
);
```

New table `thought_settings` (singleton — one row):

```ts
export const thoughtSettings = pgTable("thought_settings", {
  id: text("id").primaryKey().default("singleton"),
  enableNearTrade: boolean("enable_near_trade").notNull().default(false),
  enableBanter: boolean("enable_banter").notNull().default(false),
  enableMarketReact: boolean("enable_market_react").notNull().default(false),
  enablePositionColor: boolean("enable_position_color").notNull().default(false),
  enableMoodBadges: boolean("enable_mood_badges").notNull().default(true),
  // Per-type cooldowns in seconds — minimum gap between thoughts of this
  // kind from the same bot. Defaults below match the design.
  cooldownNearTradeSec: integer("cooldown_near_trade_sec").notNull().default(300),
  cooldownBanterSec: integer("cooldown_banter_sec").notNull().default(120),
  cooldownMarketReactSec: integer("cooldown_market_react_sec").notNull().default(180),
  cooldownPositionColorSec: integer("cooldown_position_color_sec").notNull().default(900),
  // Global cap across the whole roster, anti-runaway.
  maxThoughtsPerMinute: integer("max_thoughts_per_minute").notNull().default(8),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

One row, primary key `'singleton'`, upserted on save. Helper
`getThoughtSettings()` returns the row (creating defaults if missing).

## Content type: near_trade

**Trigger.** During a resolver tick, after the trade-evaluation phase, the
detector inspects per-bot strategy state for "almost fired" conditions:

- **Funding strategies**: funding rate within 70-99% of the bot's
  `fundingThreshold`. Example: Phoebe threshold 1 bp, current AVAX
  funding 0.75 bps → near_trade candidate.
- **Liquidation strategies**: a recent liquidation event whose notional
  is within 70-99% of the bot's `minLiqNotionalUsd`.
- **Momentum strategies**: a breakout that is within 70-99% of
  `breakoutPct` AND volume is within 80-99% of the multiplier.
- **Mean-revert strategies**: a z-score within 70-99% of `zEntryThreshold`.
- **Vol strategies**: vol ratio within 70-99% of `volMultiplier`.
- **Trend strategies**: skip — slow crossovers don't have a meaningful
  "near" state.

Each detector returns at most one candidate per bot per tick. The
orchestrator then picks at most one bot per kind per tick (so the entire
roster doesn't all near-fire at once and burn cost).

**Generator.** xAI prompt:

```
You are {persona.name}. {persona.systemPrompt}

A signal is forming but it has NOT crossed your entry threshold yet.
Details:
  asset: {asset}
  signal_kind: {kind}   // 'funding' | 'liquidation' | 'momentum' | etc.
  current_value: {value}
  threshold: {threshold}
  pct_of_threshold: {pct}

Write a single sentence (max ~120 chars) showing you are watching but not
acting yet. Stay in character. No markdown. No quotes. No "I'm watching".
```

**Cooldown.** 300s per bot (5 min). A bot can't publish two near_trade
thoughts back-to-back; would be repetitive.

**refMeta.** `{ kind, asset, currentValue, threshold, pctOfThreshold }`.

## Content type: banter

**Trigger.** Fires within the same tick that another bot opened or
closed a position. Every other bot in the roster is a candidate to react.
At most one banter thought per tick per bot. The bot most likely to
react is selected by:

1. **Opposite-side disagreement**: bot has a position on the same asset
   opposite side → strongest candidate.
2. **Same-family kinship**: variant reacting to its parent or vice
   versa.
3. **Strategy adjacency**: e.g. a funding bot reacting to a momentum
   bot's trade on the same asset.
4. **Fallback**: a random bot the asset is on the watchlist of.

At most 2 banter thoughts per trade event are emitted. (One direct
reactor + one fallback if available.)

**Generator.** xAI prompt:

```
You are {persona.name}. {persona.systemPrompt}

Another bot just opened/closed a position. Their identity and view:
  bot: {otherBotName}
  action: {opened|closed}
  asset: {asset}
  side: {long|short}
  leverage: {leverage}x
  their_trigger: {brief}

Your own state on this asset:
  position: {none|long|short}
  recent_pnl_usd: {value}
  agree_with_them: {true|false}

Write ONE short sentence (max ~120 chars) reacting. Be in character.
Reference them by name. No markdown. No quotes around your reply.
```

**Cooldown.** 120s per bot (2 min). Lower than near_trade because banter
is reactive — feels weird to be silent when another bot just acted.

**refMeta.** `{ reactingTo: positionId, otherBotId, asset, side }`.

## Content types deferred

`market_react` and `position_color` are scaffolded only — the checkbox
exists in admin (disabled), the schema accepts the `kind` value, but no
detector or generator is implemented. They will be added in a follow-up
plan once near_trade and banter prove out.

## Mood badges

Deterministic visual state per bot, computed at signal-build time inside
`buildBotSignals()` (lib/signals/bot-signals.ts). One of:

| Badge | Trigger condition | Emoji |
|---|---|---|
| `HUNTING` | strategy-specific "signal nearly fired" (same detector as near_trade) | 🎯 |
| `LOADED` | bot has 1+ open position with live PnL >= 0 | ⚡ |
| `WOUNDED` | bot has 1+ open position with live PnL <= -25% on stake | 💀 |
| `ON_STREAK` | last 3 closed trades all profitable | 🔥 |
| `DORMANT` | none of the above; balance >= 90% of starting | 😴 |
| `BUSTED` | bot.status === 'busted' | 🪦 |

Computed once per signal build, returned as a new field on the BotSignal
payload. Cost: zero (no LLM). Default on.

When `enableMoodBadges` is false, the field returns null and the card
hides the badge.

## Triggering & cadence

The `publishThoughts(tickContext)` call happens at the end of every
resolver tick (every 60s via Vercel cron). It does the following in order:

1. Read `thoughtSettings`. If all enable toggles are false, return.
2. Build a candidate pool by running each enabled detector.
3. For each candidate, check the bot's most recent thought of that kind.
   If `now - last.createdAt < cooldown`, drop the candidate.
4. Apply global rate limit: count thoughts inserted in the last 60s. If
   `count >= maxThoughtsPerMinute`, stop processing further candidates
   for this tick.
5. For each remaining candidate, call the appropriate generator with a
   15s xAI timeout. On success, insert the row. On failure, log and skip.

The orchestrator processes content kinds in a fixed order: `banter`
first (it's reactive to this tick's trades, time-sensitive), then
`near_trade` (more deliberative). This ensures banter wins the rate
budget when both want to fire.

## Admin page: `/admin/thoughts`

Server component reading current settings + recent thoughts.

```
┌──────────────────────────────────────────────────────┐
│  Bot Thoughts                                        │
│  ─────────────                                       │
│                                                      │
│  [Master toggle: ON ⬤]                               │
│                                                      │
│  Content types                                       │
│  ─────────────                                       │
│  ☐ Near-trade thoughts   cooldown: [300]s            │
│  ☐ Bot-to-bot banter     cooldown: [120]s            │
│  ☒ Market reactions      coming soon                 │  ← disabled
│  ☒ Position commentary   coming soon                 │  ← disabled
│  ☑ Mood badges                                       │  ← default on
│                                                      │
│  Rate limit                                          │
│  ──────────                                          │
│  Max thoughts/min across roster: [8]                 │
│                                                      │
│  Today                                               │
│  ─────                                               │
│  Thoughts published: 23                              │
│  xAI cost (est):     $0.07                           │
│                                                      │
│  Recent (last 50)                                    │
│  ────────────────                                    │
│  19:47  📊 Phoebe   near_trade  "AVAX 0.75bps..." [×]│
│  19:46  🎯 Mike     banter      "Lite brave on..."[×]│
│  ...                                                 │
│                                                      │
│  [Save settings]                                     │
└──────────────────────────────────────────────────────┘
```

Routes:
- `GET /admin/thoughts` — server page render
- `POST /api/admin/thoughts/settings` — upsert settings row
- `DELETE /api/admin/thoughts/:id` — delete a specific thought

Auth: same `isAdminEnabled()` gate as the rest of admin (dev-only flag).

## Surfaces

### Bot card on /feed
The card pulls the bot's most recent thought (any kind) and displays it
as the headline under the bot name + chat button, in place of the
current "Watching the tape" empty-state copy.

When no thoughts exist for a bot:
- If the bot has open positions: show the existing trade narration
  (status quo, no change).
- If the bot has no positions and no thoughts: fall back to "Watching
  the tape" (existing copy).

The mood badge renders as a small chip next to the bot name (e.g. "🎯
HUNTING") regardless of whether thoughts are enabled.

### Chatter timeline
The existing `getChatterEvents()` already emits open/close events sorted
by ts. New: emit thought events too. Each `bot_thoughts` row becomes a
ChatterEvent with kind `thought`. Same row UI but with an italic prefix
("thinking…" or the bot's emoji-tone) and no PnL column.

Maintains chronological interleaving — a near_trade thought from Phoebe
that fires 30s after a Lite open shows up right below the open.

### Mood badge on bot card
Small pill next to the bot name. Color-coded:
- HUNTING / LOADED → emerald
- WOUNDED → rose
- ON_STREAK → amber pulse
- DORMANT → neutral grey
- BUSTED → black

Pulse animation only on HUNTING and ON_STREAK to draw the eye.

## Cost model

Worst case at the default cap (8 thoughts/min × 60 × 24 = 11.5K/day):
- Grok pricing ≈ $0.002 / call (250-token output)
- Daily ceiling: **~$23/day**

Realistic with cooldowns (300s near_trade, 120s banter):
- 12 bots × 60min / 5min cooldown = 144 near_trade/hour max
- Banter is event-driven; if 20 trades/hour, ~40 banter thoughts/hour
- Realistic mix: ~50-150 thoughts/hour = ~$2-7/day

The admin page shows running daily spend so surprises are caught early.

## Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| xAI rate-limited (429) | Skip the thought silently. No template fallback — silence is fine for thoughts. Existing trade narration still has its template fallback. |
| xAI timeout (>15s) | Same — skip silently. |
| Bot contradicts itself across thoughts | Generator includes the bot's last 3 thoughts as context in the prompt. |
| Cooldown bypassed by races | Cooldown check uses `MAX(created_at) FROM bot_thoughts WHERE bot_id = ? AND kind = ?` — read-then-write race is acceptable because the worst case is one extra thought. |
| Global cap bypassed by races | Same — racy count, worst case is 1-2 over the cap per minute. |
| Toggle changes mid-tick | Settings read once at the start of `publishThoughts`. A toggle change takes effect on the next tick. |
| Admin disables `enableMoodBadges` but UI caches old state | Badges are server-computed in the signal pool; next pool refresh (≤30s) hides them. |
| Thoughts overwhelm Chatter timeline | Chatter page has a `?kinds=trade,thought` query string default; user can drop `thought` to filter. |

## Testing

Unit tests (vitest):
- `lib/bots/thoughts/near-trade.test.ts` — detector returns candidates
  for each strategy family at the threshold boundary; rejects clearly-
  past-threshold and clearly-far-from-threshold cases.
- `lib/bots/thoughts/banter.test.ts` — candidate selection prefers
  opposite-side disagreement over same-family kinship over fallback.
- `lib/bots/thoughts.test.ts` — orchestrator respects cooldowns, global
  cap, ordering (banter before near_trade), and settings toggles.

Integration check (manual, scripted):
- `scripts/probe-thoughts.ts` — enable both toggles, trigger a tick,
  inspect inserted rows + console output.

No new e2e tests; the existing tick path is already covered.

## Migration / rollout

1. `npm run db:push` to add `bot_thoughts` + `thought_settings` tables.
2. Settings singleton is auto-created with all toggles off on first read.
3. Mood badges go live immediately (default on, computed in
   `buildBotSignals()`).
4. User flips near_trade + banter on via `/admin/thoughts` when ready.
5. Watch admin spend tracker for the first hour; tune cooldowns if
   spammy.

## Open questions resolved during design

- **Should thoughts also show in user chat sheet?** No. Chat sheet is
  per-user private conversation. Thoughts are public broadcast.
- **Should mood badge be a separate column or computed?** Computed at
  signal-build time. Cheaper than persistence; recomputed every refresh.
- **Should the four-checkbox UI still render the disabled two?** Yes —
  preserves planned surface area, makes future activation a one-line
  change.
- **Should mood_state ALSO appear as a row in `bot_thoughts`?** No.
  Mood state is per-snapshot, not per-event. It lives on the BotSignal
  payload only.

## Out of scope / future work

- Voice / audio output for thoughts.
- Animated sprite emotes per persona.
- "Dreams" content type for dead-market days.
- Inverse user bets on bot positions.
- Bot popularity score (engagement-weighted).
- Squad mode / fantasy teams.
- Weekly tournament UI.
- Tickertape across feed top.
- Bot profile page.
- Per-bot lore / backstory in narration.
- market_react and position_color generators (deferred but scaffolded).
