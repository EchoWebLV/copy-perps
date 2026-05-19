# Responsive Desktop Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive desktop command-center layout while preserving the current mobile-first app behavior.

**Architecture:** Keep route data and trading logic unchanged. Add reusable shell/navigation primitives, then make each route render its existing mobile experience below `1024px` and a desktop-specific layout at `lg+`. Extract small pure helpers for selection/navigation contracts so the riskiest UI state has Vitest coverage.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, Playwright/browser verification, lucide-react.

---

## File Structure

Create:

- `components/shell/nav-items.ts`: shared desktop navigation item list and active-route helper.
- `components/shell/nav-items.test.ts`: Vitest coverage for nav destinations and active-route behavior.
- `components/shell/AppShell.tsx`: desktop shell with left nav, main work area, and optional right rail.
- `components/shell/DesktopNav.tsx`: icon-only desktop nav with labels, active state, and accessible names.
- `components/shell/DesktopContextRail.tsx`: reusable right rail sections and empty state.
- `components/feed/bot-selection.ts`: deterministic selected-bot helper for desktop `/feed`.
- `components/feed/bot-selection.test.ts`: Vitest coverage for selected-bot fallback behavior.
- `components/feed/BotRosterDesktop.tsx`: desktop command-center version of the roster.
- `components/feed/live-positions.ts`: shared flattening helper for live position data.
- `components/feed/live-positions.test.ts`: Vitest coverage for flattening and recency sort.
- `components/feed/LiveFeedDesktop.tsx`: desktop version of `/live`.

Modify:

- `app/globals.css`: remove desktop phone-frame clipping, add app-shell layout utilities, keep mobile full-screen behavior.
- `app/(app)/layout.tsx`: rename wrapper class from phone-specific containment to app root containment while keeping providers.
- `app/page.tsx`: keep redirect behavior unless `/feed` route naming changes; no functional change expected.
- `components/shell/BottomNav.tsx`: hide on desktop with `lg:hidden`.
- `components/shell/BalancePill.tsx`: hide floating balance pill on desktop; desktop balance appears in shell rails.
- `components/feed/BotRoster.tsx`: render mobile current roster below `lg`, render `BotRosterDesktop` at `lg+`.
- `components/feed/LiveFeed.tsx`: reuse `flattenBotPositions`, render existing snap feed below `lg`, render `LiveFeedDesktop` at `lg+`.
- `components/feed/BotChatSheet.tsx`: make desktop width constrained and centered/right-panel friendly without changing mobile bottom sheet behavior.
- `app/(app)/portfolio/page.tsx`: add desktop shell layout and wider position list while preserving existing mobile stack.
- `app/(app)/chatter/page.tsx`: add desktop shell layout and right rail while preserving existing mobile stack.
- `app/(app)/deposit/page.tsx`: add desktop shell layout with funding main area and preferences rail while preserving existing mobile stack.
- `app/(app)/leaderboard/page.tsx`: add desktop shell layout and grid/list adaptation.

Do not modify:

- `app/api/**`
- `lib/bets/**`
- `lib/pacifica/**`
- `lib/bots/strategies/**`
- database schema files

---

### Task 1: Desktop Navigation Contract

**Files:**
- Create: `components/shell/nav-items.ts`
- Create: `components/shell/nav-items.test.ts`

- [ ] **Step 1: Write the failing nav contract tests**

Create `components/shell/nav-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DESKTOP_NAV_ITEMS, isShellNavActive } from "./nav-items";

describe("desktop shell nav contract", () => {
  it("exposes the main app destinations in display order", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/feed",
      "/live",
      "/chatter",
      "/portfolio",
      "/deposit",
      "/leaderboard",
    ]);
  });

  it("marks feed and live nested paths active", () => {
    expect(isShellNavActive("/feed", "/feed")).toBe(true);
    expect(isShellNavActive("/feed", "/feed?bot=whale")).toBe(true);
    expect(isShellNavActive("/live", "/live?bot=whale")).toBe(true);
  });

  it("does not mark unrelated destinations active", () => {
    expect(isShellNavActive("/feed", "/portfolio")).toBe(false);
    expect(isShellNavActive("/deposit", "/leaderboard")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- components/shell/nav-items.test.ts
```

Expected: FAIL because `components/shell/nav-items.ts` does not exist.

- [ ] **Step 3: Implement nav item module**

Create `components/shell/nav-items.ts`:

```ts
import { Flame, Radio, PieChart, Settings, Trophy, Zap } from "lucide-react";

export const DESKTOP_NAV_ITEMS = [
  { href: "/feed", label: "Roster", icon: Flame },
  { href: "/live", label: "Live", icon: Zap },
  { href: "/chatter", label: "Chatter", icon: Radio },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/deposit", label: "Settings", icon: Settings },
  { href: "/leaderboard", label: "Wins", icon: Trophy },
] as const;

export type DesktopNavItem = (typeof DESKTOP_NAV_ITEMS)[number];

export function isShellNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split("?")[0] ?? pathname;
  if (cleanPath === href) return true;
  return cleanPath.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- components/shell/nav-items.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add components/shell/nav-items.ts components/shell/nav-items.test.ts
git commit -m "test: define desktop nav contract"
```

---

### Task 2: Shared Desktop Shell Components

