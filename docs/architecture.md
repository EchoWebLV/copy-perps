# Architecture — copy-perps (package: `breach`)

A system map of the app **as it exists in code today**, derived from the actual
source tree — not the original Fast Bet / gwak spec.

> ⚠️ **The root `CLAUDE.md` is stale.** The product pivoted from the 3-rail
> ("Meme / Prediction / Whale") TikTok feed to a **whale copy-trading app + a
> self-directed leverage "Scalp" game**, with an **AI paper-bot arena running
> headless behind the scenes**. What actually shipped:
>
> | CLAUDE.md says | Reality in code |
> |---|---|
> | Hosted on **Vercel**, `vercel.json` crons drive refresh | Hosted on **Railway** (`railway.json`, standalone `next start`). No `vercel.json` — refresh is driven by two **in-process lease-guarded loops** started from `instrumentation.ts`. |
> | Perp execution on **Flash Trade**; Drift dead | **Two venues.** **Pacifica** (Solana perp DEX) executes the copy-trading core server-side via a per-user agent wallet. **Flash Trade** (`flash-sdk`) powers the self-directed "Scalp" game, client-signed via Privy. **Drift** is gone. |
> | Meme (Jupiter swap) + Prediction rails | Both removed. No `signals` table, no Jupiter Prediction, no DexScreener. |
> | Privy embedded wallet signs every bet | Real tails execute via a per-user **agent wallet** (encrypted Ed25519 key) on Pacifica; Privy still does auth + the sponsored deposit send. |
> | — | New: **AI paper-bot arena** (9 bots on a tick loop), bot narration + chat via xAI/Grok, a Pulse/Chatter social layer. |
>
> There **is** a test runner now: `vitest` (`npm test`), despite CLAUDE.md saying none is configured.

---

## 0. TL;DR — what actually ships in the default config

With the default environment (`FEATURE_WHALE_SOCIAL` unset → **ON**), the live
user-facing product is exactly two things:

1. **Whale copy-trading** — browse real whale traders (Hyperliquid + Pacifica
   signal), then **tail/fade** their positions for real money on **Pacifica**
   (executed server-side via a per-user agent wallet). Surfaces: `/feed`,
   `/live`, `/chatter`, `/portfolio`.
2. **The "Scalp" game** — a 1-tap long/short leverage UI on **Flash Trade**,
   client-signed via Privy. Surface: `/trade`.

Everything else in the repo — **the entire AI bot-arena UI**, the legacy
betting rails, the leaderboard, the swipe feeds — is **built but not reachable**
in the default config (see §1). The bots still *run* server-side; users just
never see them.

---

## 1. ⭐ Feature flags — what is hidden behind what

**This is the section that resolves "is X actually live?".** There is exactly
**one** flag that changes what users see (`FEATURE_WHALE_SOCIAL`); three more
flags are **defined but dead** (zero call sites); two client flags gate small
dev/onboarding bits; and three `DISABLE_*` env vars are ops kill-switches for
the background loops.

### 1a. The one flag that matters: `FEATURE_WHALE_SOCIAL`

- Helper: `whaleSocialEnabled()` in [lib/features.ts](../lib/features.ts).
- Logic: `process.env.FEATURE_WHALE_SOCIAL !== "false"` → **default ON**. The
  only way to get the legacy bot UI is to *explicitly* set it to `"false"`.
- **7 call sites**, each flipping a whole surface:

| Call site | `ON` (default) renders/allows | `OFF` (`="false"`) renders/allows |
|---|---|---|
| [app/(app)/feed/page.tsx:13](../app/%28app%29/feed/page.tsx) | `WhaleRoster` (whale list + tail) | `BotRoster` (legacy bot scoreboard) |
| [app/(app)/live/page.tsx:20](../app/%28app%29/live/page.tsx) | `WhaleMarketHeatmap` (or `WhaleLiveFeed` at `?mode=swipe`) | `LiveFeed` (bot swipe feed) |
| [app/(app)/chatter/page.tsx:129](../app/%28app%29/chatter/page.tsx) | `WhalePulseFeed` (whale opens/closes) | legacy `ChatterPage` (bot narration stream) |
| [app/api/whales/live/route.ts:9](../app/api/whales/live/route.ts) | serves whale position signals | **404** |
| [app/api/whales/roster/route.ts:16](../app/api/whales/roster/route.ts) | serves whale trader roster | **404** |
| [app/api/bet/whale/route.ts:350](../app/api/bet/whale/route.ts) | **real tailing works** (open/close on Pacifica) | **404** — copy-trading is off |
| [lib/whales/ticker.ts:28](../lib/whales/ticker.ts) | whale refresh loop + source monitor start | whale loop **never starts** (no fresh whale data) |

