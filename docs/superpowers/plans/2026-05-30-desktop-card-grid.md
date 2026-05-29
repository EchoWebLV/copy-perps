# Desktop Card Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stretched-phone desktop surfaces with responsive card-grid desktop layouts while preserving the current mobile app behavior.

**Architecture:** Keep route data, trading, wallet, and API behavior unchanged. Update shell navigation first, then add desktop-only presentation branches in the existing whale, Pulse, Scalp, portfolio, and settings surfaces. Tests are contract-first because this codebase already uses file-level contract tests for UI behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, lucide-react, Vitest, Codex Browser verification.

---

## File Structure

Modify:

- `components/shell/nav-items.ts`: desktop primary nav item list and active-route helper.
- `components/shell/nav-items.test.ts`: shared primary navigation contract.
- `components/shell/AppShell.tsx`: hide the desktop context rail when a route has no useful rail content.
- `components/shell/DesktopContextRail.tsx`: keep reusable rail container.
- `components/feed/BotRosterDesktop.tsx`: no change unless tests reveal nav dependencies.
- `components/whales/WhaleRoster.tsx`: add desktop grid branch and desktop whale card presentation while preserving mobile snap feed.
- `components/whales/whale-roster-contract.test.ts`: update contract from desktop snap feed to mobile snap plus desktop grid.
- `components/whales/WhalePulseFeed.tsx`: add desktop grid/dense stream branch while preserving mobile snap feed and reaction behavior.
- `components/whales/whale-pulse-feed-contract.test.ts`: update contract from all-viewports snap feed to mobile snap plus desktop grid.
- `components/trade/FastPerpsGame.tsx`: add desktop grouped layout around existing Flash state and actions.
- `components/trade/flash-perps-game-contract.test.ts`: assert desktop grouped controls exist and existing Flash behavior remains.
- `app/(app)/portfolio/page.tsx`: hide empty desktop rail where not useful, keep current portfolio logic.
- `components/portfolio/portfolio-layout-contract.test.ts`: assert portfolio does not show a generic empty rail.
- `app/(app)/deposit/page.tsx`: hide empty desktop rail when settings rail content is unavailable.
- `components/settings/deposit-wallet-contract.test.ts`: assert settings does not show a generic empty rail.

Do not modify:

- `app/api/**`
- `lib/pacifica/**`
- `lib/flash/**`, except tests if a contract import requires it
- `lib/bots/cross-bot.test.ts`, which has a pre-existing local modification
- Database schema files

---

### Task 1: Align Primary Navigation

**Files:**
- Modify: `components/shell/nav-items.test.ts`
- Modify: `components/shell/nav-items.ts`

- [ ] **Step 1: Write the failing nav contract**

Replace the first three nav-specific tests in `components/shell/nav-items.test.ts` with:

```ts
  it("exposes the shared primary app destinations in display order", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/feed",
      "/trade",
      "/chatter",
      "/portfolio",
      "/deposit",
    ]);
  });

  it("labels desktop primary nav to match the mobile app functions", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Whales",
      "Scalp",
      "Pulse",
      "Folio",
      "Settings",
    ]);
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain("Heat");
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain("Wins");
  });

  it("uses Scalp and Pulse icons without exposing hidden future routes", () => {
    expect(DESKTOP_NAV_ITEMS.find((item) => item.label === "Scalp")?.icon).toBe(
      ChartCandlestick,
    );
    expect(DESKTOP_NAV_ITEMS.find((item) => item.label === "Pulse")?.icon).toBe(
      Zap,
    );
    expect(DESKTOP_NAV_ITEMS.some((item) => item.href === "/live")).toBe(false);
    expect(DESKTOP_NAV_ITEMS.some((item) => item.href === "/leaderboard")).toBe(
      false,
    );
  });
```

Update the active-route test in the same file to include Scalp and remove the `/live` expectation:

```ts
  it("marks feed, scalp, and pulse nested paths active", () => {
    expect(isShellNavActive("/feed", "/feed")).toBe(true);
    expect(isShellNavActive("/feed", "/feed?bot=whale")).toBe(true);
    expect(isShellNavActive("/feed", "/feed/whale")).toBe(true);
    expect(isShellNavActive("/trade", "/trade?market=SOL")).toBe(true);
    expect(isShellNavActive("/chatter", "/chatter")).toBe(true);
  });
```

