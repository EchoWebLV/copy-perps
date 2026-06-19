# Flash v2 Migration — Phase 1 (venue foundation + onboarding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed `lib/flash-v2/*` venue foundation that can drive a full **user-signed** Flash Trade v2 lifecycle (onboard → deposit → open → close) on devnet, behind `FEATURE_FLASH_V2`, with every pure/HTTP unit tested.

**Architecture:** A REST client over Flash v2's public transaction-builder API (`https://flashapi.trade/v2`) returns unsigned versioned txs; pure helpers handle the MagicBlock-ER quirks (dual-RPC routing, balance accounting, entry-spread sizing, mark-price PnL, 3-channel error normalization). A `PerpVenue` interface fronts it so later phases swap routes by import, not rewrite. **No Pacifica code is touched in Phase 1** — this is purely additive and flag-gated.

**Tech Stack:** TypeScript (strict), `@solana/web3.js` (VersionedTransaction), Vitest (co-located `*.test.ts`, `vi.stubGlobal` for fetch), Next.js env.

**Spec:** [docs/superpowers/specs/2026-06-19-flash-v2-migration-design.md](../specs/2026-06-19-flash-v2-migration-design.md)

**Scope boundaries:**
- IN: constants/flag, types, errors, dual-RPC, builder client, query client, accounting, sizing, PnL, onboarding lifecycle, the `PerpVenue` interface + a user-signed Flash v2 implementation, a devnet smoke script.
- OUT (later phases): **session keys / server-driven copy** (Phase 2 — needs a GPL-session research pass), route rewiring (`app/api/*`), live-WS provider, two-phase withdraw, deleting Pacifica.

**Test command:** `npx vitest run <path>` · **Typecheck:** `npx tsc --noEmit`

**Pre-flight note for the executor:** The Flash v2 request/response *shapes* below are taken from `docs.flash.trade` (2026-06-19), not yet from live calls. Task 0 confirms them against `flash-trade/examples-v2` (`lifecycle.ts`, `packages/flash-v2`) before you rely on them. If a field name differs (e.g. the documented `youRecieveUsdUi` typo is intentional — do not "fix" it), update the type in Task 2 and keep going.

---

### Task 0: Confirm the Flash v2 integration surface against the reference client

**Files:**
- Create: `docs/superpowers/flash-v2-surface-notes.md` (scratch notes, committed)

- [ ] **Step 1: Read the reference walkthrough**

Fetch and read `flash-trade/examples-v2` `lifecycle.ts`, `GOTCHAS.md`, and `packages/flash-v2` types. Capture: exact endpoint paths, request bodies, and response field names for `init-basket`, `init-deposit-ledger`, `delegate-basket`, `deposit-direct`, `open-position`, `close-position`, `GET /positions/owner/{wallet}`, `GET /prices`, `GET /raw/markets`. Confirm the unsigned-tx response field name (`transactionBase64` vs `transaction`) and how `basketPubkey` is read to detect onboarding.

- [ ] **Step 2: Record findings**

Write the confirmed shapes into `docs/superpowers/flash-v2-surface-notes.md` as a short reference table. Note any divergence from the spec's §4 table.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/flash-v2-surface-notes.md
git commit -m "docs(flash-v2): confirmed integration surface from examples-v2"
```

If a shape differs from what later tasks assume, adjust those tasks' types/strings as you reach them. Do not block — the notes are the source of truth from here.

---

### Task 1: Constants, cluster resolvers, and feature flag

**Files:**
- Create: `lib/flash-v2/constants.ts`
- Test: `lib/flash-v2/constants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/constants.test.ts
import { describe, expect, it } from "vitest";
import { resolveProgramId, resolveErRpc, FLASH_V2_REST_BASE, USDC_MINT } from "./constants";