**Consequence:** the flag is effectively the master switch between the **whale
copy-trading product** (ON) and the **legacy bot-arena product** (OFF). They are
mutually exclusive — you never see both. In production it is **ON**, so the bot
UI and `/api/bet/bot` are dark.

### 1b. The bot arena: running, but invisible to users

The **bot resolver loop is NOT gated by `FEATURE_WHALE_SOCIAL`.** Compare the two
ticker entry points: `startWhaleTicker()` has an
`if (!whaleSocialEnabled()) return;` guard ([lib/whales/ticker.ts:28](../lib/whales/ticker.ts)),
while `startBotTicker()` has **no such guard** ([lib/bots/ticker.ts:50](../lib/bots/ticker.ts)) —
only `DISABLE_BOT_TICKER` stops it. So the bot loop starts in every config. This
matters because the resolver tick also drives `runMirrorCloseSweep()`, which
closes **real** user tail positions ([lib/bots/resolver.ts:301](../lib/bots/resolver.ts)),
so it has to keep running even when the bot *UI* is dark.

So in the default (whaleSocial **ON**) config:

- ✅ The 9 bots **tick every ~50s**, open/close **paper** positions, update
  balances, and **call Grok to narrate** every trade ([lib/bots/narrator.ts](../lib/bots/narrator.ts)).
- ✅ The same tick runs `runMirrorCloseSweep()` — **real-money** auto-close of
  user tails whose source went flat ([lib/bets/mirror-close.ts](../lib/bets/mirror-close.ts)).
- ❌ **No user-facing page renders any of it.** `BotRoster`, `LiveFeed`,
  `LiveFeedDesktop`, `BotChatSheet`, `/api/bots/roster`, `/api/bots/[id]/chat`,
  and `/api/bet/bot` all sit on the whaleSocial-OFF path or are simply unlinked.
  The only human view is **`/admin/bots`** and **`/admin/monitor`**.

> **Net:** the bot arena is **backstage infrastructure + signal**, not a shipped
> user feature. It also burns xAI tokens narrating trades nobody sees. Before
> retiring it, note the real-money `runMirrorCloseSweep()` dependency (a second,
> event-driven caller exists in [lib/whales/source-monitor.ts:300](../lib/whales/source-monitor.ts) —
> verify it fully covers the close cases before cutting the bot tick).

### 1c. Dead flags — defined, referenced nowhere

These exist in [lib/features.ts](../lib/features.ts) but have **zero call sites**
outside their own definition and tests. They gate nothing; setting them has no
effect.

| Helper | Env var | Status |
|---|---|---|
| `copyTradeEnabled()` | `FEATURE_COPY_TRADE` | **dead** (0 call sites) |
| `legacyRailsEnabled()` | `FEATURE_LEGACY_RAILS` | **dead** (0 call sites) |
| `casinoModeEnabled()` | `FEATURE_CASINO_MODE` | **dead** (0 call sites) |

### 1d. Client flags (`NEXT_PUBLIC_*`) — small dev/onboarding toggles

From [lib/client-features.ts](../lib/client-features.ts); both **default OFF**
(`=== "true"`):

| Helper | Env var | Gates |
|---|---|---|
| `depositDevToolsVisible()` | `NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS` | the jupUSD→USDC dev converter on [app/(app)/deposit/page.tsx:47](../app/%28app%29/deposit/page.tsx) |
| `feedRailPrefsVisible()` | `NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS` | the feed-rail toggle UI — deposit page + [components/onboarding/PreferencesProvider.tsx:40](../components/onboarding/PreferencesProvider.tsx) |

