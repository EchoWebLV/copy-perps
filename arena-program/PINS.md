# Arena program — toolchain + SDK pins (ground truth)

Recorded 2026-06-11 (Task 1, Phase 0 of the on-chain bot arena plan).
Everything below was verified on this machine, not copied from docs.

## Local toolchain (verified)

| Tool | Version | Notes |
| --- | --- | --- |
| rustc | 1.93.1 (01f6ddf75 2026-02-11) | |
| solana-cli | 3.1.15 (src:d48d0f83; feat:687058115, client:Agave) | Agave install at `~/.local/share/solana/install/active_release/bin` |
| anchor-cli (effective on PATH) | **0.31.1** | resolves to `~/.cargo/bin/anchor` — a standalone binary that SHADOWS avm |
| avm | 0.32.1 | managed versions installed: 0.31.1, 0.32.1, **1.0.2** (avm "current" = 1.0.2) |

PATH gotcha (matters for Task 2): `~/.avm/bin` is **not** on PATH, so avm's
"current" anchor 1.0.2 is not what `anchor` runs — the standalone 0.31.1 binary in
`~/.cargo/bin` wins. To build against the anchor-counter pins, invoke
`~/.avm/bin/anchor-1.0.2` explicitly (or fix PATH / remove the shadowing binary).
To build against the oracle pins, the default `anchor` (0.31.1) already matches.

## Canonical repos (cloned under `~/spikes/`)