**Files:**
- Create: `components/shell/DesktopNav.tsx`
- Create: `components/shell/DesktopContextRail.tsx`
- Create: `components/shell/AppShell.tsx`
- Modify: `components/shell/BottomNav.tsx`
- Modify: `components/shell/BalancePill.tsx`
- Modify: `app/globals.css`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Add desktop nav component**

Create `components/shell/DesktopNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCENT, BG, DIM, FAINT, FG, FONT_DISPLAY, PANEL } from "@/components/v2/ui";
import { DESKTOP_NAV_ITEMS, isShellNavActive } from "./nav-items";

export function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav
      className="hidden lg:flex lg:h-dvh lg:w-[76px] lg:flex-col lg:items-center lg:border-r lg:px-3 lg:py-4"
      style={{ background: BG, borderColor: FAINT, fontFamily: FONT_DISPLAY }}
      aria-label="Primary"
    >
      <Link
        href="/feed"
        className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl text-[12px] font-black"
        style={{ background: ACCENT, color: BG }}
        aria-label="Breach roster"
      >
        B
      </Link>
      <div className="flex flex-1 flex-col gap-2">
        {DESKTOP_NAV_ITEMS.map((item) => {
          const active = isShellNavActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              title={item.label}
              className="group relative flex h-11 w-11 items-center justify-center rounded-2xl transition active:scale-95"
              style={{
                background: active ? ACCENT : PANEL,
                color: active ? BG : FG,
                border: `1px solid ${active ? ACCENT : FAINT}`,
                opacity: active ? 1 : 0.68,
              }}
            >
              <Icon size={19} strokeWidth={active ? 3 : 2.4} />
              <span
                className="pointer-events-none absolute left-[52px] z-50 hidden rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest group-hover:block"
                style={{ background: PANEL, color: active ? ACCENT : DIM, border: `1px solid ${FAINT}` }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Add context rail component**

Create `components/shell/DesktopContextRail.tsx`:

```tsx
import type { ReactNode } from "react";
import { DIM, FAINT, FG, FONT_DISPLAY, PANEL } from "@/components/v2/ui";

export function DesktopContextRail({
  children,
  title = "Context",
}: {
  children?: ReactNode;
  title?: string;
}) {
  return (
    <aside
      className="hidden min-h-0 w-[340px] shrink-0 flex-col border-l p-4 xl:flex"
      style={{ borderColor: FAINT, fontFamily: FONT_DISPLAY }}
      aria-label={title}
    >
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: DIM }}>
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children ?? (
          <div
            className="rounded-xl p-4 text-[11px] font-black uppercase tracking-widest"
            style={{ background: PANEL, border: `1px solid ${FAINT}`, color: FG }}
          >
            Select a bot or position to see details.
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Add app shell component**

Create `components/shell/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { BG, FG, FONT_DISPLAY } from "@/components/v2/ui";
import { DesktopContextRail } from "./DesktopContextRail";
import { DesktopNav } from "./DesktopNav";

export function AppShell({
  children,
  rail,
  railTitle,
  mainClassName = "",
}: {
  children: ReactNode;
  rail?: ReactNode;
  railTitle?: string;
  mainClassName?: string;
}) {
  return (
    <div className="h-full w-full lg:flex lg:h-dvh lg:overflow-hidden" style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}>
      <DesktopNav />
      <main className={`min-h-0 flex-1 ${mainClassName}`}>{children}</main>
      <DesktopContextRail title={railTitle}>{rail}</DesktopContextRail>
    </div>
  );
}
```

- [ ] **Step 4: Make mobile-only floating elements explicit**

Modify `components/shell/BottomNav.tsx` so the root `nav` class starts with:

```tsx
className="fixed bottom-0 left-0 right-0 z-30 border-t-2 lg:hidden"
```

Modify `components/shell/BalancePill.tsx` so both returned root controls include `lg:hidden`:

```tsx
className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-2xl px-4 py-1.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] lg:hidden"
```

and:

```tsx
className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 inline-flex items-baseline gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest lg:hidden"
```

- [ ] **Step 5: Replace desktop phone-frame CSS with app-root behavior**

In `app/globals.css`, replace the desktop `.phone-frame` media block with:

```css
.app-frame {
  width: 100%;
  height: 100dvh;
  position: relative;
  overflow: hidden;
}

@media (max-width: 1023px) {
  .app-frame {
    width: 100%;
    height: 100dvh;
  }
}

@media (min-width: 1024px) {
  body:has(.app-frame) {
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
    background: #0e0d10;
  }

  .app-frame {
    width: 100%;
    height: 100dvh;
    overflow: hidden;
  }
}
```

Remove the previous desktop `body:has(.phone-frame)` rules and the desktop `.phone-frame` width, border-radius, box-shadow, and transform rules.

- [ ] **Step 6: Update route group layout wrapper**

Modify `app/(app)/layout.tsx`:

```tsx
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <UserEnsure />
      <PreferencesProvider>
        <PacificaLiveProvider>{children}</PacificaLiveProvider>
      </PreferencesProvider>
      <WelcomeIntro />
    </div>
  );
}
```

Update the comment to describe app-frame rather than phone-frame containment.

- [ ] **Step 7: Verify shell primitives**

Run:

```bash
npm run typecheck
npm run test -- components/shell/nav-items.test.ts
```

Expected: both commands complete with no errors.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/globals.css app/'(app)'/layout.tsx components/shell
git commit -m "feat: add responsive desktop shell"
```

---

### Task 3: Desktop Feed Command Center

**Files:**
- Create: `components/feed/bot-selection.ts`
- Create: `components/feed/bot-selection.test.ts`
- Create: `components/feed/BotRosterDesktop.tsx`
- Modify: `components/feed/BotRoster.tsx`

- [ ] **Step 1: Write selected-bot tests**

Create `components/feed/bot-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickInitialBotId } from "./bot-selection";