### 1e. Legacy flag: `FEATURE_GASLESS_BETS`

- Read at [app/api/withdraw/route.ts:91](../app/api/withdraw/route.ts) via a
  local `sponsorWithdrawals()` helper: `=== "true"` → **default OFF**.
- When ON, withdrawals are built gas-sponsored (gas wallet as fee payer). Legacy
  path tied to the old rails; off in the current product.

### 1f. Ops kill-switches (not feature flags — operational toggles)

These stop the background loops; default unset → loop runs.

| Env var | Effect | Default |
|---|---|---|
| `DISABLE_BOT_TICKER` | bot resolver loop never starts ([lib/bots/ticker.ts:50](../lib/bots/ticker.ts)) | runs |
| `DISABLE_WHALE_TICKER` | whale refresh loop never starts ([lib/whales/ticker.ts:24](../lib/whales/ticker.ts)) | runs *(if whaleSocial ON)* |
| `DISABLE_WHALE_SOURCE_MONITOR` | the websocket source monitor inside the whale loop never starts ([lib/whales/source-monitor.ts:338](../lib/whales/source-monitor.ts)) | runs |

Tuning knobs (numeric, not on/off): `BOT_TICK_GAP_MS`, `WHALE_REFRESH_GAP_MS`,
`WHALE_ROSTER_LIMIT`, `WHALE_ROSTER_OPEN_POSITIONS`, `WHALE_ROSTER_PNL_POINTS`,
`WHALE_SOURCE_ACCOUNTS_PER_SOCKET`, `WHALE_SOURCE_RECONCILE_DELAY_MS`.

### 1g. Built-but-unreached, independent of any flag

Not flag-gated — just orphaned wiring:

- **`/leaderboard`** — full page exists, but **nothing links to it** (not in nav,
  no `href`, no redirect).
- **`/live`** — not a nav tab; reachable only via two links inside `WhaleRoster`.
- **`WhaleLiveFeed`** (swipe view) — only at `/live?mode=swipe`.
- **Legacy portfolio rows** — `PositionRow` / `CloseButton` still POST to the
  removed `/api/bet/{meme,prediction,perp}` rails (dead paths beside live `CopyRow`).

---

## 2. System context

```mermaid
flowchart TB
    user(["User<br/>Privy login + Solana wallet"])

    subgraph railway["Railway — Next.js 16 standalone server (one process)"]
        web["Frontend<br/>App Router + React 19"]
        api["API routes<br/>/api/**"]
        loops["In-process background loops<br/>(instrumentation.register)"]
    end

    neon[("Neon Postgres<br/>Drizzle / neon-http")]
    privy["Privy<br/>auth + sponsored Solana send"]

    subgraph venue["Solana mainnet — execution"]
        pacifica["Pacifica<br/>perp DEX — copy/tail core (agent wallet)"]
        flash["Flash Trade<br/>perp DEX — self-directed 'Scalp' (Privy-signed)"]
        helius["Helius / Solana RPC<br/>(deposits, balances)"]
    end

    subgraph sources["Market & signal sources (read-only)"]
        hl["Hyperliquid REST<br/>whale positions · liquidations · portfolio"]
        cex["CEX funding<br/>Binance · Bybit · OKX · dYdX"]
        xai["xAI / Grok<br/>X live-search · narration · chat"]
    end

    user <--> web
    web <--> api
    user -. JWT / sponsored deposit .-> privy
    api <--> neon
    loops <--> neon
    api --> pacifica
    api --> flash
    api --> privy
    privy --> helius
    loops --> pacifica
    loops --> hl
    loops --> cex
    loops --> xai
    api --> hl
    api --> xai

    classDef ext fill:#1e293b,stroke:#475569,color:#e2e8f0;
    class neon,privy,pacifica,flash,helius,hl,cex,xai ext;
```

---

## 3. Runtime / process model — the key architectural fact

