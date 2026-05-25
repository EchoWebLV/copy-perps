"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import type { ReactNode } from "react";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

function buildRpcs() {
  const httpUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? DEFAULT_RPC;
  const wssUrl = httpUrl.replace(/^https?:/, "wss:");
  return {
    "solana:mainnet": {
      rpc: createSolanaRpc(httpUrl),
      rpcSubscriptions: createSolanaRpcSubscriptions(wssUrl),
    },
  } as const;
}

export function PrivyClientProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    if (typeof window !== "undefined") {
      console.warn(
        "NEXT_PUBLIC_PRIVY_APP_ID not set — Privy disabled. Add it to .env.local.",
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#22c55e",
          walletChainType: "solana-only",
          showWalletLoginFirst: false,
          logo: undefined,
        },
        loginMethods: ["email", "wallet", "google", "twitter"],
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        embeddedWallets: {
          solana: { createOnLogin: "all-users" },
        },
        solana: {
          rpcs: buildRpcs(),
        },
        fundingMethodConfig: {
          moonpay: {
            useSandbox: process.env.NEXT_PUBLIC_MOONPAY_SANDBOX === "true",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
