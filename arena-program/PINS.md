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
