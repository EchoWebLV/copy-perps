# Desktop Card Grid Redesign

**Status:** approved for implementation planning  
**Date:** 2026-05-30  
**Direction:** Option B, responsive desktop card grid

## Goal

Make the desktop app feel intentionally designed for desktop without turning it into a full trading terminal.

The current shell already has a desktop side nav, main area, and optional right rail. The problem is that several active routes still render mobile-first one-card-at-a-time surfaces inside that shell. Desktop should keep the product's bold card personality, but use wider viewports for multi-card scanning, tighter spacing, route headers, and controls that match their function instead of stretching mobile buttons.

## Current State

The app is a Next.js 16 App Router project. The app routes live under `app/(app)` and are wrapped by `app/(app)/layout.tsx`, which provides global user, preference, Pacifica live marks, and Flash live price providers.

The active product path is whale social because `whaleSocialEnabled()` defaults to true. In that mode:

- `/feed` renders `WhaleRoster`, currently a vertical snap feed of whale cards. This is the clearest stretched-phone desktop problem.
- `/chatter` renders `WhalePulseFeed`, currently a vertical snap feed of Pulse cards on desktop as well as mobile.
- `/live` renders `WhaleMarketHeatmap`, which already uses desktop space better, but is no longer meant to stay in primary navigation.
- `/trade` renders `FastPerpsGame`, which uses desktop width but still stretches phone-sized control groups.
- `/portfolio`, `/deposit`, and `/leaderboard` already use `AppShell`, but still include some mobile-first constraints and empty context rails.

There is one pre-existing local modification in `lib/bots/cross-bot.test.ts`. The desktop redesign should not touch or revert it unless a later implementation task explicitly needs that file.

## Navigation

Primary navigation should match across mobile and desktop:

- Whales: `/feed`
- Scalp: `/trade`
- Pulse: `/chatter`
- Folio: `/portfolio`
- Settings: `/deposit`

Remove `Heat` (`/live`) and `Wins` (`/leaderboard`) from primary navigation for now. The routes can remain in the codebase and can be reintroduced later.

Desktop `DesktopNav` should expose the same destinations as mobile `BottomNav`, with desktop-friendly icon buttons and labels/tooltips. Mobile `BottomNav` should keep its current visual structure, including the elevated Pulse shortcut, unless a later polish pass changes it deliberately.

## Desktop Design Direction

The selected approach is a responsive card grid.

This is not a full terminal and not a dense table workbench. The app should still feel visual and fast, with whale cards, Pulse cards, and trade panels. The desktop change is primarily about layout, density, and control sizing:

- Replace one-card-per-screen snap feeds at desktop breakpoints with grid or dense card stream layouts.
- Keep mobile snap behavior below the desktop breakpoint.
- Use route headers for orientation and quick actions.
- Avoid huge full-width mobile buttons on desktop. Button width should communicate action weight.
- Use repeated cards for whales, Pulse items, positions, and share cards. Avoid wrapping whole page sections as cards.
- Preserve the warm near-black base, acid-yellow primary action, green/red PnL, and fingerprint/avatar visuals.
- Keep card radii tighter on desktop, generally 8 to 14px unless an existing atom requires otherwise.

## Route Design

### `/feed` - Whales

Desktop `/feed` should render a whale card grid instead of snap scrolling.

Recommended layout:

- Persistent `AppShell` side nav.
- Main scroll area with a compact header: `Whales`, live refresh state, and optional count summary.
- A responsive grid of whale cards, starting at 2 columns around `lg` and expanding to 3 columns when available width allows.
- Whale cards should preserve the existing data: rank, identity, source account, freshness, total or live P/L, equity, P/L chart, period stats, open count, exposure, largest or best open position, and Tail/View actions.
- Cards should be shorter and more scannable than the mobile version. They should not try to occupy the full viewport height.
- Tail actions should stay on-card. View positions can remain a secondary action, but it should not imply that `/live` is a primary nav destination.

Mobile `/feed` keeps the current snap roster.

### `/chatter` - Pulse

Desktop `/chatter` should render Pulse as a multi-card desktop feed, not a snap feed.

Recommended layout:

- Main scroll area with a Pulse header and current item count.
- Responsive card grid or dense two-column stream.
- Pulse cards keep headline, whale identity, market, side, leverage, hold time, short analysis, notional, source P/L, entry, current mark, 1D win rate, 30D P/L, social reactions, and Tail.
- Reactions should be compact icon chips sized to their content, not evenly stretched across the width.
- Tail should remain the most prominent card action.
- Cards should handle long analysis text without overlapping action rows.

Mobile `/chatter` keeps the current one-card snap feed.

### `/trade` - Scalp

Desktop `/trade` should keep the same Flash Perps behavior but reorganize the controls.

Recommended layout:

- Main area uses a two-column or panel layout at desktop widths.
- Left or top panel: market and side selection, with compact segmented controls.
- Main panel: position preview, live graph when a position exists, stake and notional preview.
- Control panel: stake chips, custom stake input, mode, leverage chips, status/error messages.
- Primary action stays visually strong, but it should not always span the full desktop width.
- Existing trade logic, signing paths, position cache, Flash market restrictions, and instant trading behavior must not change.

Mobile `/trade` keeps the current single-column flow.

### `/portfolio` - Folio

Desktop `/portfolio` already benefits from wider space, but should be polished so it does not feel like a mobile stack stretched sideways.

Recommended layout:

- Keep the summary header and tabs.
- Let open and closed positions use 2-column grids where appropriate.
- Keep wallet actions accessible and avoid oversized full-width action buttons on desktop.
- Ensure the right rail is useful when present, or hide it when it would only show a generic empty state.

