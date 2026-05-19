# Responsive Desktop Command Center Design

**Status:** approved for implementation planning  
**Date:** 2026-05-20  
**Branch:** `codex/fix-bugs-polish`

## Goal

Turn the current mobile-first paper-bot app into a responsive desktop web app. Mobile must keep the existing full-screen, bottom-nav, swipe-first experience. Desktop should stop rendering as a clipped phone frame and instead use the extra width for a trading-desk style command center.

The approved direction is **Option A: Command Center**.

## Current State

The app is a Next.js 16 App Router project. Main user routes live in `app/(app)`:

- `/feed`: bot roster, currently the primary page.
- `/live`: snap-scroll feed of open paper positions.
- `/portfolio`: authenticated wallet, open/closed positions, close/share/withdraw actions.
- `/chatter`: bot trade narration timeline.
- `/deposit`: wallet funding and feed settings.
- `/leaderboard`: shared win cards.

`app/(app)/layout.tsx` wraps every app route in `.phone-frame`. On mobile this is full-screen. On desktop, `app/globals.css` centers a 390px phone-shaped container and clips all route content inside it. That behavior is now the main desktop limitation.

## Product Behavior

### Mobile

Mobile remains the baseline product:

- Keep route-level pages full-screen.
- Keep the current bottom navigation.
- Keep `/live` snap-scroll behavior.
- Keep existing touch-oriented spacing, modals, and CTAs.
- Do not introduce a side nav or multi-panel layout below the desktop breakpoint.

### Desktop

Desktop becomes a persistent command center:

- Left side nav: compact icon navigation for Roster, Live, Chatter, Portfolio, Settings, and any existing secondary route that stays reachable.
- Main work area: the route's primary content.
- Right context rail: wallet/account state, open position summary, selected bot or selected position context, and chat where relevant.
- No phone-shaped frame, no clipped app viewport, and no centered 390px-only surface.
- Use a constrained max content width so ultra-wide displays stay structured.
- Maintain the existing warm dark substrate, acid-yellow primary action, green/red PnL colors, and bot avatar language.

The desktop command center should feel like a dense trading operations surface, not a marketing page. It should favor scannability, persistent context, and fast action.

## Route Design

### `/feed`

Desktop `/feed` is the full command center default:

- Left navigation stays persistent.
- Roster panel lists bots ranked by live equity.
- Center panel highlights the selected bot or its newest open position.
- Right rail shows wallet readiness, user open copies, and a compact chat/context panel for the selected bot.

Initial selection should be deterministic: top-ranked bot with an open position, otherwise top-ranked bot. Clicking a bot row updates the selected context without navigating away. Existing mobile roster cards remain the mobile presentation.

### `/live`

Desktop `/live` keeps the live position feed as the primary surface but should not require a narrow phone viewport:

- Center panel shows the active live position card.
- Adjacent list or rail shows other open positions by recency.
- Right rail exposes wallet readiness, selected position details, and tail action context.

Mobile keeps the existing vertical snap-scroll feed.

### `/portfolio`

Desktop `/portfolio` should present portfolio data in a wider layout:

- Summary metrics span the top of the main area.
- Open/closed tabs remain.
- Position rows can use a wider row layout.
- Withdraw actions and wallet details sit in the right rail.

Mobile keeps the current portfolio stack.

### `/chatter`

Desktop `/chatter` becomes a wider activity stream:

- Main area lists bot narration events.
- Right rail can show live roster context, selected bot, or recent open positions.

Mobile keeps the current single-column timeline.

### `/deposit`

Desktop `/deposit` uses the shell but keeps account settings simple:

- Main area contains funding and Solana address actions.
- Right rail contains feed preferences, wallet status, and logout/version information.

Mobile keeps the current stacked settings page.

### `/leaderboard`

Desktop `/leaderboard` should use the desktop shell when reachable from the app nav, with shared cards laid out in a responsive grid or wider list. Mobile can remain the existing list.

## Component Architecture

Add shared shell components rather than embedding desktop behavior in every page:

- `components/shell/AppShell.tsx`: owns responsive shell selection and shared layout slots.
- `components/shell/DesktopNav.tsx`: desktop-only icon nav using `lucide-react`.
- `components/shell/DesktopContextRail.tsx`: reusable rail container for balance, wallet, selected bot, selected position, and open-copy summaries.
- Existing `BottomNav` becomes mobile-only.
- Existing `.phone-frame` behavior is narrowed to mobile or removed in favor of shell classes.

