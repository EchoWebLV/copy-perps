"use client";

import { useCallback, useEffect, useState } from "react";
import { getUsdcBalance, getJupUsdBalance, getSolBalance } from "./balance";

interface BalanceState {
  usdc: number | null;
  jupUsd: number | null;
  // Combined USD-equivalent balance: USDC + jupUSD. Both peg 1:1 to USD,
  // so the app treats them interchangeably for display purposes.
  totalUsd: number | null;
  sol: number | null;
  loading: boolean;
  error: string | null;
}

export function useWalletBalance(walletAddress: string | undefined) {
  const [state, setState] = useState<BalanceState>({
    usdc: null,
    jupUsd: null,
    totalUsd: null,
    sol: null,
    loading: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const [usdc, jupUsd, sol] = await Promise.all([
        getUsdcBalance(walletAddress),
        getJupUsdBalance(walletAddress),
        getSolBalance(walletAddress),
      ]);
      setState({
        usdc,
        jupUsd,
        totalUsd: usdc + jupUsd,
        sol,
        loading: false,
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    void refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [walletAddress, refresh]);

  return { ...state, refresh };
}