### `/deposit` - Settings

Desktop `/deposit` should read as settings and funding, not a phone settings page.

Recommended layout:

- Main funding/account panel with Buy USDC, profile share card, and any enabled developer tools.
- Secondary settings/feed preferences in a side rail only when enabled and useful.
- If no rail content exists, avoid showing the generic "Select a bot or position" empty state.
- Keep wallet creation and funding behavior unchanged.

### `/leaderboard` and `/live`

Remove both from primary nav for now.

Do not delete the routes. `/leaderboard` can remain reachable directly. `/live` can remain available for development and future Heat reintroduction. Implementation should avoid spending design time on these routes beyond ensuring nav removal does not break active links.

## Component Architecture

Prefer incremental changes to existing components:

- Update `components/shell/nav-items.ts` and `components/shell/DesktopNav.tsx` so desktop primary nav matches mobile.
- Keep `components/shell/BottomNav.tsx` aligned with the same destination set.
- Update contract tests that currently lock in old nav order and desktop-only Heat/Wins items.
- Add desktop branches inside `WhaleRoster` and `WhalePulseFeed` rather than rewriting their data fetching and polling logic.
- Extract small helper components only when it reduces meaningful duplication, such as desktop whale cards or desktop Pulse cards.
- Keep shared trading, tailing, wallet, and API behavior untouched.

## Data Flow

No data model or API changes are needed.

The redesign should reuse:

- `/api/whales/roster` polling in `WhaleRoster`.
- `/api/whales/live?limit=1000` polling in `WhalePulseFeed` and `WhaleMarketHeatmap`.
- `/api/pulse/social` for Pulse reactions.
- Existing `TailModal` and `buildWhaleTailSource` or `toTailSource` paths.
- Existing Flash Perps routes and client state in `FastPerpsGame`.
- Existing portfolio snapshot and refresh routes.

## Interaction Details

- Desktop cards should remain clickable and keyboard reachable.
- Tail buttons must open the same `TailModal`.
- Pulse reaction buttons must preserve auth behavior and reaction persistence.
- Desktop nav icon-only controls need accessible labels and useful hover titles.
- Mobile and desktop should expose the same primary route set.
- `Heat` and `Wins` should not appear in primary nav labels, tooltips, or icon list.

## Visual Constraints

- No phone-shaped desktop frame.
- No one-card-per-screen desktop snap layout for `/feed` or `/chatter`.
- No nested cards inside cards unless the nested item is a true repeated data item.
- No decorative gradient orbs or bokeh backgrounds.
- No oversized hero treatment inside operational routes.
- Text must not overlap controls at desktop or mobile breakpoints.
- Buttons should fit their content or their control group. Avoid making secondary actions span large desktop columns.
- Do not use em dashes in user-facing copy.

## Testing And Verification

Add or update focused contract tests before implementation:

- Desktop nav exposes `Whales`, `Scalp`, `Pulse`, `Folio`, and `Settings` in the same functional set as mobile.
- Desktop nav no longer includes `Heat` or `Wins`.
- `WhaleRoster` keeps mobile snap behavior but has a desktop grid branch.
- `WhalePulseFeed` keeps mobile snap behavior but has a desktop grid or dense stream branch.
- `FastPerpsGame` has desktop-specific grouped controls without changing existing Flash trade behavior.

Run:

- `npm run test -- components/shell/nav-items.test.ts components/whales/whale-roster-contract.test.ts components/whales/whale-pulse-feed-contract.test.ts components/trade/flash-perps-game-contract.test.ts`
- `npm run typecheck`
- `npm run build` if the desktop route changes touch layout or CSS broadly.

Browser verification:

- Desktop 1280px and 1440px: `/feed` shows a grid of whale cards, not one centered phone card.
- Desktop 1280px and 1440px: `/chatter` shows multiple Pulse cards or a dense stream, not one snap card per screen.
- Desktop: `/trade` controls are grouped and compact, with Scalp reachable from desktop primary nav.
- Desktop: `/portfolio` and `/deposit` do not show irrelevant empty context rail content.
- Mobile 390px: `/feed`, `/chatter`, `/trade`, `/portfolio`, and `/deposit` preserve the mobile bottom-nav experience.

## Non-Goals

- Full trading terminal redesign.
- Table-first dense workbench.
- Trading logic changes.
- Bot or whale strategy changes.
- Database migrations.
- Authentication, wallet, or funding flow changes.
- Rebranding.
- Deleting `/live` or `/leaderboard`.

## Risks

- Existing contract tests intentionally preserve mobile-like desktop behavior. They should be updated to describe the new desktop behavior instead of bypassed.
- Whale and Pulse components mix data fetching, polling, and presentation. Desktop branches should share the existing state rather than duplicate API polling.
- The right context rail can make desktop feel cluttered if it only repeats card content. Hide or make it useful per route.
- Large route changes can accidentally alter mobile behavior. Verify mobile after each desktop route change.

## Implementation Strategy

1. Update nav contracts and shell nav to use the shared five-item primary route set.
2. Add desktop grid branch for `WhaleRoster`, preserving mobile snap feed.
3. Add desktop grid or dense stream branch for `WhalePulseFeed`, preserving mobile snap feed.
4. Reorganize `FastPerpsGame` desktop controls without changing trade execution code.
5. Polish `Portfolio` and `Deposit` desktop rails and spacing.
6. Run targeted tests, typecheck, build where feasible, and browser-verify desktop and mobile.
