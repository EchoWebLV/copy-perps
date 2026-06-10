# Live AI Leaders + On-Chain Receipts — Design

**Date:** 2026-06-11
**Status:** Approved direction, pending spec review
**Trigger:** MagicBlock Solana Blitz v5 idea thread ("Idea 1: Trading bot") — but scoped as a
full product build, not a weekend hack. Blitz editions recur every 2–3 weeks; the Magic
Incubator accepts entries anytime. A launch event will exist whenever the build is ready.

## 1. Summary

Gwak gets two new primitives:

1. **Live AI leaders** — house bots (starting with Pulse) promoted from paper trading to
   real-money execution on Flash Trade, surfaced as copyable leaders next to the whales.
2. **Receipts** — every fill in a copy trade, leader-side and follower-side, journaled
   on-chain in a MagicBlock Ephemeral Rollup (ER) within milliseconds, streamed live in the
   UI, and periodically committed to Solana base layer so anyone can verify fills on Solscan
   without trusting our database.

Receipts is the headline; the live bot is the engine that makes the receipts tape move.
Competitive scan (June 2026): no project in MagicBlock's 170+ Blitz entries or the broader
Solana copy-trading field (Stratium, perp.ag, Copin, pvp.trade) does follower-side
verification. MagicBlock has publicly named copy-trading as a wanted ER use case with
nobody in the lane. AI-agent trading alone IS derivative (Kestrel, ClawPump) — receipts
must lead.

## 2. Verified current state (file-level, June 2026)

These facts were verified against the working tree / git history and constrain the design:

- **Flash tail opens persist nothing.** `TailModal` posts to `/api/flash/perp`, gets a
  signed tx + signature back, and the `betId` shown to the user is a client-side
  `flash:${signature}` string (components/tail/TailModal.tsx:190,464,626). No bets row, no
  fills, no follower attribution. Portfolio renders Flash positions from live on-chain
  state (`positionsOf()`, app/api/portfolio/route.ts:233) as `sourceKind: 'wallet'` with
  `betId: null`.
- **Pacifica copy tails DO persist** (app/api/bet/whale/route.ts:528–620) with order id,
  entry, fee — but only position-level, not fill-level, and no close fee / close order id.
- **Mirror-close is Pacifica-only.** `closeBotFollowers` / `closeWhaleFollowers` /
  `closeLeaderFollowers` (lib/bets/mirror-close.ts) decrypt agent wallets and close on
  Pacifica. No Flash-aware close path exists.
- **The TailModal `bot` arm exists** (components/tail/tail-types.ts:17–29) but no backend
  constructs a bot TailSource and no endpoint exposes bot positions as tailable.
- **`bots.status` already supports `'live'`** (lib/db/schema.ts:114) but the resolver only
  processes `status === 'paper'` — no live code path exists.
- **Server-side key custody precedent:** agent wallets (lib/wallets/agent.ts) hold
  AES-256-GCM-encrypted Ed25519 seeds and sign Pacifica orders server-side.
- **Flash positions are owner-signed.** The Flash SDK builds the tx with the position
  owner as `req.trader`; only the owner's key can sign (lib/flash/perps.ts:314,832). A
  server-held Keypair CAN be that owner (bot wallet); a user's Privy-held key cannot be
  signed for by our server without Privy session signers.
- **The bot arena is mid-removal on `feat/ui-mint`.** `instrumentation.ts` intentionally
  does not start the resolver loop; the Pulse persona is absent from the working tree.
  Restoration source is git history (Pulse persona at commit `369d0ce`; resolver/paper
  state at `810f7d1`; checkpoint commit `7b13b6c`). Restore minimally — do not resurrect
  the full arena UI.

## 3. Architecture overview

