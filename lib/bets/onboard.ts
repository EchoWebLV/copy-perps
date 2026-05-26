import { PublicKey } from "@solana/web3.js";
import { buildMessage } from "@/lib/pacifica/sign";
import { buildDepositTx, getWalletUsdcBalance } from "@/lib/pacifica/deposit";
import { requiredPacificaDepositUsdc } from "@/lib/bets/funding";
import {
  generateAgentKeypair,
  getAgentWallet,
  getAgentWalletRow,
  createPendingAgentWallet,
  markAgentWalletBound,
} from "@/lib/wallets/agent";

export interface OnboardPlan {
  alreadyOnboarded: boolean;
  // Present when the client must sign the bind message and the deposit tx.
  bindMessage?: string;
  bindAgentPubkey?: string;
  depositTransactionB64?: string;
  initialDepositUsdc?: number;
}

// Builds the onboarding payload the client signs on first tap.
//
// The agent wallet is persisted to its DB row immediately — with
// bound_at = null — BEFORE the Pacifica bind round-trip. A server restart
// or a second instance between plan and bind can therefore never orphan
// the bind: the seed is already durable, and finalizeAgentBind only flips
// bound_at. A retried onboarding reuses the existing unbound row instead
// of minting a second agent wallet (and a second deposit address).
export async function planOnboarding(params: {
  userId: string;
  userMainPubkey: string;
  desiredStakeUsdc: number;
  leverage: number;
}): Promise<OnboardPlan> {
  if (await getAgentWallet(params.userId)) {
    return { alreadyOnboarded: true };
  }

  // Reuse a generated-but-unbound row from an interrupted onboarding;
  // otherwise mint a fresh agent keypair and persist it now.
  const existing = await getAgentWalletRow(params.userId);
  let agentPubkey: string;
  if (existing) {
    agentPubkey = existing.agentPubkey;
  } else {
    const generated = generateAgentKeypair();
    agentPubkey = generated.publicKeyB58;
    await createPendingAgentWallet({
      userId: params.userId,
      mainPubkey: params.userMainPubkey,
      agentPubkey,
      seed: generated.seed,
    });
  }

  const timestamp = Date.now();
  const bindMessage = buildMessage(
    { type: "bind_agent_wallet", timestamp, expiry_window: 5000 },
    { agent_wallet: agentPubkey },
  );

  const userPubkey = new PublicKey(params.userMainPubkey);
  const minimumInitialDeposit = requiredPacificaDepositUsdc({
    stakeUsdc: params.desiredStakeUsdc,
    leverage: params.leverage,
  });
  const walletUsdc = await getWalletUsdcBalance(userPubkey);
  const initialDeposit =
    walletUsdc >= minimumInitialDeposit ? walletUsdc : minimumInitialDeposit;
  const { transactionB64 } = await buildDepositTx({
    userPubkey,
    amountUsdc: initialDeposit,
  });

  return {
    alreadyOnboarded: false,
    bindMessage,
    bindAgentPubkey: agentPubkey,
    depositTransactionB64: transactionB64,
    initialDepositUsdc: initialDeposit,
  };
}

// Called from /api/users/me/agent/bind after Pacifica acknowledges the
// bind. The agent wallet row already exists (planOnboarding persisted it);
// this only stamps bound_at, after which getAgentWallet returns it.
// persisted: false means no matching pending row — the client should
// re-run the onboarding plan.
export async function finalizeAgentBind(params: {
  userId: string;
  agentPubkey: string;
}): Promise<{ persisted: boolean }> {
  const persisted = await markAgentWalletBound(
    params.userId,
    params.agentPubkey,
  );
  return { persisted };
}