There is **no external scheduler**. On boot, `instrumentation.ts → register()`
starts two self-healing loops in the same Node process. A **DB lease** ensures
exactly one process ticks even though dev + prod share one database.

```mermaid
flowchart TB
    boot["Server boot<br/>instrumentation.register()"]
    boot --> bt["startBotTicker()<br/>lib/bots/ticker.ts<br/>(always on unless DISABLE_BOT_TICKER)"]
    boot --> wt["startWhaleTicker()<br/>lib/whales/ticker.ts<br/>(needs FEATURE_WHALE_SOCIAL + !DISABLE_WHALE_TICKER)"]

    subgraph botloop["Bot resolver loop (~50–55s, sequential)"]
        bt --> blease{"hold DB lease?"}
        blease -- no --> bidle["idle-poll 30s, take over on death"] --> blease
        blease -- yes --> btick["tick() — lib/bots/resolver.ts"]
        btick --> bgap["sleep BOT_TICK_GAP_MS"] --> blease
    end

    subgraph whaleloop["Whale refresh loop (~60s)"]
        wt --> wlease{"hold DB lease?"}
        wlease -- no --> widle["idle-poll 30s"] --> wlease
        wlease -- yes --> wref["refreshWhales() + source monitor"]
        wref --> wgap["sleep WHALE_REFRESH_GAP_MS"] --> wlease
    end

    classDef loop fill:#0f2942,stroke:#2563eb,color:#dbeafe;
    class btick,wref loop;
```

- **Lease-guarded** (`ticker-lease.ts`): whoever holds the row ticks; others stand by and take over if the holder dies.
- **Sequential** bot ticks: one fully finishes before the next → no duplicate-position race.
- **Self-healing**: a thrown tick is logged; the loop never dies.
- **Gating differs by loop** (see §1f): the **bot** loop runs in *every* config
  (it carries real-money mirror-close); the **whale** loop only runs when
  `FEATURE_WHALE_SOCIAL` is on.

---

## 4. The bot resolver tick (what each tick does)

> **Reminder (see §1b):** none of this is shown to users in the default config.
> The bots run headless. The tick is kept alive because it *also* runs the
> real-money `runMirrorCloseSweep()`.

9 registered bots ([lib/bots/index.ts](../lib/bots/index.ts)) run strategies
against a shared signal snapshot; closes/opens are **paper** (DB only). The same
tick also force-closes **real** user tails whose source went flat.

```mermaid
flowchart TB
    t["tick()"] --> gather["Gather signal snapshot (Promise.all)"]
    gather --> marks["marks — Pacifica /trades"]
    gather --> liq["liquidations + whaleOpens — Hyperliquid"]
    gather --> fund["funding — CEX aggregate"]
    gather --> cross["cross-bot positioning snapshot"]

    marks & liq & fund & cross --> perbot["for each paper bot (9)"]
    perbot --> exit["Phase 1 · evaluate exits<br/>stop-loss (on stake) + strategy.evaluateExit<br/>→ closePaperPosition (+ xAI narrate)"]
    exit --> bust["Phase 2 · balance below $10 → mark busted"]
    bust --> free["Phase 3 · free balance, open slots (max 8),<br/>tilt guard (2 losses / 5 min)"]
    free --> entry["Phase 4 · per market: strategy.evaluateEntry<br/>family-dedupe, size by conviction (25–50%)<br/>→ openPaperPosition (+ xAI narrate)"]
    entry --> sweep["After loop · runMirrorCloseSweep()<br/>(time-boxed 20s) — REAL user tails"]
    sweep --> pp[("paper_positions · bots.balance · bot_thoughts")]

    classDef store fill:#1e293b,stroke:#475569,color:#e2e8f0;
    class pp store;
```

**Roster (9):** `Whale` · `Orca` · `Leviathan` · `Megalodon` (each mirrors a
bundle of 3 curated whales) · `Pulse` (Grok + X live-search) · `Bullion` (4h gold
mean-reversion) · `Atlas` (overnight SP500 drift) · `Blitz` (15m crypto momentum)
· `Tilt` (degen revenge). Admin can clone variants at runtime
(`/api/admin/bots` → `registerBotDynamic`).