```
            ┌─────────────────────────── Railway (Next.js, one process) ───────────────────────────┐
            │                                                                                       │
 signals ──►│  bot resolver tick ──► flashBot.open/close ──► Flash Trade (mainnet, bot wallet)      │
 (Grok/X,   │        │                       │                                                      │
  HL, CEX)  │        │                       ├──► fills + bets rows (Neon)                          │
            │        │                       └──► receiptWriter ──► receipt_journal PDA (ER)        │
            │        │                                                  │ commits (~0.0001 SOL)     │
            │  follower tails ──► /api/flash/perp ──► user signs (Privy)│                           │
            │        │                 │  auto-close: server signs via  ▼                           │
            │        │                 │  Privy session signers     Solana base layer               │
            │        │                 └──► fills + bets rows           │                           │
            │        │                                                  ▼                           │
            │                                                   Receipts UI (ws onAccountChange,    │
            │                                                   ms-latency tape + Solscan links)    │
            └───────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Build phases (dependency order)

### Phase 1 — Follower-side truth (data layer; prereq for everything)

- Insert a bets row in `/api/flash/perp` whenever the request carries a tail source
  (bot or whale): `venue: 'flash'`, botId/whaleId, stake, leverage, entry quote,
  open signature. Add a confirm postback (mirror of the Pacifica confirm pattern).
- Close postback on `/api/flash/perp/close`: closedAt, close signature, realized PnL,
  close fee.
- New `fills` table: `(id, betId, sequence, side, orderId/sig, filledAmount, price,
  feesUsd, txHash, ts)` for BOTH venues. Pacifica rows backfilled from order history.
- Reconciliation job: poll Flash (tx history per tracked wallet) and Pacifica
  (order/PnL history) to backfill fills the client never reported (e.g. user signed a
  close and closed the browser).
- Standalone value: fixes the "Flash positions evaporate from portfolio context on
  reload" bug. Ship this even if everything else stalls.

### Phase 2 — Live bot execution (production custody)

- `bot_wallets` table mirroring `agent_wallets`: `(botId PK, flashPubkey UK,
  flashSecretEnc, boundAt)`, AES-256-GCM with the same master-key pattern.
- Admin funding flow: generate + bind keypair (`POST /api/admin/bots/:id/flash-wallet`),
  fund with USDC from treasury, confirm on-chain before status flips to `'live'`.
- Resolver `'live'` branch: same strategy interface (strategies are signer-free), but
  open/close route to `flashBot.open/close` — build via `getFlashPerpsService()`, sign
  with the decrypted bot Keypair as position owner, broadcast via Helius.
- Live position tracking: extend `paper_positions` with `venue ('paper'|'flash',
  default 'paper')` and `entryTxHash` rather than adding a parallel table — the
  resolver's exit-evaluation phase then reads one table for both modes. Live PnL
  hydrated from `positionsOf(botPubkey)` instead of the paper mark calc.
- Risk controls (non-negotiable before real funds):
  - per-trade stake cap and max concurrent positions (config JSONB),
  - hard stop-loss independent of strategy,
  - liquidation/bust detection → `status: 'busted'` + admin alert,
  - `DISABLE_LIVE_BOT` kill switch env var,
  - audit log: every signed bot tx (pubkey, tx hash, amount, ts).
- Narration: extend narrator args with `venue` so Grok frames real trades as real.
- First live bot: **Pulse** (Grok + X live-search). Start small ($200–500 bankroll) and
  let a verifiable track record accumulate — weeks of history is the launch asset.
- Admin UI: extend `/admin/bots` with live balance, open positions, pause/close
  controls.

### Phase 3 — Copy rails for bot leaders

- `buildBotTailSource` + endpoint exposing the live bot's open positions as tailable
  sources; bot leader card in the whale roster (live UI, not the dark legacy path).
- Follower opens stay client-signed on Flash (existing `/api/flash/perp` flow) — now
  persisted via Phase 1.
- **Auto-close via Privy session signers (decision).** Users grant one-time consent
  (`useHeadlessDelegatedActions().delegateWallet({ address, chainType: 'solana' })`);
  the server then signs follower closes via `privyServer.walletApi.solana
  .signTransaction` and broadcasts via Helius (sign-only — Privy's own submit
  historically fails on the address lookup tables Flash txs use). Key-split + TEE on
  Privy's side; consent-scoped, not custodial.
  - Consent UX: request delegation at first bot-tail time ("enable auto-close"), not at
    login. Tails without delegation fall back to notify + one-tap close.
  - Fallback ladder if the spike fails in practice: (a) Pacifica rails for bot copies
    (auto-close already proven via `closeBotFollowers`), (b) notify + one-tap close.
- Extend mirror-close with a Flash-aware path: when the bot exits, enumerate confirmed
  bot-follower bets with `venue: 'flash'`, build closes, sign via session signer (or
  notify), journal close receipts.
- Follower attribution: tag each follower fill with the leader action (position id +
  action sequence) that triggered it.

### Phase 4 — ER receipts layer (the MagicBlock integration)

**Program** (`receipt_journal`, Anchor):

- Per-leader journal PDA, pre-allocated fixed capacity. Hard ER constraint: accounts
  cannot be created inside an ER session, so capacity is decided at init. Use epoch
  rollover (undelegate + commit + init next epoch PDA on base layer) rather than naive
  ring-buffer overwrite; the documented Resize-PDA flow is the escape hatch.
- Receipt struct (fixed size): `{ kind: leaderOpen|followerFill|leaderClose|followerClose,
  leaderId, followerHash (privacy: hashed, not raw pubkey), market, side, price, sizeUsd,
  feeUsd, venueSig, ts, seq }`.
- Instructions: `init_journal`, `append_receipt`, `delegate`, `commit`, `undelegate`,
  using the SDK macros `#[ephemeral]`, `#[delegate]` (`del` account), `#[commit]` +
  `MagicIntentBundleBuilder` (0.15.x API; the older `commit_accounts` helpers are
  deprecated).

