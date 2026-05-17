import { getAccountInfo, postSigned } from "./client";
import { signSolanaMessage } from "./sign";
import type { AgentWalletRecord } from "@/lib/wallets/agent";

/**
 * Requests a USDC withdrawal from the user's Pacifica account.
 *
 * Pacifica's `POST /account/withdraw` is a signed request — the same
 * envelope as orders. It accepts an optional `agent_wallet` field, so the
 * server-held agent wallet signs it and no user wallet modal is needed.
 * There is no destination field: funds always settle back to the account
 * owner's own wallet, so the agent key can never redirect them elsewhere.
 *
 * The signature `type` is `"withdraw"` — inferred from Pacifica's operation
 * naming convention (`create_market_order`, `update_leverage`, ...). A wrong
 * type surfaces immediately as a signature-rejected error from the API.
 */
export async function requestWithdraw(params: {
  agent: AgentWalletRecord;
  amountUsdc: number;
}): Promise<unknown> {
  // USDC carries 6 decimals; round to kill float dust, send as a string.
  const amount = (Math.round(params.amountUsdc * 1e6) / 1e6).toString();
  const timestamp = Date.now();
  const signed = await signSolanaMessage(
    { type: "withdraw", timestamp, expiry_window: 5000 },
    { amount },
    params.agent.agentPubkey,
    params.agent.agentSecretKey,
  );
  return postSigned<{ amount: string }, unknown>("/account/withdraw", {
    account: params.agent.mainPubkey,
    agentWallet: params.agent.agentPubkey,
    signatureB58: signed.signatureB58,
    header: signed.header,
    payload: signed.payload,
  });
}

/**
 * USDC the account can withdraw right now — collateral not locked behind
 * open positions — per Pacifica's account endpoint.
 */
export async function getWithdrawable(mainPubkey: string): Promise<number> {
  const info = await getAccountInfo(mainPubkey);
  const v = Number(info.available_to_withdraw);
  return Number.isFinite(v) ? v : 0;
}