---

## 5. Frontend surfaces (annotated by flag)

Real nav = **5 tabs** ([components/shell/nav-items.ts](../components/shell/nav-items.ts) +
[BottomNav.tsx](../components/shell/BottomNav.tsx)): **Whales · Scalp · Pulse ·
Folio · Settings**. Each flag-branching page is marked below.

```mermaid
flowchart TB
    subgraph pages["app/"]
        landing["page.tsx — public marketing landing (CTAs → /feed, gate sends outsiders to /invite)"]
        mobile["u/[handle] — public profile"]
        subgraph appgrp["(app)/ — authed shell (AppShell + BottomNav)"]
            feed["feed (nav: Whales)<br/>ON: WhaleRoster · OFF: BotRoster"]
            trade["trade (nav: Scalp)<br/>FastPerpsGame — always on, no flag"]
            chatter["chatter (nav: Pulse)<br/>ON: WhalePulseFeed · OFF: ChatterPage"]
            port["portfolio (nav: Folio)<br/>CopyRow (live) + PositionRow (legacy/dead)"]
            dep["deposit (nav: Settings)"]
            live["live (NOT in nav; linked from WhaleRoster)<br/>ON: WhaleMarketHeatmap · OFF: LiveFeed"]
            lb["leaderboard (ORPHAN — nothing links here)"]
        end
        subgraph admin["admin/ — gated, the only bot-arena view"]
            abots["bots · bots/[id] · bots/new"]
            amon["monitor"]
        end
    end

    classDef live2 fill:#0f2942,stroke:#22c55e,color:#dbeafe;
    classDef dark fill:#2a1518,stroke:#ef4444,color:#fecaca;
    classDef admin2 fill:#1e293b,stroke:#a855f7,color:#e9d5ff;
    class feed,trade,chatter,port,dep,landing,mobile live2;
    class lb dark;
    class abots,amon,live admin2;
```

- **Green** = live in the default (whaleSocial ON) config.
- **Purple** = reachable but off the main nav / admin-only.
- **Red** = orphaned (no link reaches it).
- The bot-arena components (`BotRoster`, `LiveFeed`, `BotChatSheet`, etc.) render
  only on each page's **OFF branch** → never in the default config.

Tail entry is the shared `TailModal` ([components/tail/TailModal.tsx](../components/tail/TailModal.tsx)),
rendered from the whale surfaces; its `TailSource` is a `kind: "whale" | "bot"`
union ([components/tail/tail-types.ts](../components/tail/tail-types.ts)), but the
`"bot"` arm is only reachable from the dark bot UI.

---

## 6. API routes ↔ domain libs ↔ externals

Routes that **404 when `FEATURE_WHALE_SOCIAL` is off** are marked 🐋.

