# Always-Alive Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every paper-bot card on /feed feel alive even when the bot is not trading, by publishing in-character "thoughts" continuously (near-trade observations, bot-to-bot banter) and showing deterministic mood badges.

**Architecture:** Existing trade-narration path stays. A new orchestrator runs at the end of every resolver tick; it reads admin-managed settings, evaluates per-content-type detectors, applies per-bot cooldowns + a global cap, calls xAI to flesh out candidates into one-line thoughts, and persists rows to `bot_thoughts`. The bot card surfaces the most recent thought as its headline; the Chatter timeline interleaves thoughts with trade events. Mood badges are deterministic state computed during signal build — no LLM cost.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Neon Postgres (HTTP), AI SDK + xAI Grok (`grok-4.20-non-reasoning`), Vitest, Tailwind v4, lucide-react.

**Default state at install:** all thought toggles OFF; mood badges ON. User flips toggles via `/admin/thoughts`.

**Reference spec:** [docs/superpowers/specs/2026-05-14-always-alive-bots-design.md](../specs/2026-05-14-always-alive-bots-design.md)

---

## File map (what gets created / modified)

**New files:**
- `lib/bots/mood.ts` — deterministic mood-badge state machine
- `lib/bots/mood.test.ts` — unit tests
- `lib/bots/thoughts/types.ts` — shared types (Candidate, ThoughtKind, etc.)
- `lib/bots/thoughts/settings.ts` — read/write thought_settings singleton
- `lib/bots/thoughts/settings.test.ts` — unit tests
- `lib/bots/thoughts/cooldowns.ts` — per-bot cooldown + global cap checks
- `lib/bots/thoughts/cooldowns.test.ts` — unit tests
- `lib/bots/thoughts/persist.ts` — insert + latest-per-bot fetch
- `lib/bots/thoughts/near-trade.ts` — detector + generator
- `lib/bots/thoughts/near-trade.test.ts` — unit tests
- `lib/bots/thoughts/banter.ts` — detector + generator
- `lib/bots/thoughts/banter.test.ts` — unit tests
- `lib/bots/thoughts.ts` — orchestrator
- `lib/bots/thoughts.test.ts` — orchestrator tests
- `app/admin/thoughts/page.tsx` — admin UI
- `app/api/admin/thoughts/settings/route.ts` — POST settings
- `app/api/admin/thoughts/[id]/route.ts` — DELETE one thought
- `components/admin/ThoughtSettingsForm.tsx` — client form for settings
- `scripts/probe-thoughts.ts` — manual end-to-end probe

**Modified files:**
- `lib/db/schema.ts` — add `botThoughts` + `thoughtSettings` tables
- `lib/types.ts` — extend BotSignal payload with `mood` + `currentThought`
- `lib/signals/bot-signals.ts` — populate mood + currentThought
- `lib/bots/resolver.ts` — call `publishThoughts(tickContext)` at end of tick
- `lib/bots/chatter.ts` — include thoughts in the timeline event union
- `app/(app)/chatter/page.tsx` — render thought events alongside trades
- `components/feed/BotCard.tsx` — show mood badge + thought-as-headline

---

## Task 1: Add `bot_thoughts` + `thought_settings` tables

**Files:**
- Modify: `lib/bots/../db/schema.ts` (path: `lib/db/schema.ts`) — append two new tables

- [ ] **Step 1.1: Append the new tables to the schema**

Read `lib/db/schema.ts`. After the existing `botChats` definition block, append:

```ts
import { boolean } from "drizzle-orm/pg-core";
// NOTE: if `boolean` is already imported in the file, skip the re-import.

// Persistent log of bot-authored in-character thoughts that are NOT tied to
// a trade event. Trade narrations stay on paper_positions.narration_open/close.
// kind: 'near_trade' | 'banter' | 'market_react' | 'position_color' | 'mood_state'
export const botThoughts = pgTable(
  "bot_thoughts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    refMeta: jsonb("ref_meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    botTsIdx: index("bot_thoughts_bot_ts_idx").on(t.botId, t.createdAt),
    tsIdx: index("bot_thoughts_ts_idx").on(t.createdAt),
    botKindTsIdx: index("bot_thoughts_bot_kind_ts_idx").on(
      t.botId,
      t.kind,
      t.createdAt,
    ),
  }),
);

// Singleton settings row controlling thought publication. PK is fixed to
// 'singleton'; we upsert into that one row. Defaults match the design.
export const thoughtSettings = pgTable("thought_settings", {
  id: text("id").primaryKey().default("singleton"),
  enableNearTrade: boolean("enable_near_trade").notNull().default(false),
  enableBanter: boolean("enable_banter").notNull().default(false),
  enableMarketReact: boolean("enable_market_react").notNull().default(false),
  enablePositionColor: boolean("enable_position_color").notNull().default(false),
  enableMoodBadges: boolean("enable_mood_badges").notNull().default(true),
  cooldownNearTradeSec: integer("cooldown_near_trade_sec").notNull().default(300),
  cooldownBanterSec: integer("cooldown_banter_sec").notNull().default(120),
  cooldownMarketReactSec: integer("cooldown_market_react_sec").notNull().default(180),
  cooldownPositionColorSec: integer("cooldown_position_color_sec").notNull().default(900),
  maxThoughtsPerMinute: integer("max_thoughts_per_minute").notNull().default(8),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

If `boolean` is not already imported at the top, add it to the existing drizzle-orm imports block (it's part of `drizzle-orm/pg-core`).

- [ ] **Step 1.2: Apply the schema to the DB**

Run: `npm run db:push`

Expected output includes `CREATE TABLE "bot_thoughts"` and `CREATE TABLE "thought_settings"` with `[✓] Changes applied`.

- [ ] **Step 1.3: Confirm tables exist**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { neon } from '@neondatabase/serverless';
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const t = await sql\`SELECT to_regclass('public.bot_thoughts') AS a, to_regclass('public.thought_settings') AS b\`;
  console.log(t[0]);
})();
"
```

Expected: both fields non-null (`{ a: 'bot_thoughts', b: 'thought_settings' }`).

- [ ] **Step 1.4: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): add bot_thoughts + thought_settings tables"
```

---

## Task 2: Mood badge state machine (deterministic, no LLM)

**Files:**
- Create: `lib/bots/mood.ts`
- Create: `lib/bots/mood.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `lib/bots/mood.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));

import { computeMoodBadge, type MoodBadge } from "./mood";
import type { PaperPosition } from "./types";

function pos(over: Partial<PaperPosition>): PaperPosition {
  return {
    id: "p1",
    botId: "bot",
    asset: "BTC",
    side: "long",
    leverage: 10,
    stakeUsd: 100,
    entryMark: 100,
    entryTs: new Date(),
    exitMark: null,
    exitTs: null,
    paperPnlUsd: null,
    triggerMeta: null,
    narrationOpen: null,
    narrationClose: null,
    status: "open",
    ...over,
  };
}

describe("computeMoodBadge", () => {
  it("returns BUSTED when bot.status is busted", () => {
    const badge = computeMoodBadge({
      botStatus: "busted",
      balanceUsd: 0,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [],
    });
    expect(badge).toBe("BUSTED" satisfies MoodBadge);
  });

  it("returns ON_STREAK when last 3 closed pnls are all positive", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1100,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [10, 20, 30],
    });
    expect(badge).toBe("ON_STREAK");
  });

  it("returns WOUNDED when an open position is at <= -25% on stake", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [pos({ stakeUsd: 100 })],
      // Note: WOUNDED is decided by livePaperPnlPct in args (see API).
      livePnlPctByPositionId: { p1: -0.3 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("WOUNDED");
  });

  it("returns LOADED when bot has an open position with non-negative live PnL", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [pos({ stakeUsd: 100 })],
      livePnlPctByPositionId: { p1: 0.02 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("LOADED");
  });

  it("returns DORMANT for an inactive bot with no open positions", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 950,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [],
    });
    expect(badge).toBe("DORMANT");
  });

  it("returns HUNTING when hasNearSignal is true and bot has no positions", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [],
      hasNearSignal: true,
    });
    expect(badge).toBe("HUNTING");
  });

  it("prefers WOUNDED over LOADED when one position is wounded and another is up", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [
        pos({ id: "a", stakeUsd: 100 }),
        pos({ id: "b", stakeUsd: 100 }),
      ],
      livePnlPctByPositionId: { a: -0.3, b: 0.05 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("WOUNDED");
  });
});
```

- [ ] **Step 2.2: Run the test and verify it fails**

Run: `npx vitest run lib/bots/mood.test.ts`
Expected: failure with `Cannot find module './mood'` or similar.

- [ ] **Step 2.3: Create the implementation**

Create `lib/bots/mood.ts`:

```ts
// lib/bots/mood.ts
//
// Deterministic mood-badge state machine. Computed per bot every time
// buildBotSignals() runs. No LLM, no DB write — purely a function of
// current state. Order of precedence below matters: BUSTED > WOUNDED >
// ON_STREAK > LOADED > HUNTING > DORMANT.

import type { PaperPosition, BotConfig } from "./types";

export type MoodBadge =
  | "BUSTED"
  | "WOUNDED"
  | "ON_STREAK"
  | "LOADED"
  | "HUNTING"
  | "DORMANT";

export interface MoodInput {
  botStatus: BotConfig["status"];
  balanceUsd: number;
  startingBalanceUsd: number;
  openPositions: PaperPosition[];
  recentClosedPnls: number[]; // last N closed paper_pnl_usd values, newest first
  /** Map from positionId → live PnL fraction on stake. Used to detect WOUNDED. */
  livePnlPctByPositionId?: Record<string, number>;
  /** Set true when a near-trade signal is forming for this bot. Drives HUNTING. */
  hasNearSignal?: boolean;
}

const WOUNDED_THRESHOLD = -0.25; // -25% on stake → WOUNDED
const STREAK_LENGTH = 3;

export function computeMoodBadge(input: MoodInput): MoodBadge {
  if (input.botStatus === "busted") return "BUSTED";

  if (input.openPositions.length > 0 && input.livePnlPctByPositionId) {
    const anyWounded = input.openPositions.some((p) => {
      const pct = input.livePnlPctByPositionId?.[p.id];
      return pct !== undefined && pct <= WOUNDED_THRESHOLD;
    });
    if (anyWounded) return "WOUNDED";
  }

  if (
    input.recentClosedPnls.length >= STREAK_LENGTH &&
    input.recentClosedPnls
      .slice(0, STREAK_LENGTH)
      .every((p) => p > 0)
  ) {
    return "ON_STREAK";
  }

  if (input.openPositions.length > 0) return "LOADED";

  if (input.hasNearSignal) return "HUNTING";

  return "DORMANT";
}
```

- [ ] **Step 2.4: Run the test and verify it passes**

Run: `npx vitest run lib/bots/mood.test.ts`
Expected: `Tests 7 passed`.

- [ ] **Step 2.5: Commit**

```bash
git add lib/bots/mood.ts lib/bots/mood.test.ts
git commit -m "feat(bots): deterministic mood-badge state machine"
```

---

## Task 3: Surface mood badge on BotSignal payload

**Files:**
- Modify: `lib/types.ts` — add `mood` field to BotSignal payload
- Modify: `lib/signals/bot-signals.ts` — compute and populate mood

- [ ] **Step 3.1: Extend the BotSignal payload type**

In `lib/types.ts`, find the `BotSignal` interface. Inside its `payload` object, after `freeBalanceUsd: number`, add:

```ts
    // Deterministic visual state — computed each signal build, no LLM.
    // null when admin has disabled mood badges via thought_settings.
    mood: import("./bots/mood").MoodBadge | null;
```

- [ ] **Step 3.2: Compute mood inside buildBotSignals**

In `lib/signals/bot-signals.ts`:

1. Add imports near the top:

```ts
import { computeMoodBadge } from "@/lib/bots/mood";
import { getThoughtSettings } from "@/lib/bots/thoughts/settings";
```

The `getThoughtSettings` module doesn't exist yet — Task 5 creates it. If you're executing strictly in order, defer importing it until then; for now stub a local `const enableMoodBadges = true;`.

2. After fetching `marks` and `crossBot`, fetch settings once:

```ts
  const settings = await getThoughtSettings();
```

3. Inside the per-bot loop, after `currentPositions` is constructed but before `signals.push`, compute:

```ts
    const livePnlPctByPositionId: Record<string, number> = {};
    for (const p of currentPositions) {
      livePnlPctByPositionId[p.positionId] = p.livePaperPnlPct;
    }
    const recentClosedPnls = closedRows
      .slice(0, 10)
      .map((r) => r.paperPnlUsd ?? 0);
    const mood = settings.enableMoodBadges
      ? computeMoodBadge({
          botStatus: bot.status as BotConfig["status"],
          balanceUsd: bot.balanceUsd,
          startingBalanceUsd: bot.startingBalanceUsd,
          openPositions: openRows.map((r) => ({
            id: r.id,
            botId: r.botId,
            asset: r.asset,
            side: r.side as "long" | "short",
            leverage: r.leverage,
            stakeUsd: r.stakeUsd,
            entryMark: r.entryMark,
            entryTs: r.entryTs,
            exitMark: r.exitMark,
            exitTs: r.exitTs,
            paperPnlUsd: r.paperPnlUsd,
            triggerMeta: (r.triggerMeta as Record<string, unknown> | null) ?? null,
            narrationOpen: r.narrationOpen,
            narrationClose: r.narrationClose,
            status: r.status as "open" | "closed" | "expired",
          })),
          recentClosedPnls,
          livePnlPctByPositionId,
        })
      : null;
```

The `BotConfig` import is already in scope via `bot-signals.ts`; if not, add `import type { BotConfig } from "@/lib/bots/types";`.

4. In the payload object, add `mood,` next to `freeBalanceUsd: freeBalance,`.

- [ ] **Step 3.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `getThoughtSettings` is missing, swap the stub mentioned above until Task 5.

- [ ] **Step 3.4: Commit**

```bash
git add lib/types.ts lib/signals/bot-signals.ts
git commit -m "feat(bots): surface mood badge on BotSignal payload"
```

---

## Task 4: Render mood badge on BotCard

**Files:**
- Modify: `components/feed/BotCard.tsx`

- [ ] **Step 4.1: Add the badge styling map + render**

At the top of the file, after the existing `fmtAge` helper, add:

```tsx
const MOOD_BADGES: Record<
  string,
  { label: string; emoji: string; classes: string; pulse: boolean }
> = {
  HUNTING: {
    label: "Hunting",
    emoji: "🎯",
    classes: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    pulse: true,
  },
  LOADED: {
    label: "Loaded",
    emoji: "⚡",
    classes: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    pulse: false,
  },
  WOUNDED: {
    label: "Wounded",
    emoji: "💀",
    classes: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
    pulse: false,
  },
  ON_STREAK: {
    label: "On streak",
    emoji: "🔥",
    classes: "bg-amber-500/15 text-amber-200 ring-amber-400/30",
    pulse: true,
  },
  DORMANT: {
    label: "Watching",
    emoji: "😴",
    classes: "bg-white/5 text-white/50 ring-white/10",
    pulse: false,
  },
  BUSTED: {
    label: "Busted",
    emoji: "🪦",
    classes: "bg-black/40 text-white/40 ring-white/10",
    pulse: false,
  },
};
```

In the JSX, locate the block that renders the chat button (the `<button>` with `MessageCircle`). Immediately before the chat button JSX, add:

```tsx
            {p.mood && MOOD_BADGES[p.mood] && (
              <span
                className={`mt-1.5 mr-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${MOOD_BADGES[p.mood].classes} ${MOOD_BADGES[p.mood].pulse ? "animate-pulse" : ""}`}
                title={`${MOOD_BADGES[p.mood].label}: deterministic state`}
              >
                {MOOD_BADGES[p.mood].emoji} {MOOD_BADGES[p.mood].label}
              </span>
            )}
```

- [ ] **Step 4.2: Visual smoke test (manual)**

Refresh `http://localhost:3001/feed`. Every bot should now show a mood pill next to its name. Bots with open positions show `LOADED` (or `WOUNDED` if down >25% on stake), idle bots show `DORMANT`.

- [ ] **Step 4.3: Commit**

```bash
git add components/feed/BotCard.tsx
git commit -m "feat(feed): render mood badge pill on bot cards"
```

---

## Task 5: Settings module — read/write the singleton

**Files:**
- Create: `lib/bots/thoughts/settings.ts`
- Create: `lib/bots/thoughts/settings.test.ts`

- [ ] **Step 5.1: Write the failing tests**

Create `lib/bots/thoughts/settings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectMock(),
        }),
      }),
    }),
    insert: () => ({
      values: insertMock,
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => updateMock(patch),
      }),
    }),
  },
}));

import { getThoughtSettings, updateThoughtSettings } from "./settings";

describe("getThoughtSettings", () => {
  beforeEach(() => {
    insertMock.mockReset();
    selectMock.mockReset();
    updateMock.mockReset();
  });

  it("returns the row when one exists", async () => {
    selectMock.mockResolvedValueOnce([
      { id: "singleton", enableNearTrade: true, enableBanter: false },
    ]);
    const s = await getThoughtSettings();
    expect(s.enableNearTrade).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("creates and returns defaults when no row exists", async () => {
    selectMock
      .mockResolvedValueOnce([]) // first read: missing
      .mockResolvedValueOnce([
        {
          id: "singleton",
          enableNearTrade: false,
          enableBanter: false,
          enableMarketReact: false,
          enablePositionColor: false,
          enableMoodBadges: true,
        },
      ]);
    insertMock.mockResolvedValueOnce(undefined);
    const s = await getThoughtSettings();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(s.enableMoodBadges).toBe(true);
    expect(s.enableNearTrade).toBe(false);
  });
});

describe("updateThoughtSettings", () => {
  beforeEach(() => updateMock.mockReset());

  it("forwards the patch", async () => {
    updateMock.mockResolvedValueOnce(undefined);
    await updateThoughtSettings({ enableNearTrade: true });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ enableNearTrade: true }),
    );
  });
});
```

- [ ] **Step 5.2: Run the test and verify it fails**

Run: `npx vitest run lib/bots/thoughts/settings.test.ts`
Expected: `Cannot find module './settings'`.

- [ ] **Step 5.3: Implement the settings module**

Create `lib/bots/thoughts/settings.ts`:

```ts
// lib/bots/thoughts/settings.ts
//
// Singleton row in thought_settings. We always upsert into id='singleton',
// so the table has at most one row. Callers should treat the returned
// object as cache-stale-OK; the orchestrator reads once per tick.

import { db } from "@/lib/db";
import { thoughtSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type ThoughtSettings = typeof thoughtSettings.$inferSelect;

const SINGLETON_ID = "singleton";

export async function getThoughtSettings(): Promise<ThoughtSettings> {
  const existing = await db
    .select()
    .from(thoughtSettings)
    .where(eq(thoughtSettings.id, SINGLETON_ID))
    .limit(1);
  if (existing[0]) return existing[0];

  // First read — create the row using DB column defaults.
  await db.insert(thoughtSettings).values({ id: SINGLETON_ID });
  const after = await db
    .select()
    .from(thoughtSettings)
    .where(eq(thoughtSettings.id, SINGLETON_ID))
    .limit(1);
  if (!after[0]) {
    throw new Error("thought_settings row missing after insert");
  }
  return after[0];
}

export async function updateThoughtSettings(
  patch: Partial<Omit<ThoughtSettings, "id" | "updatedAt">>,
): Promise<void> {
  await db
    .update(thoughtSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(thoughtSettings.id, SINGLETON_ID));
}
```