**Toolchain / pins (verified June 2026):**

- Rust 1.89.0, Solana 3.1.9, Anchor 1.0.2, `ephemeral-rollups-sdk` — **pin to whatever
  `magicblock-engine-examples/anchor-counter` pins** (0.14.3 at time of writing; docs
  describe 0.15.x — do not mix doc snippets with example code).
- Delegation program: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`. Local ER validator
  for tests: `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev` (localhost:7799 via
  `@magicblock-labs/ephemeral-validator`).
- Router: devnet `https://devnet-router.magicblock.app` (+wss, free for dev); mainnet
  `https://router.magicblock.app`. Mainnet ER is self-serve (MagicNet Phase 2);
  validator identities published (US `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`, EU,
  AS, TEE variants). Costs: ER txs free; ~0.0001 SOL per commit; 0.0003 SOL per session
  close; delegated fee payer has a 10-commit sponsorship cap → top up via
  `lamportsDelegatedTransferIx` from base layer.
- Install MagicBlock's AI dev skill before starting:
  `npx add-skill https://github.com/magicblock-labs/magicblock-dev-skill`.

**Known gotchas (from official docs/examples — encode into the plan):**

1. Pin the ER validator pubkey in the delegate ix.
2. Serialize the Anchor account (`acct.exit(&crate::ID)?`) before commit CPIs, or the
   commit captures stale data.
3. ER txs must take recentBlockhash from the ER/router connection, never base layer.
4. Send ER txs with `skipPreflight: true`.
5. Undelegate is sent to the ER; recover the base-layer commit sig with
   `GetCommitmentSignature`.
6. Router websocket `accountSubscribe` forwarding is undocumented — verify on day one;
   fallback is subscribing to the regional ER ws directly.

**Writer service** (Node, in-process like other loops): consumes fill events from
Phases 1–3, appends receipts through `ConnectionMagicRouter`
(`@magicblock-labs/ephemeral-rollups-sdk`), with retry, commit cadence (e.g. every N
receipts or T seconds), and fee top-up monitoring.

**Rollout:** devnet first (free, sufficient for demos and Blitz), then mainnet ER once
the journal design has survived a week of real traffic.

**UI:** live receipts tape on the bot leader page — `onAccountChange` on the journal
PDA over the router/ER ws, Borsh decode, ms-timestamped stream; leader and follower
receipts rendered side-by-side; each commit gets a "verify on Solscan" link. A public
shareable receipts page per leader (no auth) is the marketing surface. Later: "Magic
Actions" post-commit calls maintaining an on-chain Copy-PnL leaderboard.