```mermaid
flowchart LR
    subgraph routes["app/api/**"]
        rwhale["/bet/whale (+close) — tail a whale 🐋"]
        rcopy["/bet/copy (+close) — tail a leader wallet"]
        rbot["/bet/bot — copy a paper bot (dark UI only)"]
        rflash["/flash/perp (+close, prices, trigger) — Scalp via Flash"]
        rtrade["/trade/perp (+close) — Scalp via Pacifica (agent wallet)"]
        rport["/portfolio (+refresh, snapshot)"]
        rwd["/withdraw · /withdraw/pacifica"]
        rusers["/users/me (+agent/bind, deposit, preferences)"]
        rwhales["/whales/live 🐋 · /whales/roster 🐋"]
        rlb["/leaderboard · /share · /u feeds"]
        rchat["/bots/[botId]/chat · /bots/roster (dark UI only)"]
        rcron["/cron/refresh-whales (manual trigger)"]
        radmin["/admin/bots(+/[id]) · /admin/monitor"]
        rhealth["/health — Railway healthcheck"]
    end

    subgraph lib["lib/"]
        lprivy["privy/server — verifyPrivyRequest"]
        lagent["wallets/agent — encrypted Ed25519 custody"]
        lonboard["bets/onboard · funding — onboard→deposit→open"]
        lpac["pacifica/ — client·orders·markets·sizing·deposit·sign"]
        lmarks["data/marks — Pacifica marks (BTC/ETH/SOL/XAU/SP500)"]
        lmirror["bets/mirror-close · copy-guard · tail-reservation"]
        lwsig["signals/whale-signals · whales/refresh(-pacifica/-hyperliquid)"]
        lbots["bots/ — resolver·strategies·paper·narrator·chat·cross-bot"]
        lhl["hyperliquid/ — client · leaderboard · whales(curated)"]
        lflash["flash/ — perps (flash-sdk) · graph-channel · live-prices"]
    end

    subgraph ext["External"]
        epac["Pacifica"]; eflash["Flash Trade"]; ehl["Hyperliquid"]; exai["xAI/Grok"]; epv["Privy"]; edb[("Neon")]
    end

    rwhale & rcopy & rbot & rtrade --> lagent --> lpac --> epac
    rwhale & rcopy & rtrade --> lonboard --> lpac
    rflash --> lflash --> eflash
    rtrade --> lmarks --> epac
    rwhale --> lwsig
    rwhales --> lwsig --> ehl & epac
    rchat --> lbots --> exai
    rport & rwd --> lpac
    rusers --> lagent
    radmin --> lbots
    lbots --> lmarks & lhl & lmirror
    lmirror --> epac & ehl

    classDef ext2 fill:#1e293b,stroke:#475569,color:#e2e8f0;
    class epac,eflash,ehl,exai,epv,edb ext2;
```

---

## 7. Real-money copy / tail lifecycle (Pacifica)

Trades are **server-executed** through a per-user **agent wallet** — an Ed25519
key whose seed is AES-256-GCM encrypted in `agent_wallets` and bound to the
user's Pacifica account. The route returns multi-phase responses; the client
signs only the funding (deposit) tx via Privy **sponsored** send.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as API /bet/{copy,whale}
    participant W as Agent wallet (lib/wallets/agent)
    participant P as Pacifica
    participant DB as Neon

    C->>A: POST {leader/position, stake, leverage}
    A->>A: verifyPrivyRequest · ensureUser · re-verify source still open
    alt no agent wallet yet
        A-->>C: phase 'onboard' (generate+bind agent, deposit plan)
        C->>P: sponsored USDC deposit (Privy) + agent/bind
    else Pacifica balance short
        A-->>C: phase 'deposit' (top-up plan)
        C->>P: sponsored USDC deposit (Privy)
    end
    A->>DB: insert bet (pending) + reserve market (one tail per market)
    A->>W: decrypt seed → sign order
    W->>P: openCopyOrder (mirror source side/size)
    P-->>A: fill
    A->>DB: bet → confirmed (orderId, entry, fee)
    A-->>C: phase 'open' {betId, fill}