Where possible, page components should split data/state from presentation so mobile and desktop can share live polling, Pacifica mark updates, tail modal behavior, and chat behavior.

Recommended presentation splits:

- Extract reusable bot roster row/card pieces from `components/feed/BotRoster.tsx`.
- Extract reusable live position card pieces from `components/feed/LiveFeed.tsx`.
- Keep `TailModal`, `BotChatSheet`, and portfolio action components shared.

## Data Flow

Do not change trading, wallet, Pacifica, or bot strategy behavior for this feature.

Allowed UI data changes:

- Share selected bot or selected position state inside desktop client components.
- Reuse `/api/bots/roster` polling already used by roster and live feed.
- Reuse portfolio polling for authenticated account summaries.
- Reuse `PacificaLiveProvider` from `app/(app)/layout.tsx` for live marks.

No database schema changes are needed.

## Interaction Details

- Desktop nav links behave like normal route links.
- On `/feed`, selecting a bot should update local UI state, not force route navigation.
- Tail buttons keep opening `TailModal`.
- Bot chat keeps using `BotChatSheet`, but on desktop it may render as a rail/panel presentation if that can be done without breaking mobile.
- Keyboard and screen-reader basics should remain intact: buttons need labels, active nav state should be visible, and icon-only desktop nav entries need tooltips or accessible labels.

## Visual Rules

- Keep mobile visual language, but tune desktop density down from oversized mobile cards.
- Avoid nested cards inside cards.
- Use panels and bands for layout regions; reserve card styling for repeated bot/position/share items.
- Keep cards at modest radii, ideally 8-14px on desktop unless reusing existing atoms that require larger radii.
- Ensure button text and bot names fit at desktop and mobile breakpoints.
- Do not use decorative gradient orbs or bokeh backgrounds.
- Keep the page from becoming a one-hue palette: dark base, yellow actions, green/red PnL, neutral panels, and avatar imagery should all remain visible.

## Breakpoints

Implementation should use conservative breakpoints:

- Mobile: current behavior below `768px`.
- Desktop shell: starts at `1024px` or where there is enough room for side nav, main content, and right rail.
- Tablet/intermediate widths can use mobile behavior or a simplified two-column shell if it falls out naturally, but the requirement is mobile plus desktop.

## Testing And Verification

Run:

- `npm run typecheck`
- `npm run test`
- `npm run build` if feasible for Next.js route and CSS validation

Browser verification:

- Mobile viewport: `/feed`, `/live`, `/portfolio`, `/chatter`, `/deposit` still match the mobile-first behavior and bottom nav remains usable.
- Desktop viewport: `/feed` shows the command center with side nav, main work area, and right rail.
- Desktop viewport: `/live` is not clipped to phone size.
- Desktop viewport: `/portfolio` makes use of horizontal space and actions remain accessible.
- Tail modal and bot chat still open from desktop and mobile.

## Non-Goals

- Native desktop wrapper, Electron, Tauri, or installable app packaging.
- Trading logic changes.
- Bot strategy changes.
- Database migrations.
- New authentication or wallet flow.
- Rebranding or landing-page work.
- Admin feature changes.

## Risks

- Current roster/live components combine polling, selection, and mobile presentation. Refactoring them carelessly could break live PnL updates or tail modal state.
- `position: fixed` elements currently rely on `.phone-frame` transform behavior on desktop. Removing the phone frame requires checking balance pill, bottom nav, sheets, and modals across breakpoints.
- Desktop can become cluttered if every mobile card is simply shown at full size. The desktop implementation should use denser rows and summary panels where appropriate.

## Implementation Strategy

1. Add the responsive shell and desktop nav without changing route data logic.
2. Make `BottomNav` mobile-only and remove desktop phone-frame clipping.
3. Adapt `/feed` into the command center desktop layout while preserving existing mobile roster.
4. Adapt `/live`, `/portfolio`, `/chatter`, `/deposit`, and `/leaderboard` into shell-aware desktop layouts.
5. Verify mobile first after every major route change, then verify desktop.