Add this assertion to the existing mobile-nav test:

```ts
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/feed",
      "/trade",
      "/chatter",
      "/portfolio",
      "/deposit",
    ]);
```

- [ ] **Step 2: Run the nav test to verify it fails**

Run:

```bash
npm run test -- components/shell/nav-items.test.ts
```

Expected: FAIL because `DESKTOP_NAV_ITEMS` still includes `/live` and `/leaderboard`, and does not include `/trade`.

- [ ] **Step 3: Update the desktop nav item list**

Replace `components/shell/nav-items.ts` with:

```ts
import {
  ChartCandlestick,
  Flame,
  PieChart,
  Settings,
  Zap,
} from "lucide-react";

export const DESKTOP_NAV_ITEMS = [
  { href: "/feed", label: "Whales", icon: Flame },
  { href: "/trade", label: "Scalp", icon: ChartCandlestick },
  { href: "/chatter", label: "Pulse", icon: Zap },
  { href: "/portfolio", label: "Folio", icon: PieChart },
  { href: "/deposit", label: "Settings", icon: Settings },
] as const;

export type DesktopNavItem = (typeof DESKTOP_NAV_ITEMS)[number];

export function isShellNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split("?")[0] ?? pathname;
  if (cleanPath === href) return true;
  return cleanPath.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Run the nav test to verify it passes**

Run:

```bash
npm run test -- components/shell/nav-items.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add components/shell/nav-items.ts components/shell/nav-items.test.ts
git commit -m "fix: align desktop primary nav"
```

---

### Task 2: Hide Generic Empty Desktop Rails

**Files:**
- Modify: `components/shell/AppShell.tsx`
- Modify: `app/(app)/portfolio/page.tsx`
- Modify: `components/portfolio/portfolio-layout-contract.test.ts`
- Modify: `app/(app)/deposit/page.tsx`
- Modify: `components/settings/deposit-wallet-contract.test.ts`

- [ ] **Step 1: Write failing rail contract tests**

Add this test to `components/portfolio/portfolio-layout-contract.test.ts`:

```ts
  it("does not show a generic empty context rail when portfolio rail content is unavailable", () => {
    const page = source();

    expect(page).toContain("hideEmptyRail");
    expect(page).not.toContain("Select a bot or position");
  });
```

Add this test to `components/settings/deposit-wallet-contract.test.ts`:

```ts
  it("does not show the generic bot context rail on settings when no settings rail is available", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).toContain("hideEmptyRail");
    expect(source).not.toContain("Select a bot or position");
  });
```

- [ ] **Step 2: Run the rail tests to verify they fail**

Run:

```bash
npm run test -- components/portfolio/portfolio-layout-contract.test.ts components/settings/deposit-wallet-contract.test.ts
```

Expected: FAIL because `hideEmptyRail` is not implemented or used.

- [ ] **Step 3: Add an AppShell rail toggle**

Update `components/shell/AppShell.tsx` to accept `hideEmptyRail`:

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
  hideEmptyRail = false,
}: {
  children: ReactNode;
  rail?: ReactNode;
  railTitle?: string;
  mainClassName?: string;
  hideEmptyRail?: boolean;
}) {
  const showRail = rail != null || !hideEmptyRail;

  return (
    <div className="h-full w-full lg:flex lg:h-dvh lg:overflow-hidden" style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}>
      <DesktopNav />
      {/* AppShell owns the page main landmark; route children should use div/section. */}
      <main className={`h-full min-h-0 flex-1 ${mainClassName}`}>{children}</main>
      {showRail && (
        <DesktopContextRail title={railTitle}>{rail}</DesktopContextRail>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Use `hideEmptyRail` on portfolio and settings**

In `app/(app)/portfolio/page.tsx`, change:

```tsx
    <AppShell rail={portfolioRail} railTitle="Portfolio">
```

to:

```tsx
    <AppShell rail={portfolioRail} railTitle="Portfolio" hideEmptyRail>
