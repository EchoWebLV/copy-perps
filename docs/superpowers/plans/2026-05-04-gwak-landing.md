# gwak.gg Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the public landing page at `/` from "Fast Bet" to "gwak.gg" with the logo image, breathing mint+violet glow, and an auth-aware CTA.

**Architecture:** Pure frontend rebrand. Replace the JSX in `app/page.tsx`, add a single CSS keyframe to `app/globals.css`, and update PWA/page metadata in `app/layout.tsx` and `public/manifest.json`. The logo asset already exists at `public/logo.jpeg` (1280×853). No new dependencies, no new components, no auth-flow changes.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind CSS v4 (PostCSS, theme directives in `globals.css`) · `@privy-io/react-auth` for the login button · `next/image` for the logo.

**Note on testing:** This repo has no test runner configured (`package.json` has no `test` script and no testing dependencies). Verification for each task is via `npm run typecheck`, `npm run build`, and a manual dev-server check at `http://localhost:3000`. Do **not** add a test framework — that's out of scope.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `app/globals.css` | Modify | Add `@keyframes gwak-breathe` and a `.gwak-breathe` utility class. Honor `prefers-reduced-motion`. |
| `app/page.tsx` | Replace contents | New landing JSX: logo image, breathing glow wrapper, auth-aware CTA. |
| `app/layout.tsx` | Modify | Update `metadata.title`, `metadata.description`, `appleWebApp.title` to gwak.gg / "Trade. Watch. Grow." |
| `public/manifest.json` | Modify | Update `name`, `short_name`, `description` to match new branding. |

Reference spec: [docs/superpowers/specs/2026-05-04-gwak-landing-design.md](../specs/2026-05-04-gwak-landing-design.md).

---

## Task 1: Add the breathing-glow animation to globals.css

**Files:**
- Modify: `app/globals.css`

The animation is a single `@keyframes` rule plus a utility class that applies it. The two radial-gradient blobs (mint + violet) live inside the keyframe — opacity oscillates `0.18 → 0.34 → 0.18` over 6s. The class also sets `background-color: #000` as a fallback so the page never flashes another color.

- [ ] **Step 1: Open `app/globals.css` and append the keyframe + utility class**

Add the following at the end of `app/globals.css` (after the existing `.no-scrollbar` rule):

```css
@keyframes gwak-breathe {
  0%, 100% {
    background:
      radial-gradient(circle at 30% 35%, rgba(74, 222, 128, 0.18), transparent 55%),
      radial-gradient(circle at 70% 70%, rgba(167, 139, 250, 0.18), transparent 55%),
      #000;
  }
  50% {
    background:
      radial-gradient(circle at 30% 35%, rgba(74, 222, 128, 0.34), transparent 55%),
      radial-gradient(circle at 70% 70%, rgba(167, 139, 250, 0.34), transparent 55%),
      #000;
  }
}

.gwak-breathe {
  background:
    radial-gradient(circle at 30% 35%, rgba(74, 222, 128, 0.18), transparent 55%),
    radial-gradient(circle at 70% 70%, rgba(167, 139, 250, 0.18), transparent 55%),
    #000;
  animation: gwak-breathe 6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .gwak-breathe {
    animation: none;
  }
}
```

- [ ] **Step 2: Verify the CSS is syntactically valid**

Run: `npx tailwindcss -i app/globals.css -o /tmp/gwak-check.css 2>&1 | head -20`

Expected: No errors. (Tailwind v4 will compile the file. Warnings about unused `@theme` tokens are fine.)

If you get `Cannot find module 'tailwindcss'`, run from the project root and ensure `node_modules` is installed.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Add gwak-breathe glow animation to globals.css"
```

---

## Task 2: Replace `app/page.tsx` with the gwak landing

**Files:**
- Modify: `app/page.tsx` (full replacement)

The new page is a `"use client"` component that calls `usePrivy()` for auth state. It renders the logo image with `next/image`, then one of three CTA states (loading / login / enter). The `<main>` element gets the `gwak-breathe` class.

- [ ] **Step 1: Replace the entire contents of `app/page.tsx` with the following**

```tsx
"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();

  return (
    <main className="gwak-breathe flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Image
        src="/logo.jpeg"
        alt="gwak.gg"
        width={1280}
        height={853}
        priority
        className="h-auto w-full max-w-[360px] drop-shadow-[0_0_30px_rgba(74,222,128,0.18)]"
      />

      {!ready && (
        <div className="mt-10 text-sm text-neutral-600">Loading…</div>
      )}

      {ready && !authenticated && (
        <button
          onClick={login}
          className="mt-10 rounded-2xl bg-white px-8 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
        >
          Log in
        </button>
      )}

      {ready && authenticated && (
        <Link
          href="/feed"
          className="mt-10 rounded-2xl bg-[#22c55e] px-8 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
        >
          Enter →
        </Link>
      )}
    </main>
  );
}
```

Notes:
- The `gwak-breathe` class supplies the background gradient and animation; no inline styles needed.
- `next/image` requires explicit `width`/`height` for non-imported sources. `1280` × `853` are the actual pixel dimensions of `public/logo.jpeg` — keep them, the responsive `w-full max-w-[360px] h-auto` classes handle display sizing.
- The green hex `#22c55e` is reused from the existing button (see `app/globals.css` `--color-up` for the same value).
- The "Fast Bet" eyebrow text (`<div className="mb-3 text-xs ...">Fast Bet</div>`) and the two `<h1>`/`<h2>` headlines that were in the previous version are intentionally removed — the logo image carries the brand mark and tagline.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: Exits with code 0, no errors. (The page imports `Image`, `Link`, `usePrivy`, all of which already work in the rest of the repo.)

