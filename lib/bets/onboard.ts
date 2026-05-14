import { PublicKey } from "@solana/web3.js";
import { buildMessage } from "@/lib/pacifica/sign";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import {
  generateAgentKeypair,
  getAgentWallet,
  persistAgentWallet,
} from "@/lib/wallets/agent";

export interface OnboardPlan {
  alreadyOnboarded: boolean;
  // Present when client must sign the bind message and the deposit tx.
  bindMessage?: string;
  bindAgentPubkey?: string;
  depositTransactionB64?: string;
  initialDepositUsdc?: number;
}

const DEFAULT_INITIAL_DEPOSIT_USDC = 25; // covers one $5-$20 tap plus headroom

// Builds the onboarding payload the client needs to sign on first tap.
// Does NOT persist the agent wallet yet — that happens in
// finalizeAgentBind after the bind tx is confirmed by Pacifica.
export async function planOnboarding(params: {
  userId: string;
  userMainPubkey: string;
  desiredStakeUsdc: number;
}): Promise<OnboardPlan> {
  const existing = await getAgentWallet(params.userId);
  if (existing) return { alreadyOnboarded: true };

  const { publicKeyB58: agentPubkey, seed } = generateAgentKeypair();
  const timestamp = Date.now();
  const bindMessage = buildMessage(
    { type: "bind_agent_wallet", timestamp, expiry_window: 5000 },
    { agent_wallet: agentPubkey },
  );

  const initialDeposit = Math.max(
    DEFAULT_INITIAL_DEPOSIT_USDC,
    Math.ceil(params.desiredStakeUsdc * 2.5),
  );
  const { transactionB64 } = await buildDepositTx({
    userPubkey: new PublicKey(params.userMainPubkey),
    amountUsdc: initialDeposit,
  });

  // Stash the freshly-generated agent seed in a one-time cache. Server
  // re-loads it during finalize. For Phase 1 we store it transiently
  // in process memory keyed on agentPubkey — finalize must happen on
  // the same instance; if not, the user re-onboards. Acceptable trade
  // off; Phase 2 moves this to Redis/KV.
  pendingAgentSeeds.set(agentPubkey, {
    userId: params.userId,
    mainPubkey: params.userMainPubkey,
    seed,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  return {
    alreadyOnboarded: false,
    bindMessage,
    bindAgentPubkey: agentPubkey,
    depositTransactionB64: transactionB64,
    initialDepositUsdc: initialDeposit,
  };
}

interface PendingSeed {
  userId: string;
  mainPubkey: string;
  seed: Uint8Array;
  expiresAt: number;
}
const pendingAgentSeeds = new Map<string, PendingSeed>();

// Called from /api/users/me/agent/bind after Pacifica acknowledges
// the bind. Idempotent: returns persisted: false if the pending entry
// has expired or was already consumed.
export async function finalizeAgentBind(params: {
  agentPubkey: string;
}): Promise<{ persisted: boolean }> {
  const pending = pendingAgentSeeds.get(params.agentPubkey);
  if (!pending) return { persisted: false };
  if (pending.expiresAt < Date.now()) {
    pendingAgentSeeds.delete(params.agentPubkey);
    return { persisted: false };
  }
  await persistAgentWallet({
    userId: pending.userId,
    mainPubkey: pending.mainPubkey,
    agentPubkey: params.agentPubkey,
    seed: pending.seed,
  });
  pendingAgentSeeds.delete(params.agentPubkey);
  return { persisted: true };
}

export function clearPendingAgent(agentPubkey: string): void {
  pendingAgentSeeds.delete(agentPubkey);
}
