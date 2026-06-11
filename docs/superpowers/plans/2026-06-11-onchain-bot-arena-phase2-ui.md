# On-Chain Bot Arena — Phase 2 (Live Arena UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live `/arena` page rendering the on-chain bots straight from Ephemeral Rollup account state — ticking cards, bot profile with decision tape, staleness UX, and Solscan links — on the existing gwak design system.

**Architecture:** Client-side byte decoders for the locked zero-copy layouts (no anchor/Borsh dependency in the app bundle) + a live-data hook (REST seed → `onAccountChange` ws with visible-poll fallback) feeding presentational components that mirror the WhaleRoster patterns. No new server state: the chain IS the API for this phase (the Postgres signal watcher arrives in Phase 3 with copy-trading).

**Tech stack:** Next.js 16 App Router (existing app), @solana/web3.js (already a dependency), Tailwind + `components/v2/ui.tsx` tokens. NO @coral-xyz/anchor in the app bundle.

**Plan-style note:** novel logic (decoders, hook, data plumbing) carries complete code below; conventional JSX tasks reference the exact existing components to mirror (paths verified by recon 2026-06-11) with acceptance criteria instead of full listings — copying the established look is the requirement, not novel markup.

**Source-of-truth references:**
- Byte layouts: `arena-program/programs/arena/src/state.rs` layout comment tables (MarketState 3608B, Bot 2328B + 8-byte discriminators; zero padding — locked by tests).
- Live params: `arena-program/PINS.md` Task 13 section (program id `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC`, ER `https://devnet.magicblock.app`, bots scalper-v1/rider-v1, SOL market 0, feed `ENYweb…4jPu`).
- UI patterns: `components/whales/WhaleRoster.tsx` (cards/grid/`useVisiblePoll`), `components/whales/WhaleLiveFeed.tsx` (detail view), `lib/solana/use-usdc-balance.ts` (REST-seed + `onAccountChange` pattern), `components/v2/ui.tsx` (tokens).
- Trust wording: spec §1/§9 — devnet phase is **demo-only**; never "trustless"; no Solscan-verify *claim* until mainnet (account links are fine, labeled "devnet").

**Env (client-visible, add to `.env.local` + `.env.example`):**
`NEXT_PUBLIC_ARENA_PROGRAM_ID`, `NEXT_PUBLIC_ARENA_ER_ENDPOINT=https://devnet.magicblock.app`, `NEXT_PUBLIC_ARENA_BOTS=scalper-v1,rider-v1` (exclude test-aggro-v1), `NEXT_PUBLIC_ARENA_CLUSTER_LABEL=devnet`.

---

### Task 1: Client byte decoders + persona registry

**Files:**
- Create: `lib/arena/decode.ts`, `lib/arena/personas.ts`
- Test: `lib/arena/decode.test.ts`

- [ ] **Step 1: failing tests** — build synthetic buffers per the layout tables (write helper `mkBot(fields)` / `mkMarket(fields)` that places values at the documented offsets over 8-byte discriminator + struct size) and assert `decodeBot` / `decodeMarketState` round-trip every field group: balances/pnl/fees/seq; positions[4] {active u8, marketId u8, side u8, entryPrice u64, stakeMicro u64, leverage u16, openedTs i64, ticksHeld u32, liqPrice u64 — READ EXACT OFFSETS FROM state.rs Position table}; tape[64] entries + tapeHead wrap order (newest-first iteration helper `tapeNewestFirst`); params; trades/wins. MarketState: lastPrice/lastPublishTs/head + ring bucket at head. Include a truncated-buffer case → decoder returns null (fail-closed).

- [ ] **Step 2: implement `lib/arena/decode.ts`** — pure DataView/Buffer reads at the offsets from state.rs comment tables (transcribe them into a `const OFF = {...}` block with a comment pointing at state.rs as source of truth; if any offset disagrees with the table, the table wins and the discrepancy gets reported, not patched silently). Export types `ArenaBot`, `ArenaPosition`, `ArenaTapeEntry`, `ArenaMarketState` with JS-friendly units (USD numbers from micro, prices /1e8, Date from i64 seconds). Action-code map: `0 OPEN_LONG, 1 OPEN_SHORT, 2 EXIT_FAVORABLE, 3 EXIT_MAX_HOLD, 4 LIQUIDATED` → `{label, color}` via v2 tokens (GREEN/RED/DIM).

- [ ] **Step 3: implement `lib/arena/personas.ts`** — display metadata keyed by persona name (the on-chain persona_id is utf8-zero-padded name): `{ "scalper-v1": { display: "Scalper", emoji: "⚡", blurb: "15s momentum, 100x", }, "rider-v1": { display: "Trend Rider", emoji: "🏄", blurb: "1m trend rider, 20x" } }` + `personaIdBytes(name)` (same encoding as scripts/arena/init-devnet.ts `personaId`) + `botPda(name, programId)` derivation (web3.js `PublicKey.findProgramAddressSync(["bot", bytes])`).

- [ ] **Step 4:** `npx vitest run lib/arena` green; `npm run typecheck` green; commit `feat(arena-ui): client decoders for zero-copy layouts + persona registry`.

---

### Task 2: Live arena data hook

**Files:**
- Create: `lib/arena/use-arena-live.ts`
- Test: `lib/arena/use-arena-live.test.ts` (pure helpers only)

- [ ] **Step 1:** implement the hook mirroring `lib/solana/use-usdc-balance.ts`'s structure:

