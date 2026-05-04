"use client";

import { useCallback, useEffect, useState } from "react";
import { getUsdcBalance, getSolBalance } from "./balance";

interface BalanceState {
  usdc: number | null;
  sol: number | null;
  loading: boolean;
  error: string | null;
}

export function useWalletBalance(walletAddress: string | undefined) {
  const [state, setState] = useState<BalanceState>({
    usdc: null,
    sol: null,
    loading: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const [usdc, sol] = await Promise.all([
        getUsdcBalance(walletAddress),
        getSolBalance(walletAddress),
      ]);
      setState({ usdc, sol, loading: false, error: null });
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
