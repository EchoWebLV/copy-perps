# Pulse Social Tape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/chatter` analysis stream with a compact Pulse social tape generated from live whale positions.

**Architecture:** Keep `/chatter` as the route, but relabel navigation as Pulse. Add a pure `pulse-items` mapper that turns `WhalePositionSignal[]` into scored social tape items, then render those items in a new client component that reuses the existing whale tail modal and polling pattern.

**Tech Stack:** Next.js App Router, React client components, Vitest, existing whale signal APIs, existing TailModal.

---

## File Structure

- Modify `components/shell/nav-items.ts`: change desktop nav label from `Chatter` to `Pulse`.
- Modify `components/shell/BottomNav.tsx`: change mobile tab label from `Chatter` to `Pulse`.
- Create `components/whales/pulse-items.ts`: pure mapping and scoring from whale position signals to Pulse feed items.
- Create `components/whales/pulse-items.test.ts`: tests for fresh-open, big-position, profit, pain, entry-gap, sorting, and copyability.
- Create `components/whales/WhalePulseFeed.tsx`: client route component for the social tape.
- Create `components/whales/whale-pulse-feed-contract.test.ts`: source contract tests for route intent and UI copy.
- Modify `app/(app)/chatter/page.tsx`: render `WhalePulseFeed` instead of `WhaleAnalysisStream` when whale social mode is enabled.
- Modify `components/shell/nav-items.test.ts`: update navigation expectation to Pulse if needed.

---

### Task 1: Rename Navigation To Pulse

**Files:**
- Modify: `components/shell/nav-items.ts`
- Modify: `components/shell/BottomNav.tsx`
- Test: `components/shell/nav-items.test.ts`

- [x] **Step 1: Write the failing test**

Update the nav test to expect `Pulse` in desktop navigation and no `Chatter` label:

```ts
expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).toContain("Pulse");
expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain("Chatter");
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- components/shell/nav-items.test.ts`

Expected: FAIL because desktop nav still contains `Chatter`.

- [x] **Step 3: Implement minimal nav changes**

Change:

```ts
{ href: "/chatter", label: "Chatter", icon: Radio },
```

to:

```ts
{ href: "/chatter", label: "Pulse", icon: Radio },
```

Change the mobile `LEFT_TABS` entry:

```ts
{ href: "/chatter", icon: Radio, label: "Pulse" },
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- components/shell/nav-items.test.ts`

Expected: PASS.

---

### Task 2: Add Pure Pulse Item Mapping

**Files:**
- Create: `components/whales/pulse-items.ts`
- Create: `components/whales/pulse-items.test.ts`

- [x] **Step 1: Write failing tests**

Create tests that build minimal `WhalePositionSignal` objects and assert:

```ts
expect(items.map((item) => item.kind)).toContain("fresh_open");
expect(items.map((item) => item.kind)).toContain("big_position");
expect(items.map((item) => item.kind)).toContain("deep_profit");
expect(items.map((item) => item.kind)).toContain("pain_trade");
expect(items.map((item) => item.kind)).toContain("entry_gap");
expect(items[0]?.score).toBeGreaterThanOrEqual(items[1]?.score ?? 0);
expect(items.find((item) => item.position.stale)?.canTail).toBe(false);
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- components/whales/pulse-items.test.ts`

Expected: FAIL because `pulse-items.ts` does not exist.

- [x] **Step 3: Implement mapper**

Export:

```ts
export type PulseItemKind =
  | "fresh_open"
  | "big_position"
  | "deep_profit"
  | "pain_trade"
  | "entry_gap";

export interface PulseItem {
  id: string;
  kind: PulseItemKind;
  score: number;
  eyebrow: string;
  headline: string;
  context: string;
  reactionSeed: number;
  canTail: boolean;
  position: WhalePositionSignal["payload"];
}

export function buildPulseItems(
  positions: WhalePositionSignal[],
  nowMs: number,
): PulseItem[];
```