- [ ] **Step 5.4: Run the test and verify it passes**

Run: `npx vitest run lib/bots/thoughts/settings.test.ts`
Expected: `Tests 3 passed`.

- [ ] **Step 5.5: Commit**

```bash
git add lib/bots/thoughts/settings.ts lib/bots/thoughts/settings.test.ts
git commit -m "feat(thoughts): settings singleton read/write"
```

---

## Task 6: Cooldown + global rate-limit helpers

**Files:**
- Create: `lib/bots/thoughts/cooldowns.ts`
- Create: `lib/bots/thoughts/cooldowns.test.ts`

- [ ] **Step 6.1: Write the failing tests**

Create `lib/bots/thoughts/cooldowns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isCooledDown, isUnderGlobalCap } from "./cooldowns";

describe("isCooledDown", () => {
  it("returns true when there is no prior thought", () => {
    expect(isCooledDown(null, 300)).toBe(true);
  });

  it("returns false when the last thought is within the cooldown window", () => {
    const recent = new Date(Date.now() - 100_000); // 100s ago
    expect(isCooledDown(recent, 300)).toBe(false);
  });

  it("returns true when the last thought is older than the cooldown window", () => {
    const old = new Date(Date.now() - 400_000); // 400s ago
    expect(isCooledDown(old, 300)).toBe(true);
  });
});

describe("isUnderGlobalCap", () => {
  it("returns true when count is below cap", () => {
    expect(isUnderGlobalCap(5, 8)).toBe(true);
  });

  it("returns false at exactly the cap", () => {
    expect(isUnderGlobalCap(8, 8)).toBe(false);
  });

  it("returns false above the cap", () => {
    expect(isUnderGlobalCap(12, 8)).toBe(false);
  });
});
```

- [ ] **Step 6.2: Run the test and verify it fails**

Run: `npx vitest run lib/bots/thoughts/cooldowns.test.ts`
Expected: `Cannot find module './cooldowns'`.

- [ ] **Step 6.3: Implement**

Create `lib/bots/thoughts/cooldowns.ts`:

```ts
// lib/bots/thoughts/cooldowns.ts
//
// Two pure functions used by the orchestrator. Race-tolerant by design:
// the orchestrator reads "last thought" and "thoughts in last 60s" once
// per tick, then checks against those values for every candidate. A
// concurrent tick could blow past the cap by 1-2 — acceptable.

export function isCooledDown(
  lastThoughtAt: Date | null,
  cooldownSeconds: number,
): boolean {
  if (lastThoughtAt === null) return true;
  const elapsedMs = Date.now() - lastThoughtAt.getTime();
  return elapsedMs >= cooldownSeconds * 1000;
}

export function isUnderGlobalCap(
  thoughtsInLastMinute: number,
  maxPerMinute: number,
): boolean {
  return thoughtsInLastMinute < maxPerMinute;
}
```

- [ ] **Step 6.4: Run the test and verify it passes**

Run: `npx vitest run lib/bots/thoughts/cooldowns.test.ts`
Expected: `Tests 6 passed`.

- [ ] **Step 6.5: Commit**

```bash
git add lib/bots/thoughts/cooldowns.ts lib/bots/thoughts/cooldowns.test.ts
git commit -m "feat(thoughts): cooldown + global cap helpers"
```

---

## Task 7: Persist module (insert + latest-per-bot fetch)

**Files:**
- Create: `lib/bots/thoughts/persist.ts`
- Create: `lib/bots/thoughts/types.ts`

- [ ] **Step 7.1: Define shared types**

Create `lib/bots/thoughts/types.ts`:

```ts
// lib/bots/thoughts/types.ts
//
// Shared types for the thought-publication subsystem.

export type ThoughtKind =
  | "near_trade"
  | "banter"
  | "market_react"
  | "position_color"
  | "mood_state";

/** A candidate is the detector's output — eligible to be turned into a thought. */
export interface ThoughtCandidate {
  botId: string;
  kind: ThoughtKind;
  /** Free-form metadata the generator + persist layer can use. */
  meta: Record<string, unknown>;
}

/** A thought row after persist. */
export interface PersistedThought {
  id: string;
  botId: string;
  kind: ThoughtKind;
  content: string;
  refMeta: Record<string, unknown> | null;
  createdAt: Date;
}
```

- [ ] **Step 7.2: Implement the persist module**

Create `lib/bots/thoughts/persist.ts`:

```ts
// lib/bots/thoughts/persist.ts
//
// Read/write helpers for bot_thoughts. The orchestrator + signal builder
// both use these.

import { db } from "@/lib/db";
import { botThoughts } from "@/lib/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { PersistedThought, ThoughtKind } from "./types";

export async function insertThought(args: {
  botId: string;
  kind: ThoughtKind;
  content: string;
  refMeta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(botThoughts).values({
    botId: args.botId,
    kind: args.kind,
    content: args.content,
    refMeta: args.refMeta ?? null,
  });
}

/**
 * For each bot, the most-recent thought of any kind. Used by the bot card
 * to surface a headline. Returns a Map keyed by botId.
 */
export async function getLatestThoughtPerBot(): Promise<
  Map<string, PersistedThought>
> {
  // DISTINCT ON (bot_id) ordered by created_at desc.
  const rows = await db.execute<{
    id: string;
    bot_id: string;
    kind: string;
    content: string;
    ref_meta: unknown;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (bot_id) id, bot_id, kind, content, ref_meta, created_at
    FROM bot_thoughts
    ORDER BY bot_id, created_at DESC
  `);
  const map = new Map<string, PersistedThought>();
  for (const r of rows.rows) {
    map.set(r.bot_id, {
      id: r.id,
      botId: r.bot_id,
      kind: r.kind as ThoughtKind,
      content: r.content,
      refMeta: (r.ref_meta as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at,
    });
  }
  return map;
}

/** Most recent thought timestamp for a specific (bot, kind). Null if none. */
export async function getLastThoughtTimestamp(
  botId: string,
  kind: ThoughtKind,
): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: botThoughts.createdAt })
    .from(botThoughts)
    .where(and(eq(botThoughts.botId, botId), eq(botThoughts.kind, kind)))
    .orderBy(desc(botThoughts.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

/** Count of thoughts inserted in the last 60s. Used for global cap. */
export async function getThoughtsInLastMinute(): Promise<number> {
  const cutoff = new Date(Date.now() - 60_000);
  const rows = await db
    .select({ id: botThoughts.id })
    .from(botThoughts)
    .where(gt(botThoughts.createdAt, cutoff));
  return rows.length;
}
```

- [ ] **Step 7.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7.4: Commit**

```bash
git add lib/bots/thoughts/persist.ts lib/bots/thoughts/types.ts
git commit -m "feat(thoughts): persist module + shared types"
```

---

## Task 8: Near-trade detector

**Files:**
- Create: `lib/bots/thoughts/near-trade.ts` (detector + generator both live here)
- Create: `lib/bots/thoughts/near-trade.test.ts`

- [ ] **Step 8.1: Write the failing tests for the detector**

Create `lib/bots/thoughts/near-trade.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));

import { detectNearTradeCandidates } from "./near-trade";
import type { ExternalSignals } from "../types";

describe("detectNearTradeCandidates — funding strategies", () => {
  it("returns a candidate when funding is 70-99% of threshold", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.000075, // 0.75 bps
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    const out = detectNearTradeCandidates({ bots, signals });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      botId: "funding-phoebe",
      kind: "near_trade",
    });
    expect(out[0].meta).toMatchObject({
      signalKind: "funding",
      asset: "AVAX",
    });
  });

  it("rejects when funding is below 70% of threshold", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.00005, // 0.5 bps, 50% of 1bp threshold
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });

  it("rejects when funding has already crossed threshold (would have fired)", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.0002, // 2 bps, above 1bp threshold
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });
});

describe("detectNearTradeCandidates — liquidation strategies", () => {
  it("returns a candidate when a recent liquidation is 70-99% of minNotional", () => {
    const signals: ExternalSignals = {
      liquidations: [
        {
          asset: "BTC",
          side: "long",
          notionalUsd: 40_000, // 80% of $50K
          ts: Date.now(),
        },
      ],
      funding: {},
    };
    const bots = [
      {
        id: "liquidation-lizard",
        strategyKey: "liquidation-lizard",
        config: { minLiqNotionalUsd: 50_000 },
      },
    ];
    const out = detectNearTradeCandidates({ bots, signals });
    expect(out).toHaveLength(1);
    expect(out[0].meta.signalKind).toBe("liquidation");
  });
});