```

In `app/(app)/deposit/page.tsx`, change the `AppShell` opening tag to:

```tsx
    <AppShell
      rail={rail}
      railTitle="Settings"
      hideEmptyRail
      mainClassName={`${ready && authenticated ? "" : "[&+aside]:hidden"} lg:overflow-y-auto`}
    >
```

- [ ] **Step 5: Run the rail tests to verify they pass**

Run:

```bash
npm run test -- components/portfolio/portfolio-layout-contract.test.ts components/settings/deposit-wallet-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add components/shell/AppShell.tsx app/(app)/portfolio/page.tsx components/portfolio/portfolio-layout-contract.test.ts app/(app)/deposit/page.tsx components/settings/deposit-wallet-contract.test.ts
git commit -m "fix: hide empty desktop context rails"
```

---

### Task 3: Convert Desktop Whale Roster To A Grid

**Files:**
- Modify: `components/whales/whale-roster-contract.test.ts`
- Modify: `components/whales/WhaleRoster.tsx`

- [ ] **Step 1: Replace the old roster layout contract**

Replace the first test in `components/whales/whale-roster-contract.test.ts` with:

```ts
  it("keeps mobile snap cards but renders a desktop whale grid", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain("lg:hidden");
    expect(source).toContain("snap-y snap-mandatory");
    expect(source).toContain("h-full w-full snap-start");
    expect(source).toContain("hidden h-full min-h-0 lg:flex");
    expect(source).toContain("DesktopWhaleCard");
    expect(source).toContain("xl:grid-cols-3");
    expect(source).toContain("auto-rows-max");
  });
```

Replace the second test with:

```ts
  it("adds a compact desktop title band above the whale grid only", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain("COPYABLE WHALE ACCOUNTS");
    expect(source).toContain("ranked.length");
    expect(source).not.toContain("pt-[150px]");
    expect(source).not.toContain("lg:pt-[118px]");
  });
```

- [ ] **Step 2: Run the roster test to verify it fails**

Run:

```bash
npm run test -- components/whales/whale-roster-contract.test.ts
```

Expected: FAIL because there is no desktop grid branch or `DesktopWhaleCard`.

- [ ] **Step 3: Split the roster render into mobile and desktop branches**

Inside `WhaleRoster`, replace the ranked-content block:

```tsx
      {!loaded && ranked.length === 0 ? (
        <LoadingRoster />
      ) : ranked.length === 0 ? (
        <EmptyRoster />
      ) : (
        <div className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll">
          {ranked.map((whale, idx) => (
            <section
              key={whale.payload.whaleId}
              className="flex h-full w-full snap-start items-center justify-center px-3 pt-12 pb-24 lg:px-8 lg:py-8"
              style={{ scrollSnapStop: "always" }}
            >
              <WhaleCard
                whale={whale}
                rank={idx + 1}
                onTail={(source) => setTailSource(source)}
              />
            </section>
          ))}
        </div>
      )}