const bot = (id: string, openCount: number) => ({
  payload: {
    botId: id,
    currentPositions: Array.from({ length: openCount }, (_, index) => ({
      positionId: `${id}-${index}`,
    })),
  },
});

describe("pickInitialBotId", () => {
  it("chooses the highest-ranked bot with an open position", () => {
    expect(pickInitialBotId([bot("atlas", 0), bot("whale", 1), bot("pulse", 2)])).toBe("whale");
  });

  it("falls back to the top-ranked bot when no bot has an open position", () => {
    expect(pickInitialBotId([bot("atlas", 0), bot("whale", 0)])).toBe("atlas");
  });

  it("returns null for an empty roster", () => {
    expect(pickInitialBotId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- components/feed/bot-selection.test.ts
```

Expected: FAIL because `components/feed/bot-selection.ts` does not exist.

- [ ] **Step 3: Implement selected-bot helper**

Create `components/feed/bot-selection.ts`:

```ts
type SelectableBot = {
  payload: {
    botId: string;
    currentPositions: unknown[];
  };
};

export function pickInitialBotId<T extends SelectableBot>(bots: T[]): string | null {
  const active = bots.find((bot) => bot.payload.currentPositions.length > 0);
  return active?.payload.botId ?? bots[0]?.payload.botId ?? null;
}
```

- [ ] **Step 4: Add desktop roster component**

Create `components/feed/BotRosterDesktop.tsx` with this structure:

```tsx
"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Zap } from "lucide-react";
import type { BotSignal } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { ACCENT, BG, DIM, FAINT, FG, GREEN, PANEL, PANEL_2, RED, StoryAvatar, BigNum, Headline, Stamp } from "@/components/v2/ui";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { BotChatSheet } from "./BotChatSheet";
import { pickInitialBotId } from "./bot-selection";

export function BotRosterDesktop({ bots }: { bots: BotSignal[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => pickInitialBotId(bots));
  const [chatBotId, setChatBotId] = useState<string | null>(null);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const selected = useMemo(
    () => bots.find((bot) => bot.payload.botId === selectedId) ?? bots[0] ?? null,
    [bots, selectedId],
  );
  const chatBot = bots.find((bot) => bot.payload.botId === chatBotId) ?? null;
  const selectedPosition = selected?.payload.currentPositions[0] ?? null;

  const rail = selected ? (
    <div className="space-y-3">
      <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
        <Stamp label="Selected Bot" />
        <div className="mt-3 flex items-center gap-3">
          <StoryAvatar
            emoji={selected.payload.avatarEmoji}
            imageUrl={selected.payload.avatarImageUrl}
            mood={selected.payload.mood ?? "DORMANT"}
            size={52}
          />
          <div className="min-w-0">
            <Headline size={24}>{selected.payload.botName}</Headline>
            <p className="mt-1 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              {selected.payload.currentPositions.length} open positions
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setChatBotId(selected.payload.botId)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest"
          style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
        >
          <MessageCircle size={13} /> Chat
        </button>
      </div>
      {selectedPosition && (
        <button
          type="button"
          onClick={() =>
            setTailSource({
              kind: "bot",
              botId: selected.payload.botId,
              botName: selected.payload.botName,
              avatarEmoji: selected.payload.avatarEmoji,
              avatarImageUrl: selected.payload.avatarImageUrl,
              asset: selectedPosition.asset,
              side: selectedPosition.side,
              leverage: selectedPosition.leverage,
              entryMark: selectedPosition.entryMark,
              positionId: selectedPosition.positionId,
            })
          }
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-black uppercase tracking-widest"
          style={{ background: ACCENT, color: BG }}
        >
          <Zap size={14} fill={BG} /> Tail current position
        </button>
      )}
    </div>
  ) : null;

  return (
    <AppShell rail={rail} railTitle="Bot Context" mainClassName="overflow-hidden">
      <div className="grid h-full grid-cols-[minmax(360px,460px)_minmax(0,1fr)] gap-4 p-4">
        <section className="min-h-0 overflow-hidden rounded-2xl" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
          <div className="border-b px-4 py-3" style={{ borderColor: FAINT }}>
            <Headline size={30}>{`"ROSTER"`}</Headline>
          </div>
          <div className="no-scrollbar h-[calc(100%-60px)] overflow-y-auto p-3">
            {bots.map((bot, index) => (
              <button
                key={bot.payload.botId}
                type="button"
                onClick={() => setSelectedId(bot.payload.botId)}
                className="mb-2 flex w-full items-center gap-3 rounded-xl p-3 text-left transition active:scale-[0.99]"
                style={{
                  background: bot.payload.botId === selected?.payload.botId ? PANEL_2 : "transparent",
                  border: `1px solid ${bot.payload.botId === selected?.payload.botId ? ACCENT : FAINT}`,
                }}
              >
                <span className="w-7 text-[10px] font-black" style={{ color: index === 0 ? ACCENT : DIM }}>#{index + 1}</span>
                <StoryAvatar emoji={bot.payload.avatarEmoji} imageUrl={bot.payload.avatarImageUrl} mood={bot.payload.mood ?? "DORMANT"} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-black uppercase">{bot.payload.botName}</div>
                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    {bot.payload.currentPositions.length} open · {bot.payload.stats.totalTrades} trades
                  </div>
                </div>
                <BigNum size={18} color={bot.payload.balanceUsd >= bot.payload.startingBalanceUsd ? GREEN : RED}>
                  ${bot.payload.balanceUsd.toFixed(0)}
                </BigNum>
              </button>
            ))}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-2xl p-5" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
          {selected ? (
            <div className="flex h-full flex-col">
              <Stamp label="Command Center" value={selected.payload.botName.toUpperCase()} />
              <div className="mt-5 flex items-center gap-4">
                <StoryAvatar emoji={selected.payload.avatarEmoji} imageUrl={selected.payload.avatarImageUrl} mood={selected.payload.mood ?? "DORMANT"} size={76} />
                <div>
                  <Headline size={44}>{selected.payload.botName}</Headline>
                  <p className="mt-2 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    Live equity ${selected.payload.balanceUsd.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-4 gap-2">
                <Metric label="24H" value={`${selected.payload.stats.paperPnl24hUsd >= 0 ? "+" : "-"}$${Math.abs(selected.payload.stats.paperPnl24hUsd).toFixed(0)}`} color={selected.payload.stats.paperPnl24hUsd >= 0 ? GREEN : RED} />
                <Metric label="Win Rate" value={selected.payload.stats.winRate == null ? "-" : `${(selected.payload.stats.winRate * 100).toFixed(0)}%`} />
                <Metric label="Trades" value={String(selected.payload.stats.totalTrades)} />
                <Metric label="Open" value={String(selected.payload.currentPositions.length)} />
              </div>
              <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
                {selected.payload.currentPositions.length === 0 ? (
                  <div className="rounded-xl p-5 text-[12px] font-black uppercase tracking-widest" style={{ background: PANEL_2, color: DIM }}>
                    Watching the tape. No open position.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selected.payload.currentPositions.map((position) => (
                      <div key={position.positionId} className="rounded-xl p-4" style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}>
                        <div className="flex items-center justify-between">
                          <Headline size={30}>{position.asset}</Headline>
                          <span className="rounded px-2 py-1 text-[11px] font-black uppercase" style={{ color: position.side === "long" ? GREEN : RED }}>
                            {position.side} ×{position.leverage}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-snug" style={{ color: FG }}>
                          {position.narrationOpen ? `"${position.narrationOpen}"` : "No thesis text yet."}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              No bots loaded.
            </div>
          )}
        </section>
      </div>

      {chatBot && (
        <BotChatSheet
          botId={chatBot.payload.botId}
          botName={chatBot.payload.botName}
          avatarEmoji={chatBot.payload.avatarEmoji}
          avatarImageUrl={chatBot.payload.avatarImageUrl}
          openingThoughts={chatBot.payload.currentPositions.map((position) => ({
            asset: position.asset,
            side: position.side,
            narration: position.narrationOpen,
          }))}
          onClose={() => setChatBotId(null)}
        />
      )}
      <TailModal open={!!tailSource} source={tailSource} onClose={() => setTailSource(null)} />
    </AppShell>
  );
}

function Metric({ label, value, color = FG }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}>
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>{label}</div>
      <div className="mt-1 text-[18px] font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 5: Wire desktop roster into existing roster component**

Modify `components/feed/BotRoster.tsx`:

```tsx
import { BotRosterDesktop } from "./BotRosterDesktop";
```

In `BotRoster`, wrap the existing returned mobile root with `lg:hidden` and add the desktop component:

```tsx
return (
  <>
    <div className="lg:hidden">
      {/* existing mobile roster JSX goes here unchanged */}
    </div>
    <div className="hidden h-full lg:block">
      <BotRosterDesktop bots={bots} />
    </div>
  </>
);
```

The existing polling state remains in `BotRoster`; pass the live `bots` state to `BotRosterDesktop`.

- [ ] **Step 6: Verify feed command center**

Run:

```bash
npm run test -- components/feed/bot-selection.test.ts
npm run typecheck
```

Expected: both commands complete with no errors.

Start the app:

```bash
npm run dev
```

In browser verification:

- At `390x844`, `/feed` shows the current mobile roster and bottom nav.
- At `1440x900`, `/feed` shows left desktop nav, roster panel, selected bot center panel, and right context rail.
- Clicking a bot row updates the center panel.

- [ ] **Step 7: Commit**

Run:

```bash
git add components/feed/BotRoster.tsx components/feed/BotRosterDesktop.tsx components/feed/bot-selection.ts components/feed/bot-selection.test.ts
git commit -m "feat: add desktop roster command center"
```

---

### Task 4: Desktop Live Feed

**Files:**
- Create: `components/feed/live-positions.ts`
- Create: `components/feed/live-positions.test.ts`
- Create: `components/feed/LiveFeedDesktop.tsx`
- Modify: `components/feed/LiveFeed.tsx`

- [ ] **Step 1: Write live flattening tests**

Create `components/feed/live-positions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BotSignal } from "@/lib/types";
import { flattenBotPositions } from "./live-positions";

const bot = (botId: string, openSinceMs: number) => ({
  payload: {
    botId,
    botName: botId,
    avatarEmoji: "B",
    avatarImageUrl: null,
    mood: "DORMANT",
    currentPositions: [
      {
        positionId: `${botId}-pos`,
        asset: "SOL",
        side: "long",
        leverage: 10,
        entryMark: 100,
        currentMark: 101,
        stakeUsd: 10,
        livePaperPnlUsd: 1,
        livePaperPnlPct: 0.1,
        openSinceMs,
        narrationOpen: "test",
        disagreements: [],
      },
    ],
  },
});

describe("flattenBotPositions", () => {
  it("sorts freshest positions first", () => {
    const out = flattenBotPositions(
      [bot("old", 1000), bot("new", 2000)] as unknown as BotSignal[],
      null,
    );
    expect(out.map((position) => position.bot.botId)).toEqual(["new", "old"]);
  });

  it("filters by bot id", () => {
    const out = flattenBotPositions(
      [bot("old", 1000), bot("new", 2000)] as unknown as BotSignal[],
      "old",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.bot.botId).toBe("old");
  });
});
```

- [ ] **Step 2: Extract flattening helper**

Create `components/feed/live-positions.ts` by moving the `FlatPosition` interface and `flatten` function out of `LiveFeed.tsx`. Export them as:

```ts
import type { BotSignal } from "@/lib/types";

export interface FlatPosition {
  positionId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
  stakeUsd: number;
  livePaperPnlUsd: number;
  livePaperPnlPct: number;
  openSinceMs: number;
  narrationOpen: string | null;
  bot: {
    botId: string;
    botName: string;
    avatarEmoji: string;
    avatarImageUrl: string | null;
    mood: BotSignal["payload"]["mood"];
  };
  disagreements: Array<{
    botId: string;
    botName: string;
    avatarEmoji: string;
    avatarImageUrl: string | null;
  }>;
}

export function flattenBotPositions(bots: BotSignal[], filter: string | null): FlatPosition[] {
  const out: FlatPosition[] = [];
  for (const bot of bots) {
    if (filter && bot.payload.botId !== filter) continue;
    for (const pos of bot.payload.currentPositions) {
      out.push({
        positionId: pos.positionId,
        asset: pos.asset,
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        currentMark: pos.currentMark,
        stakeUsd: pos.stakeUsd,
        livePaperPnlUsd: pos.livePaperPnlUsd,
        livePaperPnlPct: pos.livePaperPnlPct,
        openSinceMs: pos.openSinceMs,
        narrationOpen: pos.narrationOpen,
        bot: {
          botId: bot.payload.botId,
          botName: bot.payload.botName,
          avatarEmoji: bot.payload.avatarEmoji,
          avatarImageUrl: bot.payload.avatarImageUrl,
          mood: bot.payload.mood,
        },
        disagreements: pos.disagreements,
      });
    }
  }
  out.sort((a, b) => b.openSinceMs - a.openSinceMs);
  return out;
}
```

Modify `LiveFeed.tsx` to import:

```ts
import { flattenBotPositions, type FlatPosition } from "./live-positions";
```

and replace calls to `flatten(bots, botFilter)` with `flattenBotPositions(bots, botFilter)`.

- [ ] **Step 3: Run tests**

Run:

```bash
npm run test -- components/feed/live-positions.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add desktop live feed component**

Create `components/feed/LiveFeedDesktop.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, Zap } from "lucide-react";
import type { BotSignal } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { ACCENT, BG, DIM, FAINT, FG, GREEN, PANEL, PANEL_2, RED, Headline, Stamp, StoryAvatar } from "@/components/v2/ui";
import { computeLivePaperPnlPct } from "@/lib/bots/pnl";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { BotChatSheet } from "./BotChatSheet";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { flattenBotPositions, type FlatPosition } from "./live-positions";

export function LiveFeedDesktop({ bots, botFilter }: { bots: BotSignal[]; botFilter: string | null }) {
  const liveMarks = useLiveMarks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatBotId, setChatBotId] = useState<string | null>(null);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const positions = useMemo(() => {
    return flattenBotPositions(bots, botFilter).map((pos) => {
      const liveMark = liveMarks[pos.asset] ?? pos.currentMark;
      const livePct = computeLivePaperPnlPct({
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        currentMark: liveMark,
        asset: pos.asset,
        stakeUsd: pos.stakeUsd,
      });
      return { ...pos, currentMark: liveMark, livePaperPnlPct: livePct, livePaperPnlUsd: livePct * pos.stakeUsd };
    });
  }, [bots, botFilter, liveMarks]);

  const selected = positions.find((position) => position.positionId === selectedId) ?? positions[0] ?? null;
  const chatBot = bots.find((bot) => bot.payload.botId === chatBotId) ?? null;

  return (
    <AppShell rail={selected ? <LiveRail pos={selected} onTail={() => setTailSource(toTailSource(selected))} onChat={() => setChatBotId(selected.bot.botId)} /> : null} railTitle="Position Context" mainClassName="overflow-hidden">
      <div className="grid h-full grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-4 p-4">
        <section className="min-h-0 rounded-2xl" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
          <div className="border-b px-4 py-3" style={{ borderColor: FAINT }}>
            <Headline size={30}>{`"LIVE"`}</Headline>
          </div>
          <div className="no-scrollbar h-[calc(100%-60px)] overflow-y-auto p-3">
            {positions.map((pos) => (
              <button
                key={pos.positionId}
                type="button"
                onClick={() => setSelectedId(pos.positionId)}
                className="mb-2 w-full rounded-xl p-3 text-left"
                style={{ background: pos.positionId === selected?.positionId ? PANEL_2 : "transparent", border: `1px solid ${pos.positionId === selected?.positionId ? ACCENT : FAINT}` }}
              >
                <div className="flex items-center gap-3">
                  <StoryAvatar emoji={pos.bot.avatarEmoji} imageUrl={pos.bot.avatarImageUrl} mood={pos.bot.mood ?? "DORMANT"} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-black uppercase">{pos.bot.botName}</div>
                    <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                      {pos.asset} · {pos.side} ×{pos.leverage}
                    </div>
                  </div>
                  <span className="text-[13px] font-black" style={{ color: pos.livePaperPnlPct >= 0 ? GREEN : RED }}>
                    {pos.livePaperPnlPct >= 0 ? "+" : ""}{(pos.livePaperPnlPct * 100).toFixed(1)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
        <section className="min-h-0 rounded-2xl p-5" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
          {selected ? <LivePositionHero pos={selected} onTail={() => setTailSource(toTailSource(selected))} onChat={() => setChatBotId(selected.bot.botId)} /> : <EmptyLive />}
        </section>
      </div>

      {chatBot && (
        <BotChatSheet
          botId={chatBot.payload.botId}
          botName={chatBot.payload.botName}
          avatarEmoji={chatBot.payload.avatarEmoji}
          avatarImageUrl={chatBot.payload.avatarImageUrl}
          openingThoughts={chatBot.payload.currentPositions.map((position) => ({ asset: position.asset, side: position.side, narration: position.narrationOpen }))}
          onClose={() => setChatBotId(null)}
        />
      )}
      <TailModal open={!!tailSource} source={tailSource} onClose={() => setTailSource(null)} />
    </AppShell>
  );
}

function LivePositionHero({ pos, onTail, onChat }: { pos: FlatPosition; onTail: () => void; onChat: () => void }) {
  const profit = pos.livePaperPnlPct >= 0;
  return (
    <div className="flex h-full flex-col">
      <Stamp label="Selected Position" value={pos.bot.botName.toUpperCase()} />
      <div className="mt-5 flex items-center gap-4">
        <StoryAvatar emoji={pos.bot.avatarEmoji} imageUrl={pos.bot.avatarImageUrl} mood={pos.bot.mood ?? "DORMANT"} size={70} />
        <div>
          <Headline size={52}>{pos.asset}</Headline>
          <div className="mt-2 text-[13px] font-black uppercase tracking-widest" style={{ color: pos.side === "long" ? GREEN : RED }}>
            {pos.side} ×{pos.leverage}
          </div>
        </div>
      </div>
      <div className="mt-8 rounded-2xl p-5" style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}>
        <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>Live P/L</div>
        <div className="mt-2 text-[46px] font-black tabular-nums" style={{ color: profit ? GREEN : RED }}>
          {profit ? "+" : ""}{(pos.livePaperPnlPct * 100).toFixed(2)}%
        </div>
      </div>
      {pos.narrationOpen && <p className="mt-5 text-lg italic leading-snug">"{pos.narrationOpen}"</p>}
      <div className="mt-auto flex gap-3">
        <button type="button" onClick={onTail} className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-black uppercase tracking-widest" style={{ background: ACCENT, color: BG }}>
          <Zap size={14} fill={BG} /> Tail
        </button>
        <button type="button" onClick={onChat} className="rounded-2xl px-4 py-3" style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}>
          <MessageCircle size={16} />
        </button>
      </div>
    </div>
  );
}

function LiveRail({ pos, onTail, onChat }: { pos: FlatPosition; onTail: () => void; onChat: () => void }) {
  return <LivePositionHero pos={pos} onTail={onTail} onChat={onChat} />;
}

function EmptyLive() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Headline size={34}>{`"WATCHING THE TAPE"`}</Headline>
      <Link href="/feed" className="mt-5 rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest" style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}>
        Back to roster
      </Link>
    </div>
  );
}

function toTailSource(pos: FlatPosition): TailSource {
  return {
    kind: "bot",
    botId: pos.bot.botId,
    botName: pos.bot.botName,
    avatarEmoji: pos.bot.avatarEmoji,
    avatarImageUrl: pos.bot.avatarImageUrl,
    asset: pos.asset,
    side: pos.side,
    leverage: pos.leverage,
    entryMark: pos.entryMark,
    positionId: pos.positionId,
  };
}
```

- [ ] **Step 5: Wire desktop live feed into existing component**

Modify `components/feed/LiveFeed.tsx`:

```tsx
import { LiveFeedDesktop } from "./LiveFeedDesktop";
```

Wrap the existing mobile UI root in `lg:hidden`, then add:

```tsx
<div className="hidden h-full lg:block">
  <LiveFeedDesktop bots={bots} botFilter={botFilter} />
</div>
```

The existing polling state remains in `LiveFeed`; pass the live `bots` state to `LiveFeedDesktop`.

- [ ] **Step 6: Verify live route**

Run:

```bash
npm run test -- components/feed/live-positions.test.ts
npm run typecheck
```

Expected: both commands complete with no errors.

Browser verification:

- At `390x844`, `/live` still snap-scrolls vertically.
- At `1440x900`, `/live` shows side nav, open-position list, selected position panel, and context rail.
- Tail and chat buttons still open their modal/sheet.

- [ ] **Step 7: Commit**

Run:

```bash
git add components/feed/LiveFeed.tsx components/feed/LiveFeedDesktop.tsx components/feed/live-positions.ts components/feed/live-positions.test.ts
git commit -m "feat: add desktop live feed"
```

---

### Task 5: Desktop Portfolio Layout

**Files:**
- Modify: `app/(app)/portfolio/page.tsx`

- [ ] **Step 1: Wrap portfolio in AppShell**

Modify imports:

```tsx
import { AppShell } from "@/components/shell/AppShell";
```

Build a rail block inside the authenticated branch:

```tsx
const portfolioRail = authenticated ? (
  <div className="space-y-3">
    <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
      <Stamp label="Wallet" />
      <div className="mt-2 font-mono text-[12px]" style={{ color: FG }}>
        {truncateAddress(wallet?.address)}
      </div>
      <div className="mt-3 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        Available
      </div>
      <BigNum size={26}>{walletUsd == null ? "-" : `$${walletUsd.toFixed(2)}`}</BigNum>
    </div>
    <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
      <Stamp label="Actions" />
      <div className="mt-3 flex flex-col gap-2">
        <PacificaWithdrawButton onComplete={load} />
        <WithdrawButton maxUsd={walletUsd ?? 0} onComplete={load} />
      </div>
    </div>
  </div>
) : null;
```

Return:

```tsx
return (
  <AppShell rail={portfolioRail} railTitle="Portfolio">
    <main className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-12 lg:max-w-none lg:px-6 lg:pt-6" style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}>
      {/* existing portfolio contents */}
    </main>
  </AppShell>
);
```

- [ ] **Step 2: Make portfolio content use desktop width**

Change the authenticated content wrapper to:

```tsx
<div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-rows-[auto_auto_minmax(0,1fr)]">
```

Change the summary card grid from `grid-cols-2` to:

```tsx
className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4"
```

Move the withdraw button container inside the summary card behind `lg:hidden` because desktop actions are in the rail:

```tsx
<div className="flex items-center gap-2 lg:hidden">
  <PacificaWithdrawButton onComplete={load} />
  <WithdrawButton maxUsd={walletUsd ?? 0} onComplete={load} />
</div>
```

Change the scroll list wrapper to use desktop columns only for position rows:

```tsx
<div className="flex flex-col gap-2 pb-24 lg:grid lg:grid-cols-2 lg:items-start lg:pb-6">
```

- [ ] **Step 3: Verify portfolio**

Run:

```bash
npm run typecheck
```

Expected: completes with no errors.

Browser verification:

- At `390x844`, `/portfolio` remains a stacked mobile page with bottom nav.
- At `1440x900`, `/portfolio` uses the side nav and right rail, and position rows are not constrained to 390px.

- [ ] **Step 4: Commit**

Run:

```bash
git add app/'(app)'/portfolio/page.tsx
git commit -m "feat: add desktop portfolio layout"
```

---

### Task 6: Desktop Chatter, Deposit, And Leaderboard Layouts

**Files:**
- Modify: `app/(app)/chatter/page.tsx`
- Modify: `app/(app)/deposit/page.tsx`
- Modify: `app/(app)/leaderboard/page.tsx`

- [ ] **Step 1: Add AppShell to chatter**

Modify `app/(app)/chatter/page.tsx` imports:

```tsx
import { AppShell } from "@/components/shell/AppShell";
```

Wrap the page:

```tsx
return (
  <AppShell
    rail={
      <div className="rounded-xl p-4 text-[11px] font-black uppercase tracking-widest" style={{ background: PANEL_2, border: `1px solid ${FAINT}`, color: DIM }}>
        Latest bot trade narration streams here. Use roster and live views for action context.
      </div>
    }
    railTitle="Chatter Context"
  >
    <main className="no-scrollbar mx-auto h-full w-full max-w-md overflow-y-auto pb-32 lg:max-w-none lg:px-6 lg:pb-6">
      {/* existing chatter content */}
    </main>
  </AppShell>
);
```

Keep the existing `BottomNav` after `</AppShell>` or inside mobile content; it is hidden on desktop after Task 2.

- [ ] **Step 2: Add AppShell to deposit**

Modify `app/(app)/deposit/page.tsx` imports:

```tsx
import { AppShell } from "@/components/shell/AppShell";
```

Return:

```tsx
return (
  <AppShell
    rail={
      ready && authenticated ? (
        <div className="space-y-3">
          <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
            <Stamp label="Wallet" />
            <div className="mt-2 break-all font-mono text-[12px]" style={{ color: FG }}>
              {wallet?.address ?? "GENERATING WALLET..."}
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
            <Stamp label="Feed Preferences" />
            <p className="mt-2 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              Use the main settings panel to toggle rails.
            </p>
          </div>
        </div>
      ) : null
    }
    railTitle="Settings"
  >
    <main className="flex min-h-screen w-full flex-col px-5 pt-12 pb-32 lg:min-h-0 lg:h-full lg:max-w-3xl lg:px-6 lg:pt-6">
      {/* existing deposit content */}
    </main>
  </AppShell>
);
```

- [ ] **Step 3: Add AppShell to leaderboard**

Modify `app/(app)/leaderboard/page.tsx` imports:

```tsx
import { AppShell } from "@/components/shell/AppShell";
```

Return:

```tsx
return (
  <AppShell railTitle="Wins">
    <main className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-12 lg:max-w-none lg:px-6 lg:pt-6">
      {/* existing leaderboard content */}
    </main>
  </AppShell>
);
```

Change the cards wrapper:

```tsx
<div className="flex flex-col gap-3 pb-24 lg:grid lg:grid-cols-2 lg:items-start lg:pb-6 xl:grid-cols-3">
```

- [ ] **Step 4: Verify secondary routes**

Run:

```bash
npm run typecheck
```

Expected: completes with no errors.

Browser verification at desktop width:

- `/chatter` shows side nav and wide timeline.
- `/deposit` shows side nav and settings rail.
- `/leaderboard` shows side nav and responsive card grid/list.

Browser verification at mobile width:

- `/chatter`, `/deposit`, and `/leaderboard` still use the current stacked layouts and bottom nav.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/'(app)'/chatter/page.tsx app/'(app)'/deposit/page.tsx app/'(app)'/leaderboard/page.tsx
git commit -m "feat: add desktop layouts for secondary routes"
```

---

### Task 7: Desktop Sheet And Modal Polish

**Files:**
- Modify: `components/feed/BotChatSheet.tsx`
- Modify: `components/tail/TailModal.tsx`

- [ ] **Step 1: Constrain bot chat on desktop**

In `components/feed/BotChatSheet.tsx`, change the sheet panel class from:

```tsx
className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-white/10 bg-neutral-950 shadow-2xl"
```

to:

```tsx
className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-white/10 bg-neutral-950 shadow-2xl lg:mx-auto lg:max-w-[520px] lg:rounded-3xl lg:border"
```

Change overlay alignment from:

```tsx
className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
```

to:

```tsx
className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm lg:items-center lg:justify-center"
```

- [ ] **Step 2: Constrain tail modal on desktop**

In `components/tail/TailModal.tsx`, locate the modal panel root and add desktop max-width/rounded classes:

```tsx
lg:mx-auto lg:max-w-[520px] lg:rounded-3xl lg:border lg:border-white/10
```

Ensure the overlay remains `fixed inset-0` so it covers the full browser viewport on desktop.

- [ ] **Step 3: Verify modal polish**

Run:

```bash
npm run typecheck
```

Expected: completes with no errors.

Browser verification:

- Desktop `/feed`: chat opens centered and does not fill the entire screen.
- Desktop `/feed` or `/live`: tail modal opens centered and remains readable.
- Mobile `/feed`: chat and tail retain bottom-sheet/mobile behavior.

- [ ] **Step 4: Commit**

Run:

```bash
git add components/feed/BotChatSheet.tsx components/tail/TailModal.tsx
git commit -m "fix: polish desktop overlays"
```

---

### Task 8: Full Verification And Final Polish

**Files:**
- Modify only files already touched in earlier tasks if verification reveals layout regressions.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Expected: all commands complete successfully.

- [ ] **Step 2: Start local dev server**

Run:

```bash
npm run dev
```

Expected: Next.js starts and prints a localhost URL, usually `http://localhost:3000`.

- [ ] **Step 3: Browser verify mobile**

Use the in-app browser at a mobile viewport around `390x844`.

Check:

- `/feed`: mobile roster displays, bottom nav visible, no desktop side nav.
- `/live`: snap-scroll still works, bottom nav visible.
- `/portfolio`: stacked summary and position list remain usable.
- `/chatter`: timeline remains single column.
- `/deposit`: settings stack remains usable.

- [ ] **Step 4: Browser verify desktop**

Use the in-app browser at a desktop viewport around `1440x900`.

Check:

- `/feed`: left desktop nav, roster panel, selected bot center panel, right rail.
- `/live`: left desktop nav, open-position list, selected position panel, right rail.
- `/portfolio`: left desktop nav, wider summary/list, wallet/actions rail.
- `/chatter`: left desktop nav, wide timeline, no phone clipping.
- `/deposit`: left desktop nav, main settings panel, settings rail.
- `/leaderboard`: left desktop nav, responsive cards/list.

- [ ] **Step 5: Fix text overflow and overlapping controls**

If browser verification shows clipped text, overlapping buttons, or route content hidden behind navigation, adjust only the affected Tailwind classes. Prefer:

```tsx
className="min-w-0 truncate"
```

for single-line labels, and:

```tsx
className="min-w-0 break-words"
```

for wallet addresses, narrations, and long generated text.

For scroll containers inside desktop panels, prefer:

```tsx
className="min-h-0 overflow-y-auto"
```

- [ ] **Step 6: Commit final polish**

If files changed in Step 5, run:

```bash
git add app components
git commit -m "fix: polish responsive desktop layout"
```

If no files changed, do not create an empty commit.

- [ ] **Step 7: Record final status**

Run:

```bash
git status --short
```

Expected: only user-owned unrelated untracked files remain, such as `.claude/` and `artifacts/`.