### Phase 5 — Stretch: private copy-sizing (Private ER)

Follower stake sizes hidden in a Private Ephemeral Rollup; fills publicly provable
(receipt carries a hash + size bucket instead of exact size). Aligns with the privacy
momentum across Blitz v2–v4 winners. Only after the public journal is solid.

## 5. Error handling

- **Bot tx failure** (Flash rejection, RPC timeout): resolver marks the attempt failed,
  no position row, no receipt; retried next tick only if the strategy still signals.
- **Receipt write failure**: fills are source-of-truth in Postgres; the writer retries
  with backoff. The journal is a projection — a gap is detectable (seq numbers) and
  back-fillable, never a money bug.
- **Session-signer close failure** (revoked delegation, Privy outage): fall back to
  notify + one-tap close; bet row flagged `autoCloseFailed` for the reconciliation job.
- **ER unavailability**: writer queues receipts; commits resume when the ER returns.
  Base-layer commits are the durability boundary.
- **Bot liquidation**: detection in resolver tick → status `'busted'`, kill open
  follower copies via the standard mirror-close path, admin alert.

## 6. Testing

- Vitest (`npm test`) for: fills persistence, receipt encoding/decoding (Borsh round-
  trip), resolver live-branch decision logic (signer mocked), session-signer close
  builder.
- Anchor program tests against the local ephemeral validator
  (`@magicblock-labs/ephemeral-validator`) — the anchor-counter test layout is the
  template.
- Devnet integration smoke: stock counter end-to-end FIRST (deploy → delegate → write
  via router → ws subscribe), then the journal. This is the riskiest integration step;
  do it before any custom program code is trusted.
- Real-money verification: bot trades with tiny bankroll on mainnet Flash; one
  follower account (ours) with a $5 stake exercising the full open → receipt → auto-
  close → receipt loop before any external user touches it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| ER delegate-then-write handoff (validator pinning, blockhash source, sponsorship cap) | Stock-counter-first rule; localnet ephemeral validator in CI |
| SDK version churn (0.13→0.15 in 6 weeks) | Pin to example versions; upgrade deliberately |
| Privy session-signer fit for Flash txs (ALTs, tx size) | Early spike: sign-only + Helius broadcast; fallback ladder documented in Phase 3 |
| Bot loses real money | Small bankroll, hard caps, kill switch, busted-state handling; it's also content — losses are verifiable too |
| Bot arena code mid-removal | Restore minimal pieces from git (`369d0ce`, `810f7d1`, `7b13b6c`); no arena UI revival |
| Receipts journal capacity | Epoch rollover design; seq-numbered receipts make gaps detectable |

## 8. Milestones

1. **M1 — Truth**: Phase 1 shipped. Flash tails persist; fills table live. (Shippable alone.)
2. **M2 — Live leader**: Phase 2. Pulse trades real money, admin-only visibility, track record accumulating.
3. **M3 — Copyable**: Phase 3. Bot leader card public; session-signer auto-close working.
4. **M4 — Receipts**: Phase 4 on devnet ER → the Blitz v6 / Magic Incubator entry artifact; mainnet ER after a week of stability.
5. **M5 — Privacy stretch** (Phase 5), once the public journal is proven.

## 9. Decisions log

- Receipts is the headline; AI leader is the engine (competitive scan, June 2026).
- First live bot: Pulse. Restored from git, not rebuilt.
- Follower auto-close: **Privy session signers** (user-approved 2026-06-11), fallback
  Pacifica rails, then notify+tap.
- Journal: per-leader fixed-capacity PDA with epoch rollover; follower identity hashed
  in receipts.
- Devnet ER first, mainnet ER second. Bot's actual trading is mainnet Flash from day one.
- **No Telegram bot** (user decision 2026-06-11). Alerts/auto-close fallbacks are in-app
  only; the Blitz idea card's Telegram bullet is deliberately dropped.
- Blitz v5 (June 12–14) is NOT a deadline; target Blitz v6+/Magic Incubator with M4.