```ts
// lib/arena/use-arena-live.ts — live ER state for the arena page.
// Seed via one getMultipleAccountsInfo on the ER endpoint, then subscribe
// with onAccountChange (ER ws). The router-ws forwarding gotcha (spec §13)
// applies: if no ws update arrives within WS_GRACE_MS of mount, fall back
// to visible-aware polling (same cadence as WhaleLiveFeed, 4s) and keep the
// subscriptions as best-effort. Staleness is a UI state, never hidden.
"use client";
import { useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeBot, decodeMarketState } from "./decode";
import { botPda } from "./personas";

const WS_GRACE_MS = 15_000;
const POLL_MS = 4_000;

export interface ArenaLive {
  bots: Record<string, ReturnType<typeof decodeBot>>;
  market: ReturnType<typeof decodeMarketState> | null;
  mode: "ws" | "poll" | "loading";
  lastUpdateMs: number;
}
// ... connection singleton from NEXT_PUBLIC_ARENA_ER_ENDPOINT;
// accounts = [marketPda(0), ...NEXT_PUBLIC_ARENA_BOTS.map(botPda)];
// seed -> setState; onAccountChange per account patching state;
// grace timer flips mode to "poll" + visibility-aware setInterval refetch;
// cleanup removes listeners + timers.
```

Full implementation required (the sketch above sets the contract; ~120 lines). Pure helpers (`marketPda`, env parsing, staleness computation `isStale(lastPublishTs, now, maxAgeS=30)`) exported for the vitest.

- [ ] **Step 2:** tests for the pure helpers (PDA derivations match the known devnet addresses from PINS — assert `botPda("scalper-v1")` equals the recorded PDA; staleness boundaries). `npm run typecheck` green. Commit `feat(arena-ui): live ER data hook with ws→poll fallback`.

---

### Task 3: Arena page + roster cards

**Files:**
- Create: `app/(app)/arena/page.tsx`, `components/arena/ArenaRoster.tsx`, `components/arena/BotCard.tsx`

- [ ] **Step 1:** `page.tsx` — thin server component rendering `<ArenaRoster />` (client). No SSR data fetch in this phase (chain-only source); render the skeleton immediately (mirror `/feed/page.tsx`'s skeleton-then-hydrate behavior).

- [ ] **Step 2:** `ArenaRoster` + `BotCard` mirroring `components/whales/WhaleRoster.tsx` card/grid/mobile-snap layout and `components/v2/ui.tsx` tokens exactly. Card contents per bot: persona emoji + display name + "on-chain strategy" badge; equity (balance + open stake) with PnL coloring (GREEN/RED); win rate (wins/trades), trades count, fees paid; open positions list {side, leverage, entry, liq, age}; live mark from MarketState; staleness badge when `isStale` (amber "oracle stale Xs" — never silently frozen numbers); `devnet demo` chip (CLUSTER_LABEL env) near the header. Acceptance: visually consistent with WhaleRoster at mobile 390px and desktop grid; zero layout shift between loading/ws/poll modes; no console errors.

- [ ] **Step 3:** typecheck + `npm run dev` smoke (page renders live numbers; kill the crank briefly → staleness badge appears; restart). Commit `feat(arena-ui): /arena roster with live ER cards`.

---

### Task 4: Bot profile + decision tape

**Files:**
- Create: `components/arena/BotProfile.tsx` (modal-or-detail panel from the roster, mirroring how `WhaleLiveFeed` opens detail; no new route needed this phase)

- [ ] **Step 1:** profile panel: persona header; stats row (equity, gross PnL, fees, win rate, max positions); **decision tape** — `tapeNewestFirst(bot)` rendered as rows {action label+color, market (SOL), price, stake, age} (codes → copy via decode.ts map); open-position cards with liq-distance bar; links section: bot PDA + program + market accounts on `https://solscan.io/account/<pda>?cluster=devnet` labeled "view raw account (devnet)" — NO verify-claims copy (locked wording: this phase is demo-only).

- [ ] **Step 2:** an "About this bot" block from personas.ts blurb + the honest one-liner: "Decisions are made by program code running in a MagicBlock Ephemeral Rollup; prices come from the Pyth Lazer oracle feed operated by MagicBlock." (spec §1 locked claim, devnet-trimmed).

- [ ] **Step 3:** typecheck + browser smoke (tape shows real test-aggro trades from the soak if roster env includes it locally; staleness + empty-tape states). Commit `feat(arena-ui): bot profile with on-chain decision tape`.

---

### Task 5: Navigation + polish + gates

**Files:**
- Modify: the app's nav (`components/shell/BottomNav.tsx` and/or the desktop switch — locate the whale view switch and add Arena alongside)
- Modify: `.env.example` (the four NEXT_PUBLIC_ARENA_* vars with comments)

- [ ] **Step 1:** nav entry "Arena" (route `/arena`) following the existing nav item pattern; invite-gate inherits from the (app) group — verify `/arena` is NOT in the public allowlist (lib/invite/gate.ts).
- [ ] **Step 2:** empty/error states: ER endpoint unreachable → full-page friendly fallback with retry (no crash); zero bots configured → hide nav entry? (no — render explainer).
- [ ] **Step 3:** full gates: `npm run typecheck`, `npx vitest run`, `npx next build`. Browser pass at 390px + desktop. Commit `feat(arena-ui): nav + states + env docs`.

---

### Task 6: Phase 2 exit

- [ ] All gates green; roster + profile live against the devnet ER with the soak crank running; staleness UX verified by stopping the crank for 60s; PINS.md "Phase 2" note (what shipped, the ws-vs-poll mode actually observed on devnet — feeds spec §13 item 3 resolution); update plan checkboxes; report.

**Explicitly deferred to Phase 3 (do NOT build):** signal watcher/Postgres projections, Copy buttons + TailSource wiring, BTC/ETH markets, public shareable pages, leaderboard re-rank. (Copy CTA placement may be stubbed visually as disabled "Copy — soon" if it helps layout; no wiring.)