describe("flash-v2 constants", () => {
  it("resolves the mainnet program id", () => {
    expect(resolveProgramId("mainnet")).toBe("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");
  });
  it("resolves the devnet program id", () => {
    expect(resolveProgramId("devnet")).toBe("FMTgsEDaPPfJi1PKD67McLTC5n833T4irbBP53LLxtvj");
  });
  it("defaults the ER rpc for devnet", () => {
    expect(resolveErRpc("devnet")).toContain("magicblock.app");
  });
  it("exposes the public REST base and USDC mint", () => {
    expect(FLASH_V2_REST_BASE).toBe("https://flashapi.trade/v2");
    expect(USDC_MINT).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/constants.test.ts`
Expected: FAIL — `Cannot find module './constants'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/constants.ts
export type FlashCluster = "devnet" | "mainnet";

export const FLASH_V2_REST_BASE =
  process.env.FLASH_V2_REST_URL ?? "https://flashapi.trade/v2";

/** Mainnet USDC. Devnet uses a test mint — override with FLASH_V2_USDC_MINT. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const FLASH_V2_USDC_MINT = process.env.FLASH_V2_USDC_MINT ?? USDC_MINT;

/** Protocol-fixed MagicBlock validator the basket delegates to (GOTCHAS). */
export const FLASH_V2_ER_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

export const FLASH_V2_CLUSTER: FlashCluster =
  process.env.FLASH_V2_CLUSTER === "mainnet" ? "mainnet" : "devnet";

/** Gate: while false, nothing in this module is used by routes. */
export const FEATURE_FLASH_V2 = process.env.FEATURE_FLASH_V2 === "true";

export function resolveProgramId(cluster: FlashCluster): string {
  return cluster === "mainnet"
    ? "FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV"
    : "FMTgsEDaPPfJi1PKD67McLTC5n833T4irbBP53LLxtvj";
}

export function resolveErRpc(cluster: FlashCluster): string {
  if (process.env.FLASH_V2_ER_RPC) return process.env.FLASH_V2_ER_RPC;
  return cluster === "mainnet"
    ? "https://mainnet.magicblock.app"
    : "https://devnet.magicblock.app";
}

export function resolveBaseRpc(): string {
  return (
    process.env.FLASH_V2_BASE_RPC ??
    process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
    "https://api.devnet.solana.com"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/constants.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/constants.ts lib/flash-v2/constants.test.ts
git commit -m "feat(flash-v2): constants, cluster resolvers, FEATURE_FLASH_V2 flag"
```

---

### Task 2: Shared venue + wire types

**Files:**
- Create: `lib/flash-v2/types.ts`

- [ ] **Step 1: Write the types** (verified by typecheck, not a unit test — pure declarations)

```ts
// lib/flash-v2/types.ts
import type { VersionedTransaction } from "@solana/web3.js";

export type Side = "long" | "short";
export type OrderType = "market" | "limit";

/** Layer a tx must be submitted on (GOTCHAS: mixing fails). */
export type RpcLayer = "base" | "er";

export interface UnsignedTx {
  tx: VersionedTransaction;
  layer: RpcLayer;
}

export interface Quote {
  entryPriceUi?: number;
  liquidationPriceUi?: number;
  feeUsdUi?: number;
  /** Documented API typo — kept verbatim, do not rename. */
  youRecieveUsdUi?: number | null;
}

export interface VenuePosition {
  positionKey: string;
  symbol: string;
  side: Side;
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  leverage: number;
}

export interface VenueBalance {
  availableUsdc: number;
  ledgerDeposits: number;
  basketDebits: number;
  basketPendingCredits: number;
}

export interface VenueMarket {
  symbol: string;
  maxLeverage: number;
}

export interface OnboardStep {
  name: "init-basket" | "init-deposit-ledger" | "delegate-basket";
  unsigned: UnsignedTx;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/flash-v2/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/flash-v2/types.ts
git commit -m "feat(flash-v2): shared venue + wire types"
```

---

### Task 3: Error normalization (3 channels + typed guards)

**Files:**
- Create: `lib/flash-v2/errors.ts`
- Test: `lib/flash-v2/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/errors.test.ts
import { describe, expect, it } from "vitest";
import {
  normalizeFlashError,
  FlashWithdrawSettlingError,
  FlashOnboardingRequiredError,
} from "./errors";

describe("normalizeFlashError", () => {
  it("returns null when a 200 body has no err", () => {
    expect(normalizeFlashError({ httpStatus: 200, body: { ok: true } })).toBeNull();
  });
  it("classifies a 200 body.err string (trade/preview channel)", () => {
    const e = normalizeFlashError({ httpStatus: 200, body: { err: "something failed" } });
    expect(e).not.toBeNull();
    expect(e!.code).toBe("unknown");
  });
  it("maps 0xbc4 / AccountNotInitialized to a settling timing error", () => {
    const e = normalizeFlashError({ httpStatus: 500, body: "custom program error: 0xbc4" });
    expect(e).toBeInstanceOf(FlashWithdrawSettlingError);
  });
  it("maps a missing-basket message to onboarding required", () => {
    const e = normalizeFlashError({ httpStatus: 400, body: "basket account not initialized" });
    expect(e).toBeInstanceOf(FlashOnboardingRequiredError);
  });
  it("wraps a bare 500 as an unknown error", () => {
    const e = normalizeFlashError({ httpStatus: 500, body: "" });
    expect(e!.code).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/errors.test.ts`
Expected: FAIL — `Cannot find module './errors'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/errors.ts
export type FlashErrorCode =
  | "onboarding_required"
  | "settling"
  | "session_expired"
  | "unknown";

export class FlashV2Error extends Error {
  constructor(message: string, readonly code: FlashErrorCode) {
    super(message);
    this.name = "FlashV2Error";
  }
}
export class FlashOnboardingRequiredError extends FlashV2Error {
  constructor(message: string) { super(message, "onboarding_required"); }
}
export class FlashWithdrawSettlingError extends FlashV2Error {
  constructor(message: string) { super(message, "settling"); }
}
export class FlashSessionExpiredError extends FlashV2Error {
  constructor(message: string) { super(message, "session_expired"); }
}

/**
 * Flash v2 reports errors on three channels (GOTCHAS):
 *  - trade/preview: HTTP 200 with `body.err`
 *  - trigger/limit: HTTP 400 plain text
 *  - setup/withdraw: bare HTTP 500
 * Returns null when there is no error. String matching is best-effort and
 * refined against real devnet responses in Task 12.
 */
export function normalizeFlashError(args: {
  httpStatus: number;
  body: unknown;
}): FlashV2Error | null {
  let message: string | null = null;
  if (args.httpStatus === 200) {
    const b = args.body as { err?: unknown } | null;
    if (b && typeof b === "object" && b.err) message = String(b.err);
  } else {
    message =
      typeof args.body === "string" && args.body
        ? args.body
        : `HTTP ${args.httpStatus}`;
  }
  if (message == null) return null;
  return classify(message);
}

function classify(message: string): FlashV2Error {
  const m = message.toLowerCase();
  if (m.includes("0xbc4") || m.includes("accountnotinitialized")) {
    return new FlashWithdrawSettlingError(message);
  }
  if (m.includes("basket") && (m.includes("not init") || m.includes("uninitialized"))) {
    return new FlashOnboardingRequiredError(message);
  }
  if (m.includes("session") && m.includes("expired")) {
    return new FlashSessionExpiredError(message);
  }
  return new FlashV2Error(message, "unknown");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/errors.ts lib/flash-v2/errors.test.ts
git commit -m "feat(flash-v2): 3-channel error normalization + typed guards"
```

---

### Task 4: Dual-RPC routing

**Files:**
- Create: `lib/flash-v2/rpc.ts`
- Test: `lib/flash-v2/rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/rpc.test.ts
import { describe, expect, it } from "vitest";
import { endpointForLayer } from "./rpc";

describe("endpointForLayer", () => {
  const opts = { baseRpc: "https://base.example", erRpc: "https://er.example" };
  it("routes trade ops to the ER endpoint", () => {
    expect(endpointForLayer("er", opts)).toBe("https://er.example");
  });
  it("routes setup/withdraw ops to the base endpoint", () => {
    expect(endpointForLayer("base", opts)).toBe("https://base.example");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/rpc.test.ts`
Expected: FAIL — `Cannot find module './rpc'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/rpc.ts
import { Connection } from "@solana/web3.js";
import { resolveBaseRpc, resolveErRpc, FLASH_V2_CLUSTER } from "./constants";
import type { RpcLayer } from "./types";

export function endpointForLayer(
  layer: RpcLayer,
  opts: { baseRpc: string; erRpc: string },
): string {
  return layer === "er" ? opts.erRpc : opts.baseRpc;
}

const cache: Partial<Record<RpcLayer, Connection>> = {};

/** Trades → ER; setup/withdraw → base. Never mix (GOTCHAS). */
export function getConnection(layer: RpcLayer): Connection {
  if (cache[layer]) return cache[layer]!;
  const endpoint = endpointForLayer(layer, {
    baseRpc: resolveBaseRpc(),
    erRpc: resolveErRpc(FLASH_V2_CLUSTER),
  });
  // "processed": the ER is a single validator with no consensus to wait on.
  const conn = new Connection(endpoint, layer === "er" ? "processed" : "confirmed");
  cache[layer] = conn;
  return conn;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/rpc.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/rpc.ts lib/flash-v2/rpc.test.ts
git commit -m "feat(flash-v2): dual-RPC routing (base vs ER)"
```

---

### Task 5: REST transaction-builder client

**Files:**
- Create: `lib/flash-v2/builder.ts`
- Test: `lib/flash-v2/builder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/builder.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { postBuilder } from "./builder";
import { FlashV2Error } from "./errors";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status, json: async () => body })),
  );
}

describe("postBuilder", () => {
  it("deserializes the returned base64 transaction", async () => {
    const sentinel = {} as VersionedTransaction;
    vi.spyOn(VersionedTransaction, "deserialize").mockReturnValue(sentinel);
    mockFetch(200, { transactionBase64: "AA==" });
    const out = await postBuilder("/transaction-builder/deposit-direct", { owner: "x" });
    expect(out.tx).toBe(sentinel);
  });
  it("throws a typed error when the 200 body carries err", async () => {
    mockFetch(200, { err: "insufficient collateral" });
    await expect(
      postBuilder("/transaction-builder/open-position", {}),
    ).rejects.toBeInstanceOf(FlashV2Error);
  });
  it("throws when no transaction is returned", async () => {
    mockFetch(200, { ok: true });
    await expect(postBuilder("/transaction-builder/init-basket", {})).rejects.toThrow(
      /no transaction/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/builder.test.ts`
Expected: FAIL — `Cannot find module './builder'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/builder.ts
import { Buffer } from "node:buffer";
import { VersionedTransaction } from "@solana/web3.js";
import { FLASH_V2_REST_BASE } from "./constants";
import { FlashV2Error, normalizeFlashError } from "./errors";

export interface BuilderResult<T = Record<string, unknown>> {
  tx: VersionedTransaction;
  raw: T;
}

/** POST a transaction-builder endpoint; return the deserialized unsigned tx. */
export async function postBuilder<T = Record<string, unknown>>(
  path: string,
  body: object,
): Promise<BuilderResult<T>> {
  const res = await fetch(`${FLASH_V2_REST_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = normalizeFlashError({ httpStatus: res.status, body: json });
  if (err) throw err;
  const b64 =
    (json.transactionBase64 as string | undefined) ??
    (json.transaction as string | undefined);
  if (!b64) throw new FlashV2Error("builder returned no transaction", "unknown");
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  return { tx, raw: json as T };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/builder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/builder.ts lib/flash-v2/builder.test.ts
git commit -m "feat(flash-v2): REST transaction-builder client"
```

---

### Task 6: Query client (positions / prices / markets)

**Files:**
- Create: `lib/flash-v2/query.ts`
- Test: `lib/flash-v2/query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/query.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrices, getBasketPubkey } from "./query";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status, json: async () => body })));
}

describe("query", () => {
  it("maps the prices payload to a symbol→number record", async () => {
    mockFetch([{ symbol: "SOL", price: "150.5" }, { symbol: "BTC", price: "60000" }]);
    const marks = await getPrices();
    expect(marks.SOL).toBe(150.5);
    expect(marks.BTC).toBe(60000);
  });
  it("returns null basketPubkey for an un-onboarded owner", async () => {
    mockFetch({ basketPubkey: null });
    expect(await getBasketPubkey("owner1")).toBeNull();
  });
  it("returns the basketPubkey for an onboarded owner", async () => {
    mockFetch({ basketPubkey: "Bskt111" });
    expect(await getBasketPubkey("owner1")).toBe("Bskt111");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/query.test.ts`
Expected: FAIL — `Cannot find module './query'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/query.ts
import { FLASH_V2_REST_BASE } from "./constants";
import type { VenueMarket, VenuePosition } from "./types";

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${FLASH_V2_REST_BASE}${path}`);
  return res.json().catch(() => null);
}

/** GET /prices → { SYMBOL: markPrice }. Field names confirmed in Task 0. */
export async function getPrices(): Promise<Record<string, number>> {
  const data = (await getJson("/prices")) as
    | Array<{ symbol?: string; price?: string | number }>
    | null;
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row?.symbol != null && row.price != null) out[row.symbol] = Number(row.price);
  }
  return out;
}

/** GET /raw/markets → [{ symbol, maxLeverage }]. */
export async function getMarkets(): Promise<VenueMarket[]> {
  const data = (await getJson("/raw/markets")) as
    | Array<{ symbol?: string; maxLeverage?: number | string }>
    | null;
  return (data ?? [])
    .filter((m) => m?.symbol != null)
    .map((m) => ({ symbol: String(m.symbol), maxLeverage: Number(m.maxLeverage ?? 0) }));
}

/** GET /positions/owner/{wallet}. Mapping refined against real shapes (Task 0). */
export async function getPositions(owner: string): Promise<VenuePosition[]> {
  const data = (await getJson(
    `/positions/owner/${owner}?includePnlInLeverageDisplay=true`,
  )) as VenuePosition[] | null;
  return Array.isArray(data) ? data : [];
}

/** Read the basket PDA; null means the owner has not onboarded. */
export async function getBasketPubkey(owner: string): Promise<string | null> {
  const data = (await getJson(`/positions/owner/${owner}`)) as
    | { basketPubkey?: string | null }
    | null;
  return data?.basketPubkey ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/query.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/query.ts lib/flash-v2/query.test.ts
git commit -m "feat(flash-v2): query client (positions/prices/markets/basket)"
```

---

### Task 7: Balance accounting

**Files:**
- Create: `lib/flash-v2/accounting.ts`
- Test: `lib/flash-v2/accounting.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/accounting.test.ts
import { describe, expect, it } from "vitest";
import { availableUsdc } from "./accounting";

describe("availableUsdc", () => {
  it("nets ledger deposits against basket debits + pending credits", () => {
    expect(
      availableUsdc({ ledgerDeposits: 100, basketDebits: 30, basketPendingCredits: 5 }),
    ).toBe(75);
  });
  it("never goes negative", () => {
    expect(
      availableUsdc({ ledgerDeposits: 10, basketDebits: 40, basketPendingCredits: 0 }),
    ).toBe(0);
  });
  it("rounds to 6 USDC decimals", () => {
    expect(
      availableUsdc({ ledgerDeposits: 1.0000005, basketDebits: 0, basketPendingCredits: 0 }),
    ).toBe(1.000001);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/accounting.test.ts`
Expected: FAIL — `Cannot find module './accounting'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/accounting.ts
/**
 * Available funds = ledger.deposits − basket.debits + basket.pendingCredits
 * (GOTCHAS: debits/pendingCredits are cumulative accounting lines, NOT a
 * balance — never display a single component). Clamp ≥ 0, round to 6 dp.
 */
export function availableUsdc(a: {
  ledgerDeposits: number;
  basketDebits: number;
  basketPendingCredits: number;
}): number {
  const v = a.ledgerDeposits - a.basketDebits + a.basketPendingCredits;
  return Math.max(0, Math.round(v * 1e6) / 1e6);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/accounting.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/accounting.ts lib/flash-v2/accounting.test.ts
git commit -m "feat(flash-v2): balance accounting formula"
```

---

### Task 8: Entry-spread-aware sizing

**Files:**
- Create: `lib/flash-v2/sizing.ts`
- Test: `lib/flash-v2/sizing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/sizing.test.ts
import { describe, expect, it } from "vitest";
import { effectiveSizeUsd, effectiveLeverage, meetsTriggerMinimum } from "./sizing";

describe("flash-v2 sizing", () => {
  it("reshapes size by the entry spread (GOTCHAS example: $5 x25 @10% -> ~112.5)", () => {
    expect(effectiveSizeUsd(5, 25, 0.1)).toBeCloseTo(112.5, 4);
  });
  it("computes effective leverage from size/collateral", () => {
    expect(effectiveLeverage(112.5, 5)).toBeCloseTo(22.5, 4);
  });
  it("enforces the $11 minimum collateral for triggers", () => {
    expect(meetsTriggerMinimum(11)).toBe(true);
    expect(meetsTriggerMinimum(10)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/sizing.test.ts`
Expected: FAIL — `Cannot find module './sizing'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/sizing.ts
/** Triggers/limit orders require > $10 collateral after fees (GOTCHAS). */
export const MIN_TRIGGER_COLLATERAL_USD = 11;

/**
 * Effective size ≠ collateral × leverage — fills execute at oracle ± entry
 * spread, which reshapes size (GOTCHAS). entrySpreadFrac is a fraction (0.1 = 10%).
 */
export function effectiveSizeUsd(
  collateralUsd: number,
  leverage: number,
  entrySpreadFrac: number,
): number {
  if (collateralUsd <= 0 || leverage <= 0) {
    throw new Error("collateral and leverage must be positive");
  }
  return collateralUsd * leverage * (1 - entrySpreadFrac);
}

export function effectiveLeverage(sizeUsd: number, collateralUsd: number): number {
  if (collateralUsd <= 0) throw new Error("collateral must be positive");
  return sizeUsd / collateralUsd;
}

export function meetsTriggerMinimum(collateralUsd: number): boolean {
  return collateralUsd >= MIN_TRIGGER_COLLATERAL_USD;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/sizing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/sizing.ts lib/flash-v2/sizing.test.ts
git commit -m "feat(flash-v2): entry-spread-aware sizing + trigger minimum"
```

---

### Task 9: Mark-price PnL

**Files:**
- Create: `lib/flash-v2/pnl.ts`
- Test: `lib/flash-v2/pnl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/pnl.test.ts
import { describe, expect, it } from "vitest";
import { markPnlUsd } from "./pnl";

describe("markPnlUsd", () => {
  it("computes long PnL net of fees", () => {
    // +10% on $100 size = $10 gross, minus $1 fees = $9
    expect(
      markPnlUsd({ side: "long", entryPrice: 100, markPrice: 110, sizeUsd: 100, feesUsd: 1 }),
    ).toBe(9);
  });
  it("computes short PnL (price up = loss)", () => {
    expect(
      markPnlUsd({ side: "short", entryPrice: 100, markPrice: 110, sizeUsd: 100 }),
    ).toBe(-10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/pnl.test.ts`
Expected: FAIL — `Cannot find module './pnl'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/pnl.ts
import type { Side } from "./types";

/**
 * Mark-price PnL, client-side (GOTCHAS: ignore the indexer's tradeSpread PnL;
 * Flash's own UI uses mark price and only deducts execution + borrow fees).
 */
export function markPnlUsd(p: {
  side: Side;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  feesUsd?: number;
  borrowUsd?: number;
}): number {
  const dir = p.side === "long" ? 1 : -1;
  const pct = ((p.markPrice - p.entryPrice) / p.entryPrice) * dir;
  const gross = p.sizeUsd * pct;
  const net = gross - (p.feesUsd ?? 0) - (p.borrowUsd ?? 0);
  return Math.round(net * 1e6) / 1e6;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/pnl.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/pnl.ts lib/flash-v2/pnl.test.ts
git commit -m "feat(flash-v2): client-side mark-price PnL"
```

---

### Task 10: Onboarding lifecycle (basket / ledger / delegate)

**Files:**
- Create: `lib/flash-v2/onboard.ts`
- Test: `lib/flash-v2/onboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/onboard.test.ts
import { describe, expect, it, vi } from "vitest";
import { needsOnboarding, buildOnboardingSteps } from "./onboard";

describe("onboarding", () => {
  it("needsOnboarding is true only when the basket PDA is null", () => {
    expect(needsOnboarding(null)).toBe(true);
    expect(needsOnboarding("Bskt111")).toBe(false);
  });

  it("builds the three setup steps in the chain-enforced order, all on base layer", async () => {
    const calls: string[] = [];
    const fakeTx = {} as never;
    const postBuilder = vi.fn(async (path: string) => {
      calls.push(path);
      return { tx: fakeTx, raw: {} };
    });
    const steps = await buildOnboardingSteps("owner1", { postBuilder });
    expect(steps.map((s) => s.name)).toEqual([
      "init-basket",
      "init-deposit-ledger",
      "delegate-basket",
    ]);
    expect(steps.every((s) => s.unsigned.layer === "base")).toBe(true);
    expect(calls).toEqual([
      "/transaction-builder/init-basket",
      "/transaction-builder/init-deposit-ledger",
      "/transaction-builder/delegate-basket",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/onboard.test.ts`
Expected: FAIL — `Cannot find module './onboard'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/onboard.ts
import type { OnboardStep } from "./types";
import { postBuilder as defaultPostBuilder } from "./builder";

export function needsOnboarding(basketPubkey: string | null): boolean {
  return !basketPubkey;
}

type PostBuilder = typeof defaultPostBuilder;

/**
 * Chain-enforced order: init-basket → init-deposit-ledger → delegate-basket.
 * The API does not check ordering — the program does — so we always emit them
 * in this sequence. All three are base-layer txs (setup, not trading).
 * delegate-basket needs only { payer, owner }; commitFrequency/validator are
 * protocol-fixed server-side (GOTCHAS).
 */
export async function buildOnboardingSteps(
  owner: string,
  deps: { postBuilder?: PostBuilder } = {},
): Promise<OnboardStep[]> {
  const post = deps.postBuilder ?? defaultPostBuilder;
  const initBasket = await post("/transaction-builder/init-basket", { owner });
  const initLedger = await post("/transaction-builder/init-deposit-ledger", { owner });
  const delegate = await post("/transaction-builder/delegate-basket", {
    owner,
    payer: owner,
  });
  return [
    { name: "init-basket", unsigned: { tx: initBasket.tx, layer: "base" } },
    { name: "init-deposit-ledger", unsigned: { tx: initLedger.tx, layer: "base" } },
    { name: "delegate-basket", unsigned: { tx: delegate.tx, layer: "base" } },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/onboard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/flash-v2/onboard.ts lib/flash-v2/onboard.test.ts
git commit -m "feat(flash-v2): onboarding lifecycle (basket/ledger/delegate)"
```

---

### Task 11: `PerpVenue` interface + user-signed Flash v2 implementation

**Files:**
- Create: `lib/flash-v2/venue.ts`
- Test: `lib/flash-v2/venue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/flash-v2/venue.test.ts
import { describe, expect, it, vi } from "vitest";
import { flashV2Venue } from "./venue";

describe("flashV2Venue", () => {
  it("openPosition builds an ER-layer unsigned tx with mapped params", async () => {
    const fakeTx = {} as never;
    const postBuilder = vi.fn(async () => ({ tx: fakeTx, raw: { entryPriceUi: 150 } }));
    const venue = flashV2Venue({ postBuilder });
    const out = await venue.openPosition({
      owner: "owner1",
      symbol: "SOL",
      collateralUsd: 25,
      leverage: 5,
      side: "long",
      orderType: "market",
    });
    expect(out.unsigned.layer).toBe("er");
    expect(postBuilder).toHaveBeenCalledWith("/transaction-builder/open-position", {
      owner: "owner1",
      inputTokenSymbol: "USDC",
      outputTokenSymbol: "SOL",
      inputAmountUi: 25,
      leverage: 5,
      tradeType: "LONG",
      orderType: "MARKET",
    });
    expect(out.quote.entryPriceUi).toBe(150);
  });

  it("closePosition routes to close-position on the ER layer", async () => {
    const fakeTx = {} as never;
    const postBuilder = vi.fn(async () => ({ tx: fakeTx, raw: {} }));
    const venue = flashV2Venue({ postBuilder });
    const out = await venue.closePosition({
      owner: "owner1",
      positionKey: "pos1",
      closeUsd: 10,
    });
    expect(out.unsigned.layer).toBe("er");
    expect(postBuilder).toHaveBeenCalledWith("/transaction-builder/close-position", {
      owner: "owner1",
      positionKey: "pos1",
      inputUsdUi: 10,
      withdrawTokenSymbol: "USDC",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/flash-v2/venue.test.ts`
Expected: FAIL — `Cannot find module './venue'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/flash-v2/venue.ts
import { postBuilder as defaultPostBuilder } from "./builder";
import { buildOnboardingSteps } from "./onboard";
import { getPositions, getPrices, getMarkets, getBasketPubkey } from "./query";
import type { OnboardStep, Quote, Side, OrderType, UnsignedTx } from "./types";

type PostBuilder = typeof defaultPostBuilder;

export interface OpenArgs {
  owner: string;
  symbol: string;
  collateralUsd: number;
  leverage: number;
  side: Side;
  orderType: OrderType;
  takeProfit?: number;
  stopLoss?: number;
}
export interface CloseArgs {
  owner: string;
  positionKey: string;
  closeUsd: number;
}

/** User-signed Flash v2 venue (Phase 1). Session-key/server-driven copy = Phase 2. */
export function flashV2Venue(deps: { postBuilder?: PostBuilder } = {}) {
  const post = deps.postBuilder ?? defaultPostBuilder;

  return {
    async ensureOnboarded(owner: string): Promise<OnboardStep[]> {
      const basket = await getBasketPubkey(owner);
      if (basket) return [];
      return buildOnboardingSteps(owner, { postBuilder: post });
    },

    async deposit(args: { owner: string; amountUsdc: number; tokenMint: string }): Promise<UnsignedTx> {
      const { tx } = await post("/transaction-builder/deposit-direct", {
        owner: args.owner,
        tokenMint: args.tokenMint,
        amount: String(args.amountUsdc),
      });
      return { tx, layer: "base" };
    },

    async openPosition(args: OpenArgs): Promise<{ unsigned: UnsignedTx; quote: Quote }> {
      const body: Record<string, unknown> = {
        owner: args.owner,
        inputTokenSymbol: "USDC",
        outputTokenSymbol: args.symbol,
        inputAmountUi: args.collateralUsd,
        leverage: args.leverage,
        tradeType: args.side === "long" ? "LONG" : "SHORT",
        orderType: args.orderType.toUpperCase(),
      };
      if (args.takeProfit != null) body.takeProfit = args.takeProfit;
      if (args.stopLoss != null) body.stopLoss = args.stopLoss;
      const { tx, raw } = await post("/transaction-builder/open-position", body);
      return { unsigned: { tx, layer: "er" }, quote: raw as Quote };
    },

    async closePosition(args: CloseArgs): Promise<{ unsigned: UnsignedTx }> {
      const { tx } = await post("/transaction-builder/close-position", {
        owner: args.owner,
        positionKey: args.positionKey,
        inputUsdUi: args.closeUsd,
        withdrawTokenSymbol: "USDC",
      });
      return { unsigned: { tx, layer: "er" } };
    },

    getPositions,
    getMarks: getPrices,
    getMarkets,
  };
}

export type FlashV2Venue = ReturnType<typeof flashV2Venue>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/flash-v2/venue.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck the whole module**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/flash-v2/venue.ts lib/flash-v2/venue.test.ts
git commit -m "feat(flash-v2): PerpVenue interface + user-signed implementation"
```

---

### Task 12: Devnet smoke script (onboard → deposit → open → close)

**Files:**
- Create: `scripts/flash-v2/smoke-lifecycle.ts`

**Note:** This is a manual, signing script (no unit test) — it hits devnet RPCs and signs with a local keypair, mirroring `scripts/arena/*` conventions. Read it before running.

- [ ] **Step 1: Write the smoke script**

```ts
// scripts/flash-v2/smoke-lifecycle.ts
//
// Manual devnet smoke for the Flash v2 venue foundation. Drives:
//   onboard (basket/ledger/delegate) → deposit → open → close
// signing each returned unsigned tx with a local keypair and submitting to the
// correct layer (base vs ER). Run:
//
//   FLASH_V2_CLUSTER=devnet \
//   FLASH_V2_USDC_MINT=<devnet-usdc-mint> \
//   FLASH_V2_KEYPAIR=~/.config/solana/flash-v2-devnet.json \
//   npx tsx --env-file=.env.local scripts/flash-v2/smoke-lifecycle.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { flashV2Venue } from "../../lib/flash-v2/venue";
import { getConnection } from "../../lib/flash-v2/rpc";
import { FLASH_V2_USDC_MINT } from "../../lib/flash-v2/constants";
import type { UnsignedTx } from "../../lib/flash-v2/types";

function loadKeypair(): Keypair {
  const p =
    process.env.FLASH_V2_KEYPAIR ??
    path.join(homedir(), ".config/solana/flash-v2-devnet.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function signSubmit(u: UnsignedTx, kp: Keypair): Promise<string> {
  const conn = getConnection(u.layer);
  const tx = u.tx as VersionedTransaction;
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const kp = loadKeypair();
  const owner = kp.publicKey.toBase58();
  const venue = flashV2Venue();
  console.log(`owner ${owner}`);

  const steps = await venue.ensureOnboarded(owner);
  for (const s of steps) {
    console.log(`onboard ${s.name} → ${await signSubmit(s.unsigned, kp)}`);
  }

  const dep = await venue.deposit({ owner, amountUsdc: 5, tokenMint: FLASH_V2_USDC_MINT });
  console.log(`deposit → ${await signSubmit(dep, kp)}`);

  const open = await venue.openPosition({
    owner, symbol: "SOL", collateralUsd: 5, leverage: 2, side: "long", orderType: "market",
  });
  console.log(`open → ${await signSubmit(open.unsigned, kp)} (quote ${JSON.stringify(open.quote)})`);

  const positions = await venue.getPositions(owner);
  console.log(`positions: ${JSON.stringify(positions)}`);
  const pos = positions[0];
  if (pos) {
    const close = await venue.closePosition({ owner, positionKey: pos.positionKey, closeUsd: pos.sizeUsd });
    console.log(`close → ${await signSubmit(close.unsigned, kp)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Dry-run readiness (no execution yet)**

Confirm prerequisites are documented: a funded devnet keypair at `FLASH_V2_KEYPAIR`, the devnet USDC mint in `FLASH_V2_USDC_MINT`, and `FLASH_V2_CLUSTER=devnet`. Do NOT run against mainnet. Running the smoke is a deliberate, supervised step — record the resulting signatures in `docs/superpowers/flash-v2-surface-notes.md` when executed.

- [ ] **Step 4: Commit**

```bash
git add scripts/flash-v2/smoke-lifecycle.ts
git commit -m "feat(flash-v2): devnet lifecycle smoke script (onboard/deposit/open/close)"
```

---

### Task 13: Full Phase 1 verification

- [ ] **Step 1: Run the whole flash-v2 suite**

Run: `npx vitest run lib/flash-v2`
Expected: PASS — all tests from Tasks 1–11 green.

- [ ] **Step 2: Typecheck the repo**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm Pacifica is untouched**

Run: `git diff --name-only main -- lib/pacifica`
Expected: empty output (Phase 1 adds, never edits Pacifica).

---

## Self-review

- **Spec coverage:** §5 architecture (venue interface, dual-RPC, builder/Privy) → Tasks 4,5,11. §6 interface → Task 11. §7 capability map (deposit/open/close/positions/balance/marks/markets/sizing/PnL) → Tasks 5–11. §8 onboarding (setup-only, ordered) → Task 10. §11 gotchas (dual-RPC, ER-first, ordering, error channels, accounting, sizing, $11 min, mark-PnL, DTO typo) → Tasks 3,4,6,7,8,9,10, types. §13 devnet-first + flag → Tasks 1,12. **Deferred (own plans):** §9 session keys, §8 two-phase withdraw, §10 route rewiring, live-WS provider, Pacifica deletion — explicitly out of Phase 1 scope.
- **Placeholder scan:** none — every code step is complete and runnable.
- **Type consistency:** `UnsignedTx { tx, layer }`, `OnboardStep { name, unsigned }`, `flashV2Venue` method names, and `postBuilder` signature are consistent across Tasks 2, 5, 10, 11, 12.
- **Known soft spots (by design, flagged in Task 0):** Flash v2 response field names (`transactionBase64`, `basketPubkey`, prices/positions shapes) and error strings are doc-sourced; Task 0 confirms them against `examples-v2` and the smoke (Task 12) validates end-to-end before Phase 2 builds on them.