describe("detectNearTradeCandidates — limit + filtering", () => {
  it("emits at most one candidate per bot per call", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.00009,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
        XRP: {
          avgRate: 0.00008,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    const out = detectNearTradeCandidates({ bots, signals });
    expect(out).toHaveLength(1);
  });

  it("skips trend strategies entirely (no meaningful 'near' state)", () => {
    const signals: ExternalSignals = { liquidations: [], funding: {} };
    const bots = [
      {
        id: "boomer-trend",
        strategyKey: "boomer-trend",
        config: { fastPeriod: 7, slowPeriod: 21 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });
});
```

- [ ] **Step 8.2: Run the test and verify it fails**

Run: `npx vitest run lib/bots/thoughts/near-trade.test.ts`
Expected: `Cannot find module './near-trade'`.

- [ ] **Step 8.3: Implement the detector**

Create `lib/bots/thoughts/near-trade.ts`:

```ts
// lib/bots/thoughts/near-trade.ts
//
// Detector: which bots are CLOSE to firing but haven't? "Close" = the
// strategy-specific signal is within 70-99% of the threshold. We emit at
// most one candidate per bot per tick.
//
// Generator: turn a candidate into an in-character one-liner via xAI.

import { familyOf } from "../wiring";
import { PERSONAS } from "../narrator";
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import type { ExternalSignals } from "../types";
import type { ThoughtCandidate } from "./types";

const MODEL_ID = "grok-4.20-non-reasoning";
const NEAR_LOW = 0.7;
const NEAR_HIGH = 0.99;

interface BotForDetector {
  id: string;
  strategyKey: string;
  config: Record<string, unknown>;
}

export interface DetectNearTradeArgs {
  bots: BotForDetector[];
  signals: ExternalSignals;
}

function readNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function detectNearTradeCandidates(
  args: DetectNearTradeArgs,
): ThoughtCandidate[] {
  const out: ThoughtCandidate[] = [];

  for (const bot of args.bots) {
    const family = familyOf(bot.strategyKey);
    if (!family) continue;

    let cand: ThoughtCandidate | null = null;

    if (family === "funding-phoebe") {
      const threshold = readNumber(bot.config.fundingThreshold, 0.0001);
      const minVenues = readNumber(bot.config.minVenueAgreement, 3);
      for (const [asset, f] of Object.entries(args.signals.funding)) {
        if (f.venuesAgreed < minVenues) continue;
        const mag = Math.abs(f.avgRate);
        const pct = mag / threshold;
        if (pct >= NEAR_LOW && pct < NEAR_HIGH) {
          cand = {
            botId: bot.id,
            kind: "near_trade",
            meta: {
              signalKind: "funding",
              asset,
              currentValue: f.avgRate,
              threshold,
              pctOfThreshold: pct,
            },
          };
          break;
        }
      }
    } else if (family === "liquidation-lizard") {
      const minNotional = readNumber(bot.config.minLiqNotionalUsd, 50_000);
      for (const liq of args.signals.liquidations) {
        const pct = liq.notionalUsd / minNotional;
        if (pct >= NEAR_LOW && pct < NEAR_HIGH) {
          cand = {
            botId: bot.id,
            kind: "near_trade",
            meta: {
              signalKind: "liquidation",
              asset: liq.asset,
              currentValue: liq.notionalUsd,
              threshold: minNotional,
              pctOfThreshold: pct,
            },
          };
          break;
        }
      }
    }
    // momo-max / vol-vector / mean-revert-mike near-detection requires
    // historical candle queries we don't pass into this detector yet.
    // Those families emit no near_trade candidates in the initial cut;
    // the spec marks this as acceptable. Extending later is a follow-up.

    if (cand) out.push(cand);
  }

  return out;
}

export interface GenerateNearTradeArgs {
  personaKey: string;
  meta: Record<string, unknown>;
}

export async function generateNearTradeText(
  args: GenerateNearTradeArgs,
  timeoutMs = 15_000,
): Promise<string | null> {
  const persona = PERSONAS[args.personaKey as keyof typeof PERSONAS];
  if (!persona) return null;

  const prompt = `A signal is forming but has NOT crossed your entry threshold yet.
Details:
  asset: ${args.meta.asset}
  signal_kind: ${args.meta.signalKind}
  current_value: ${args.meta.currentValue}
  threshold: ${args.meta.threshold}
  pct_of_threshold: ${(Number(args.meta.pctOfThreshold) * 100).toFixed(0)}%

Write a single sentence (max ~120 chars) showing you are watching but not
acting yet. Stay in character. No markdown. No quotes around your reply.
Do not start with "I'm watching".`;

  try {
    const { text } = await Promise.race([
      generateText({
        model: xai(MODEL_ID),
        system: persona.systemPrompt,
        prompt,
        maxOutputTokens: 80,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`near-trade timeout ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    return text.trim();
  } catch (err) {
    console.warn(
      `[thoughts] near-trade gen failed for ${args.personaKey}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

- [ ] **Step 8.4: Run the test and verify it passes**

Run: `npx vitest run lib/bots/thoughts/near-trade.test.ts`
Expected: `Tests 6 passed`.

- [ ] **Step 8.5: Commit**

```bash
git add lib/bots/thoughts/near-trade.ts lib/bots/thoughts/near-trade.test.ts
git commit -m "feat(thoughts): near-trade detector + generator"
```

---

## Task 9: Banter detector + generator

**Files:**
- Create: `lib/bots/thoughts/banter.ts`
- Create: `lib/bots/thoughts/banter.test.ts`

- [ ] **Step 9.1: Write the failing tests**

Create `lib/bots/thoughts/banter.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));

import { selectBanterReactors } from "./banter";

const phoebeLite = {
  id: "funding-phoebe-lite",
  strategyKey: "funding-phoebe-lite",
};
const phoebe = { id: "funding-phoebe", strategyKey: "funding-phoebe" };
const mike = { id: "mean-revert-mike", strategyKey: "mean-revert-mike" };
const lizard = { id: "liquidation-lizard", strategyKey: "liquidation-lizard" };

describe("selectBanterReactors", () => {
  it("prefers a bot holding the opposite side of the same asset", () => {
    const out = selectBanterReactors({
      tradeEvent: {
        actor: phoebeLite,
        asset: "XRP",
        side: "long",
        action: "opened",
      },
      candidates: [
        { bot: phoebe, openPositions: [] },
        { bot: mike, openPositions: [{ asset: "XRP", side: "short" }] },
        { bot: lizard, openPositions: [] },
      ],
    });
    expect(out[0].botId).toBe("mean-revert-mike");
  });

  it("uses same-family kinship as a tiebreaker when no opposite-side", () => {
    const out = selectBanterReactors({
      tradeEvent: {
        actor: phoebeLite,
        asset: "XRP",
        side: "long",
        action: "opened",
      },
      candidates: [
        { bot: phoebe, openPositions: [] }, // same family
        { bot: mike, openPositions: [] },
        { bot: lizard, openPositions: [] },
      ],
    });
    expect(out[0].botId).toBe("funding-phoebe");
  });

  it("never selects the actor as its own reactor", () => {
    const out = selectBanterReactors({
      tradeEvent: {
        actor: phoebeLite,
        asset: "XRP",
        side: "long",
        action: "opened",
      },
      candidates: [
        { bot: phoebeLite, openPositions: [] },
        { bot: phoebe, openPositions: [] },
      ],
    });
    expect(out.map((c) => c.botId)).not.toContain("funding-phoebe-lite");
  });

  it("returns at most 2 reactor candidates", () => {
    const out = selectBanterReactors({
      tradeEvent: {
        actor: phoebeLite,
        asset: "XRP",
        side: "long",
        action: "opened",
      },
      candidates: [
        { bot: phoebe, openPositions: [] },
        { bot: mike, openPositions: [{ asset: "XRP", side: "short" }] },
        { bot: lizard, openPositions: [] },
      ],
    });
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 9.2: Run the test and verify it fails**

Run: `npx vitest run lib/bots/thoughts/banter.test.ts`
Expected: `Cannot find module './banter'`.

- [ ] **Step 9.3: Implement**

Create `lib/bots/thoughts/banter.ts`:

```ts
// lib/bots/thoughts/banter.ts
//
// Banter fires within the same tick that another bot opened or closed.
// Selection precedence:
//   1. Opposite-side disagreement on the same asset
//   2. Same-family kinship (variants of the same family)
//   3. Strategy adjacency (different family but same asset watchlist)
//   4. Fallback: skip (no random selection — keeps the feed honest)

import { familyOf } from "../wiring";
import { PERSONAS } from "../narrator";
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import type { ThoughtCandidate } from "./types";

const MODEL_ID = "grok-4.20-non-reasoning";
const MAX_REACTORS = 2;

interface BotRef {
  id: string;
  strategyKey: string;
}

interface OpenPosSnapshot {
  asset: string;
  side: "long" | "short";
}

export interface TradeEvent {
  actor: BotRef;
  asset: string;
  side: "long" | "short";
  action: "opened" | "closed";
  leverage?: number;
  triggerMetaBrief?: string;
}

export interface BanterCandidate {
  bot: BotRef;
  openPositions: OpenPosSnapshot[];
}

export interface SelectBanterArgs {
  tradeEvent: TradeEvent;
  candidates: BanterCandidate[];
}

export function selectBanterReactors(
  args: SelectBanterArgs,
): ThoughtCandidate[] {
  const { tradeEvent, candidates } = args;
  const oppositeSide = tradeEvent.side === "long" ? "short" : "long";
  const actorFamily = familyOf(tradeEvent.actor.strategyKey);

  const tier1: BanterCandidate[] = [];
  const tier2: BanterCandidate[] = [];
  const tier3: BanterCandidate[] = [];

  for (const c of candidates) {
    if (c.bot.id === tradeEvent.actor.id) continue;
    const hasOpposite = c.openPositions.some(
      (p) => p.asset === tradeEvent.asset && p.side === oppositeSide,
    );
    if (hasOpposite) {
      tier1.push(c);
      continue;
    }
    const myFamily = familyOf(c.bot.strategyKey);
    if (myFamily && myFamily === actorFamily) {
      tier2.push(c);
      continue;
    }
    tier3.push(c);
  }

  const ordered = [...tier1, ...tier2, ...tier3];
  return ordered.slice(0, MAX_REACTORS).map((c) => ({
    botId: c.bot.id,
    kind: "banter" as const,
    meta: {
      reactingToActorId: tradeEvent.actor.id,
      asset: tradeEvent.asset,
      side: tradeEvent.side,
      action: tradeEvent.action,
      leverage: tradeEvent.leverage,
      triggerMetaBrief: tradeEvent.triggerMetaBrief,
      // Tier the candidate was placed in helps the generator phrase the reply.
      tier: tier1.includes(c) ? 1 : tier2.includes(c) ? 2 : 3,
      agreeWithActor: tier1.includes(c) ? false : null,
    },
  }));
}

export interface GenerateBanterArgs {
  personaKey: string;
  actorName: string;
  meta: Record<string, unknown>;
}

export async function generateBanterText(
  args: GenerateBanterArgs,
  timeoutMs = 15_000,
): Promise<string | null> {
  const persona = PERSONAS[args.personaKey as keyof typeof PERSONAS];
  if (!persona) return null;

  const verb = args.meta.action === "opened" ? "opened" : "closed";
  const disagree =
    args.meta.agreeWithActor === false
      ? "You hold the OPPOSITE side of this trade."
      : "";

  const prompt = `Another bot just ${verb} a position. Your job is a one-sentence reaction in character.
  bot: ${args.actorName}
  asset: ${args.meta.asset}
  side: ${args.meta.side}
  leverage: ${args.meta.leverage ?? "?"}x
  ${args.meta.triggerMetaBrief ? `their_trigger: ${args.meta.triggerMetaBrief}` : ""}

${disagree}

Write ONE short sentence (max ~120 chars) reacting. Reference them by name.
Stay in your voice. No markdown. No quotes around your reply.`;

  try {
    const { text } = await Promise.race([
      generateText({
        model: xai(MODEL_ID),
        system: persona.systemPrompt,
        prompt,
        maxOutputTokens: 80,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`banter timeout ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    return text.trim();
  } catch (err) {
    console.warn(
      `[thoughts] banter gen failed for ${args.personaKey}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

- [ ] **Step 9.4: Run the test and verify it passes**

Run: `npx vitest run lib/bots/thoughts/banter.test.ts`
Expected: `Tests 4 passed`.

- [ ] **Step 9.5: Commit**

```bash
git add lib/bots/thoughts/banter.ts lib/bots/thoughts/banter.test.ts
git commit -m "feat(thoughts): banter detector + generator"
```

---

## Task 10: Orchestrator (publishThoughts)

**Files:**
- Create: `lib/bots/thoughts.ts`
- Create: `lib/bots/thoughts.test.ts`

- [ ] **Step 10.1: Write the failing tests**

Create `lib/bots/thoughts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const settingsMock = vi.fn();
vi.mock("./thoughts/settings", () => ({
  getThoughtSettings: () => settingsMock(),
}));

const insertMock = vi.fn();
const lastTsMock = vi.fn();
const inLastMinMock = vi.fn();
vi.mock("./thoughts/persist", () => ({
  insertThought: (a: unknown) => insertMock(a),
  getLastThoughtTimestamp: (b: string, k: string) => lastTsMock(b, k),
  getThoughtsInLastMinute: () => inLastMinMock(),
}));

const nearDetectorMock = vi.fn();
const nearGenMock = vi.fn();
vi.mock("./thoughts/near-trade", () => ({
  detectNearTradeCandidates: (a: unknown) => nearDetectorMock(a),
  generateNearTradeText: (a: unknown) => nearGenMock(a),
}));

const banterSelectMock = vi.fn();
const banterGenMock = vi.fn();
vi.mock("./thoughts/banter", () => ({
  selectBanterReactors: (a: unknown) => banterSelectMock(a),
  generateBanterText: (a: unknown) => banterGenMock(a),
}));

import { publishThoughts } from "./thoughts";

beforeEach(() => {
  settingsMock.mockReset();
  insertMock.mockReset();
  lastTsMock.mockReset();
  inLastMinMock.mockReset();
  nearDetectorMock.mockReset();
  nearGenMock.mockReset();
  banterSelectMock.mockReset();
  banterGenMock.mockReset();
});

const ENABLED_SETTINGS = {
  id: "singleton",
  enableNearTrade: true,
  enableBanter: true,
  enableMarketReact: false,
  enablePositionColor: false,
  enableMoodBadges: true,
  cooldownNearTradeSec: 300,
  cooldownBanterSec: 120,
  cooldownMarketReactSec: 180,
  cooldownPositionColorSec: 900,
  maxThoughtsPerMinute: 8,
  updatedAt: new Date(),
};

describe("publishThoughts", () => {
  it("does nothing when all toggles are off", async () => {
    settingsMock.mockResolvedValueOnce({
      ...ENABLED_SETTINGS,
      enableNearTrade: false,
      enableBanter: false,
    });
    await publishThoughts({ bots: [], signals: { liquidations: [], funding: {} }, tickTrades: [], openPositionsByBotId: new Map() });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips a candidate that's inside its cooldown", async () => {
    settingsMock.mockResolvedValueOnce(ENABLED_SETTINGS);
    inLastMinMock.mockResolvedValueOnce(0);
    nearDetectorMock.mockReturnValueOnce([
      {
        botId: "funding-phoebe",
        kind: "near_trade",
        meta: { signalKind: "funding", asset: "AVAX" },
      },
    ]);
    lastTsMock.mockResolvedValueOnce(new Date(Date.now() - 60_000)); // 60s ago, cooldown 300s
    banterSelectMock.mockReturnValue([]);
    await publishThoughts({
      bots: [
        {
          id: "funding-phoebe",
          strategyKey: "funding-phoebe",
          personaVoiceKey: "funding-phoebe",
          config: {},
        },
      ],
      signals: { liquidations: [], funding: {} },
      tickTrades: [],
      openPositionsByBotId: new Map(),
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(nearGenMock).not.toHaveBeenCalled();
  });

  it("stops processing once the global cap is hit", async () => {
    settingsMock.mockResolvedValueOnce({
      ...ENABLED_SETTINGS,
      maxThoughtsPerMinute: 1,
    });
    inLastMinMock.mockResolvedValueOnce(1); // already at cap
    nearDetectorMock.mockReturnValueOnce([
      {
        botId: "funding-phoebe",
        kind: "near_trade",
        meta: { signalKind: "funding", asset: "AVAX" },
      },
    ]);
    banterSelectMock.mockReturnValue([]);
    await publishThoughts({
      bots: [
        {
          id: "funding-phoebe",
          strategyKey: "funding-phoebe",
          personaVoiceKey: "funding-phoebe",
          config: {},
        },
      ],
      signals: { liquidations: [], funding: {} },
      tickTrades: [],
      openPositionsByBotId: new Map(),
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("calls the generator and persists when checks pass", async () => {
    settingsMock.mockResolvedValueOnce(ENABLED_SETTINGS);
    inLastMinMock.mockResolvedValueOnce(0);
    nearDetectorMock.mockReturnValueOnce([
      {
        botId: "funding-phoebe",
        kind: "near_trade",
        meta: { signalKind: "funding", asset: "AVAX" },
      },
    ]);
    lastTsMock.mockResolvedValueOnce(null); // no prior thought
    nearGenMock.mockResolvedValueOnce("AVAX 0.75 bps - watching.");
    banterSelectMock.mockReturnValue([]);
    await publishThoughts({
      bots: [
        {
          id: "funding-phoebe",
          strategyKey: "funding-phoebe",
          personaVoiceKey: "funding-phoebe",
          config: {},
        },
      ],
      signals: { liquidations: [], funding: {} },
      tickTrades: [],
      openPositionsByBotId: new Map(),
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "funding-phoebe",
        kind: "near_trade",
        content: "AVAX 0.75 bps - watching.",
      }),
    );
  });
});
```

- [ ] **Step 10.2: Run the test and verify it fails**

Run: `npx vitest run lib/bots/thoughts.test.ts`
Expected: `Cannot find module './thoughts'`.

- [ ] **Step 10.3: Implement the orchestrator**

Create `lib/bots/thoughts.ts`:

```ts
// lib/bots/thoughts.ts
//
// Orchestrator: pulled in once per resolver tick. Reads settings,
// dispatches enabled detectors, applies cooldowns + global cap, calls
// generators, persists rows.

import { getThoughtSettings } from "./thoughts/settings";
import {
  insertThought,
  getLastThoughtTimestamp,
  getThoughtsInLastMinute,
} from "./thoughts/persist";
import { isCooledDown, isUnderGlobalCap } from "./thoughts/cooldowns";
import {
  detectNearTradeCandidates,
  generateNearTradeText,
} from "./thoughts/near-trade";
import {
  selectBanterReactors,
  generateBanterText,
} from "./thoughts/banter";
import type { ThoughtCandidate, ThoughtKind } from "./thoughts/types";
import type { ExternalSignals } from "./types";

export interface PublishThoughtsBot {
  id: string;
  strategyKey: string;
  personaVoiceKey: string;
  config: Record<string, unknown>;
}

export interface PublishThoughtsTrade {
  actorBotId: string;
  actorStrategyKey: string;
  actorName: string;
  asset: string;
  side: "long" | "short";
  action: "opened" | "closed";
  leverage?: number;
  triggerMetaBrief?: string;
}

export interface PublishThoughtsArgs {
  bots: PublishThoughtsBot[];
  signals: ExternalSignals;
  tickTrades: PublishThoughtsTrade[];
  openPositionsByBotId: Map<
    string,
    Array<{ asset: string; side: "long" | "short" }>
  >;
}

const COOLDOWN_BY_KIND: Record<ThoughtKind, "cooldownNearTradeSec" | "cooldownBanterSec" | "cooldownMarketReactSec" | "cooldownPositionColorSec" | null> = {
  near_trade: "cooldownNearTradeSec",
  banter: "cooldownBanterSec",
  market_react: "cooldownMarketReactSec",
  position_color: "cooldownPositionColorSec",
  mood_state: null, // doesn't use this path
};

export async function publishThoughts(
  args: PublishThoughtsArgs,
): Promise<{ published: number }> {
  const settings = await getThoughtSettings();
  if (!settings.enableNearTrade && !settings.enableBanter) {
    return { published: 0 };
  }

  let countInWindow = await getThoughtsInLastMinute();
  let published = 0;

  // Phase 1: banter first (reactive, time-sensitive).
  const banterCandidates: ThoughtCandidate[] = [];
  if (settings.enableBanter && args.tickTrades.length > 0) {
    for (const trade of args.tickTrades) {
      const candPool = args.bots
        .filter((b) => b.id !== trade.actorBotId)
        .map((b) => ({
          bot: { id: b.id, strategyKey: b.strategyKey },
          openPositions: args.openPositionsByBotId.get(b.id) ?? [],
        }));
      const picked = selectBanterReactors({
        tradeEvent: {
          actor: { id: trade.actorBotId, strategyKey: trade.actorStrategyKey },
          asset: trade.asset,
          side: trade.side,
          action: trade.action,
          leverage: trade.leverage,
          triggerMetaBrief: trade.triggerMetaBrief,
        },
        candidates: candPool,
      });
      for (const p of picked) {
        // Stash the actor name on the meta so the generator can reference it.
        banterCandidates.push({
          ...p,
          meta: { ...p.meta, actorName: trade.actorName },
        });
      }
    }
  }

  // Phase 2: near-trade.
  const nearCandidates: ThoughtCandidate[] = settings.enableNearTrade
    ? detectNearTradeCandidates({ bots: args.bots, signals: args.signals })
    : [];

  // Process banter first, then near-trade (matches phase ordering above).
  const ordered = [...banterCandidates, ...nearCandidates];

  for (const cand of ordered) {
    if (!isUnderGlobalCap(countInWindow, settings.maxThoughtsPerMinute)) break;

    const cooldownField = COOLDOWN_BY_KIND[cand.kind];
    if (!cooldownField) continue;
    const cooldownSec = settings[cooldownField];
    const lastTs = await getLastThoughtTimestamp(cand.botId, cand.kind);
    if (!isCooledDown(lastTs, cooldownSec)) continue;

    const bot = args.bots.find((b) => b.id === cand.botId);
    if (!bot) continue;

    let text: string | null = null;
    if (cand.kind === "near_trade") {
      text = await generateNearTradeText({
        personaKey: bot.personaVoiceKey,
        meta: cand.meta,
      });
    } else if (cand.kind === "banter") {
      text = await generateBanterText({
        personaKey: bot.personaVoiceKey,
        actorName: String(cand.meta.actorName ?? "Another bot"),
        meta: cand.meta,
      });
    }
    if (!text) continue;

    await insertThought({
      botId: cand.botId,
      kind: cand.kind,
      content: text,
      refMeta: cand.meta,
    });
    countInWindow += 1;
    published += 1;
  }

  return { published };
}
```

- [ ] **Step 10.4: Run the test and verify it passes**

Run: `npx vitest run lib/bots/thoughts.test.ts`
Expected: `Tests 4 passed`.

- [ ] **Step 10.5: Commit**

```bash
git add lib/bots/thoughts.ts lib/bots/thoughts.test.ts
git commit -m "feat(thoughts): orchestrator with cooldowns + global cap"
```

---

## Task 11: Wire publishThoughts into the resolver tick

**Files:**
- Modify: `lib/bots/resolver.ts`

- [ ] **Step 11.1: Add the import**

At the top of `lib/bots/resolver.ts`, after the existing narrator imports, add:

```ts
import {
  publishThoughts,
  type PublishThoughtsTrade,
} from "./thoughts";
```

- [ ] **Step 11.2: Collect trade events during the tick**

At the top of `tick()`, after the local counters declaration (`let opened = 0;` etc.), add:

```ts
  const tickTrades: PublishThoughtsTrade[] = [];
```

In the **close** branch, after `closed += 1;`, push:

```ts
        tickTrades.push({
          actorBotId: bot.id,
          actorStrategyKey: bot.strategyKey,
          actorName: bot.name,
          asset: pos.asset,
          side: pos.side,
          action: "closed",
          leverage: pos.leverage,
          triggerMetaBrief: `pnl ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`,
        });
```

In the **open** branch, after `opened += 1;`, push:

```ts
      tickTrades.push({
        actorBotId: bot.id,
        actorStrategyKey: bot.strategyKey,
        actorName: bot.name,
        asset: decision.asset,
        side: decision.side,
        action: "opened",
        leverage: decision.leverage,
        triggerMetaBrief: summarizeTrigger(decisionWithCosts.triggerMeta),
      });
```

Add a helper above `tick()`:

```ts
function summarizeTrigger(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (typeof meta.signalKind === "string") parts.push(String(meta.signalKind));
  if (typeof meta.avgRate === "number") {
    parts.push(`avg ${(meta.avgRate * 10_000).toFixed(2)} bps`);
  }
  if (typeof meta.venuesAgreed === "number" && typeof meta.venuesQueried === "number") {
    parts.push(`${meta.venuesAgreed}/${meta.venuesQueried} venues`);
  }
  if (typeof meta.zScore === "number") parts.push(`z=${meta.zScore.toFixed(2)}`);
  return parts.join(", ");
}
```

- [ ] **Step 11.3: Call publishThoughts at the end of tick()**

Just before `return { opened, closed, busted };`, add:

```ts
  // Build the open-positions snapshot used for banter (asset + side per bot).
  const openPositionsByBotId = new Map<
    string,
    Array<{ asset: string; side: "long" | "short" }>
  >();
  for (const b of listBots()) {
    if (b.status !== "paper") continue;
    const positions = await fetchOpenPositionsForBot(b.id);
    openPositionsByBotId.set(
      b.id,
      positions.map((p) => ({ asset: p.asset, side: p.side })),
    );
  }

  try {
    await publishThoughts({
      bots: listBots()
        .filter((b) => b.status === "paper")
        .map((b) => ({
          id: b.id,
          strategyKey: b.strategyKey,
          personaVoiceKey: b.personaVoiceKey,
          config: (b.config ?? {}) as Record<string, unknown>,
        })),
      signals,
      tickTrades,
      openPositionsByBotId,
    });
  } catch (err) {
    console.warn("[resolver] publishThoughts failed:", err instanceof Error ? err.message : err);
  }
```

- [ ] **Step 11.4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 11.5: Run all resolver tests**

Run: `npx vitest run lib/bots/resolver.test.ts`
Expected: existing 5 tests still green (publishThoughts is wrapped in try/catch and the existing mocks return without it being called).

- [ ] **Step 11.6: Commit**

```bash
git add lib/bots/resolver.ts
git commit -m "feat(resolver): call publishThoughts at end of tick"
```

---

## Task 12: Surface latest thought on BotSignal payload

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/signals/bot-signals.ts`

- [ ] **Step 12.1: Extend the payload type**

In `lib/types.ts`, inside the BotSignal payload, after the `mood` line added earlier, add:

```ts
    // Most-recent thought for this bot of any kind. Null = no thoughts yet,
    // card falls back to "Watching the tape" copy.
    currentThought: {
      kind: string;
      content: string;
      createdAtMs: number;
    } | null;
```

- [ ] **Step 12.2: Populate it in buildBotSignals**

In `lib/signals/bot-signals.ts`:

1. Add import:

```ts
import { getLatestThoughtPerBot } from "@/lib/bots/thoughts/persist";
```

2. Near the top, after `crossBot` is fetched, add:

```ts
  const latestThoughtPerBot = await getLatestThoughtPerBot();
```

3. Inside the per-bot loop, before `signals.push`, compute:

```ts
    const latest = latestThoughtPerBot.get(bot.id) ?? null;
    const currentThought = latest
      ? {
          kind: latest.kind,
          content: latest.content,
          createdAtMs: latest.createdAt.getTime(),
        }
      : null;
```

4. Add `currentThought,` to the payload object.

- [ ] **Step 12.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 12.4: Commit**

```bash
git add lib/types.ts lib/signals/bot-signals.ts
git commit -m "feat(signals): surface latest bot thought on payload"
```

---

## Task 13: BotCard renders thought as headline (with fallback)

**Files:**
- Modify: `components/feed/BotCard.tsx`

- [ ] **Step 13.1: Show currentThought when positions are empty**

Find the block that renders when `positions.length === 0` (the "Watching the tape" empty state). Replace its inner content with:

```tsx
          <div className="flex h-full items-center justify-center text-center text-sm text-white/40">
            <div>
              {p.currentThought ? (
                <p className="italic text-white/85 text-[13px] leading-snug">
                  &ldquo;{p.currentThought.content}&rdquo;
                </p>
              ) : (
                <>
                  <p className="font-semibold text-white/60">Watching the tape</p>
                  <p className="mt-1 text-xs">
                    No active positions · ${p.freeBalanceUsd.toFixed(0)} free
                  </p>
                </>
              )}
            </div>
          </div>
```

- [ ] **Step 13.2: Visual smoke test (manual)**

Refresh `http://localhost:3001/feed`. Bots without positions should now display the latest thought (italicized quote) if one exists, otherwise the old "Watching the tape" copy. Since thoughts aren't yet enabled in admin, you'll still see "Watching the tape" for everyone — that's expected. Task 16 enables them.

- [ ] **Step 13.3: Commit**

```bash
git add components/feed/BotCard.tsx
git commit -m "feat(feed): bot card shows latest thought as headline"
```

---

## Task 14: Extend Chatter timeline with thought events

**Files:**
- Modify: `lib/bots/chatter.ts`
- Modify: `app/(app)/chatter/page.tsx`

- [ ] **Step 14.1: Extend ChatterEvent in chatter.ts**

In `lib/bots/chatter.ts`:

1. Update the `ChatterKind` union:

```ts
export type ChatterKind = "open" | "close" | "thought";
```

2. Update `ChatterEvent` to allow thought-specific shape:

```ts
export interface ChatterEvent {
  id: string;
  kind: ChatterKind;
  ts: number;
  positionId: string | null; // null for thoughts
  botId: string;
  botName: string;
  avatarEmoji: string;
  asset: string | null;       // null for thoughts that aren't asset-specific
  side: "long" | "short" | null;
  leverage: number | null;
  stakeUsd: number | null;
  entryMark: number | null;
  exitMark: number | null;
  paperPnlUsd: number | null;
  narration: string;          // for thoughts: the content
  thoughtKind?: "near_trade" | "banter" | "market_react" | "position_color";
}
```

3. After the existing `for (const r of rows)` loop, add a second query for thoughts:

```ts
  const thoughtRows = await db
    .select({
      id: botThoughts.id,
      botId: botThoughts.botId,
      kind: botThoughts.kind,
      content: botThoughts.content,
      refMeta: botThoughts.refMeta,
      createdAt: botThoughts.createdAt,
      botName: bots.name,
      avatarEmoji: bots.avatarEmoji,
    })
    .from(botThoughts)
    .innerJoin(bots, eq(bots.id, botThoughts.botId))
    .orderBy(desc(botThoughts.createdAt))
    .limit(limit);

  for (const r of thoughtRows) {
    const meta = (r.refMeta as Record<string, unknown> | null) ?? {};
    events.push({
      id: r.id,
      kind: "thought",
      ts: r.createdAt.getTime(),
      positionId: null,
      botId: r.botId,
      botName: r.botName,
      avatarEmoji: r.avatarEmoji,
      asset: typeof meta.asset === "string" ? meta.asset : null,
      side: meta.side === "long" || meta.side === "short" ? (meta.side as "long" | "short") : null,
      leverage: typeof meta.leverage === "number" ? meta.leverage : null,
      stakeUsd: null,
      entryMark: null,
      exitMark: null,
      paperPnlUsd: null,
      narration: r.content,
      thoughtKind: r.kind as ChatterEvent["thoughtKind"],
    });
  }
```

Update the imports at the top: `import { bots, paperPositions, botThoughts } from "@/lib/db/schema";`.

- [ ] **Step 14.2: Render thoughts on the chatter page**

In `app/(app)/chatter/page.tsx`, update the `EventRow` function to handle `ev.kind === "thought"`:

```tsx
  if (ev.kind === "thought") {
    return (
      <li className="border-b border-white/5 px-5 py-3 transition hover:bg-white/[0.02]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-2xl leading-none">{ev.avatarEmoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
              <span className="font-bold text-white">{ev.botName}</span>
              <span className="text-white/40">{ev.thoughtKind === "banter" ? "reacts" : "muses"}</span>
              {ev.asset && <span className="font-bold text-white">{ev.asset}</span>}
              <span className="ml-auto text-[10px] text-white/30">{fmtAge(ev.ts)}</span>
            </div>
            <p className="mt-1 text-[13px] italic leading-snug text-white/85">
              &ldquo;{ev.narration}&rdquo;
            </p>
          </div>
        </div>
      </li>
    );
  }
```

Place this block right before the existing trade-event return (the open/close render).

- [ ] **Step 14.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 14.4: Commit**

```bash
git add lib/bots/chatter.ts app/\(app\)/chatter/page.tsx
git commit -m "feat(chatter): include bot thoughts in timeline"
```

---

## Task 15: Admin settings page UI + form

**Files:**
- Create: `app/admin/thoughts/page.tsx`
- Create: `components/admin/ThoughtSettingsForm.tsx`

- [ ] **Step 15.1: Server page that loads settings + recent thoughts**

Create `app/admin/thoughts/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { botThoughts, bots } from "@/lib/db/schema";
import { desc, eq, gt } from "drizzle-orm";
import { isAdminEnabled } from "@/lib/admin/auth";
import { getThoughtSettings } from "@/lib/bots/thoughts/settings";
import { ThoughtSettingsForm } from "@/components/admin/ThoughtSettingsForm";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 50;

export default async function ThoughtsAdminPage() {
  if (!isAdminEnabled()) {
    return <div className="p-6 text-zinc-400">Not found.</div>;
  }
  const settings = await getThoughtSettings();
  const recent = await db
    .select({
      id: botThoughts.id,
      botName: bots.name,
      avatarEmoji: bots.avatarEmoji,
      kind: botThoughts.kind,
      content: botThoughts.content,
      createdAt: botThoughts.createdAt,
    })
    .from(botThoughts)
    .innerJoin(bots, eq(bots.id, botThoughts.botId))
    .orderBy(desc(botThoughts.createdAt))
    .limit(RECENT_LIMIT);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const today = await db
    .select({ id: botThoughts.id })
    .from(botThoughts)
    .where(gt(botThoughts.createdAt, since));
  const estCostUsd = (today.length * 0.002).toFixed(2);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bot Thoughts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Continuous in-character publishing from the bot roster. All toggles
          default off; flip them on as you tune cooldowns. xAI-driven; cost
          tracker below.
        </p>
      </div>

      <ThoughtSettingsForm initial={settings} />

      <div className="rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Today</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Thoughts published in the last 24h:{" "}
          <span className="font-bold text-zinc-100">{today.length}</span>
          &nbsp;·&nbsp;Estimated xAI spend:{" "}
          <span className="font-bold text-zinc-100">${estCostUsd}</span>
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800">
        <div className="border-b border-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-200">
          Recent (last {RECENT_LIMIT})
        </div>
        <ul className="divide-y divide-zinc-800">
          {recent.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-zinc-500">
              No thoughts yet. Enable a toggle above and trigger a tick.
            </li>
          )}
          {recent.map((r) => (
            <li key={r.id} className="flex items-baseline gap-3 px-4 py-2 text-xs">
              <span className="w-12 shrink-0 text-zinc-500">
                {fmtTime(r.createdAt)}
              </span>
              <span className="text-base leading-none">{r.avatarEmoji}</span>
              <span className="w-44 shrink-0 truncate font-semibold text-zinc-200">
                {r.botName}
              </span>
              <span className="w-24 shrink-0 text-zinc-500">{r.kind}</span>
              <span className="flex-1 truncate italic text-zinc-300">
                &ldquo;{r.content}&rdquo;
              </span>
              <form action={`/api/admin/thoughts/${r.id}`} method="post">
                <input type="hidden" name="_method" value="DELETE" />
                <button
                  type="submit"
                  className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
                >
                  delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function fmtTime(d: Date): string {
  return d.toISOString().slice(11, 16);
}
```

- [ ] **Step 15.2: Client form for the settings toggles**

Create `components/admin/ThoughtSettingsForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Settings {
  enableNearTrade: boolean;
  enableBanter: boolean;
  enableMarketReact: boolean;
  enablePositionColor: boolean;
  enableMoodBadges: boolean;
  cooldownNearTradeSec: number;
  cooldownBanterSec: number;
  maxThoughtsPerMinute: number;
}

interface Props {
  initial: Settings;
}

export function ThoughtSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/thoughts/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!r.ok) throw new Error(await r.text());
      setMsg("Saved.");
      router.refresh();
    } catch (err) {
      setMsg(`Failed: ${String(err).slice(0, 120)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="space-y-3 rounded-lg border border-zinc-800 p-4"
    >
      <h2 className="text-sm font-semibold text-zinc-200">Content types</h2>

      <Toggle
        label="Near-trade thoughts"
        checked={state.enableNearTrade}
        onChange={(v) => setState({ ...state, enableNearTrade: v })}
        helper={`Cooldown ${state.cooldownNearTradeSec}s per bot`}
      />
      <Toggle
        label="Bot-to-bot banter"
        checked={state.enableBanter}
        onChange={(v) => setState({ ...state, enableBanter: v })}
        helper={`Cooldown ${state.cooldownBanterSec}s per bot`}
      />
      <Toggle
        label="Market reactions"
        checked={false}
        onChange={() => {}}
        disabled
        helper="coming soon"
      />
      <Toggle
        label="Position commentary"
        checked={false}
        onChange={() => {}}
        disabled
        helper="coming soon"
      />

      <h2 className="pt-3 text-sm font-semibold text-zinc-200">Mood badges</h2>
      <Toggle
        label="Show mood badge on bot cards"
        checked={state.enableMoodBadges}
        onChange={(v) => setState({ ...state, enableMoodBadges: v })}
        helper="Deterministic, no LLM cost"
      />

      <h2 className="pt-3 text-sm font-semibold text-zinc-200">Rate limit</h2>
      <NumberField
        label="Max thoughts per minute (roster total)"
        value={state.maxThoughtsPerMinute}
        onChange={(v) => setState({ ...state, maxThoughtsPerMinute: v })}
        min={1}
        max={60}
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  helper,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  helper?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between text-xs ${disabled ? "opacity-50" : ""}`}
    >
      <span className="text-zinc-300">
        {label}
        {helper && (
          <span className="ml-2 text-zinc-500">— {helper}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex items-center justify-between text-xs">
      <span className="text-zinc-300">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
        className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-right text-xs text-zinc-100"
      />
    </label>
  );
}
```

- [ ] **Step 15.3: Visual smoke test**

Navigate to `http://localhost:3001/admin/thoughts`. Confirm the page renders with all toggles unchecked except mood badges. The two "coming soon" toggles should be visibly disabled.

- [ ] **Step 15.4: Commit**

```bash
git add app/admin/thoughts/page.tsx components/admin/ThoughtSettingsForm.tsx
git commit -m "feat(admin): /admin/thoughts page with settings form"
```

---

## Task 16: Admin API routes (POST settings, DELETE thought)

**Files:**
- Create: `app/api/admin/thoughts/settings/route.ts`
- Create: `app/api/admin/thoughts/[id]/route.ts`

- [ ] **Step 16.1: Settings POST**

Create `app/api/admin/thoughts/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isAdminEnabled } from "@/lib/admin/auth";
import { updateThoughtSettings } from "@/lib/bots/thoughts/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set([
  "enableNearTrade",
  "enableBanter",
  "enableMarketReact",
  "enablePositionColor",
  "enableMoodBadges",
  "cooldownNearTradeSec",
  "cooldownBanterSec",
  "cooldownMarketReactSec",
  "cooldownPositionColorSec",
  "maxThoughtsPerMinute",
]);

export async function POST(req: Request) {
  if (!isAdminEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) {
      patch[k] = v;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no recognized fields" }, { status: 400 });
  }
  await updateThoughtSettings(patch);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 16.2: DELETE one thought**

Create `app/api/admin/thoughts/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botThoughts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdminEnabled } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

// Plain HTML <form method="post"> can't issue DELETE; the admin page
// sends POST with body `_method=DELETE`. Support both verbs here.
async function handleDelete(_req: Request, { params }: Params) {
  if (!isAdminEnabled()) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  await db.delete(botThoughts).where(eq(botThoughts.id, id));
  return NextResponse.redirect(new URL("/admin/thoughts", _req.url));
}

export const POST = handleDelete;
export const DELETE = handleDelete;
```

- [ ] **Step 16.3: Manual smoke test**

In the admin UI, check "Bot-to-bot banter" → click Save → page refreshes → setting shows checked. Toggle it off → save → unchecked.

- [ ] **Step 16.4: Commit**

```bash
git add app/api/admin/thoughts/
git commit -m "feat(admin): settings POST + thought DELETE routes"
```

---

## Task 17: Probe script — manual end-to-end

**Files:**
- Create: `scripts/probe-thoughts.ts`

- [ ] **Step 17.1: Write the probe**

Create `scripts/probe-thoughts.ts`:

```ts
// scripts/probe-thoughts.ts
// Enables both content toggles, triggers a synthetic tick context that
// includes one fake trade event, then prints what publishThoughts inserts.
// Run with: npx tsx --env-file=.env.local scripts/probe-thoughts.ts
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { publishThoughts } from "../lib/bots/thoughts";
import { listBots } from "../lib/bots";
import { getMarksSnapshot } from "../lib/data/marks";
import { getRecentLiquidations } from "../lib/hyperliquid/client";
import { getFundingRates } from "../lib/data/cex-funding";
import type { PublishThoughtsTrade } from "../lib/bots/thoughts";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  // Force-enable both toggles + bump per-min cap for the probe.
  await sql`
    INSERT INTO thought_settings (id, enable_near_trade, enable_banter, max_thoughts_per_minute)
    VALUES ('singleton', true, true, 30)
    ON CONFLICT (id) DO UPDATE SET
      enable_near_trade = true,
      enable_banter = true,
      max_thoughts_per_minute = 30
  `;

  const before = (await sql`SELECT COUNT(*)::int AS n FROM bot_thoughts`)[0]
    .n as number;

  const [_, liquidations, funding] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
  ]);

  // Synthesize one trade event so banter has something to react to.
  const someBot = listBots().find((b) => b.status === "paper");
  const tickTrades: PublishThoughtsTrade[] = someBot
    ? [
        {
          actorBotId: someBot.id,
          actorStrategyKey: someBot.strategyKey,
          actorName: someBot.name,
          asset: "BTC",
          side: "long",
          action: "opened",
          leverage: 10,
          triggerMetaBrief: "probe synthetic",
        },
      ]
    : [];

  const result = await publishThoughts({
    bots: listBots()
      .filter((b) => b.status === "paper")
      .map((b) => ({
        id: b.id,
        strategyKey: b.strategyKey,
        personaVoiceKey: b.personaVoiceKey,
        config: (b.config ?? {}) as Record<string, unknown>,
      })),
    signals: { liquidations, funding },
    tickTrades,
    openPositionsByBotId: new Map(),
  });

  const after = (await sql`SELECT COUNT(*)::int AS n FROM bot_thoughts`)[0]
    .n as number;
  console.log(`Published: ${result.published}, total in table: ${before} → ${after}`);

  const rows = (await sql`
    SELECT bot_id, kind, content
    FROM bot_thoughts
    ORDER BY created_at DESC
    LIMIT 8
  `) as Array<{ bot_id: string; kind: string; content: string }>;
  for (const r of rows) {
    console.log(`  [${r.kind}] ${r.bot_id}: "${r.content.slice(0, 100)}"`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 17.2: Run the probe**

Run: `npx tsx --env-file=.env.local scripts/probe-thoughts.ts`

Expected: `Published: N` where N >= 1 (xAI rate-limiting can drop some calls; even 1 success proves the wiring). Output lists recent thoughts with bot id, kind, content.

- [ ] **Step 17.3: Verify the bot card surfaces a thought**

Open `http://localhost:3001/feed` and find any bot without an open position. Its card should now show an italicized thought instead of "Watching the tape".

- [ ] **Step 17.4: Verify the chatter timeline shows thought rows**

Open `http://localhost:3001/chatter`. Recent thoughts appear interleaved with trade events, marked as "muses" or "reacts" instead of "opened"/"closed".

- [ ] **Step 17.5: Commit**

```bash
git add scripts/probe-thoughts.ts
git commit -m "chore(scripts): end-to-end probe for bot thoughts"
```

---

## Task 18: Final integration check

**Files:** none (verification only)

- [ ] **Step 18.1: Full typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 18.2: Full test suite**

Run: `npx vitest run`
Expected: all green. Should include the new tests:
- `lib/bots/mood.test.ts` (7 tests)
- `lib/bots/thoughts/settings.test.ts` (3 tests)
- `lib/bots/thoughts/cooldowns.test.ts` (6 tests)
- `lib/bots/thoughts/near-trade.test.ts` (6 tests)
- `lib/bots/thoughts/banter.test.ts` (4 tests)
- `lib/bots/thoughts.test.ts` (4 tests)
- Plus the pre-existing tests in resolver.test.ts and paper.test.ts.

- [ ] **Step 18.3: Visual confirmation**

In a browser, walk through:
1. `/feed` — every bot card shows a mood badge. Bots without positions show a thought (if enabled) or "Watching the tape".
2. `/chatter` — timeline interleaves thoughts ("muses" / "reacts") with trades ("opened" / "closed").
3. `/admin/thoughts` — 4 content checkboxes (2 functional, 2 disabled), mood toggle, rate-limit field, today's cost tracker, recent list with delete.

- [ ] **Step 18.4: Final commit (if anything pending)**

```bash
git status
# if clean → no final commit needed
```

---

## Coverage check (writer's self-review)

| Spec requirement | Task |
|---|---|
| `bot_thoughts` table | Task 1 |
| `thought_settings` table | Task 1 |
| Mood badge state machine | Task 2 |
| Mood on BotSignal payload | Task 3 |
| Mood badge UI | Task 4 |
| Settings read/write (with defaults) | Task 5 |
| Per-bot cooldown helper | Task 6 |
| Global rate-limit helper | Task 6 |
| Persist insert + latest-per-bot | Task 7 |
| Near-trade detector (funding, liquidation) | Task 8 |
| Near-trade generator (xAI) | Task 8 |
| Banter selector (4-tier precedence) | Task 9 |
| Banter generator (xAI) | Task 9 |
| Orchestrator (settings → cooldowns → cap → gen → persist) | Task 10 |
| Banter-first ordering | Task 10 |
| Resolver tick integration | Task 11 |
| Tick-trade collection | Task 11 |
| currentThought on payload | Task 12 |
| BotCard headline replacement | Task 13 |
| Chatter timeline includes thoughts | Task 14 |
| `/admin/thoughts` page | Task 15 |
| 4 checkboxes, 2 disabled | Task 15 |
| Mood toggle | Task 15 |
| Cost tracker | Task 15 |
| Recent thoughts list with delete | Task 15 |
| POST /settings | Task 16 |
| DELETE one thought | Task 16 |
| Probe + verification | Task 17 |
| Final integration | Task 18 |

Spec sections **not** in this plan (explicitly out of scope per spec):
- `market_react` detector + generator
- `position_color` detector + generator
- Voice / animated emote / dreams / inverse bets / squad mode / tickertape / profile pages / lore

The two unimplemented content types still render in the admin UI as disabled
checkboxes (Task 15), preserving the surface area for the follow-up plan.
