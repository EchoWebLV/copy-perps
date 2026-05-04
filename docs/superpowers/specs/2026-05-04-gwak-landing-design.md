# gwak.gg Landing Page — Design

**Date:** 2026-05-04
**Scope:** Rebrand of the public landing page from "Fast Bet" to "gwak.gg".

## Goal

Replace the current sign-in gate at `/` with a rebranded gwak.gg version. Same behavior (logo, single CTA, auth-aware), new identity. The page should feel calm and confident — playful glow, subtle motion, brand mark front and center.

## In scope

- `app/page.tsx` — replace contents.
- `app/layout.tsx` — update `metadata.title`, `metadata.description`, `appleWebApp.title`.
- `public/manifest.json` — update `name`, `short_name`, `description`.
- `app/globals.css` — register a single `@keyframes gwak-breathe` rule used by the landing.

The logo asset already lives at `public/logo.jpeg` and is used as-is.

## Out of scope

- App routes other than `/`. Feed, portfolio, deposit, API routes are untouched.
- Auth flow. We continue to use `usePrivy()` exactly as today.
- Project rename. The repo, `package.json` name, folder name remain `fast-bet`.
- Icon assets. The manifest references `/icon-192.png` and `/icon-512.png` which do not exist in `public/`; this is pre-existing and not addressed here.
- Any non-landing UI.

## Layout

Full-viewport, mobile-first, vertically centered. The viewport is treated as a single hero — no scroll, no second section.

```
┌───────────────────────────────────┐
│                                   │
│   [ambient glow: mint + violet]   │
│                                   │
│      ┌──────────────────┐         │
│      │  logo image      │         │  max-width 360px, centered
│      │  (gwak + tagline)│         │
│      └──────────────────┘         │
│                                   │
│        [  CTA button  ]           │  rounded-2xl pill
│                                   │
└───────────────────────────────────┘
```

- Container: `flex min-h-dvh flex-col items-center justify-center px-6`.
- Logo: `next/image`, `priority`, intrinsic dimensions sourced from the file. Rendered at `max-w-[360px] w-full h-auto` with a soft mint drop-shadow (`drop-shadow(0 0 30px rgba(74,222,128,0.18))`).
- Spacing between logo and CTA: ~40px (`mt-10`).
- No sub-copy text — the tagline is part of the logo image.

## Visual treatment

**Background.** `#000` base with two radial-gradient blobs layered on top:

- Mint blob: `radial-gradient(circle at 30% 35%, rgba(74, 222, 128, 0.18), transparent 55%)`.
- Violet blob: `radial-gradient(circle at 70% 70%, rgba(167, 139, 250, 0.18), transparent 55%)`.

**Motion.** A single CSS keyframe animation `gwak-breathe` runs on the page wrapper (`<main>` element in `app/page.tsx`), not on `<body>` — the animation is scoped to this route only. The blob opacities oscillate `18% → 34% → 18%` over 6s, `ease-in-out infinite`. No JavaScript, no scroll listeners. Honor `prefers-reduced-motion: reduce` by disabling the animation (steady state at the lower opacity).

**Logo.** Static `<Image>` element. The arrow on the "k" and the tagline are baked into the image and do not animate independently.

**CTA button.**

- Reuses the existing pill style from the current `app/page.tsx` (`rounded-2xl px-8 py-4 text-lg font-bold transition active:scale-[0.97]`).
- Authenticated state: green pill, label `Enter →`, links to `/feed` (was already labeled "Open feed →" — relabeled to "Enter →").
- Unauthenticated state: white pill, label `Log in`, calls `usePrivy().login()`.
- Loading state (`!ready`): muted text `Loading…`, no button — same as today.

## Copy

| Element | Value |
| --- | --- |
| Page tab title | `gwak.gg` |
| Meta description | `Trade. Watch. Grow.` |
| `appleWebApp.title` | `gwak.gg` |
| Manifest `name` | `gwak.gg` |
| Manifest `short_name` | `gwak` |
| Manifest `description` | `Trade. Watch. Grow.` |
| CTA (authenticated) | `Enter →` |
| CTA (unauthenticated) | `Log in` |

The small uppercase `Fast Bet` eyebrow text above the headline is removed entirely. There is no eyebrow on the new design — the logo image is the brand mark.

## Behaviors

The page reads `usePrivy()` and renders one of three states (same logic as today):

1. **`!ready`** — show the muted `Loading…` text. No button.
2. **`ready && !authenticated`** — show the white `Log in` pill that calls `login()`.
3. **`ready && authenticated`** — show the green `Enter →` pill that links to `/feed`.

The component remains a `"use client"` component because `usePrivy` is a client hook.

## Accessibility

- Logo `<Image>` gets `alt="gwak.gg"`.
- Buttons keep their default focus rings; do not suppress focus visibility.
- The breathe animation respects `prefers-reduced-motion: reduce`.
- Color contrast for both buttons against the dark background already meets WCAG AA (white on black, green on black).

## File changes summary

```
app/page.tsx        — replaced (no new components, ~40 lines)
app/layout.tsx      — metadata.title, metadata.description, appleWebApp.title
app/globals.css     — add @keyframes gwak-breathe and a .gwak-breathe utility class
public/manifest.json — name, short_name, description
```

No new dependencies. No new components. No new files outside the spec/plan docs.

## Non-goals / explicit choices

- **No tagline rendered as text.** It is part of the logo image. We trade per-word animation potential for simplicity and crispness.
- **No live data, no ticker, no counters.** We chose mood B (playful glow), not C (live ticker).
- **No marketing sections.** This is a sign-in gate, not a scrollable marketing site.
- **No project-wide rebrand.** Only landing-visible surfaces change. Internal route names, component names, repo name remain.
