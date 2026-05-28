import { VersionedTransaction } from "@solana/web3.js";
import { privyServer } from "./server";

export const SOLANA_MAINNET_CAIP2 =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

type PrivyLinkedWallet = {
  type?: string;
  id?: string | null;
  address?: string;
  chainType?: string;
  walletClientType?: string;
};

export interface PrivyInstantSolanaSendRequest {
  privyUserId: string;
  walletAddress: string;
  transactionB64: string;
}

export interface PrivyInstantSolanaSendResult {
  signature: string;
  caip2: string;
}

async function resolvePrivySolanaWalletId(
  privyUserId: string,
  walletAddress: string,
): Promise<string> {
  const user = await privyServer.getUserById(privyUserId);
  const wallet = user.linkedAccounts.find((account) => {
    const linkedWallet = account as PrivyLinkedWallet;
    return (
      linkedWallet.type === "wallet" &&
      linkedWallet.address === walletAddress &&
      linkedWallet.chainType === "solana" &&
      linkedWallet.walletClientType?.startsWith("privy") &&
      Boolean(linkedWallet.id)
    );
  }) as PrivyLinkedWallet | undefined;

  if (!wallet?.id) {
    throw new Error("Instant trading wallet is not ready for server-side signing.");
  }
  return wallet.id;
}

export async function signAndSendPrivySolanaTransaction({
  privyUserId,
  walletAddress,
  transactionB64,
}: PrivyInstantSolanaSendRequest): Promise<PrivyInstantSolanaSendResult> {
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(transactionB64, "base64"),
  );
  const walletId = await resolvePrivySolanaWalletId(privyUserId, walletAddress);
  const result = await privyServer.walletApi.solana.signAndSendTransaction({
    walletId,
    transaction,
    caip2: SOLANA_MAINNET_CAIP2,
  });
  return {
    signature: result.hash,
    caip2: result.caip2,
  };
}
