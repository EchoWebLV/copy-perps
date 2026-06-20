# Arena Multi-Asset, Multi-Action Bots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the arena LLM bots trade the top ~6 majors and take multiple actions per tick (e.g. open 2 + close 1) at variable leverage, routing each decision to the right on-chain market — with no program upgrade.

**Architecture:** Off-chain only + admin tune + per-asset market setup. The decision schema becomes a bounded list of actions; a single `ASSET_MARKETS` map routes each action's asset to its `(marketId, feed)`; the worker makes ONE LLM call per bot per tick and submits one `apply_decision` per surviving action. On-chain markets are stood up with the existing `init_market`/`delegate_market` instructions against MagicBlock `pricing_oracle` feed PDAs.

**Tech Stack:** TypeScript (strict), Vitest, Zod, `@solana/web3.js`, `@coral-xyz/anchor`, Vercel AI SDK v6, MagicBlock ER.

**Spec:** [docs/superpowers/specs/2026-06-21-arena-multi-asset-bots-design.md](../specs/2026-06-21-arena-multi-asset-bots-design.md)

---

## File Structure

- `lib/arena/llm/schema.ts` (modify) — widen `ARENA_ASSETS`; `decisionSchema` → `{ actions: Action[] }`; export `actionSchema` + `Action`.
- `lib/arena/markets.ts` (create) — `ASSET_MARKETS` (asset → `{ marketId, feed }`), `marketForAsset`, `assetForMarket`, `activeMarkets`. Single source of truth for routing.
- `lib/arena/llm/floor.ts` (modify) — extract `evaluateAction` (today's single-decision logic), add `evaluateActions` returning one `{ asset, outcome }` per action with a running trades budget.
- `lib/arena/llm/loop.ts` (modify) — `runBotDecision` submits one routed `apply_decision` per surviving action; persists one row per action; keeps the day-roll heartbeat gate.
- `lib/arena/llm/brief.ts` (modify) — `renderBookBlock` shows asset labels (not `mkt1`) via `assetForMarket`.
- `scripts/arena/llm-operator-worker.ts` (modify) — `submit` routes `asset → {marketId, feed}`; per-action logging.
- `scripts/arena/_probe-oracle-feeds.ts` (create) — probe candidate MagicBlock oracle PDAs for freshness before wiring.
- `scripts/arena/init-markets.ts` (create) — `init_market` + `delegate_market` per new asset on mainnet.
- `lib/arena/crank-deps.ts` (modify) — `FEEDS` per asset; `listMarkets()` returns every active market.
- `scripts/arena/bot-tuning.ts` (modify) — `cooldownSecs 0`, raise `maxLeverage` + `maxTradesPerDay` for multi-action bots.

**Sequencing:** Tasks 1-7 are pure off-chain (build + test with bots still on SOL only). Tasks 8-12 are the mainnet rollout (feeds, markets, crank, tune, deploy). Nothing trades multi-asset until a market exists for the asset, so the off-chain code ships safely ahead of setup.

---

## Task 1: Widen the asset universe

**Files:**
- Modify: `lib/arena/llm/schema.ts:11`
- Test: `lib/arena/llm/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/arena/llm/schema.test.ts`:

```typescript
import { ARENA_ASSETS } from "./schema";

it("covers the six target majors", () => {
  expect([...ARENA_ASSETS]).toEqual(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"]);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run lib/arena/llm/schema.test.ts -t "six target majors"`
Expected: FAIL (`ARENA_ASSETS` is `["BTC","ETH","SOL"]`).

- [ ] **Step 3: Widen the constant**

In `lib/arena/llm/schema.ts:11`:

```typescript
export const ARENA_ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"] as const;
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run lib/arena/llm/schema.test.ts -t "six target majors"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arena/llm/schema.ts lib/arena/llm/schema.test.ts
git commit -m "feat(arena): widen arena assets to the six target majors"
```

---

## Task 2: Decision becomes a bounded list of actions

**Files:**
- Modify: `lib/arena/llm/schema.ts:14-32`
- Test: `lib/arena/llm/schema.test.ts`

The current `decisionSchema` (single action, flat) becomes `actionSchema`, and `decisionSchema` wraps a `z.array(actionSchema).max(4)`. `Action` is the per-trade shape; `LlmDecision` is `{ actions: Action[] }`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/arena/llm/schema.test.ts`:

```typescript
import { decisionSchema, actionSchema } from "./schema";

const action = {
  action: "open", side: "long", asset: "BTC", leverage: 10,
  stakeFracPct: 0.1, stopLossPct: 0.02, takeProfitPct: 0.04,
  confidence: 0.7, reasoning: "reclaim",
} as const;

it("parses a multi-action decision (open 2, close 1)", () => {
  const d = decisionSchema.parse({ actions: [
    { ...action, asset: "BTC" },
    { ...action, asset: "ETH" },
    { ...action, action: "close", asset: "SOL" },
  ] });
  expect(d.actions).toHaveLength(3);
  expect(d.actions[0].asset).toBe("BTC");
});

it("accepts an empty action list (a do-nothing tick)", () => {
  expect(decisionSchema.parse({ actions: [] }).actions).toHaveLength(0);
});

it("rejects more than four actions (the position-slot cap)", () => {
  const five = Array.from({ length: 5 }, () => action);
  expect(decisionSchema.safeParse({ actions: five }).success).toBe(false);
});

it("validates each action against the per-trade schema", () => {
  expect(actionSchema.safeParse({ ...action, leverage: 0 }).success).toBe(false);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run lib/arena/llm/schema.test.ts`
Expected: FAIL (`actionSchema` not exported; `decisionSchema` has no `actions`).

- [ ] **Step 3: Restructure the schema**

Replace `lib/arena/llm/schema.ts:14-32` (the `decisionSchema` block) with:

```typescript
export const actionSchema = z.object({
  action: z.enum(["open", "close", "hold"]),
  side: z.enum(["long", "short"]),
  asset: z.enum(ARENA_ASSETS),
  leverage: z.number().int().min(1).max(50),
  stakeFracPct: z.number().min(0).max(1),
  stopLossPct: z.number().min(0).max(0.1),
  takeProfitPct: z.number().min(0).max(0.2),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});

export type LlmAction = z.infer<typeof actionSchema>;

// One tick may emit up to 4 actions (the on-chain position-slot count): e.g.
// close a loser and open two new ideas in a single decision. An empty list is
// a valid do-nothing tick.
export const decisionSchema = z.object({
  actions: z.array(actionSchema).max(4),
});

export type LlmDecision = z.infer<typeof decisionSchema>;
```

Keep the existing `DECISION_ACTION`, `DECISION_SIDE`, `toBps`, `toConfidence100` exports below unchanged.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run lib/arena/llm/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arena/llm/schema.ts lib/arena/llm/schema.test.ts
git commit -m "feat(arena): decision schema is a bounded list of actions"
```

---

## Task 3: Asset → market routing map

**Files:**
- Create: `lib/arena/markets.ts`
- Test: `lib/arena/markets.test.ts`

`feed` values are the MagicBlock oracle PDAs. SOL's is known (`ENYweb…`); the rest are placeholders until Task 8 fills them — but the marketId assignment and helpers are fixed and testable now. Placeholders use the system program id so an unconfigured asset fails loudly on-chain rather than silently routing to SOL.

- [ ] **Step 1: Write the failing test**

Create `lib/arena/markets.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ASSET_MARKETS, marketForAsset, assetForMarket, activeMarkets } from "./markets";
import { ARENA_ASSETS } from "./llm/schema";

describe("asset/market routing", () => {
  it("maps every arena asset to a unique market id", () => {
    const ids = ARENA_ASSETS.map((a) => ASSET_MARKETS[a].marketId);
    expect(new Set(ids).size).toBe(ARENA_ASSETS.length);
    expect(Math.max(...ids)).toBeLessThanOrEqual(7); // MAX_MARKETS = 8
  });

  it("keeps SOL on market 0 (the existing live market)", () => {
    expect(ASSET_MARKETS.SOL.marketId).toBe(0);
  });

  it("round-trips asset <-> marketId", () => {
    expect(marketForAsset("BTC").marketId).toBe(ASSET_MARKETS.BTC.marketId);
    expect(assetForMarket(ASSET_MARKETS.ETH.marketId)).toBe("ETH");
  });

  it("activeMarkets lists only assets with a real (non-placeholder) feed", () => {
    const ids = activeMarkets().map((m) => m.marketId);
    expect(ids).toContain(0); // SOL is configured
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run lib/arena/markets.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Create the map**

Create `lib/arena/markets.ts`:

```typescript
// lib/arena/markets.ts
//
// Single source of truth routing an arena asset to its on-chain market id +
// oracle feed PDA. The worker uses this to submit each decision action to the
// right market; the crank uses it to tick every active market; the brief uses
// assetForMarket() to label positions. Feeds are MagicBlock pricing_oracle
// Lazer PDAs (same mechanism as the SOL feed). Assets whose feed is still the
// UNSET placeholder are not yet stood up on-chain and are filtered by
// activeMarkets() (and would fail loudly if routed to).
import { PublicKey } from "@solana/web3.js";
import { ARENA_ASSETS, type ArenaAsset } from "./llm/schema";

// System program id == "not configured yet" sentinel (Task 8 replaces these).
const UNSET = new PublicKey("11111111111111111111111111111111");

const SOL_FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");

export interface MarketRoute {
  marketId: number;
  feed: PublicKey;
}

// marketId is FIXED per asset (it is an on-chain PDA seed; never renumber a
// live market). SOL=0 is the original live market.
export const ASSET_MARKETS: Record<ArenaAsset, MarketRoute> = {
  SOL: { marketId: 0, feed: SOL_FEED },
  BTC: { marketId: 1, feed: UNSET },
  ETH: { marketId: 2, feed: UNSET },
  BNB: { marketId: 3, feed: UNSET },
  XRP: { marketId: 4, feed: UNSET },
  DOGE: { marketId: 5, feed: UNSET },
};

const BY_MARKET: Record<number, ArenaAsset> = Object.fromEntries(
  ARENA_ASSETS.map((a) => [ASSET_MARKETS[a].marketId, a]),
) as Record<number, ArenaAsset>;

export function marketForAsset(asset: ArenaAsset): MarketRoute {
  return ASSET_MARKETS[asset];
}

export function assetForMarket(marketId: number): ArenaAsset | undefined {
  return BY_MARKET[marketId];
}

export function isFeedConfigured(asset: ArenaAsset): boolean {
  return !ASSET_MARKETS[asset].feed.equals(UNSET);
}

/** Markets that are actually stood up on-chain (feed configured). */
export function activeMarkets(): Array<{ asset: ArenaAsset } & MarketRoute> {
  return ARENA_ASSETS.filter(isFeedConfigured).map((asset) => ({
    asset,
    ...ASSET_MARKETS[asset],
  }));
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run lib/arena/markets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arena/markets.ts lib/arena/markets.test.ts
git commit -m "feat(arena): asset->market routing map (feeds filled at rollout)"
```

---

## Task 4: Floor evaluates a list of actions

**Files:**
- Modify: `lib/arena/llm/floor.ts:62-129`
- Test: `lib/arena/llm/floor.test.ts`

Extract the existing single-decision body into `evaluateAction(action, params, liveState, now)` (unchanged logic, takes one `LlmAction`). Add `evaluateActions(decision, params, liveState, now)` that maps each action to `{ asset, outcome }`, decrementing a running open budget so a multi-open tick that would breach `maxTradesPerDay` skips the overflow opens (mirrors the on-chain sequential `trades_today` increment). CLOSE/HOLD do not consume the budget.

- [ ] **Step 1: Write the failing tests**

Add to `lib/arena/llm/floor.test.ts`:

```typescript
import { evaluateActions } from "./floor";

const params = {
  maxLeverage: 50, minStopBps: 50, maxStopBps: 300, maxStakeFracBps: 2000,
  maxTradesPerDay: 2, decisionCooldownSecs: 0, confidenceFloor: 40,
};
const live = { halted: false, tradesToday: 0, lastDecisionTs: 0 };
const open = (asset: string) => ({
  action: "open", side: "long", asset, leverage: 10, stakeFracPct: 0.1,
  stopLossPct: 0.02, takeProfitPct: 0.04, confidence: 0.8, reasoning: "x",
});

it("evaluates each action and tags it with its asset", () => {
  const out = evaluateActions(
    { actions: [open("BTC"), { ...open("SOL"), action: "close" }] },
    params, live, 1_000,
  );
  expect(out.map((o) => o.asset)).toEqual(["BTC", "SOL"]);
  expect(out[0].outcome.kind).toBe("send");
  expect(out[1].outcome.kind).toBe("send"); // close always sends
});

it("skips opens that would breach the daily trade cap within one tick", () => {
  const out = evaluateActions(
    { actions: [open("BTC"), open("ETH"), open("SOL")] }, // cap is 2
    params, live, 1_000,
  );
  expect(out[0].outcome.kind).toBe("send");
  expect(out[1].outcome.kind).toBe("send");
  expect(out[2].outcome).toEqual({ kind: "skip", reason: "TradeCap" });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run lib/arena/llm/floor.test.ts -t "evaluates each action"`
Expected: FAIL (`evaluateActions` not exported).

- [ ] **Step 3: Refactor + add `evaluateActions`**

In `lib/arena/llm/floor.ts`: rename the existing `evaluateDecision` to `evaluateAction` and change its first param type from `LlmDecision` to `LlmAction` (the body is unchanged — it already reads `decision.action/side/...`). Then append:

```typescript
import type { LlmDecision, LlmAction } from "./schema";

export interface ActionOutcome {
  asset: LlmAction["asset"];
  outcome: FloorOutcome;
}

/** Evaluate every action in a tick. Opens draw down a running daily-trade
 *  budget so a multi-open tick stops submitting once the cap is hit (matches
 *  the on-chain sequential trades_today increment). CLOSE/HOLD never consume
 *  the budget. Cooldown is checked against the pre-tick lastDecisionTs, so a
 *  multi-open tick requires decisionCooldownSecs = 0 (see the spec). */
export function evaluateActions(
  decision: LlmDecision,
  params: LlmFloorParams,
  state: LlmBotLiveState,
  nowSecs: number,
): ActionOutcome[] {
  let opensSoFar = 0;
  return decision.actions.map((action) => {
    const liveForAction: LlmBotLiveState = {
      ...state,
      tradesToday: state.tradesToday + opensSoFar,
    };
    const outcome = evaluateAction(action, params, liveForAction, nowSecs);
    if (outcome.kind === "send" && outcome.args.action === DECISION_ACTION.open) {
      opensSoFar += 1;
    }
    return { asset: action.asset, outcome };
  });
}
```

Add `DECISION_ACTION` to the existing `./schema` import if not already present.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run lib/arena/llm/floor.test.ts`
Expected: PASS (including the pre-existing single-action tests, now exercising `evaluateAction`). Update any pre-existing test that imported `evaluateDecision` to import `evaluateAction`.

- [ ] **Step 5: Commit**

```bash
git add lib/arena/llm/floor.ts lib/arena/llm/floor.test.ts
git commit -m "feat(arena): floor evaluates a list of actions with a trade budget"
```

---

## Task 5: Loop submits one routed apply_decision per action

**Files:**
- Modify: `lib/arena/llm/loop.ts:44-115`
- Test: `lib/arena/llm/loop.test.ts`

`runBotDecision` keeps the day-roll heartbeat gate (Task already shipped), then: one `decide()` → `evaluateActions` → for each `{asset, outcome}` with `kind==='send'`, call `deps.submit({ persona, asset, args })` (the worker maps asset→marketId+feed). Persist one record per action. `RunResult` gains `{ status: "acted"; results }`.

- [ ] **Step 1: Write the failing test**

Add to `lib/arena/llm/loop.test.ts` (the helpers `deps`, `fakeBot`, `cfg` already exist; `decide` now returns `{ actions: [...] }`):

```typescript
it("submits one routed apply_decision per surviving action", async () => {
  const d = deps({
    decide: vi.fn(async () => ({ actions: [
      { action: "open", side: "long", asset: "BTC", leverage: 10, stakeFracPct: 0.1,
        stopLossPct: 0.02, takeProfitPct: 0.04, confidence: 0.8, reasoning: "a" },
      { action: "close", side: "long", asset: "SOL", leverage: 1, stakeFracPct: 0,
        stopLossPct: 0.01, takeProfitPct: 0, confidence: 0.6, reasoning: "b" },
    ] })),
  });
  const res = await runBotDecision(cfg, d);
  expect(res.status).toBe("acted");
  expect(d.submit).toHaveBeenCalledTimes(2);
  expect((d.submit as any).mock.calls[0][0].asset).toBe("BTC");
  expect((d.submit as any).mock.calls[1][0].asset).toBe("SOL");
});

it("submits nothing for an all-hold (empty) tick", async () => {
  const d = deps({ decide: vi.fn(async () => ({ actions: [] })) });
  const res = await runBotDecision(cfg, d);
  expect(res.status).toBe("skip");
  expect(d.submit).not.toHaveBeenCalled();
});
```

Update the existing `deps()` default `decide` mock to return `{ actions: [openDecision()] }` and the existing "submits an operator-signed decision" assertions to expect a single routed submit (`asset` present, `args` as before).

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run lib/arena/llm/loop.test.ts`
Expected: FAIL (loop still expects a single flat decision).

- [ ] **Step 3: Update the loop**

In `lib/arena/llm/loop.ts`: change `LlmLoopDeps.submit` to `(p: { persona: string; asset: ArenaAsset; args: ApplyDecisionArgs }) => Promise<string | null>`. Replace the post-heartbeat body of `runBotDecision` (from `const decision = ...` onward) with:

```typescript
  const decision = await deps.decide(prompt);
  if (!decision) return { status: "no-decision" };

  const outcomes = evaluateActions(decision, floorParamsFromBot(bot), liveStateFromBot(bot), deps.now());
  const sends = outcomes.filter((o) => o.outcome.kind === "send");
  if (sends.length === 0) {
    // persist skips for the UI "why" layer, then no-op
    for (const o of outcomes) {
      if (o.outcome.kind === "skip") {
        await deps.persistDecision?.({ persona: cfg.persona, asset: o.asset, decision: pickAction(decision, o.asset), sent: false, reason: o.outcome.reason });
      }
    }
    return { status: "skip", reason: outcomes[0]?.outcome.kind === "skip" ? outcomes[0].outcome.reason : "Hold" };
  }

  const results: Array<{ asset: ArenaAsset; signature: string | null; args: ApplyDecisionArgs }> = [];
  for (const o of sends) {
    if (o.outcome.kind !== "send") continue;
    const signature = await deps.submit({ persona: cfg.persona, asset: o.asset, args: o.outcome.args });
    await deps.persistDecision?.({ persona: cfg.persona, asset: o.asset, decision: pickAction(decision, o.asset), sent: true, args: o.outcome.args, signature });
    results.push({ asset: o.asset, signature, args: o.outcome.args });
  }
  return { status: "acted", results };
```

Add a `pickAction` helper (returns the first action for an asset, for the persistence record) and extend `DecisionRecord` with `asset: ArenaAsset` and `decision: LlmAction`. Add `"acted"` to `RunResult`. Import `evaluateActions`, `ArenaAsset`, `LlmAction`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run lib/arena/llm/loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arena/llm/loop.ts lib/arena/llm/loop.test.ts
git commit -m "feat(arena): loop submits one routed apply_decision per action"
```

---

## Task 6: Brief renders the multi-asset book with asset labels

**Files:**
- Modify: `lib/arena/llm/brief.ts:134-155`
- Test: `lib/arena/llm/brief.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/arena/llm/brief.test.ts`:

```typescript
import { renderBookBlock } from "./brief";

it("labels open positions by asset, not market number", () => {
  const bot = { balanceUsd: 900, equityHighUsd: 1000, feesUsd: 1, fundingPaidUsd: 0,
    tradesToday: 1, halted: false,
    positions: [{ active: true, marketId: 1, side: "long", leverage: 20,
      entryPrice: 64000, stakeUsd: 100, stopPrice: 62000 }] } as any;
  expect(renderBookBlock(bot)).toContain("long BTC 20x");
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run lib/arena/llm/brief.test.ts -t "labels open positions by asset"`
Expected: FAIL (renders `mkt1`).

- [ ] **Step 3: Use `assetForMarket`**

In `lib/arena/llm/brief.ts` import `assetForMarket` from `../markets`, and in `renderBookBlock` replace the market label expression `p.marketId === 0 ? "SOL" : \`mkt${p.marketId}\`` with `assetForMarket(p.marketId) ?? \`mkt${p.marketId}\``.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run lib/arena/llm/brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arena/llm/brief.ts lib/arena/llm/brief.test.ts
git commit -m "feat(arena): brief labels positions by asset"
```

---

## Task 7: Worker routes each action to its market + feed

**Files:**
- Modify: `scripts/arena/llm-operator-worker.ts:73-141`
- Test: manual (worker is integration glue; covered by Task 5 unit tests + a typecheck)

- [ ] **Step 1: Update `depsFor.submit` to route by asset**

In `scripts/arena/llm-operator-worker.ts`, import `marketForAsset` from `../../lib/arena/markets`, and change the `submit` dep so it derives the market + feed from the action's asset instead of the global `MARKET_ID`/`FEED`:

```typescript
    submit: async ({ persona, asset, args }) => {
      const { marketId, feed } = marketForAsset(asset);
      const ix = buildApplyDecisionIx({ programId: PROGRAM, persona, operator: operator.publicKey, feed, marketId, args });
      const tx = new Transaction().add(ix);
      tx.feePayer = operator.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(operator);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    },
```

Update the per-tick log to print each action's asset + result, and update `persistDecision` to record `rec.asset`. The top-level `MARKET_ID`/`FEED` constants stay for the day-roll heartbeat (which still targets SOL/market 0).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 3: Full arena suite**

Run: `npx vitest run lib/arena`
Expected: PASS except the pre-existing `client.live.test.ts` (Anthropic credits).

- [ ] **Step 4: Commit**

```bash
git add scripts/arena/llm-operator-worker.ts
git commit -m "feat(arena): worker routes each action to its asset's market+feed"
```

---

## Task 8: Discover + wire the per-asset oracle feed PDAs

**Files:**
- Create: `scripts/arena/_probe-oracle-feeds.ts`
- Modify: `lib/arena/markets.ts` (fill `feed` pubkeys)

- [ ] **Step 1: Probe candidate feeds**

Create `scripts/arena/_probe-oracle-feeds.ts` modeled on `scripts/arena/_spike-oracle-read.ts` (reads price@73 / ts@93 on the mainnet ER `https://eu.magicblock.app`). Populate `CANDIDATES: Record<string, string>` with the MagicBlock `pricing_oracle` PDAs for BTC/ETH/BNB/XRP/DOGE (obtain from MagicBlock oracle docs or the team; the SOL one is `ENYweb…`). For each, print owner/dataLen/priceUsd/ageSec and assert age < 60s and a plausible price band.

Run: `npx tsx scripts/arena/_probe-oracle-feeds.ts`
Expected: each configured feed prints a fresh, plausible price. Drop any asset whose feed is missing/stale (fall back to the Lazer-publisher route in the spec, or trim it).

- [ ] **Step 2: Fill the map**

Replace the `UNSET` placeholders in `lib/arena/markets.ts` `ASSET_MARKETS` with the verified feed PDAs for each confirmed asset.

- [ ] **Step 3: Verify routing tests still pass**

Run: `npx vitest run lib/arena/markets.test.ts`
Expected: PASS, and `activeMarkets()` now includes every configured asset.

- [ ] **Step 4: Commit**

```bash
git add scripts/arena/_probe-oracle-feeds.ts lib/arena/markets.ts
git commit -m "feat(arena): wire verified per-asset oracle feed PDAs"
```

---

## Task 9: Stand up the markets on-chain (mainnet)

**Files:**
- Create: `scripts/arena/init-markets.ts`

- [ ] **Step 1: Write the setup script**

Create `scripts/arena/init-markets.ts` mirroring `scripts/arena/init-devnet.ts:198-300` (the `init_market` + `delegate_market` calls), but iterating `activeMarkets()` from `lib/arena/markets.ts` and skipping market 0 (already live). For each asset: derive the market PDA (`["market", [marketId]]`), call `program.methods.initMarket(marketId, feed)`, then `program.methods.delegateMarket(marketId)` with the ER validator remaining-account, signed by the admin (`ARENA_ADMIN_KEYPAIR_PATH`, default `~/.config/solana/id.json`). Idempotent: skip a market that already exists (catch the "already in use" account error).

- [ ] **Step 2: Dry-run against the program ID, then run on mainnet**

Run: `ARENA_ER_ENDPOINT=https://eu.magicblock.app npx tsx scripts/arena/init-markets.ts`
Expected: `init_market` + `delegate_market` confirmations for BTC/ETH/BNB/XRP/DOGE; re-running prints "already exists — skipping".

- [ ] **Step 3: Verify each market reads on the ER**

Run: `npx tsx scripts/arena/_probe-oracle-feeds.ts` (already fresh) and confirm each new market PDA exists via a `getAccountInfo` check (add a one-line print to the init script).

- [ ] **Step 4: Commit**

```bash
git add scripts/arena/init-markets.ts
git commit -m "feat(arena): init-markets script for the new majors (mainnet setup)"
```

---

## Task 10: Crank ticks every active market

**Files:**
- Modify: `lib/arena/crank-deps.ts:40-51,221-224`

- [ ] **Step 1: Source feeds + markets from the routing map**

In `lib/arena/crank-deps.ts`, replace the local `SOL_FEED`/`FEEDS` block with a `FEEDS` built from `ASSET_MARKETS` (import from `@/lib/arena/markets`): `Object.fromEntries(activeMarkets().map((m) => [m.marketId, m.feed]))`. Change `listMarkets()` to return one `CrankMarket` per `activeMarkets()` entry (each with the same `botPubkeys`), instead of the single env `MARKET_ID`. Keep the `commit_state` per-market loop wiring (it already takes a `MARKET_ID`; iterate `activeMarkets()` for commits too).

- [ ] **Step 2: Typecheck + arena suite**

Run: `npm run typecheck && npx vitest run lib/arena`
Expected: clean / PASS (minus the known live test).

- [ ] **Step 3: Verify the crank folds prices for a new market**

Deploy/run the crank against the ER and confirm (via `_probe-llm-bot-state` or a market-state read) that the BTC market candle ring advances.

- [ ] **Step 4: Commit**

```bash
git add lib/arena/crank-deps.ts
git commit -m "feat(arena): crank ticks every active market"
```

---

## Task 11: Tune the bots for multi-action, higher leverage

**Files:**
- Modify: `scripts/arena/bot-tuning.ts:50-74`

- [ ] **Step 1: Update tunings**

In `scripts/arena/bot-tuning.ts`, for the aggressive bots set `cooldownSecs: 0` (enables multi-open per tick), raise `maxLeverage` (e.g. `50`), and raise `maxTradesPerDay` (e.g. `400`+). Keep `dailyLossBps` as the kill-switch and `maxStakeBps` small. Leave the patient bot lower-leverage with a non-zero cooldown if you want it calmer. Update the header comment.

- [ ] **Step 2: Push on-chain**

Run: `npm run arena:tune`
Expected: `before → after` shows `decisionCooldownSecs`, `maxLeverage`, `maxTradesPerDay` changes for the targeted bots; others "no change".

- [ ] **Step 3: Commit**

```bash
git add scripts/arena/bot-tuning.ts
git commit -m "tune(arena): zero cooldown + higher leverage for multi-action bots"
```

---

## Task 12: Deploy + verify end-to-end

- [ ] **Step 1: Deploy the worker**

Run: `railway up -s arena-llm-operator --ci -m "feat(arena): multi-asset multi-action bots"`
Expected: `Deploy complete`.

- [ ] **Step 2: Verify multi-asset, multi-action trades land**

Watch the worker logs (`railway logs -s arena-llm-operator`) for a tick that submits actions on >1 asset, then read on-chain state (`railway run -s arena-llm-operator npx tsx scripts/arena/_probe-llm-bot-state.ts`) and confirm a bot now holds positions in multiple markets (e.g. BTC + ETH) with the chosen leverage.

- [ ] **Step 3: Confirm guardrails**

Confirm `dailyLossLimitBps` still halts a bot that draws down, and the daily heartbeat clears it next day (already shipped). Confirm the crank is maintaining stops/liq on every market.

---

## Self-Review

**Spec coverage:** schema list (T1-2), routing map (T3), floor list (T4), loop multi-submit (T5), brief labels (T6), worker routing (T7), feeds (T8), on-chain markets (T9), crank multi-market (T10), tune (T11), deploy/verify (T12). The "quality vs cost" reasoning knob (spec §8) is a one-line `client.ts` change deferred to A/B testing, not a required task — call it out during execution if multi-action reads look weak.

**Placeholder scan:** Feed PDAs are an explicit discovery task (T8), not a code placeholder; the map ships with a loud `UNSET` sentinel so an unconfigured asset can never silently route to SOL.

**Type consistency:** `LlmAction`/`LlmDecision` (T2) flow through `evaluateAction`/`evaluateActions` → `ActionOutcome` (T4) → `submit({persona, asset, args})` (T5/T7) → `marketForAsset` (T3/T7). `assetForMarket` (T3) is used by the brief (T6) and crank (T10).
