"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useFundWallet,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, CreditCard, Zap } from "lucide-react";
import { Connection } from "@solana/web3.js";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { usePreferences } from "@/components/onboarding/PreferencesProvider";
import { ProfileShareCard } from "@/components/settings/ProfileShareCard";
import { RAILS } from "@/lib/feed/rails";
import type { FeedPrefs } from "@/lib/feed/preferences";
import { ev } from "@/lib/analytics";
import {
  depositDevToolsVisible,
  feedRailPrefsVisible,
} from "@/lib/client-features";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";
import {
  decodeBase64Tx,
  signAndSubmitTx,
} from "@/lib/bets/post-with-consolidation";
import {
  BG,
  FG,
  ACCENT,
  GREEN,
  DIM,
  FAINT,
  PANEL,
  PANEL_2,
  FONT_DISPLAY,
  Headline,
  Stamp,
} from "@/components/v2/ui";

const DEFAULT_FUND_AMOUNT_USD = "25";
const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const showDevTools = depositDevToolsVisible();
const showFeedPrefs = feedRailPrefsVisible();

export default function DepositPage() {
  const { ready, authenticated, getAccessToken, login, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signTransaction } = useSignTransaction();
  const { usdc, jupUsd, refresh } = useWalletBalance(wallet?.address);
  const { prefs, setPrefs } = usePreferences();
  const { fundWallet } = useFundWallet();
  const [funding, setFunding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertSuccess, setConvertSuccess] = useState<string | null>(null);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const autoCreateAttemptedRef = useRef(false);

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

  const togglePref = (key: keyof FeedPrefs) => {
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

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

  const convertJupUsdToUsdc = async () => {
    if (!wallet?.address || converting) return;
    setConverting(true);
    setConvertError(null);
    setConvertSuccess(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const resp = await fetch("/api/dev/convert-jupusd", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ walletAddress: wallet.address }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as {
        swapTransaction: string;
        jupUsdAmount: number;
        expectedUsdcOut: number;
      };
      const txBytes = decodeBase64Tx(
        data.swapTransaction,
        "jupUSD conversion tx",
      );
      const sig = await signAndSubmitTx(txBytes, wallet, signTransaction, {
        skipPreflight: true,
      });
      const conn = new Connection(RPC_URL, "confirmed");
      const result = await conn.confirmTransaction(sig, "confirmed");
      if (result.value.err) {
        throw new Error(
          `Conversion failed on chain: ${JSON.stringify(result.value.err)}`,
        );
      }
      setConvertSuccess(
        `Converted $${data.jupUsdAmount.toFixed(2)} jupUSD to about $${data.expectedUsdcOut.toFixed(2)} USDC.`,
      );
      setTimeout(() => void refresh(), 1500);
    } catch (err) {
      console.error("[deposit] convert jupUSD error:", err);
      setConvertError(err instanceof Error ? err.message : String(err));
    } finally {
      setConverting(false);
    }
  };

  const rail =
    ready && authenticated && showFeedPrefs ? (
      <div className="flex flex-col gap-3">
        <div
          className="p-4"
          style={{
            background: PANEL,
            borderRadius: 16,
            border: `1px solid ${FAINT}`,
          }}
        >
          <Stamp label="Feed Preferences" />
          <p
            className="mt-3 text-[11px] font-black uppercase tracking-widest leading-relaxed"
            style={{ color: DIM }}
          >
            Use the main settings panel to toggle rails.
          </p>
        </div>
      </div>
    ) : undefined;

  return (
    <AppShell
      rail={rail}
      railTitle="Settings"
      hideEmptyRail
      mainClassName={`${ready && authenticated ? "" : "[&+aside]:hidden"} lg:overflow-y-auto`}
    >
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
          {/* Buy with card. */}
          <div>
            <Stamp label="DEPOSIT" />
            <button
              onClick={buyWithCard}
              disabled={!wallet?.address || funding}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[14px] font-black uppercase tracking-widest active:scale-[0.97] disabled:opacity-40"
              style={{
                background: ACCENT,
                color: BG,
                boxShadow: `0 4px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
              }}
            >
              {funding ? (
                <>
                  <Zap size={16} strokeWidth={3} fill={BG} />
                  OPENING…
                </>
              ) : (
                <>
                  <CreditCard size={16} strokeWidth={2.8} />
                  BUY USDC WITH CARD
                </>
              )}
            </button>
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
                style={{ color: "#fb7185" }}
              >
                {walletError.slice(0, 120)}
              </p>
            ) : null}
          </div>

          {showDevTools ? (
            <div className="mt-5">
              <Stamp label="DEV" />
              <div
                className="mt-2 p-4"
                style={{
                  background: PANEL,
                  borderRadius: 18,
                  border: `1px solid ${FAINT}`,
                }}
              >
                <div
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  USDC {usdc == null ? "..." : `$${usdc.toFixed(2)}`} · jupUSD{" "}
                  {jupUsd == null ? "..." : `$${jupUsd.toFixed(2)}`}
                </div>
                <button
                  onClick={convertJupUsdToUsdc}
                  disabled={!wallet?.address || converting || !jupUsd || jupUsd <= 0}
                  className="mt-3 flex w-full items-center justify-center rounded-xl py-3 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                  style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
                >
                  {converting ? "CONVERTING..." : "CONVERT JUPUSD TO USDC"}
                </button>
                {convertError ? (
                  <p
                    className="mt-2 text-[10px] font-black uppercase tracking-widest leading-relaxed"
                    style={{ color: "#fb7185" }}
                  >
                    {convertError.slice(0, 160)}
                  </p>
                ) : null}
                {convertSuccess ? (
                  <p
                    className="mt-2 text-[10px] font-black uppercase tracking-widest leading-relaxed"
                    style={{ color: GREEN }}
                  >
                    {convertSuccess}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <ProfileShareCard walletAddress={wallet?.address ?? null} />

          {/* Feed prefs */}
          {showFeedPrefs ? (
            <div className="mt-6">
              <Stamp label="FEED" />
              <div
                className="mt-2 overflow-hidden"
                style={{
                  background: PANEL,
                  borderRadius: 18,
                  border: `1px solid ${FAINT}`,
                }}
              >
                {RAILS.map(({ key, label, description, stripe }) => {
                  const enabled = prefs[key];
                  return (
                    <button
                      key={key}
                      onClick={() => togglePref(key)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:opacity-70"
                      style={{ borderBottom: `1px solid ${FAINT}` }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: stripe }}
                      />
                      <div className="flex-1">
                        <div className="text-[13px] font-black uppercase tracking-widest">
                          {label}
                        </div>
                        <div
                          className="text-[10px] font-black uppercase tracking-widest"
                          style={{ color: DIM }}
                        >
                          {description}
                        </div>
                      </div>
                      <div
                        className="relative h-6 w-10 shrink-0 rounded-full transition"
                        style={{
                          background: enabled ? ACCENT : PANEL_2,
                          border: `1px solid ${FAINT}`,
                        }}
                      >
                        <span
                          className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
                          style={{
                            left: enabled ? "calc(100% - 22px)" : "2px",
                            background: enabled ? BG : FG,
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
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
            style={{
              color: DIM,
              border: `1px solid ${FAINT}`,
              borderRadius: 14,
            }}
          >
            MADE IN BREACH / 2026
            <br />
            SERIES 01 OF 12 · v0.1.4-paper
          </div>
        </>
      )}

      </div>
      <BottomNav />
    </AppShell>
  );
}