```

**Auto-close (mirror-close sweep):** for every confirmed `copy`/`whale` bet,
group by leader wallet / bot id / whale source; if the source has gone flat,
submit a reduce-only close on Pacifica and record realized PnL. Three close
paths: `closeLeaderFollowers`, `closeBotFollowers`, `closeWhaleFollowers`
([lib/bets/mirror-close.ts](../lib/bets/mirror-close.ts)). Invoked from **two
places**: the bot resolver tick ([lib/bots/resolver.ts:301](../lib/bots/resolver.ts))
and the event-driven whale source monitor
([lib/whales/source-monitor.ts:300](../lib/whales/source-monitor.ts)).

**Flash tail persistence (June 2026):** Flash tails are no longer write-less.
`TailModal` sends whale/bot lineage in the `/api/flash/perp` body; the route
records a `flash-tail` bets row (meta in
[lib/bets/flash-tail-meta.ts](../lib/bets/flash-tail-meta.ts), lifecycle in
[lib/bets/flash-tail.ts](../lib/bets/flash-tail.ts)); the client confirms via
`/api/flash/perp/confirm` and `/api/flash/perp/close/confirm`. Every open/close
also writes a `fills` row (`quote-estimate` at confirm time). The portfolio
attributes live Flash positions back to their bet by (market, side), so tail
rows survive reload with whale/bot names + betId. A reconcile sweep
([lib/bets/flash-reconcile.ts](../lib/bets/flash-reconcile.ts)) rides the whale
ticker tick: reaps stale pendings, verifies signatures on-chain, upgrades
estimate fills/proceeds to chain truth via USDC balance deltas, reverts failed
closes, and kills failed opens — including opens whose signature never becomes
findable within 30 min (dropped tx; they'd otherwise retry forever). A liveness
pass then expires confirmed tails whose chain-verified position no longer shows
in `positionsOf` (liquidation, TP/SL trigger, lost close postback) to status
`closed-external` with `closeReason: 'external'` — no proceeds or fill is
fabricated; the portfolio renders them as closed history with unknown PnL.
Scalp-game trades (no lineage) are untouched.

---

## 8. Database (Drizzle / Neon)

```mermaid
erDiagram
    users ||--o{ bets : places
    users ||--|| agent_wallets : custodies
    users ||--|| portfolio_snapshots : caches
    users ||--o{ bot_chats : "chats with"
    users ||--o{ pulse_reactions : reacts
    users ||--o{ pulse_comments : comments
    bots ||--o{ paper_positions : holds
    bots ||--o{ bot_chats : answers
    bots ||--o{ bot_thoughts : authors
    whales ||--o{ whale_positions : holds
    whale_positions ||--|| whale_position_analysis : "AI summary"
    whale_positions ||--o{ pulse_reactions : on
    whale_positions ||--o{ pulse_comments : on

    users {
        uuid id PK
        text privy_id UK
        text solana_pubkey
        text handle
        jsonb feed_prefs
    }
    bets {
        uuid id PK
        uuid user_id FK
        text type "copy | perp"
        text status "pending|confirmed|closed|failed"
        float amount_usdc
        float proceeds_usdc
        jsonb meta "leader/whale source, pacificaOrderId"
    }
    agent_wallets {
        uuid user_id PK
        text agent_pubkey UK
        text agent_secret_enc "AES-256-GCM seed"
        timestamp bound_at
    }
    bots {
        text id PK
        text strategy_key
        text status "paper|live|retired|busted"
        float balance_usd
        jsonb config
    }
    paper_positions {
        uuid id PK
        text bot_id FK
        text asset
        text side
        int leverage
        float stake_usd
        float paper_pnl_usd
        text status "open|closed|expired"
    }
    whales {
        text id PK
        text source "pacifica|hyperliquid"
        text source_account
    }
    whale_positions {
        text id PK
        text whale_id FK
        text market
        text side
        float notional_usd
        text status
    }
    bot_thoughts { uuid id PK }
    bot_chats { uuid id PK }
    portfolio_snapshots { uuid user_id PK }
    whale_position_analysis { text position_id PK }
    pulse_reactions { uuid id PK }
    pulse_comments { uuid id PK }
```

Plus a singleton `thought_settings` row, runtime-created **lease tables** (bot +
whale tickers), and a `waitlist`. `bets.signal_id` is a soft pointer — no FK.

---

## Legend

- **Solid** = data/control flow · **dotted** = auth/verification side-calls.
- Two execution venues: **Pacifica** (copy/tail core, server-signed via agent
  wallet) and **Flash Trade** (`flash-sdk`, self-directed "Scalp", Privy-signed).
  **Drift** is gone.
- **Hyperliquid** is read-only signal intelligence. **xAI/Grok** drives bot
  narration, chat, and the Pulse strategy's X live-search.
- Bot trades are **paper** (`paper_positions`) and **invisible to users in the
  default config**; user copy/tail trades are **real** (`bets` → Pacifica).
- The arena runs on **in-process lease-guarded loops**, not external cron.
- **Flag reality (§1):** `FEATURE_WHALE_SOCIAL` (default ON) is the only flag
  that changes what users see; `FEATURE_COPY_TRADE` / `FEATURE_LEGACY_RAILS` /
  `FEATURE_CASINO_MODE` are dead.
