"use client";

import {
  type ConnectedStandardSolanaWallet,
  useWallets,
} from "@privy-io/react-auth/solana";

export function isPrivySolanaWallet(
  wallet: ConnectedStandardSolanaWallet,
): boolean {
  const standardWallet = wallet.standardWallet as typeof wallet.standardWallet & {
    isPrivyWallet?: boolean;
  };
  return (
    standardWallet.isPrivyWallet === true ||
    standardWallet.name === "Privy" ||
    "privy:" in standardWallet.features
  );
}

export function useEmbeddedSolanaWallet() {
  const { wallets } = useWallets();
  const wallet = wallets.find(isPrivySolanaWallet);
  return wallet;
}

export function truncateAddress(address?: string, lead = 4, tail = 4): string {
  if (!address) return "—";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
