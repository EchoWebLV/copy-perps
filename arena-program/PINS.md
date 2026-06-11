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
