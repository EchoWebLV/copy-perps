"use client";

import { useCallback, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import type { PacificaTraderSignal, StakeAmount } from "@/lib/types";

const STAKES: StakeAmount[] = [5, 10, 20, 50];
const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

interface Props {
  signal: PacificaTraderSignal;
  isActive: boolean;
}

interface OnboardResponse {
  phase: "onboard";
  alreadyOnboarded: false;
  bindMessage: string;
  bindAgentPubkey: string;
  depositTransactionB64: string;
  initialDepositUsdc: number;
}

interface OpenResponse {
  phase: "open";
  betId: string;
  fill: {
    orderId: string;
    avgFillPrice: string;
    filledAmount: string;
    side: string;
  };
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function CopyCard({ signal, isActive }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState<StakeAmount | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pos = signal.position;
  const truncated = useMemo(
    () => `${signal.address.slice(0, 4)}…${signal.address.slice(-4)}`,
    [signal.address],
  );

  const onTap = useCallback(
    async (stake: StakeAmount) => {
      if (!pos || busy || !wallet) return;
      setBusy(stake);
      setStatus("Placing order…");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");

        const body = {
          leaderAddress: signal.address,
          market: pos.market,
          side: pos.side,
          leverage: pos.leverage,
          stakeUsdc: stake,
          signalId: signal.id,
          walletAddress: wallet.address,
        };
        let resp = await fetch("/api/bet/copy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.error ?? `HTTP ${resp.status}`);
        }
        const first = (await resp.json()) as OnboardResponse | OpenResponse;

        if (first.phase === "onboard") {
          // Step A: sign + submit the bind message.
          setStatus("Authorizing trader…");
          const bindMsgBytes = new TextEncoder().encode(first.bindMessage);
          const { signature: bindSig } = (await signMessage({
            message: bindMsgBytes,
            wallet,
          })) as { signature: Uint8Array };
          const bs58 = (await import("bs58")).default;
          const bindSigB58 = bs58.encode(bindSig);
          // Parse the canonical message to extract timestamp/expiry for the API call.
          const parsed = JSON.parse(first.bindMessage) as {
            timestamp: number;
            expiry_window: number;
          };
          const bindResp = await fetch("/api/users/me/agent/bind", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              agentPubkey: first.bindAgentPubkey,
              signatureB58: bindSigB58,
              timestamp: parsed.timestamp,
              expiryWindow: parsed.expiry_window,
              walletAddress: wallet.address,
            }),
          });
          if (!bindResp.ok) {
            const e = await bindResp.json().catch(() => ({}));
            throw new Error(`bind failed: ${e.error ?? bindResp.status}`);
          }

          // Step B: sign + submit the deposit tx.
          setStatus("Depositing USDC…");
          const txBytes = b64ToBytes(first.depositTransactionB64);
          const { signedTransaction } = (await signTransaction({
            transaction: txBytes,
            wallet,
          })) as { signedTransaction: Uint8Array };
          const conn = new Connection(RPC, "confirmed");
          const sig = await conn.sendRawTransaction(signedTransaction, {
            maxRetries: 3,
          });
          await conn.confirmTransaction(sig, "confirmed");

          // Re-tap.
          setStatus("Placing order…");
          resp = await fetch("/api/bet/copy", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
          });
          if (!resp.ok) {
            const e = await resp.json().catch(() => ({}));
            throw new Error(e.error ?? `HTTP ${resp.status}`);
          }
        }

        const open = (await resp.json()) as OpenResponse;
        setStatus(`Opened @ $${Number(open.fill.avgFillPrice).toFixed(4)}`);
      } catch (err) {
        console.error("[copy] tap failed:", err);
        setStatus(`Failed: ${String(err).slice(0, 80)}`);
      } finally {
        setBusy(null);
        setTimeout(() => setStatus(null), 5000);
      }
    },
    [
      busy,
      getAccessToken,
      pos,
      signal.address,
      signal.id,
      signMessage,
      signTransaction,
      wallet,
    ],
  );

  return (
    <div
      className="flex h-full w-full flex-col justify-between p-6 text-white"
      data-card-type="pacifica_trader"
    >
      <div>
        <div className="text-xs uppercase tracking-widest text-white/60">
          Pacifica Trader
        </div>
        <div className="mt-1 text-2xl font-bold">
          {signal.username ?? truncated}
        </div>
        <a
          href={`https://solscan.io/account/${signal.address}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-white/40 underline"
        >
          {truncated} ↗
        </a>
      </div>
      {pos ? (
        <div className="space-y-1 text-sm">
          <div>
            <span className="text-white/60">Position </span>
            <span className="font-semibold">
              {pos.market} {pos.side.toUpperCase()}
              {pos.leverage > 0 ? ` ${Math.round(pos.leverage)}x` : ""}
            </span>
          </div>
          <div>
            <span className="text-white/60">Entry </span>
            <span>${pos.entryPrice.toFixed(4)}</span>
          </div>
          <div className="text-xs text-white/50">
            7d vol ${Math.round(signal.stats.volume7dUsdc).toLocaleString()} ·
            equity ${Math.round(signal.stats.equityUsdc).toLocaleString()}
          </div>
        </div>
      ) : (
        <div className="text-sm text-white/60">No open position. Watching…</div>
      )}
      <div className="flex gap-2">
        {STAKES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={!pos || busy !== null || !isActive}
            onClick={() => onTap(s)}
            className="flex-1 rounded-2xl bg-white/10 py-3 font-semibold disabled:opacity-40"
          >
            {busy === s ? "…" : `$${s}`}
          </button>
        ))}
      </div>
      {status && (
        <div className="mt-2 text-center text-xs text-white/70">{status}</div>
      )}
    </div>
  );
}