If typecheck fails on an unrelated file, that pre-existing failure is not yours to fix here — note it and proceed only if the failure is in `app/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "Replace landing page with gwak.gg rebrand"
```

---

## Task 3: Update page metadata and manifest

**Files:**
- Modify: `app/layout.tsx`
- Modify: `public/manifest.json`

Metadata changes only. The Apple PWA title and the standalone manifest both still say "Fast Bet" — update them to match the new brand. The body markup in `layout.tsx` is unchanged.

- [ ] **Step 1: Edit `app/layout.tsx` — replace the `metadata` export**

Find the existing `metadata` block:

```tsx
export const metadata: Metadata = {
  title: "Fast Bet",
  description: "All the short market spam, in one feed.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fast Bet",
  },
};
```

Replace it with:

```tsx
export const metadata: Metadata = {
  title: "gwak.gg",
  description: "Trade. Watch. Grow.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "gwak.gg",
  },
};
```

Leave `viewport`, the `RootLayout` function, and all other content in `app/layout.tsx` exactly as they are.

- [ ] **Step 2: Replace `public/manifest.json` contents**

Replace the entire file contents with:

```json
{
  "name": "gwak.gg",
  "short_name": "gwak",
  "description": "Trade. Watch. Grow.",
  "start_url": "/feed",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

Note: the `icons` array references `/icon-192.png` and `/icon-512.png`, which do not exist in `public/`. This is a pre-existing condition (manifest already had these references) and is **out of scope** for this task. Do not generate icons.

- [ ] **Step 3: Verify JSON is valid and typecheck still passes**

Run in parallel:
```bash
node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8'))" && echo "manifest OK"
npm run typecheck
```

Expected: `manifest OK` printed, typecheck exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx public/manifest.json
git commit -m "Update metadata and manifest to gwak.gg branding"
```

---

## Task 4: Verify the build and check the page in a browser

**Files:** none (verification only).

This is the only verification gate that catches visual regressions, image-loading issues (next/image config), and CSS animation correctness. Do not skip it.

- [ ] **Step 1: Run a production build**

Run: `npm run build`

Expected: Exits with code 0. The build prints route info; `/` should appear in the output as a static or dynamic route.

If the build fails on an `Image` width/height error, double-check the dimensions in `app/page.tsx` are `width={1280}` and `height={853}`.

If the build fails on a Tailwind compilation error, double-check the `@keyframes` block in `app/globals.css` for typos (no Tailwind directives inside, just plain CSS).

- [ ] **Step 2: Start the dev server**

Run: `npm run dev` (in a background terminal so you can keep using your shell, or in a separate terminal pane).

Wait until you see `Ready in <time>ms`.

- [ ] **Step 3: Open `http://localhost:3000` in a browser and verify the following**

Visual checklist (eyes-on, no automation):

1. The page loads on a black background.
2. A mint + violet glow is visible behind the logo (radial gradients, not a hard edge).
3. The glow gently brightens and dims on a ~6 second cycle (the `gwak-breathe` animation).
4. The gwak logo image is centered, capped at ~360px wide, with a soft mint shadow.
5. The CTA below the logo says either:
   - **Loading…** (briefly, while Privy initializes), or
   - **Log in** (white pill) if you're not authenticated, or
   - **Enter →** (green pill) if you're already authenticated.
6. Clicking **Log in** opens the Privy login modal.
7. Clicking **Enter →** (when authenticated) navigates to `/feed`.
8. The browser tab title reads `gwak.gg` (not `Fast Bet`).
9. No console errors related to `next/image`, missing CSS, or hydration.

- [ ] **Step 4: Verify reduced-motion support (optional but recommended)**

In Chrome DevTools: open the **Rendering** panel (⋮ → More tools → Rendering) and set "Emulate CSS media feature prefers-reduced-motion" to `reduce`. The glow should freeze at the lower-opacity state. Reset to `no-preference` afterwards.

- [ ] **Step 5: Stop the dev server**

Stop the `npm run dev` process (Ctrl+C in its terminal).

- [ ] **Step 6: Final commit (only if any tweaks were made during verification)**

If you made any inline tweaks during the visual check (e.g. nudging spacing), commit them now:

```bash
git add -A
git commit -m "Polish gwak landing after visual review"
```

If nothing changed during verification, skip this step.

---

## Done

The landing page rebrand is complete. To recap what shipped:

- New visual identity at `/` — logo, breathing glow, auth-aware CTA labelled "Enter →" or "Log in".
- Browser tab title and PWA standalone title updated to `gwak.gg`.
- No new dependencies, no behavior change to auth, feed, portfolio, or API routes.

Out-of-scope follow-ups someone might want later (do NOT do these in this plan):
- Generating `icon-192.png` / `icon-512.png` to match the gwak brand.
- Renaming the repo / `package.json` `name` from `fast-bet` to `gwak`.
- Updating the bottom-nav, balance pill, or other in-app surfaces that may still reference Fast Bet copy.