```

with:

```tsx
      {!loaded && ranked.length === 0 ? (
        <LoadingRoster />
      ) : ranked.length === 0 ? (
        <EmptyRoster />
      ) : (
        <>
          <div className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll lg:hidden">
            {ranked.map((whale, idx) => (
              <section
                key={whale.payload.whaleId}
                className="flex h-full w-full snap-start items-center justify-center px-3 pt-12 pb-24"
                style={{ scrollSnapStop: "always" }}
              >
                <WhaleCard
                  whale={whale}
                  rank={idx + 1}
                  onTail={(source) => setTailSource(source)}
                />
              </section>
            ))}
          </div>

          <div className="hidden h-full min-h-0 flex-col lg:flex">
            <div className="shrink-0 px-7 pb-3 pt-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[34px] font-black uppercase leading-none">
                    WHALES
                  </div>
                  <div
                    className="mt-1 text-[10px] font-black uppercase tracking-[0.22em]"
                    style={{ color: DIM }}
                  >
                    COPYABLE WHALE ACCOUNTS
                  </div>
                </div>
                <div
                  className="rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em]"
                  style={{ borderColor: FAINT, background: PANEL, color: ACCENT }}
                >
                  {ranked.length} tracked
                </div>
              </div>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-8">
              <div className="grid auto-rows-max grid-cols-2 gap-3 xl:grid-cols-3">
                {ranked.map((whale, idx) => (
                  <DesktopWhaleCard
                    key={whale.payload.whaleId}
                    whale={whale}
                    rank={idx + 1}
                    onTail={(source) => setTailSource(source)}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 4: Add the desktop whale card component**

Add this function below `WhaleCard` in `components/whales/WhaleRoster.tsx`:

```tsx
function DesktopWhaleCard({
  whale,
  rank,
  onTail,
}: {
  whale: WhaleTraderSignal;
  rank: number;
  onTail: (source: TailSource) => void;
}) {
  const p = whale.payload;
  const [now, setNow] = useState(0);
  const exposureSummary = buildWhaleExposureSummary(p.openPositions, now);
  const lastSeenAtMs = p.lastSeenAt === null ? null : Date.parse(p.lastSeenAt);
  const fresh =
    now > 0 &&
    !p.stale &&
    lastSeenAtMs !== null &&
    Number.isFinite(lastSeenAtMs) &&
    isSourceFresh(lastSeenAtMs, undefined, now);
  const canTail = exposureSummary.copyableCount > 0;
  const livePositionStatsOnly = p.stats.statsSource === "live_positions";
  const totalPnl = p.stats.pnlAllTimeUsdc;
  const totalPnlColor = totalPnl >= 0 ? GREEN : RED;
  const largest = exposureSummary.largestPosition;
  const largestTime = largest ? formatWhalePositionTime(largest, now) : null;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <article
      className="min-h-[360px] overflow-hidden rounded-xl border p-4"
      style={{
        background: PANEL,
        borderColor: fresh ? FAINT : `${RED}55`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <WhaleFingerprintAvatar
            sourceAccount={p.sourceAccount}
            label={p.displayName}
            mood={fresh ? "HUNTING" : "WOUNDED"}
            size={42}
            pulse={fresh && p.openPositionsCount > 0}
          />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-black uppercase">
              {p.displayName}
            </div>
            <div
              className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              <span>#{rank}</span>
              <span>{p.source}</span>
              <span>{shortAccount(p.sourceAccount)}</span>
            </div>
          </div>
        </div>
        <FreshnessBadge stale={p.stale} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {livePositionStatsOnly ? "Live P/L" : "Total P/L"}
          </div>
          <div
            className="mt-1 text-[30px] font-black leading-none tabular-nums"
            style={{ color: totalPnlColor }}
          >
            {formatSignedWhaleUsd(totalPnl)}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            Equity
          </div>
          <div className="mt-1 text-[15px] font-black tabular-nums">
            {p.stats.equityUsdc > 0 ? fmtUsd(p.stats.equityUsdc) : "N/A"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniMetric label="Open" value={String(exposureSummary.totalCount)} active={exposureSummary.totalCount > 0} />
        <MiniMetric label="Exposure" value={exposureSummary.exposureUsd > 0 ? fmtUsd(exposureSummary.exposureUsd) : "N/A"} active={exposureSummary.exposureUsd > 0} />
        <MiniMetric label="Copy" value={`${exposureSummary.copyableCount}/${exposureSummary.totalCount}`} active={exposureSummary.copyableCount > 0} />
      </div>

      {largest ? (
        <div
          className="mt-3 rounded-lg border p-3"
          style={{ background: BG, borderColor: FAINT }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[20px] font-black uppercase leading-none">
                {largest.market}
              </div>
              <div
                className="mt-1 text-[10px] font-black uppercase tracking-widest"
                style={{ color: largest.side === "long" ? GREEN : RED }}
              >
                {largest.side} {largest.leverage}x
              </div>
            </div>
            <div className="text-right">
              <div
                className="text-[13px] font-black tabular-nums"
                style={{
                  color:
                    (largest.unrealizedPnlPct ?? 0) >= 0 ? GREEN : RED,
                }}
              >
                {largest.unrealizedPnlPct == null
                  ? "N/A"
                  : `${largest.unrealizedPnlPct >= 0 ? "+" : ""}${largest.unrealizedPnlPct.toFixed(1)}%`}
              </div>
              <div
                className="mt-1 text-[9px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                {largestTime?.label === "Seen" ? "Seen" : "Held"}{" "}
                {largestTime?.value ?? "N/A"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="mt-3 rounded-lg border p-3 text-[10px] font-black uppercase tracking-widest"
          style={{ background: BG, borderColor: FAINT, color: DIM }}
        >
          No open positions.
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/live?mode=swipe"
          prefetch={false}
          className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
          style={{
            background: PANEL_2,
            color: FG,
            border: `1px solid ${FAINT}`,
          }}
        >
          <ArrowRight size={12} strokeWidth={3} />
          Positions
        </Link>
        <button
          type="button"
          disabled={!canTail}
          onClick={() => {
            const source = buildWhaleTailSource(p, now);
            if (!source) return;
            onTail(source);
          }}
          className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
          style={{
            background: canTail ? ACCENT : "rgba(250,250,242,0.08)",
            color: canTail ? BG : DIM,
          }}
        >
          <Zap size={12} strokeWidth={3} fill={canTail ? BG : "none"} />
          Tail
        </button>
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Run the roster test to verify it passes**

Run:

```bash
npm run test -- components/whales/whale-roster-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add components/whales/WhaleRoster.tsx components/whales/whale-roster-contract.test.ts
git commit -m "feat: add desktop whale grid"
```

---

### Task 4: Convert Desktop Pulse To A Grid

**Files:**
- Modify: `components/whales/whale-pulse-feed-contract.test.ts`
- Modify: `components/whales/WhalePulseFeed.tsx`

- [ ] **Step 1: Replace the all-viewports Pulse snap contract**

Replace the test named `renders Pulse as a one-card-at-a-time vertical snap feed` in `components/whales/whale-pulse-feed-contract.test.ts` with:

```ts
  it("keeps mobile Pulse snap cards but renders a desktop Pulse grid", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("lg:hidden");
    expect(componentSource).toContain("snap-y snap-mandatory overflow-y-scroll");
    expect(componentSource).toContain('scrollSnapStop: "always"');
    expect(componentSource).toContain("h-full w-full snap-start");
    expect(componentSource).toContain("hidden h-full min-h-0 lg:flex");
    expect(componentSource).toContain("DesktopPulseCard");
    expect(componentSource).toContain("xl:grid-cols-3");
    expect(componentSource).toContain("PULSE TAPE");
  });
```

Add this test after it:

```ts
  it("sizes desktop Pulse reactions to content instead of stretching mobile chips", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("DesktopPulseReactionButton");
    expect(componentSource).toContain("w-auto");
    expect(componentSource).not.toContain("lg:flex-1");
  });
```

- [ ] **Step 2: Run the Pulse contract to verify it fails**

Run:

```bash
npm run test -- components/whales/whale-pulse-feed-contract.test.ts
```

Expected: FAIL because there is no desktop Pulse grid branch.

- [ ] **Step 3: Split Pulse render into mobile and desktop branches**

In `WhalePulseFeed`, replace the `items.length === 0 ? ... : <div ref={scrollRef} ...>` branch with:

```tsx
      {items.length === 0 ? (
        <EmptyPulse />
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={rememberVisiblePulsePosition}
            className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll lg:hidden"
            style={{ scrollSnapStop: "always" }}
          >
            {items.map((item, index) => (
              <section
                key={item.id}
                data-pulse-position-id={item.position.positionId}
                className="h-full w-full snap-start"
              >
                <PulsePositionCard
                  item={item}
                  now={now}
                  slideIndex={index}
                  total={items.length}
                  whaleStats={statsByWhaleId[item.position.whaleId]}
                  selectedReaction={
                    persistedSocial[item.position.positionId]?.myReaction ?? undefined
                  }
                  persistedSocial={persistedSocial[item.position.positionId]}
                  onReact={(reaction) => {
                    if (!requirePulseAuth()) return;
                    const positionId = item.position.positionId;
                    const current = persistedSocial[positionId]?.myReaction;
                    const next = current === reaction ? undefined : reaction;
                    void postPulseSocial({
                      positionId,
                      reaction: next ?? null,
                    });
                  }}
                  onTail={() => {
                    if (!requirePulseAuth()) return;
                    setTailSource(toTailSource(item.position, now));
                  }}
                />
              </section>
            ))}
          </div>

          <div className="hidden h-full min-h-0 flex-col lg:flex">
            <div className="shrink-0 px-7 pb-3 pt-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[34px] font-black uppercase leading-none">
                    PULSE
                  </div>
                  <div
                    className="mt-1 text-[10px] font-black uppercase tracking-[0.22em]"
                    style={{ color: DIM }}
                  >
                    PULSE TAPE
                  </div>
                </div>
                <div
                  className="rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em]"
                  style={{ borderColor: FAINT, background: PANEL, color: ACCENT }}
                >
                  {items.length} live
                </div>
              </div>
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-8">
              <div className="grid auto-rows-max grid-cols-2 gap-3 xl:grid-cols-3">
                {items.map((item, index) => (
                  <DesktopPulseCard
                    key={item.id}
                    item={item}
                    now={now}
                    slideIndex={index}
                    total={items.length}
                    whaleStats={statsByWhaleId[item.position.whaleId]}
                    selectedReaction={
                      persistedSocial[item.position.positionId]?.myReaction ?? undefined
                    }
                    persistedSocial={persistedSocial[item.position.positionId]}
                    onReact={(reaction) => {
                      if (!requirePulseAuth()) return;
                      const positionId = item.position.positionId;
                      const current = persistedSocial[positionId]?.myReaction;
                      const next = current === reaction ? undefined : reaction;
                      void postPulseSocial({
                        positionId,
                        reaction: next ?? null,
                      });
                    }}
                    onTail={() => {
                      if (!requirePulseAuth()) return;
                      setTailSource(toTailSource(item.position, now));
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 4: Add desktop Pulse card and reaction button components**

Add these functions near `PulsePositionCard` in `components/whales/WhalePulseFeed.tsx`:

```tsx
function DesktopPulseCard({
  item,
  now,
  slideIndex,
  total,
  whaleStats,
  selectedReaction,
  persistedSocial,
  onReact,
  onTail,
}: {
  item: PulseItem;
  now: number;
  slideIndex: number;
  total: number;
  whaleStats?: PulseWhaleStats;
  selectedReaction?: PulseReaction;
  persistedSocial?: PulseApiSocialRecord;
  onReact: (reaction: PulseReaction) => void;
  onTail: () => void;
}) {
  const position = item.position;
  const stale = position.stale || !isSourceFresh(position.lastSeenAtMs, undefined, now);
  const sideColor = position.side === "long" ? GREEN : RED;
  const time = formatWhalePositionTime(position, now);
  const social = persistedSocial;

  return (
    <article
      data-pulse-position-id={position.positionId}
      className="flex min-h-[360px] flex-col rounded-xl border p-4"
      style={{ background: PANEL, borderColor: stale ? `${RED}55` : FAINT }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <WhaleFingerprintAvatar
            sourceAccount={position.sourceAccount}
            label={position.displayName}
            mood={stale ? "WOUNDED" : "HUNTING"}
            size={42}
            pulse={!stale}
          />
          <div className="min-w-0">
            <div
              className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {item.toneLabel} | {position.source}
            </div>
            <div className="mt-1 truncate text-[16px] font-black uppercase">
              {position.displayName}
            </div>
          </div>
        </div>
        <div
          className="shrink-0 text-[9px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          {String(slideIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[28px] font-black uppercase leading-none">
            {position.market}
          </div>
          <div
            className="mt-1 text-[11px] font-black uppercase tracking-widest"
            style={{ color: sideColor }}
          >
            {position.side} {position.leverage}x
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {time.label}
          </div>
          <div className="mt-1 text-[13px] font-black">{time.value}</div>
        </div>
      </div>

      <p
        className="mt-4 line-clamp-4 text-[13px] leading-snug"
        style={{ color: FG, fontFamily: FONT_BODY }}
      >
        {item.summary}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <PulseMetric label="Notional" value={formatCompactUsd(position.notionalUsd)} />
        <PulseMetric
          label="Source P/L"
          value={
            position.unrealizedPnlPct == null
              ? "N/A"
              : `${position.unrealizedPnlPct >= 0 ? "+" : ""}${position.unrealizedPnlPct.toFixed(2)}%`
          }
          color={(position.unrealizedPnlPct ?? 0) >= 0 ? GREEN : RED}
        />
        <PulseMetric label="1D Win Rate" value={formatWinRate(whaleStats?.winRatePct1d ?? null)} />
        <PulseMetric label="30D P/L" value={formatSignedUsd(whaleStats?.pnl30dUsdc ?? 0)} color={(whaleStats?.pnl30dUsdc ?? 0) >= 0 ? GREEN : RED} />
      </div>

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="flex flex-wrap gap-2">
          {PULSE_REACTIONS.map((reaction) => (
            <DesktopPulseReactionButton
              key={reaction}
              reaction={reaction}
              selected={selectedReaction === reaction}
              count={social?.reactionCounts[reaction] ?? 0}
              onClick={() => onReact(reaction)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onTail}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
          style={{ background: ACCENT, color: BG }}
        >
          <Zap size={13} strokeWidth={3} fill={BG} />
          Tail
        </button>
      </div>
    </article>
  );
}

function DesktopPulseReactionButton({
  reaction,
  selected,
  count,
  onClick,
}: {
  reaction: PulseReaction;
  selected: boolean;
  count: number;
  onClick: () => void;
}) {
  const color = pulseReactionColor(reaction);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-auto items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
      style={{
        background: selected ? `${color}24` : "rgba(250,250,242,0.04)",
        borderColor: selected ? `${color}70` : FAINT,
        color,
      }}
      aria-pressed={selected}
    >
      {reaction} {count}
    </button>
  );
}
```

- [ ] **Step 5: Run the Pulse test to verify it passes**

Run:

```bash
npm run test -- components/whales/whale-pulse-feed-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add components/whales/WhalePulseFeed.tsx components/whales/whale-pulse-feed-contract.test.ts
git commit -m "feat: add desktop pulse grid"
```

---

### Task 5: Group Desktop Scalp Controls

**Files:**
- Modify: `components/trade/flash-perps-game-contract.test.ts`
- Modify: `components/trade/FastPerpsGame.tsx`

- [ ] **Step 1: Add a failing desktop Scalp layout contract**

Add this test to `components/trade/flash-perps-game-contract.test.ts`:

```ts
  it("groups Scalp controls on desktop instead of stretching the mobile stack", () => {
    const page = source();

    expect(page).toContain("lg:grid lg:grid-cols-[minmax(0,1fr)_360px]");
    expect(page).toContain("Desktop trade controls");
    expect(page).toContain("Desktop order ticket");
    expect(page).toContain("lg:max-w-none");
    expect(page).toContain("lg:w-auto");
  });
```

- [ ] **Step 2: Run the Scalp contract to verify it fails**

Run:

```bash
npm run test -- components/trade/flash-perps-game-contract.test.ts
```

Expected: FAIL because the desktop grouped layout markers do not exist.

- [ ] **Step 3: Add desktop layout wrappers without moving trade logic**

In `FastPerpsGame`, replace the top-level class string:

```tsx
className="mx-auto flex h-full min-h-0 max-w-md flex-col overflow-hidden px-4 pt-3 pb-[calc(88px+env(safe-area-inset-bottom))] lg:max-w-5xl lg:px-8 lg:py-8"
```

with:

```tsx
className="mx-auto flex h-full min-h-0 max-w-md flex-col overflow-hidden px-4 pt-3 pb-[calc(88px+env(safe-area-inset-bottom))] lg:max-w-none lg:px-8 lg:py-8"
```

Then wrap the market, side, preview, stake, leverage, status, and CTA area in a desktop grid. Keep all existing state and handlers. The shape should be:

```tsx
      <div className="mt-3 min-h-0 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
        <section
          className="min-h-0 lg:rounded-xl lg:border lg:p-4"
          style={{ borderColor: FAINT, background: "transparent" }}
        >
          <div
            className="hidden text-[10px] font-black uppercase tracking-widest lg:block"
            style={{ color: DIM }}
          >
            Desktop trade controls
          </div>
          {/* existing positions strip, market buttons, side buttons, graph, and preview metrics stay here */}
        </section>

        <aside
          className="lg:rounded-xl lg:border lg:p-4"
          style={{ borderColor: FAINT, background: PANEL }}
        >
          <div
            className="hidden text-[10px] font-black uppercase tracking-widest lg:block"
            style={{ color: DIM }}
          >
            Desktop order ticket
          </div>
          {/* existing stake, leverage, status, and CTA stay here */}
        </aside>
      </div>
```

For the primary action button, add `lg:w-auto lg:px-8` to the class name while keeping `w-full` for mobile:

```tsx
className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed lg:w-auto lg:px-8"
```

- [ ] **Step 4: Run the Scalp contract to verify it passes**

Run:

```bash
npm run test -- components/trade/flash-perps-game-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add components/trade/FastPerpsGame.tsx components/trade/flash-perps-game-contract.test.ts
git commit -m "feat: group desktop scalp controls"
```

---

### Task 6: Focused Regression Suite

**Files:**
- No source changes expected unless tests reveal a regression.

- [ ] **Step 1: Run the targeted contract suite**

Run:

```bash
npm run test -- components/shell/nav-items.test.ts components/portfolio/portfolio-layout-contract.test.ts components/settings/deposit-wallet-contract.test.ts components/whales/whale-roster-contract.test.ts components/whales/whale-pulse-feed-contract.test.ts components/trade/flash-perps-game-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests if targeted tests and typecheck pass**

Run:

```bash
npm run test
```

Expected: PASS. If unrelated existing tests fail, identify the failing files and do not modify unrelated dirty work without confirming scope.

- [ ] **Step 4: Route any regression fixes back to the owning task**

If the targeted suite, typecheck, or full test run fails because of the desktop card grid changes, fix the issue in the task that introduced it and amend that task's commit before continuing.

If failures are unrelated to this work, record the failing command and file names in the final implementation summary. Do not modify unrelated dirty work.

---

### Task 7: Browser Verification

**Files:**
- No source changes expected unless browser verification reveals a layout issue.

- [ ] **Step 1: Verify desktop Whales**

Open `http://localhost:3000/feed` at desktop width around 1280px.

Expected:

- Desktop nav contains `Whales`, `Scalp`, `Pulse`, `Folio`, `Settings`.
- It does not contain `Heat` or `Wins`.
- The Whales page shows a multi-card grid, not one centered card per screen.
- Mobile bottom nav is hidden.

- [ ] **Step 2: Verify desktop Pulse**

Open `http://localhost:3000/chatter` at desktop width around 1280px.

Expected:

- Pulse renders multiple cards or a dense desktop card stream.
- Pulse does not snap one card per screen on desktop.
- Reaction chips are content-sized.
- Tail buttons open the existing `TailModal`.

- [ ] **Step 3: Verify desktop Scalp**

Open `http://localhost:3000/trade` at desktop width around 1280px.

Expected:

- Scalp is reachable from desktop primary nav.
- Market and side controls are grouped separately from stake and leverage controls.
- Primary action no longer feels like a stretched phone button on desktop.
- Existing login or wallet-required states remain readable.

- [ ] **Step 4: Verify mobile**

Open these routes at mobile width around 390px:

- `http://localhost:3000/feed`
- `http://localhost:3000/chatter`
- `http://localhost:3000/trade`
- `http://localhost:3000/portfolio`
- `http://localhost:3000/deposit`

Expected:

- Bottom nav still works and shows `Whales`, `Scalp`, elevated `Pulse`, `Folio`, `Settings`.
- `/feed` keeps mobile snap cards.
- `/chatter` keeps mobile snap cards.
- `/trade` keeps the current compact mobile flow.

- [ ] **Step 5: Route browser-discovered fixes back to the owning task**

If browser verification reveals a layout defect caused by a task in this plan, fix it in the relevant component and amend that task's commit before final verification.

If no source changes are required, do not make an empty commit.
