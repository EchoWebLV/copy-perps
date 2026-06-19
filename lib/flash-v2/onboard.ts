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
