"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getUsdcBalance, getJupUsdBalance, getSolBalance, getConnection } from "./balance";
import { USDC_MINT, USDC_DECIMALS, JUPUSD_MINT, JUPUSD_DECIMALS } from "@/lib/jupiter/constants";
import { getAssociatedTokenAddress, decodeTokenAmount } from "./spl";

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

const usdcMintPk = new PublicKey(USDC_MINT);
const jupUsdMintPk = new PublicKey(JUPUSD_MINT);
const USDC_DIVISOR = 10 ** USDC_DECIMALS;
const JUPUSD_DIVISOR = 10 ** JUPUSD_DECIMALS;

// Live wallet balance powered by Helius WebSocket subscriptions.
//
// We do one REST fetch on mount to seed initial values, then open three
// `accountSubscribe` channels (SOL native, USDC ATA, jupUSD ATA). Every
// time any of them changes, the RPC pushes the new account state and we
// recompute the relevant slice locally. No polling, no per-second RPC
// cost.
//
// Helius auto-derives the WS endpoint from the HTTP URL (https → wss),
// so the existing NEXT_PUBLIC_HELIUS_RPC_URL is enough — no new env.
//
// `refresh()` is still exposed for one-shot manual reads (e.g. right
// after a withdraw, before the chain commits, when we want to verify
// the post-state explicitly).
export function useWalletBalance(walletAddress: string | undefined) {
  const [state, setState] = useState<BalanceState>({
    usdc: null,
    jupUsd: null,
    totalUsd: null,
    sol: null,
    loading: false,
    error: null,
  });

  // Latest balances live in a ref so the WS callbacks can compose
  // partial updates (e.g. only USDC changed) without losing the other
  // legs to a stale closure.
  const latestRef = useRef({
    usdc: null as number | null,
    jupUsd: null as number | null,
    sol: null as number | null,
  });

  const apply = useCallback(
    (
      patch: Partial<{ usdc: number; jupUsd: number; sol: number }>,
    ) => {
      const next = { ...latestRef.current, ...patch };
      latestRef.current = next;
      setState((s) => ({
        ...s,
        usdc: next.usdc,
        jupUsd: next.jupUsd,
        sol: next.sol,
        totalUsd:
          next.usdc != null && next.jupUsd != null
            ? next.usdc + next.jupUsd
            : (next.usdc ?? next.jupUsd),
        loading: false,
        error: null,
      }));
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const [usdc, jupUsd, sol] = await Promise.all([
        getUsdcBalance(walletAddress),
        getJupUsdBalance(walletAddress),
        getSolBalance(walletAddress),
      ]);
      apply({ usdc, jupUsd, sol });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [walletAddress, apply]);

  useEffect(() => {
    if (!walletAddress) return;

    const conn = getConnection();
    const ownerPk = new PublicKey(walletAddress);
    const usdcAta = getAssociatedTokenAddress(ownerPk, usdcMintPk);
    const jupUsdAta = getAssociatedTokenAddress(ownerPk, jupUsdMintPk);

    let cancelled = false;
    const subIds: number[] = [];

    // Seed the UI from a one-time REST fetch. WS subs below take over
    // after the first push from the RPC.
    void (async () => {
      try {
        const [usdc, jupUsd, sol] = await Promise.all([
          getUsdcBalance(walletAddress),
          getJupUsdBalance(walletAddress),
          getSolBalance(walletAddress),
        ]);
        if (!cancelled) apply({ usdc, jupUsd, sol });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setState((s) => ({ ...s, loading: false, error: msg }));
        }
      }
    })();

    // SOL native balance — owner pubkey IS the account, lamports field
    // updates on any in/out transfer.
    subIds.push(
      conn.onAccountChange(
        ownerPk,
        (info) => apply({ sol: info.lamports / 1_000_000_000 }),
        { commitment: "confirmed" },
      ),
    );

    // USDC ATA — token account data, amount at byte offset 64 (u64 LE).
    // ATA may not exist yet for new wallets; subscription still fires
    // when it gets created on the first inbound transfer.
    subIds.push(
      conn.onAccountChange(
        usdcAta,
        (info) => {
          if (!info.data || info.data.length < 72) return;
          const atomic = decodeTokenAmount(info.data as Buffer);
          apply({ usdc: Number(atomic) / USDC_DIVISOR });
        },
        { commitment: "confirmed" },
      ),
    );

    subIds.push(
      conn.onAccountChange(
        jupUsdAta,
        (info) => {
          if (!info.data || info.data.length < 72) return;
          const atomic = decodeTokenAmount(info.data as Buffer);
          apply({ jupUsd: Number(atomic) / JUPUSD_DIVISOR });
        },
        { commitment: "confirmed" },
      ),
    );

    return () => {
      cancelled = true;
      for (const id of subIds) {
        void conn.removeAccountChangeListener(id);
      }
    };
  }, [walletAddress, apply]);

  return { ...state, refresh };
}
