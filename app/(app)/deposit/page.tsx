"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useFundWallet,
  useWallets,
} from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, LogOut } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { WithdrawButton } from "@/components/portfolio/WithdrawButton";
import { ev } from "@/lib/analytics";
import { usePushSubscribe } from "@/lib/notifications/use-push-subscribe";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";
import {
  BG,
  FG,
  ACCENT,
  GREEN,
  RED,
  DIM,
  FAINT,
  PANEL,
  PANEL_2,
  FONT_DISPLAY,
  Headline,
} from "@/components/v2/ui";
import { InstallNudge } from "@/components/pwa/InstallNudge";

const DEFAULT_FUND_AMOUNT_USD = "25";

export default function DepositPage() {
  const { ready, authenticated, getAccessToken, login, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { totalUsd, refresh } = useWalletBalance(wallet?.address);
  const { fundWallet } = useFundWallet();
  const [funding, setFunding] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoCreateAttemptedRef = useRef(false);

  const {
    toggleState: pushToggleState,
    error: pushError,
    enablePush,
    supported: pushSupported,
  } = usePushSubscribe(getAccessToken);

  const createAppWallet = useCallback(async () => {
    if (wallet || creatingWallet) return;
    setWalletError(null);
    setCreatingWallet(true);
    try {
      await createWallet();
    } catch (err) {
      console.error("[deposit] create wallet error:", err);
      setWalletError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingWallet(false);
    }
  }, [createWallet, creatingWallet, wallet]);

  useEffect(() => {
    if (
      !ready ||
      !authenticated ||
      !walletsReady ||
      wallet ||
      autoCreateAttemptedRef.current
    ) {
      return;
    }
    autoCreateAttemptedRef.current = true;
    void createAppWallet();
  }, [authenticated, createAppWallet, ready, wallet, walletsReady]);

  const buyWithCard = async () => {
    if (!wallet?.address || funding) return;
    ev.fundWithCardClicked();
    setFunding(true);
    try {
      await fundWallet({
        address: wallet.address,
        options: {
          asset: "USDC",
          amount: DEFAULT_FUND_AMOUNT_USD,
          defaultFundingMethod: "card",
          card: { preferredProvider: "moonpay" },
        },
      });
      ev.fundWithCardCompleted();
    } catch (err) {
      console.error("[deposit] fundWallet error:", err);
      ev.fundWithCardFailed({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFunding(false);
    }
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[deposit] copy address error:", err);
    }
  };

  return (
    <AppShell railTitle="Wallet" hideEmptyRail>
      <div
        className="flex min-h-screen w-full flex-col px-5 pt-4 pb-32 lg:h-full lg:min-h-0 lg:max-w-3xl lg:px-6 lg:pt-5"
        style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
      >
        {!ready && (
          <p
            className="mt-6 text-[11px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            LOADING…
          </p>
        )}

        {ready && !authenticated && (
          <div className="mt-12 text-center">
            <Headline size={26}>{`"LOG IN"`}</Headline>
            <p
              className="mt-2 text-[11px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              TO FUND YOUR WALLET
            </p>
            <button
              onClick={() => {
                ev.loginClicked("deposit");
                login();
              }}
              className="mt-6 rounded-2xl px-6 py-3 text-[13px] font-black uppercase tracking-widest active:scale-[0.97]"
              style={{
                background: ACCENT,
                color: BG,
                boxShadow: `0 4px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
              }}
            >
              LOG IN
            </button>
          </div>
        )}

        {ready && authenticated && (
          <>
            {/* PWA install nudge — funding is the natural "set up your app"
                surface. Dismissible. */}
            <InstallNudge />

            {/* Balance hero — funding only, no settings hiding in here. */}
            <div
              className="mt-2 p-6 text-center"
              style={{ background: PANEL, borderRadius: 20, border: `1px solid ${FAINT}` }}
            >
              <div
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                Ready to trade
              </div>
              <div
                className="mt-2 text-[40px] font-black leading-none tabular-nums"
                style={{ color: FG }}
              >
                {totalUsd == null ? "$0.00" : `$${totalUsd.toFixed(2)}`}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={buyWithCard}
                  disabled={!wallet?.address || funding}
                  className="flex items-center justify-center rounded-2xl py-3.5 text-[13px] font-black uppercase tracking-widest active:scale-[0.97] disabled:opacity-40"
                  style={{
                    background: ACCENT,
                    color: BG,
                    boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
                  }}
                >
                  {funding ? "OPENING…" : "ADD FUNDS"}
                </button>
                <WithdrawButton
                  maxUsd={totalUsd ?? 0}
                  onComplete={() => void refresh()}
                  triggerClassName="flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] py-3.5 text-[13px] font-black uppercase tracking-widest text-white transition active:scale-[0.97] disabled:opacity-40"
                />
              </div>

              {!wallet?.address && walletsReady ? (
                <button
                  onClick={createAppWallet}
                  disabled={creatingWallet}
                  className="mt-3 flex w-full items-center justify-center rounded-xl py-3 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                  style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
                >
                  {creatingWallet ? "CREATING..." : "CREATE APP WALLET"}
                </button>
              ) : null}
              {!wallet?.address && walletError ? (
                <p
                  className="mt-2 text-[10px] font-black uppercase tracking-widest leading-relaxed"
                  style={{ color: RED }}
                >
                  {walletError.slice(0, 120)}
                </p>
              ) : null}
            </div>

            {/* USDC address */}
            <div
              className="mt-4 p-4"
              style={{ background: PANEL, borderRadius: 16, border: `1px solid ${FAINT}` }}
            >
              <div
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                Your USDC address
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div
                  className="min-w-0 flex-1 break-all font-mono text-[12px] font-black uppercase leading-relaxed tracking-widest"
                  style={{ color: wallet?.address ? FG : DIM }}
                >
                  {wallet?.address ?? "Wallet not ready"}
                </div>
                <button
                  onClick={copyAddress}
                  disabled={!wallet?.address}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                  style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
                >
                  {copied ? (
                    <>
                      <Check size={12} strokeWidth={3} /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={12} strokeWidth={2.8} /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Push alerts — kept here (launch-critical, has no other home). */}
            {pushSupported ? (
              <div
                className="mt-4 flex items-center justify-between gap-3 p-4"
                style={{ background: PANEL, borderRadius: 16, border: `1px solid ${FAINT}` }}
              >
                <div className="min-w-0">
                  <div
                    className="text-[12px] font-black uppercase tracking-widest"
                    style={{ color: FG }}
                  >
                    Push alerts
                  </div>
                  <div
                    className="mt-0.5 text-[10px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    When a copy opens or closes
                  </div>
                </div>
                {pushToggleState === "on" ? (
                  <span
                    className="shrink-0 text-[11px] font-black uppercase tracking-widest"
                    style={{ color: GREEN }}
                  >
                    On
                  </span>
                ) : pushToggleState === "blocked" ? (
                  <span
                    className="shrink-0 text-[11px] font-black uppercase tracking-widest"
                    style={{ color: RED }}
                  >
                    Blocked
                  </span>
                ) : (
                  <button
                    onClick={() => void enablePush()}
                    disabled={pushToggleState === "enabling"}
                    className="shrink-0 rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                    style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
                  >
                    {pushToggleState === "enabling" ? "ENABLING…" : "ENABLE"}
                  </button>
                )}
              </div>
            ) : null}
            {pushError ? (
              <p
                className="mt-2 text-[10px] font-black uppercase tracking-widest leading-relaxed"
                style={{ color: RED }}
              >
                {pushError.slice(0, 160)}
              </p>
            ) : null}

            {/* Log out */}
            <button
              onClick={logout}
              className="mx-auto mt-8 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition hover:opacity-100"
              style={{ color: DIM }}
            >
              <LogOut size={12} /> LOG OUT
            </button>

            {/* Factory stamp */}
            <div
              className="mt-6 p-3 text-[9px] font-black uppercase tracking-[0.24em]"
              style={{ color: DIM, border: `1px solid ${FAINT}`, borderRadius: 14 }}
            >
              MADE IN GWAK.GG / 2026
              <br />
              SERIES 01 OF 12 · v0.1.4
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </AppShell>
  );
}
