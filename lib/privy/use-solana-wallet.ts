"use client";

import { useWallets } from "@privy-io/react-auth/solana";

export function useEmbeddedSolanaWallet() {
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.standardWallet?.name === "Privy");
  return wallet;
}

export function truncateAddress(address?: string, lead = 4, tail = 4): string {
  if (!address) return "—";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