Implementation rules:

- Fresh Open: `nowMs - openedAtMs <= 15 * 60_000`.
- Big Position: `notionalUsd >= 500_000`.
- Deep In Profit: `unrealizedPnlPct >= 25`.
- Pain Trade: `unrealizedPnlPct <= -10`.
- Entry Gap: `analysis.entryGapWarning !== null`.
- `canTail = !stale && copyableOnPacifica !== false`.
- Sort descending by `score`.
- Limit output to the top 80 items.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- components/whales/pulse-items.test.ts`

Expected: PASS.

---

### Task 3: Render Pulse Feed On `/chatter`

**Files:**
- Create: `components/whales/WhalePulseFeed.tsx`
- Create: `components/whales/whale-pulse-feed-contract.test.ts`
- Modify: `app/(app)/chatter/page.tsx`

- [x] **Step 1: Write failing route/component contract tests**

Add source-level tests asserting:

```ts
expect(routeSource).toContain("WhalePulseFeed");
expect(routeSource).not.toContain("WhaleAnalysisStream");
expect(componentSource).toContain("PULSE");
expect(componentSource).toContain("Watching");
expect(componentSource).toContain("Bullish");
expect(componentSource).toContain("Fading");
expect(componentSource).not.toContain("SUMMARY");
expect(componentSource).not.toContain("THESIS");
expect(componentSource).not.toContain("RISK");
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- components/whales/whale-pulse-feed-contract.test.ts`

Expected: FAIL because `WhalePulseFeed.tsx` does not exist and the route still imports `WhaleAnalysisStream`.

- [x] **Step 3: Implement `WhalePulseFeed`**

Component requirements:

- Use `buildPulseItems(positions, now)`.
- Poll `/api/whales/live` every 10 seconds like the current analysis stream.
- Render compact posts with avatar, kind label, headline, context, position stats, holding time, and reactions.
- Local-only reaction state: clicking `Watching`, `Bullish`, or `Fading` toggles the selected reaction for that item.
- Tail button opens `TailModal` for copyable fresh positions.
- Non-copyable positions show `Watch only`.

- [x] **Step 4: Swap route to Pulse**

In `app/(app)/chatter/page.tsx`, replace:

```ts
import { WhaleAnalysisStream } from "@/components/whales/WhaleAnalysisStream";
...
<WhaleAnalysisStream initialPositions={positions} />
```

with:

```ts
import { WhalePulseFeed } from "@/components/whales/WhalePulseFeed";
...
<WhalePulseFeed initialPositions={positions} />
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npm test -- components/whales/whale-pulse-feed-contract.test.ts`

Expected: PASS.

---

### Task 4: Verify The Feature

**Files:**
- All files changed in tasks 1-3.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- components/shell/nav-items.test.ts components/whales/pulse-items.test.ts components/whales/whale-pulse-feed-contract.test.ts
```

Expected: PASS.

- [x] **Step 2: Run broader checks**

Run:

```bash
npm test -- components/whales components/shell
npm run typecheck
```

Expected: PASS.

- [x] **Step 3: Browser verify**

Open `http://localhost:4000/chatter`.

Expected:

- Nav says `Pulse`.
- Route heading says `PULSE`.
- Cards are compact posts, not large Summary/Thesis/Risk analysis blocks.
- At least one item has social reactions.
- Copyable items show a `Tail` action.

- [ ] **Step 4: Commit**

```bash
git add components/shell/nav-items.ts components/shell/BottomNav.tsx components/shell/nav-items.test.ts components/whales/pulse-items.ts components/whales/pulse-items.test.ts components/whales/WhalePulseFeed.tsx components/whales/whale-pulse-feed-contract.test.ts 'app/(app)/chatter/page.tsx' docs/superpowers/plans/2026-05-24-pulse-social-tape.md
git commit -m "Replace chatter with Pulse social tape"
```