| Repo | Commit (HEAD at clone) | Commit date / subject |
| --- | --- | --- |
| [magicblock-labs/magicblock-engine-examples](https://github.com/magicblock-labs/magicblock-engine-examples) | `e4bf31dd95f74ed54d503b3ddc5887cc50e95454` | 2026-06-09 — feat: pinocchio vrf example (#96) |
| [magicblock-labs/real-time-pricing-oracle](https://github.com/magicblock-labs/real-time-pricing-oracle) | `4344ae5b89601bf0d6e0d9f5accf7b7b6e4602c4` | 2026-05-04 — chore: update symbol url (#14) |

## Dependency pins found in those repos

### anchor-counter (`magicblock-engine-examples/anchor-counter/programs/public-counter/Cargo.toml`)

```toml
anchor-lang = { version = "1.0.2", features = ["init-if-needed"] }
ephemeral-rollups-sdk = { version = "0.14.3", features = ["anchor"] }
```

`Anchor.toml` pins `[toolchain] anchor_version = "1.0.2"`.

### ephemeral-oracle (`real-time-pricing-oracle/program/ephemeral-oracle/programs/ephemeral-oracle/Cargo.toml`)

```toml
anchor-lang = "=0.31.1"
ephemeral-rollups-sdk = { version = "0.2.4", features = ["anchor"] }
```

`Anchor.toml` has no `anchor_version` pin. These match the expected
"anchor-lang 0.31.1 / er-sdk 0.2.4 as of June 2026" exactly.

### The two repos do NOT agree

The anchor-counter example has moved to anchor-lang **1.0.2** + er-sdk **0.14.3**,
while the oracle repo is still on anchor-lang **0.31.1** + er-sdk **0.2.4**. These
are different major SDK generations — APIs, feature flags, and macro surfaces
differ (e.g. the skill docs note `disable-realloc` was removed in er-sdk 0.14).

## MagicBlock dev skill

`npx add-skill https://github.com/magicblock-labs/magicblock-dev-skill` succeeded:
installed to `.agents/skills/magicblock/` (symlinked into `.claude/skills/`),
lockfile `skills-lock.json`. Its version guidance matches the anchor-counter pins
verbatim: `anchor-lang 1.0.2` + `ephemeral-rollups-sdk 0.14.3 ["anchor"]`
(see `.agents/skills/magicblock/delegation.md`).

## Decision rule

**The arena uses the anchor-counter er-sdk pin (`ephemeral-rollups-sdk 0.14.3` +
`anchor-lang 1.0.2`) if its delegation flow passes Task 2; never mix doc snippets
from other versions.** If Task 2's delegation spike fails on the anchor-counter
pins, fall back to the oracle pins (`er-sdk 0.2.4` + `anchor-lang =0.31.1`) — and
then only copy patterns from the oracle repo, never from the 0.14.x skill docs.

Corollary for Task 2: building on the anchor-counter pins requires anchor-cli
1.0.2 (`~/.avm/bin/anchor-1.0.2` — installed, but shadowed on PATH; see above).
Do not build anchor-lang 1.0.2 code with the default 0.31.1 CLI.

## Spike A

**Outcome: PASS** (2026-06-11). The stock anchor-counter example ran the full
delegate → ER write → commit → undelegate cycle end-to-end against the devnet
Ephemeral Rollup. All 7 tests in `tests/public-counter.ts` passed in 18s.
**Decision rule satisfied: the arena builds on the anchor-counter pins
(anchor-lang 1.0.2 + ephemeral-rollups-sdk 0.14.3).**

### Path taken

**Stock program, no own deploy** (README's primary flow). The stock program id
`79sGyNW41g8TrKyQwk7SZu432SH9ZfHmtRzEtR6CSt3n` was already deployed + executable
on devnet (its upgrade keypair is tracked in the repo at
`target/deploy/public_counter-keypair.json`, so `git checkout` restores it).
Own-deploy path was skipped: wallet `HKVgAYCTKDdtLyN4hGmBC49Psfb9yxsFWQk3jnBEXnhL`
had only 0.686 SOL (deploy needs ~2.3; faucet was dry).

### Exact commands

```bash
cd ~/spikes/magicblock-engine-examples/anchor-counter
git checkout -- .                      # restore stock declare_id + Anchor.toml + shipped keypair
~/.avm/bin/anchor-1.0.2 build          # NEVER plain `anchor` (PATH has 0.31.1)
PROVIDER_ENDPOINT="https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" \
  ~/.avm/bin/anchor-1.0.2 test --skip-build --skip-deploy --provider.cluster devnet
```

`PROVIDER_ENDPOINT` override was required: `api.devnet.solana.com` was degraded
(getHealth ok, but getAccountInfo/getMultipleAccounts timed out >25s). The test
file honors `PROVIDER_ENDPOINT` over `ANCHOR_PROVIDER_URL`, so Helius devnet
served as the base layer with zero source changes. ER endpoint was the test's
default `https://devnet-as.magicblock.app/` (identity
`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`, matches the validator pubkey
hardcoded in the delegate test).

### Key tx signatures (devnet + devnet ER)

| Step | Layer | Signature |
| --- | --- | --- |
| Initialize | Base | `3PPkPpTzfNrg8byseqffjqXhrnUM5NAEA93YevCHPsHihD3EimMMzXzZyWLyGkHowH4LxViytnB4R9bb5jf1dTVo` |
| Increment | Base | `2aizcn34khbM1z42iAwKzGBBeePoGzNox4mLo3S1GZPnJDUpEJGaNCps58XimCpwD59qcVjiMfWYAX3umTSL3FG9` |
| **Delegate** | Base | `3ZkkqRz6JUdSXQyY8aaSxKAe7Ky2ZfUgLFWhmxtsximZoB2Z19q2gSMy129L5xRphSjX2f6Hkbd8acpJiwmYZNMP` |
| **ER increment** | ER | `4mdygqfnYPLYMHUcKzdnFBtLcq8pwA5RPPzDkXbfMNQuRg4XExPPZBCZspLBQLDn5dTa4PtALenot3hRDBPuDuL6` |
| **Commit (ER side)** | ER | `kTBsTst8bwhRyFBKiVbJoNCXQFYatfDg8js9uqM4NScvHtM5zZExoAHdxgtPFKgRZiRSCYaJKtUJQBsDEPqx5Hy` |
| **Commit (base-layer confirmation)** | Base | `4NufAWazGrWvzMFLBhzt69mp9VQsp6hQk4NyW8bHsv6YFbCWmqn3dmPKaw1P1af6dSWMheoQiowH1yA5uWFKW2vt` |
| Increment+commit CPI | ER | `4T7AXVBirAR1cKQZ9zzcQDVEqrGUpCZVR5SGETse4ymSfamru7VhTw3PmgeFcyuwwmoWPVK6KMidmF5YD5vuQpsc` |
| **Increment+undelegate** | ER | `2tGCEztZC2yNNYN3tp1tJL77FoAKzRs2d3nmx2mJ6eQbcqRMXmLJbPVsLFFAwDf4JP6R6KtTGdHrWYSiBFyLYSuq` |

### State verification (post-run, base layer via Helius devnet)

Counter PDA `7Qgut4mSFC6aK23ocQ6vMTFB3HjHuVQVpK1iipkZZPDV` (seeds `["counter"]`,
globally seeded — shared state, but it was undelegated pre-run so no collision):
owner back to `79sG…` (undelegated, not the delegation program) and `count = 4` —
exactly initialize(0) + 1 base + 3 ER increments, proving ER state committed back
to the base layer.

### Deviations / notes

- A previous session had deleted the shipped keypair, regenerated it, run
  `anchor keys sync` (rewriting `declare_id!` + Anchor.toml) and rebuilt,
  preparing a fresh deploy that never happened (faucet dry). Recovery was
  `git checkout -- .` (the keypair is git-tracked, so it restored too) + a
  rebuild with `anchor-1.0.2`; artifacts (IDL address, keypair, declare_id) all
  verified back at the stock `79sG…` id before the run.
- Wall clock: 7 tests in 18s total. Base-layer txs ~0.7–1.6s; ER increment
  3.2s first-touch then 1.5–2.8s; commit ER-side 1.8s + base confirmation 1.5s
  (via `GetCommitmentSignature`).
- ER fee payer worked with the base-layer wallet (0.686 SOL) — no separate ER
  funding step was needed on devnet.

## Task 4: workspace scaffold (2026-06-11)

- Layout mirrors `~/spikes/magicblock-engine-examples/anchor-counter` @ e4bf31d
  (Anchor.toml / workspace Cargo.toml / package.json / tsconfig), program renamed
  to `arena`, pins exactly as above (anchor-lang 1.0.2 + er-sdk 0.14.3).
  Cargo.lock pinned er-sdk to **0.14.3 exactly** (`cargo update --precise`) —
  plain "0.14.3" caret-resolved to 0.14.4, which is not what Spike A validated.
- `declare_id!` uses `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC` — a real
  generated keypair (tracked at `target/deploy/arena-keypair.json`, mirroring how
  anchor-counter tracks its deploy keypair). The plan's placeholder
  `Arena111…111` decodes to 31 bytes (invalid pubkey, rejected by `declare_id!`),
  and localnet `anchor test` requires declared id == deployed id anyway.
- Test harness is plain local-validator ts-mocha (`tests/arena.ts` pings), NOT
  the template's `../fullstack-test.sh` (that needs the ephemeral validator;
  delegation tests come later). Run as:
  `~/.avm/bin/anchor-1.0.2 test --validator legacy`
  — anchor 1.0's default localnet runner is **surfpool** (not installed);
  `--validator legacy` selects solana-test-validator. The validator type is a
  CLI-only flag (no Anchor.toml key for it in 1.0.2).
- npm (package-lock.json) instead of the template's yarn — matches the parent
  repo's package manager; anchor only shells out to the `[scripts] test` line,
  so the package manager choice doesn't affect `anchor test`.

## Spike B — oracle feed read (PASS, 2026-06-11)

- `npx tsx scripts/arena/_spike-oracle-read.ts` → SOLUSD feed PDA
  `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu` on `https://devnet.magicblock.app`:
  owner `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`, dataLen 134,
  price offset 73 (i64 LE) / publish_ts offset 93 (i64 LE) confirmed, **age 0s**.
- Account fixture dumped to `arena-program/tests/fixtures/solusd-feed.json` for
  local-validator tests.

## Oracle derivation + MAINNET (confirmed 2026-06-11)

- MagicBlock confirmed direct PDA reads (their answer + https://pyth-template.magicblock.app/).
- Derivation: seeds `["price_feed", "pyth-lazer", ascii(lazerFeedId)]` under
  `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`. Feed ids: BTC/USD=1, ETH/USD=2,
  SOL/USD=6 — verified to reproduce all three published devnet addresses.
  NOTE the third seed is the DECIMAL STRING of the feed id ("6"), not the symbol
  and not little-endian bytes.
- PDAs are cluster-independent → mainnet uses the SAME addresses. Verified live:
  mainnet base layer shows the SOL feed delegated (owner DELeG…), and regional
  mainnet ER endpoints `https://as.magicblock.app` / `eu.` / `us.` serve it with
  age 0s. `https://router.magicblock.app` errored on plain getAccountInfo — use
  the regional endpoints (pin validator identity at Phase-1.5 delegation).

### Task 4 deviations addendum (review follow-up)
- `init-if-needed` anchor-lang feature dropped (template has it; ping program does not
  use it — re-add only when an instruction needs `init_if_needed`).
- Template's `packageManager: yarn@1.22.19` field dropped from package.json (npm used,
  matching the parent repo).

## Tasks 6–9: pure Rust modules (2026-06-11)

- `state.rs` / `candles.rs` / `strategy.rs` / `paper.rs` landed per the plan;
  `cargo test -p arena` = 25 tests green (1 state size, 8 candles, 2 strategy,
  13 paper, 1 scaffold). Strategy mirrors the CURRENT
  `lib/arena/strategy-reference.ts` (including the `breakout_bps >= 10_000`
  domain guard added in review) and passes all nine fixture cases in
  `fixtures/arena/strategy-cases.json`.
- dev-deps `serde`/`serde_json` added for the fixture parity test (test-only;
  Cargo.lock delta is exactly those crates — er-sdk stays at 0.14.3 exact).
- **`anchor-1.0.2 build` caveat for Tasks 10–11:** the SBF compile emits
  stack-offset diagnostics (build still exits 0, `arena.so` + IDL produced):
  `MarketState::try_deserialize_unchecked` frame ≈7232 bytes (limit 4096) and
  `Bot::try_deserialize_unchecked` ≈4672 bytes. The Borsh deserialize path
  builds the full ~3.3KB ring / ~2KB tape structs on the stack. This bites the
  moment an instruction takes `Account<MarketState>` / `Account<Bot>`
  (Task 10's init contexts construct fresh accounts — likely fine — but
  Task 11's `tick` deserializes both). Mitigations to evaluate at Task 10/11,
  in order: `Box<Account<...>>` in the Accounts structs, then zero_copy
  (`AccountLoader`) if the boxed form still trips the limit at runtime.
  Do NOT restructure the state structs preemptively — measure on the local
  validator first.

## Task 10 BLOCKED: Borsh deserialize blows the SBF stack at RUNTIME (2026-06-11)

**Box<Account<...>> is NOT sufficient.** With every account Boxed in every
`#[derive(Accounts)]` context (`Box<Account<ArenaConfig>>`,
`Box<Account<MarketState>>`, `Box<Account<Bot>>`), `init_market` and
`init_bot` fail on the local validator with stack AccessViolations. Tasks
10–12 cannot proceed until the structural decision below is made.

### Build diagnostics (anchor-1.0.2 build, all accounts Boxed; exit 0)

| Function | Frame | Over the 4096 offset by |
| --- | --- | --- |
| `MarketState::try_deserialize_unchecked` | 7232 B (offset 7208) | 3112 B |
| `Bot::try_deserialize_unchecked` | 4608 B (offset 4168) | 72 B |
| `InitMarket::try_accounts` closure | 4288 B (offset 4160) | 64 B |

### Runtime (solana-test-validator via `anchor-1.0.2 test --validator legacy`)

- `ping`, feed-fixture load, `init_config` → **pass** (ArenaConfig is 8+327 B;
  its deserialize frame is small).
- `init_market` → `Access violation in stack frame 7 at 0x200007fc0 of size 8`
  (8,635 CU consumed, fails inside the program before completing).
- `init_bot` → `Access violation in stack frame 11 at 0x20000bfb8 of size 8`
  (after the System CPI creates the account, i.e. in the deserialize of the
  fresh zeroed buffer into `Account<Bot>`).
- Boxing does not help because the overflow is in the *callee*
  `try_deserialize_unchecked` frame (Borsh constructs the `[Bucket; 64]` /
  `[TapeEntry; 64]` arrays on that function's own stack before the value ever
  reaches the heap Box). The diagnostics are identical with and without Box.

### RESOLVED (2026-06-11): option 1 (zero_copy) chosen by the controller and shipped

MarketState and Bot migrated to `#[account(zero_copy)]` + `AccountLoader`
(nested Bucket/Position/TapeEntry/StrategyParams are `#[zero_copy]` Pod;
ArenaConfig stays Borsh). bool fields became u8 (`Position.active`,
`StrategyParams.trend_filter`); fields reordered widest-first with explicit
`_pad` arrays so there is **zero implicit padding** — Borsh field-order bytes
== repr(C) bytes, which matters because @coral-xyz/anchor 0.32.1 ignores the
IDL `serialization: bytemuck` flag and decodes with plain Borsh layouts.
Byte layouts documented per-struct in state.rs and locked by
`state::tests::zero_copy_layouts_locked` (Bucket 56 B, Position 48 B,
TapeEntry 32 B, StrategyParams 16 B, MarketState 3608 B, Bot 2328 B —
account data = 8-byte discriminator + struct).

Measurements after the migration (same toolchain as the BLOCKED table above):

- `anchor-1.0.2 build` (forced clean recompile of the arena crate):
  **zero stack-offset diagnostics** (previously
  `MarketState::try_deserialize_unchecked` 7232 B and
  `Bot::try_deserialize_unchecked` 4608 B over the 4096 B limit). The Borsh
  deserialize frames no longer exist — AccountLoader maps account bytes in
  place.
- `anchor-1.0.2 test --validator legacy`: **6/6 passing** (ping, fixture,
  init_config, init_market, init_bot ×2 round-trip, BadParams rejection).
  Previously 3 passing / 3 failing with stack AccessViolations in
  init_market/init_bot.
- `cargo test -p arena`: 29 green (28 prior + the new layout-lock test).

Gotchas hit during the migration (recorded for Phase-2/UI work):

- `#[derive(AnchorSerialize)]` on a `#[zero_copy]` struct fails under the
  `idl-build` feature: both generate an `IdlBuild` impl (E0119).
  StrategyParams (it doubles as the `init_bot` ix arg) therefore implements
  AnchorSerialize/AnchorDeserialize **manually** as raw Pod bytes — valid
  precisely because the struct has zero padding.
- The safe `#[zero_copy]` expansion derives `::bytemuck::Pod` against the
  LOCAL crate's bytemuck, so `bytemuck = { version = "1.17", features =
  ["derive", "min_const_generics"] }` is now a direct dependency (lockfile
  already resolved 1.25.0 via anchor-lang; no lock churn beyond the dep edge).
- `init_bot` now also requires `max_hold_ticks >= 1` (hardening review:
  0 would close every position on the tick after open).

### Options for the controller (measured, superseded by the resolution above)

1. **zero_copy (`AccountLoader`)** — the standard fix for accounts this size.
   Structural: `bool` fields (`MarketCfg.active`, `Position.active`,
   `StrategyParams.trend_filter`) are not Pod and must become `u8`; `#[repr(C)]`
   layout review; `candles.rs`/`paper.rs` signatures move to `Ref/RefMut`; the
   TS client decodes change. Touches the Tasks 6–9 modules + their 25 tests.
2. **Shrink the structs until the frames fit** — does NOT work for
   `MarketState`: rider (span 4 × MIN_STRAT_CANDLES 12 = 48 buckets) needs
   RING_LEN ≥ ~50, and frame ≈ 2× ring bytes ⇒ ~5.2 KB, still over. `Bot` is
   only 72 B over (TAPE_LEN 64→60 would fit), but that alone doesn't unblock
   `MarketState`.
3. **`LazyAccount<'info, T>`** (anchor-lang 1.0.2, `lazy-account` feature,
   experimental) — heap-based lazy per-field deserialize; avoids the frame
   entirely for reads, but tick mutates nearly every Bot field and init must
   write whole accounts, so the write path needs hand-rolled serialization.
4. **SBPF v2+ dynamic stack frames** (`cargo build-sbf --arch ...`) — removes
   the 4 KB fixed frame, but deviates from the anchor-counter template pins and
   needs feature-gate support on devnet AND the MagicBlock ER validator.

## Tasks 11–12: tick + ER delegation lifecycle (2026-06-11)

- **Task 11 `tick(market_id)`** (commit after the zero_copy migration):
  permissionless; config seed-checked, MarketState `AccountLoader` (mut,
  `bump = market_state.load()?.bump`), feed `UncheckedAccount` +
  `require_keys_eq` vs `config.markets[market_id].feed` (WrongFeed). Bots via
  remaining_accounts: `AccountLoader::<Bot>::try_from` (owner + discriminator
  checked) + `load_mut()` (writable-checked) — zero_copy writes land directly
  in account memory, **no `.exit()` re-serialize** (confirmed on anchor 1.0.2:
  the plan's `bot.exit(&crate::ID)?` line is Borsh-era and unnecessary).
  Conviction stays 0 in tape entries (not modeled in Phase 1).
  `anchor-1.0.2 test --validator legacy`: 9/9.

- **Task 12 delegation** copies anchor-counter's er-sdk 0.14.3 macro usage:
  `#[ephemeral]` on the program mod, `#[delegate]` contexts with
  `#[account(mut, del, seeds = ..., bump)]` on an **UncheckedAccount** (the
  `del` macro is happiest there; delegation works at the AccountInfo level so
  zero_copy is irrelevant to it), `#[commit]` + `MagicIntentBundleBuilder`
  `.commit(...)` / `.commit_and_undelegate(...)` + `.build_and_invoke()`.
  Instructions: `delegate_market(market_id)` / `delegate_bot(persona_id)`
  (admin-gated, validator pinned via first remaining account),
  `commit_state(market_id)` (deliberately permissionless — the Task-14 crank
  keypair is not the admin and commits only persist state),
  `undelegate_all(market_id)` (admin-gated; the non-delegated config PDA is
  served to the ER as a read-only clone — verified working on the local
  ephemeral validator, de-risking the same pattern for tick's config read).
  Handler lifetime note: anchor 1.0.2's `Context` takes ONE lifetime
  (`Context<'info, T<'info>>`), not the four-lifetime 0.3x form.

### Local ER harness (scripts/test-delegation.sh → tests/delegation.ts)

`npm run test:delegation`: mb-test-validator (base, :8899) + ephemeral-validator
(:7799, pty-wrapped — the TUI exits silently without a TTY) + deploy + mocha.
**5/5 passing**: init → delegate (market + 2 bots, owner flips to DELeG…) →
tick via ER (lastPrice live, bucket folded) → commit_state
(GetCommitmentSignature lands on base; base lastPrice == ER lastPrice; still
delegated) → undelegate_all (owner back to the program on base ≤2 s; state
matches ER). The suite self-skips (5 pending) under
`anchor-1.0.2 test --validator legacy` via `ARENA_DELEGATION_TEST=1` gating.

Gotchas:

- `@magicblock-labs/ephemeral-validator` **0.12.0 global install is missing
  two delegation-program account dumps** (`9yvg9551…` and `7L9eCRv5…`) from
  `bin/local-dumps/` — mb-test-validator hard-fails on startup. They exist on
  devnet; the harness script auto-dumps them on first run
  (`ARENA_DEVNET_RPC` overrides the RPC; api.devnet.solana.com was degraded
  again, Helius devnet worked).
- The delegation program id at er-sdk 0.14.3 is
  `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
  (magicblock-delegation-program-api 3.0.0) — NOT the older
  `…teabpTabdBah` id that floats around older docs; ownership asserts against
  the wrong id fail confusingly while everything else works.
- Local ephemeral-validator identity is `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`
  (pinned in tests/delegation.ts, same as anchor-counter's localnet test).

## Task 13: devnet deploy + first live tick (2026-06-11)

### Deploy

- Program id `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC` (declared id ==
  deployed id; keypair tracked at `target/deploy/arena-keypair.json`).
- Deployed with `solana program deploy target/deploy/arena.so --program-id
  target/deploy/arena-keypair.json --use-rpc` against Helius devnet
  (`https://devnet.helius-rpc.com/?api-key=…` — api.devnet.solana.com still
  degraded, same Spike A workaround). First attempt landed; no buffer cleanup
  needed.
- Deploy signature:
  `4SQYjVBmkHZk3BmeDfsU9fiATEL6akpDtd7rDkqMEHQMhTdqFAP2T4oPgavzftRS4AwYJzk8Z5mNJvxLV8YxqxFG`
- Cost: wallet `HKVgAYCTKDdtLyN4hGmBC49Psfb9yxsFWQk3jnBEXnhL` 10.686 → 7.919
  devnet SOL = **2.767 SOL** (2.76404568 SOL rent on the 396,960-byte
  programdata `BWwYevg6yd1RSmooRgE6uhks1RsNmV2m7bkCbSDUJwYn` + fees).
  Upgrade authority = the wallet.

### Devnet ER endpoint + validator (measured, not assumed)

`https://devnet.magicblock.app` and `https://devnet-as.magicblock.app` are the
SAME validator: both `getIdentity` →
**`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`** (the pubkey anchor-counter
pins for devnet), and both serve the SOLUSD feed
`ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu` fresh. So:
delegation validator = `MAS1…zk57`, `ARENA_ER_ENDPOINT=
https://devnet.magicblock.app` (matches the .env.example default; no regional
fallback was needed — the feed was visible and ticks landed first try).

### Init + delegation (scripts/arena/init-devnet.ts, idempotent)

Config `{fee_bps 6, spread_bps 5, maint_buffer_bps 500, max_age_secs 10,
bucket_secs 15}` — note max_age_secs is the REAL 10s freshness guard here,
unlike the huge window the static-fixture local tests need. Bots seeded with
$1,000 (1_000_000_000 micro-USD).

**Persona-id encoding: utf8 bytes zero-padded to 16** (`Buffer.alloc(16)` +
`buf.write(name)`); the bytes are the PDA seed, so the string IS the on-chain
identity. Devnet personas are **`scalper-v1` / `rider-v1`** (dashes, per the
Task-13 spec) — the local test suites use `scalper.v1` / `rider.v1` (dots),
which derive DIFFERENT PDAs; deliberate, the suites self-contain.

| Step | Account | Signature |
| --- | --- | --- |
| init_config | `34CNfvrbVQUUMhX1PWNK7EjP8rmFB6DkBvbxT2Lia9hA` | `5r99K2WGWgHPhFS4LS4vFwGv3AzBHiiZHB4nLAtEDkZ7Y11ntjEfMvhEKQiTddaiB62zrYHn5MFX1pwKydmDa6Do` |
| init_market 0 | `BTk9M99Eh5xjccYpZui4K8CvMesCLkHAWjF9gXSjhhzj` | `2KZ3EMoEeSRM9NH2zUxR1FiHY8diiY9D21bcv61f9KroxYzZH3daH3cKgupoK3Xaavkyza6cpxwJ58uZmhkcPHZ4` |
| init_bot scalper-v1 | `Fgbev9Y218a3V74baTRuwpecc4Ae6dddqbTFzkmJ8JkZ` | `66zyT5mp6pj47LQA2SLrvcvWq89jFifamzMskSKPCWy9aWHD542oCyrF3LgeALax5M9x6jvcqQcFjMg7ue4qPScA` |
| init_bot rider-v1 | `Az5PA1SVzC7z6p5ckjXwikoaGgG6oi65iuAhyriNRRHC` | `57uDGbe6ydpKAbk3h4H7iHMyiTC93pJsTyDbt346AzGwDX4EoP3Q2ttgGPFdB39BHPYvo1ADKLuj6jMVekDpUhBx` |
| delegate_market | (owner → `DELeG…aeSh`) | `55yE5qc7BVGSLkLBFWMNBq8cCz6dyKY8woxeTtTZqg53Cp55ufkheCT951m2nik8qXsdMZphwsVHo3oMJWGyBLAd` |
| delegate_bot scalper-v1 | (owner → `DELeG…aeSh`) | `rUkCtyLzSrEMJauFkQyMdiH8nN9omWZGrtGBKjLXFTZLDemFoe1ZJak2FnLnaEQ37ZBArfW5wz5LDJgJDJxP66k` |
| delegate_bot rider-v1 | (owner → `DELeG…aeSh`) | `4bWUyKYKQqq8kALjowrN1k682Hzc73FdynjZsNZEbfuZpGbFkoYTFH3N5jwcyqKrQ8SEAMvhvd3XFnbDDPeyrvkD` |

Delegation worked first try WITH the validator pinned via the first remaining
account (`MAS1…zk57`); the "try without validator" fallback from the task notes
was never needed.

### First live ticks (scripts/arena/tick-once.ts, via the ER)

Sent with the tests/delegation.ts pattern: ER blockhash, skipPreflight true,
base-layer wallet as ER fee payer (no ER funding step, same as Spike A).
MarketState decoded from raw bytes at the documented state.rs offsets.

| Tick | ER signature | Decoded after |
| --- | --- | --- |
| 1 | `3x4HpAL2VZUzTXKrDainthR9VNxBfXUBDd4uEkTXPU65Q57K8XiUVgJ7uj7uk8esmeQ8aftAdkgrqG6ykXyPtDEJ` | lastPrice **$66.68689696**, publishTs 1781200142, head 0, bucket o/h/l/c all 66.68689696, startTs 1781200140, pathLen 0, updates 1 |
| 2 | `Vh7Rho6H73KXwLYAXVaoQdrKYEapdG3S7VMfAFCJ1rexfk6ci3sBJNW2JxcuwfySPMLM4XPZ8ZnJPceFM33BuN6` | lastPrice 66.68703616, head **1** (15s bucket rolled: startTs 1781200155), open carried from prior close, pathLen 0.0001392, updates 1 |
| 3 | `A8F6Y3vQumGnKzDr1E7pawq6hW5usc6NMKapxTZ1BsTDGUx3TrvSMgwctJGXjabrumbf8HnieNGaEKpkKJu21gp` | lastPrice 66.99854111, head 2, o 66.68703616 / h 66.99854111 / l 66.68703616 / c 66.99854111, pathLen 0.31150495, updates 1 |

A live SOL price in the expected $60–70 band, the ring folding real movement
(tick 3 caught a 31¢ move), buckets rolling on the 15s boundary, head
advancing, pathLen accumulating — the on-chain pipeline is live against the
real MagicBlock oracle. No compute/stack errors on the devnet ER (the local
harness's 5/5 carried over). Each script invocation takes ~15s wall clock, so
consecutive runs landed in different buckets; in-bucket `updates` increments
were already proven by the local suites.

Tick CU note: tick 1 had 2 incomplete buckets; strategy evaluation
(MIN_STRAT_CANDLES=12) stays a no-op until the crank (Task 14) keeps the ring
warm for ≥3 min (scalper) / ≥12 min (rider).

## Known pre-mainnet gates (review follow-ups, recorded 2026-06-11)

Deliberately NOT fixed in the Task-13.5 review patch; to be resolved before
any public/mainnet exposure (per-item status below):

- **Permissionless tick spam-aging / fee-bleed griefing (review Issue 2) —
  IMPLEMENTED 2026-06-12.**
  Original issue: anyone can call `tick` in a tight loop — each call is a
  successful no-op (or same-bucket fold) that still ages positions via
  `ticks_held` and bleeds the crank's expected cadence assumptions
  (max_hold_ticks personas decay on attacker-paid ticks). The fix is the
  planned no-op guard, now in the `tick` handler right after the oracle
  read: `if read.publish_ts <= ms.last_publish_ts { return Ok(()); }` —
  a print no newer than the last folded one returns success WITHOUT
  folding the candle, running paper maintenance, or aging `ticks_held`;
  state only advances on a strictly newer oracle print. The static-fixture
  double-tick test was rewritten to assert exactly that no-op (updates,
  pathLen, ticks_held, tape/seq/balances all unchanged); folding stays
  exercised by each suite's first tick and the ascending-ts candles.rs
  unit tests (which call `fold_price` directly and are unaffected).
  Evidence: cargo 30 green / legacy suite 12 passing / local ER harness
  7/7 / anchor-1.0.2 build with zero stack-offset diagnostics. NOT yet
  deployed — the guarded .so ships with the next planned deploy.
- **`commit_state` trust dependency (review Issue 3 sibling, per review).**
  `commit_state` is permissionless and relies on MagicBlock's delegation
  records binding commits to the owning program — i.e. the magic program
  rejecting commits of accounts not delegated from this program. That is a
  trust dependency on MagicBlock's delegation-program enforcement, not
  something the arena verifies itself.

## Task 13.5: review patch — devnet upgraded in place (2026-06-11)

- Patches: candles.rs `fold_price` gap-loop clamp (`start = start.max(target -
  RING_LEN as i64 * bucket_secs)` — a multi-day publish_ts gap now reseeds the
  full ring in ≤ RING_LEN iterations instead of one iteration per skipped
  bucket, which blew the ER compute cap stickily) + lib.rs mandatory validator
  pin in `delegate_market`/`delegate_bot` (`MissingValidator` error when the
  first remaining account is absent; silent unpinned delegation no longer
  possible).
- Tests: `cargo test -p arena` 30 green (29 + `multi_day_gap_clamps_to_
  ring_len_and_recovers`); legacy suite 10 green (9 + "rejects delegation
  without a pinned ER validator" — the require! fires before the delegation
  CPI, so it asserts on solana-test-validator with no delegation program).
  `anchor-1.0.2 build`: still zero stack-offset diagnostics.
- New binary 398,712 B > the 396,960 B programdata max len, so the upgrade
  needed `solana program extend 6YSS… 2048` first (programdata now 399,008 B).
- Upgrade sig (same wallet/Helius-devnet/--use-rpc pattern as Task 13):
  `2wdV4kB6sYz6pSnRsvBaqhAw6MzJiLwa5UXQ9gYUXZtz7aoa1ySqwjJ9CStnkKET82wMREbrszHQvmH4mVxhbgUy`
  (slot 468744327). Net cost 0.01624 SOL (extend rent + fees; the deploy
  buffer rent was refunded on close), wallet 7.846 → 7.830 SOL.
- Post-upgrade smoke (tick-once.ts ×2 via the devnet ER): live prices
  $67.063 → $67.030, head 56 → 57 (15s bucket rolled), updates/pathLen sane.

## Task 15: devnet soak + Phase 1 exit (2026-06-11 evening)

- **Soak**: crank (lib/arena/crank-deps.ts wiring) ran 700+ ticks with ZERO failures
  across ~1h+, commits landing every 5 min (sample sigs in /tmp/arena-crank-soak.log
  history: JjD4QaWm…G6Y, 2XY5V9KG…ot6y, …). Base-layer commit mirroring verified twice
  (head 40 → 60 across consecutive commits). Rode through a live program upgrade
  (55895a5) with no failed ticks. ~5-7 oracle prints folded per 15s bucket.
- **First autonomous on-chain trade (exit-checklist evidence)**: test-aggro-v1
  (PDA 9rzUs2NA2kdzNU8eqikhApMo49CqQBB65cYZabi5PKZ4, breakout 5bps / activity 1.0x /
  no trend filter / 5x / maxHold 20 ticks):
  OPEN_SHORT $100 stake @ $66.81305105 (2026-06-11T18:49:33Z) →
  EXIT_MAX_HOLD @ $66.85149969 (18:50:41Z, 68s hold).
  Books: grossPnl -$0.587733, fees $0.600000 (= 2 × 6bps × $500 notional exactly),
  balance $999.112267, trades 1, wins 0, seq 2, both tape entries decoded from the
  ER. Full open→close lifecycle with real price action, spread, fees, honest loss.
- **Roster reverted** to scalper-v1,rider-v1 post-evidence (test bot stays on-chain,
  undelegation optional later); crank restarted.
- **Launch personas** (scalper-v1/rider-v1): zero trades after 1h+ — correct, no
  0.6%@1.4x-activity breakout occurred; they are deliberately picky.
- **Phase 1 EXIT: all checklist items green** (tests, live trade lifecycle, commit
  mirroring, no compute errors). Phase 1.5 (mainnet) unblocked pending real SOL.

## magic_fee_vault commits (2026-06-12)

### Incident that forced this

**2026-06-11 ~21:45 sponsored-commit quota exhausted (nonce 10/10); commits
failed ~1h; undelegate-redelegate cycle stalled on validator-side base-layer
finalize (30+ min), arena paused; interim: hourly commits + redelegate.ts;
permanent: this section.** Root cause: MagicBlock sponsors only 10 commits
per delegated account (magic program error 0xa0000000 "current commit nonce
10 reached the limit of 10"); 5-min commit cadence burned the quota in
~50 min.

**2026-06-12 follow-up — the stalled finalize root cause is CONFIRMED by
MagicBlock**: their validator's commit-intent tx for our 3-account bundle —
`4wuVM2uxWjMGwWRYcR5hqZUfi5QDWuouSTxDJnN3JTgmH3sUyKpwDPj4XDv32ThoaKXhqFdCuGF17equ24fAe6m3`
— fails on ComputationalBudget on the base layer and retries forever
(that's what wedged the undelegation). Multi-account intent bundles
finalize as ONE base-layer tx touching every bundled account, and 3
accounts already exceed the validator's base-layer compute budget. Their
team is checking internally on the validator side.

**Fix (shipped with this entry): ONE intent per account.** `commit_state`
and `undelegate_all` now loop — one `MagicIntentBundleBuilder` →
`.commit(&[single account])` / `.commit_and_undelegate(&[single account])`
→ `build_and_invoke(_signed)` per account (market_state first, then each
remaining bot). Each call is one CPI scheduling one independent intent, so
every base-layer finalize tx touches exactly one account. Instruction
signatures unchanged (IDL delta is doc comments only) — crank-deps.ts /
redelegate.ts needed no changes. Local ER harness proof (7/7): the
fee-vault commit test now asserts one scheduling line per account, N
DISTINCT base-layer commit sigs, each landing err-free; undelegate
semantics unchanged (all accounts end program-owned on base, asserted).
ER CU measured: 3 intents in one commit_state ix = 108,763 CU (~36k per
intent) against the default 200k/ix budget → ~5 accounts is the ceiling
for the multi-CPI shape; past that, fall back to a `commit_state(
account_index)` cranked once per account in separate ER txs (defensive
note also in lib.rs). Undelegation atomicity note: accounts now flip back
to the program independently, not in one tx — redelegate.ts already polls
every account, so no change needed.

**Deploy status: the devnet program still has the OLD multi-account bundle
shape** — d300d12/c2c62b7 (fee vault) and this per-account fix are all
undeployed until the controller runs the lockstep deploy post-unstick.

### Design (shipped, local-ER verified; devnet deploy pending post-incident)

`commit_state` now pays its own Magic intent bundles — no per-account quota
(delegation.md "Option 2", mirrored from
`magicblock-engine-examples/rewards-delegated-vrf`, the only in-repo user of
the pattern):

- **CrankPayer PDA** `["crank-payer"]` — a program-owned Borsh data account
  (8 + 1 bytes, just the bump). The documented "delegated fee payer" is NOT
  a system account: it must be program-owned so the `del` constraint can
  delegate it (rewards-delegated-vrf's payer is its `reward_list` data PDA).
  Lamports it holds at delegation time become its spendable ER balance.
  Devnet PDA: `6TpDj4Z5h1v9MqFNpvSy4nYZFQB2Yrhgov6MKUpmveWS`.
- **`init_crank_payer` / `delegate_crank_payer`** — admin-gated; delegation
  requires the validator pinned via the first remaining account
  (MissingValidator otherwise, same rule as market/bots). Pinning to the
  SAME validator as the market matters: the fee vault commit_state derives
  is the market-validator's vault, and the payer's ER balance only exists on
  the validator it was delegated to.
- **`commit_state` v2 accounts** (+3): `delegation_record` (market_state's,
  `address =`-pinned via `ephemeral_rollups_sdk::pda::
  delegation_record_pda_from_delegated_account`), `magic_fee_vault`
  (writable; handler re-derives `["magic-fee-vault", validator]` under
  `ephemeral_rollups_sdk::id()` from the record's bytes 8..40 —
  DelegationRecord = [8-byte AccountDiscriminator=100][32 authority =
  validator][...], verified in dlp-api 3.0.0 source — and requires equality,
  InvalidFeeVault), `crank_payer` (writable UncheckedAccount, seeds-checked).
  Builder: `.magic_fee_vault(...)` then `.commit(...)` then
  `.build_and_invoke_signed(&[crank_payer_seeds])` — the payer signs via
  seeds; er-sdk 0.14.3's `build()` forces the payer meta signer+writable, so
  no `is_signer` patching needed (rewards-delegated-vrf's `as_signer`
  workaround targets its CallHandler escrow_authority path, which we don't
  use). Still permissionless: a spammer can drain the crank payer at the
  per-commit fee rate (reviewed + accepted — persistence pauses, ER state
  unharmed).
- **Funding** — `scripts/arena/fund-crank-payer.ts` shuttles lamports to the
  delegated payer via the Ephemeral SPL Token program's sponsored-lamports
  flow (`lamportsDelegatedTransferIx`, ix discriminator 20, program
  `SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2`): base-layer tx, fresh
  32-byte salt per run (PDA `["lamports", payer, dest, salt]` — reuse
  collides), destination must already be delegated. Pre-delegation a plain
  SystemProgram.transfer works instead (what the local test does).
  init-devnet.ts gained idempotent init+delegate steps for the payer.
- **Crank** — lib/arena/crank-deps.ts derives the three PDAs client-side
  (validator from `ARENA_ER_VALIDATOR`, default MAS1…zk57); the TS SDK's
  `delegationRecordPdaFromDelegatedAccount` / `magicFeeVaultPdaFromValidator`
  exist but the package only lives in arena-program/node_modules, so the
  root derives by hand (seeds verified against SDK source — both PDAs live
  under the DELEGATION program, `DELeG…aeSh`, which is also what
  `ephemeral_rollups_sdk::id()` returns; the skill doc's "under the
  ephemeral rollups SDK program ID" means exactly that id).
- **undelegate_all** unchanged (admin-gated sponsored path is fine for the
  rare undelegation).

### Verification (2026-06-12)

- `cargo test -p arena` 30 green; legacy suite **12 passing** (+ crank-payer
  init + MissingValidator rejection); `anchor-1.0.2 build` clean — zero
  stack-offset diagnostics (CrankPayer is 9 bytes).
- Local ER harness (`scripts/test-delegation.sh`) **7/7**: init→fund (plain
  base transfer pre-delegation)→delegate crank payer (owner → DELeG…),
  bogus-vault commit REJECTED with InvalidFeeVault (raw-send + log assert —
  anchor's sendAndConfirm mangles ER failures into "Unknown action
  'undefined'", hence the raw pattern), fee-vault commit lands on base via
  GetCommitmentSignature with base lastPrice == ER lastPrice, still
  delegated.
- NOT verified locally: actual lamport billing. The local ephemeral
  validator accepted the fee-vault bundle but debited 0 lamports from the
  crank payer (no fee schedule locally; the `["magic-fee-vault",
  mAGicPQY…1mev]` vault account doesn't exist on the local base layer and
  that was fine). Real per-commit cost + the >10-commit soak must be
  measured on devnet post-incident, then size fund-crank-payer.ts top-ups
  accordingly. Quota-lift behavior (the whole point) is likewise
  devnet-only to prove.
- IDL is a COMMITTED file now — `anchor build` regenerates
  target/idl/arena.json; commit it together with any instruction change
  (the crank loads it at runtime).

## Phase 2: live arena UI (2026-06-11 night)

- Shipped: /arena page (roster + bot profile + decision tape + Arena nav tab),
  client byte-decoders for the zero-copy layouts (53 vitest green incl. PDA
  derivations asserted against this file's Task 13 records), live data hook
  (REST seed → ER ws → 4s visible-poll fallback).
- **Spec §13 item 3 RESOLVED empirically: `onAccountChange` ws subscriptions
  WORK against https://devnet.magicblock.app directly** — the arena page runs
  in "LIVE" (ws) mode in the browser; the poll fallback exists but did not
  trigger. Verified in-browser 2026-06-11 ~22:35 EEST (SOL mark ticking live).
- Browser-verified end-to-end: invite gate → /arena → live cards ($1,000
  equity, flat state) → profile modal (stats grid, empty-tape copy, Solscan
  devnet links to the real bot PDA + program). Production build green with
  /arena in the route table.

## Market-1 generation: wedge sidestep LIVE on devnet (2026-06-12 morning)

Rather than wait for MagicBlock to unstick the market-0 undelegation (their
internal check pending — see the 2026-06-12 incident entry), a fresh
generation was stood up next to it. Market 0 + scalper-v1/rider-v1 stay
wedged-delegated until MagicBlock's fix and then simply retire (no
re-delegation planned); `/tmp/arena-recover2.sh` watches for the ownership
flip purely as a courtesy signal.

- **Program upgraded in place** to the 4a1b35e build (magic_fee_vault +
  per-account intents): `3LCsyrwhnwHKquTDRqLHn2HhV4R38u9p7CnQ1Fj57SRDrZCJCu7SxTqadjsYDgY6Girba7RGZUjTeiF65FVHYX9e`.
  Lockstep concern moot — every consumer of the old shape was already dead
  (market-0 ticks failing 3007 since the wedge).
- **Market id is now env-driven everywhere** (`ARENA_MARKET_ID`, default 0):
  init-devnet.ts / tick-once.ts / redelegate.ts / commit-once.ts /
  lib/arena/crank-deps.ts / parseArenaEnv (`NEXT_PUBLIC_ARENA_MARKET_ID`).
  Roster params keyed by persona name in init-devnet.ts BOT_PARAMS
  (v2 == v1 strategies byte-for-byte, fresh PDAs).
- **Live generation (all delegated to MAS1…zk57, validator pinned):**
  - market 1 `F45qAoXf4ZnBvBLcFmNUws9GGhGyjn6MZQMvgfgrtZML`
    (init `2J3KfZVbPHuky4XbFnp9D5SDZ3XBVdLxHa1zrwuTmiieo3GsrW4upFFR52UHBmXEU1e7aPUBNi4u4AJsmhuy5ncm`)
  - scalper-v2 `82pSMR2Qj1T27SXmWBxnvUBwVZWYEBzixAGT5ke1ttxH`
  - rider-v2 `2XbMh7EGTDBkJbUo1zSpQFqRDzdJ3SP3dXNx2Egy5eXY`
  - crank-payer `6TpDj4Z5h1v9MqFNpvSy4nYZFQB2Yrhgov6MKUpmveWS`, delegated
    then funded 0.2 SOL via the lamports shuttle
    (`3Dd8sbebHAd18Sob1w5ikJWqyn1STVeJ7iPUC35xWeNh6Y1bYVQkdWgEa1zr4Kt5GXQvXaesG3quhvuEkLxDHStL`)
- **Per-account intents PROVEN on the real devnet validator** —
  scripts/arena/commit-once.ts (new ops tool: force one commit + assert
  per-account base finalize). ER commit
  `4h6yVCxm3EvFivKPGBDDNp35VkCGndQ2ioKLLUw9SAvXiazt3KMxcBWijPmeQAUATQend8gr5uJ1k87kkw3tiyUx`
  → three independent err-free base finalizes:
  market-1 `RzHNJwndW8Lv8qUHE2uw4U7tBmERQ7dezQfJkq2Kzec8tbVRD8VHBxuWFQg9tYCW5EGMSMDeK37RxHQPc4HCPxb`,
  scalper-v2 `4DDy8RSXqTybo1yBuzpmWr2wzRDbHLW7R7MDNMrT4wgEoirH8YGfSix9fnLnXisQPCVcKFeUNN9G58f9e6fuvw7G`,
  rider-v2 `3CYr5B77fTPWeqf66JKYC3emzDtbEZJ9kgyo4Fioujv5fEda6peCvbq4btyRy8wSXAhkV2oE4a7WwqeYPpQTXJvv`.
  This is byte-for-byte the operation class that wedged market 0.
- **Crank-payer debit observed: 0 lamports on devnet too** (same as local).
  Billing appears inactive/deferred; the quota-lift proof is therefore
  "commit #11 lands" during the soak (sponsored path died at exactly 10).
  Re-measure fund-crank-payer.ts sizing once billing activates.

## Phase 1.5 mainnet runbook (prepped 2026-06-12, awaiting funding)

Verified live 2026-06-12: all three mainnet ER regions serve the SOL/USD feed
(`ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu`, same cluster-independent PDA)
at age 0–1s. Validator identities (the delegation pin + fee-vault scope):

| region | endpoint | identity |
|---|---|---|
| Asia | as.magicblock.app | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` (same key as devnet!) |
| EU | eu.magicblock.app | `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e` |
| US | us.magicblock.app | `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd` |

Recommended pin: **EU** (founder + demo audience are EEST; crank latency is
irrelevant at the 2s cadence). The same program keypair deploys to the same
id — `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC` is unoccupied on mainnet
(checked 2026-06-12).

Cost (computed against mainnet rent, 437,416-byte .so):
program 3.046 + market 0.026 + bots×3 0.051 + config 0.009 + crank-payer
account 0.001 + crank-payer funding 0.1 + fee headroom ≈ **3.28 SOL total**.

Sequence (each step = the devnet command with mainnet env):
```bash
# admin wallet needs ~3.4 SOL on MAINNET first
solana program deploy arena-program/target/deploy/arena.so \
  --program-id arena-program/target/deploy/arena-keypair.json \
  --use-rpc --url "$NEXT_PUBLIC_HELIUS_RPC_URL"          # mainnet Helius

ARENA_DEVNET_RPC="$NEXT_PUBLIC_HELIUS_RPC_URL" \
ARENA_ER_ENDPOINT=https://eu.magicblock.app \
ARENA_MARKET_ID=0 ARENA_BOTS=scalper-v2,rider-v2 \
  npx tsx --env-file=.env.local scripts/arena/init-devnet.ts
# NOTE: init-devnet.ts pins DEVNET_ER_VALIDATOR (MAS1…) as the delegation
# validator — MUST be switched to the chosen mainnet identity (env-drive it
# before running; same for _test-aggro-bot.ts). Asia would work unchanged
# (same key) but pin deliberately, not by coincidence.

ARENA_DEVNET_RPC="$NEXT_PUBLIC_HELIUS_RPC_URL" ARENA_ER_ENDPOINT=https://eu.magicblock.app \
  npx tsx --env-file=.env.local scripts/arena/fund-crank-payer.ts   # ARENA_FUND_LAMPORTS=100000000

ARENA_MARKET_ID=0 ARENA_BOTS=scalper-v2,rider-v2 ARENA_ER_ENDPOINT=https://eu.magicblock.app \
ARENA_ER_VALIDATOR=MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e \
ARENA_DEVNET_RPC="$NEXT_PUBLIC_HELIUS_RPC_URL" \
  npx tsx --env-file=.env.local scripts/arena/commit-once.ts        # smoke before the crank

# Railway arena-crank env flips: ARENA_ER_ENDPOINT, ARENA_ER_VALIDATOR,
# ARENA_MARKET_ID=0, ARENA_BOTS, ARENA_DEVNET_RPC (mainnet Helius)
# Web env flips: NEXT_PUBLIC_ARENA_ER_ENDPOINT, NEXT_PUBLIC_ARENA_MARKET_ID=0,
# NEXT_PUBLIC_ARENA_BOTS, NEXT_PUBLIC_ARENA_CLUSTER_LABEL=mainnet
```

Open items before running: (1) ~~validator pin env-drive~~ DONE same day —
`ARENA_ER_VALIDATOR` drives init-devnet.ts + _test-aggro-bot.ts; (2) mainnet commit BILLING
is unmeasured — fund 0.1 SOL, watch the crank-payer balance for the first
hours, resize; (3) PINS pre-mainnet gates: ~~tick spam-aging guard~~ DONE
2026-06-12 (guard in the .so this runbook deploys; see the gates section) +
the commit_state delegation-record trust note (still open — d300d12's
delegation_record is read only for fee-vault scoping, not commit-binding).

### 2026-06-12 follow-on finding: validator co-packs intents and underestimates CU

Per-account intents work when flushed as separate base txs (the smoke run) —
but the validator's intent executor BATCHES co-pending intents into one base
tx with a CU estimate that ignores account size. Evidence: base tx
`5pBemJVKz618E8HMy3eqMz3M3SyEvW3VYRq7DPsidwS1ggvHCKxLPB1mqtaXitqsZBJsLZX6EWshjkVnHa3PHzu`
(slot 468872281) sets ~140k CU for two finalize instructions; the market's
finalize alone consumes 124,244 CU (3.6KB account), ix[3] gets 15,456 and
dies ComputationalBudgetExceeded; atomicity voids the whole tx. No on-chain
retry observed in 10+ min.

Steady state since: **bot finalizes land on every flush (2.3KB ≈ small
enough), the market account alone lags on base** (ER fully live throughout —
ticks, trades, UI unaffected). Soft degradation, accepted for the devnet
soak: bot PnL records (the product-critical tape) persist; the market ring is
derived oracle data. Escalated to MagicBlock as more evidence on the same
ticket (their estimator/packer, nothing actionable in our intent shape —
each intent is already single-account). If their queue ever starts choking
BOT finalizes too, the contingency is bumping ARENA_COMMIT_INTERVAL_MS on
the Railway worker (persistence pauses, ER unharmed — the already-accepted
failure mode).

Mainnet gate addendum: do NOT undelegate the market on a validator without
this fix (the undelegation finalize for a 3.6KB account may co-pack and
fail the same way — that is exactly the market-0 wedge).

### 2026-06-12 ~11:00 EEST: MagicBlock unstuck the v1 accounts — generation retired

MagicBlock confirmed "the accounts should be undelegated" and on-chain agrees:
market-0 `BTk9M99…`, scalper-v1 `Fgbev9Y…`, rider-v1 `Az5PA1S…` are all
base-owned by the arena program again. As planned they RETIRE here: no
re-delegation, final ER-committed state (the v1 PnL history) stays readable
on base forever. Watcher killed. They asked for our versions (sent: Anchor
1.0.2 / anchor-lang 1.0.2, ephemeral-rollups-sdk 0.14.3 with the anchor
feature, TS @magicblock-labs/ephemeral-rollups-sdk 0.14.3 +
@coral-xyz/anchor 0.32.1, commits via MagicIntentBundleBuilder one account
per intent with magic_fee_vault). Market-1 finalize co-packing (entry above)
is STILL failing as of this note (base data 68m stale, newest attempt FAIL)
— their targeted unstick did not include the estimator fix.

### 2026-06-12 ~11:30 EEST: Tail-flow verified live end to end (Task: bot copy)

test-aggro-v2 (G3YAcrRJ…4pE1, market 1) made its first autonomous trades:
OPEN $100 long 5x @66.270 → EXIT_FAVORABLE @66.314 (win), OPEN @66.359 →
EXIT_MAX_HOLD @66.214 (loss); fees $1.199838 = exactly 4 fills × 6bps ×
$500 notional; balance $1000 → $998.04, 1W/1L. The TS reference strategy
replayed over the live ring flags long breakouts at precisely the on-chain
open timestamps (live-data parity, not just fixtures).

Browser-verified during the NEXT open (long 5x entry=66.464 liq=53.836):
/feed bots pill → aggro card shows the position panel (5X LONG badge,
Entry→Mark, Liq, live P&L, on-chain sparkline + entry line, "NEW POSITION ·
OPENED <1M AGO") → TAIL button → TailModal renders ASSET/SIDE/MARK +
"ENTRY $66.46 · LIQ ≈ $53.17", stake presets, receipt (notional 5× of
stake, est. taker fee, ~20% liq buffer, "You're following test-aggro-v2's
MKT1 LONG"), CTA gated on wallet connect (logged out — correct). The signed
Flash tx remains the one unverified step (needs the founder's wallet — same
handoff prereq as the rest of flash-tail).

Roster plan: test-aggro-v2 STAYS in the Railway crank roster as soak fuel
(trades + 3-account commits = co-packing evidence for MagicBlock); remove
from ARENA_BOTS + NEXT_PUBLIC_ARENA_BOTS before any public deploy.

## PHASE 1.5 EXECUTED: ARENA LIVE ON MAINNET (2026-06-12 ~12:15 EEST)

Founder funded the admin wallet to 4.896 SOL; full runbook executed in ~6 min:

- **Program deployed to MAINNET**, same id `6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC`
  (347227b build — fee-vault + per-account intents + spam guard):
  `4o5Po8AMGnLHLzU5V1Le9VCnNpaiFbcM11BEKWXaCjK7rc4fFZ29AZoEDNswB6dogQMz1cNWLGoKUPmaG9v8ybsV`.
  Upgrade authority kept on the admin keypair — `solana program close`
  recovers the ~3.05 SOL programdata rent (founder asked for recoverability;
  do NOT set immutable). ~/.config/solana/id.json must be backed up.
- **Bootstrap (init-devnet.ts with mainnet env)**: config + market 0 +
  scalper-v1 + rider-v1 + crank-payer, all delegated to the **EU validator**
  `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e` (eu.magicblock.app).
  PDAs are byte-identical to devnet market-0 generation (same program +
  seeds, different cluster): market `BTk9M99…`, scalper `Fgbev9Y…`,
  rider `Az5PA1S…`, crank-payer `6TpDj4Z…`.
- **Crank payer funded 0.1 SOL** via the lamports shuttle (program SPLxh1…
  verified present on mainnet): `4Hntdi8xXa8GvAw25rLJLjSJA69KGDThH88nJaSPFbFwM4x6kvm9UKgDxsi7oG9SJnRoRiiTPSY4GzCxK1z1h1F4`.
- **Smokes green on the EU mainnet validator**: tick×2 folds real Pyth Lazer
  SOL prints (updates 1→2, pathLen advancing); commit-once → ER
  `4StdSfywpgMHteoWPvYizetZXTaU65D4EmUiACToZLCKRmMbE8HLhWvsTbRFNbCuMY7juG4tNw2EXNC2QmmC8GhJ`
  → 3 independent err-free MAINNET base finalizes (market `62kZHGSR…`,
  scalper `5f9vzwxf…`, rider `2JWrUDCE…`). Crank-payer debit again 0 —
  billing inactive/deferred on the EU validator too; 0.1 SOL fuel standing by.
- **Railway arena-crank flipped to mainnet env** (eu endpoint, MEUGG pin,
  market 0, v1 roster). Devnet market-1 generation freezes in place as the
  rehearsal record (test-aggro-v2 retired with it).
- Local UI env → mainnet (cluster label "mainnet"); browser-verified live.
  Prod web still ships the arena UI with the pending merge.
