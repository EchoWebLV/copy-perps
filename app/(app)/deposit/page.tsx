"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { useState } from "react";
import { Copy, Check, LogOut, CreditCard, Zap } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { usePreferences } from "@/components/onboarding/PreferencesProvider";
import { RAILS } from "@/lib/feed/rails";
import type { FeedPrefs } from "@/lib/feed/preferences";
import { ev } from "@/lib/analytics";
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

export default function DepositPage() {
  const { ready, authenticated, login, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { prefs, setPrefs } = usePreferences();
  const { fundWallet } = useFundWallet();
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState(false);

  const togglePref = (key: keyof FeedPrefs) => {
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

  const copy = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    ev.depositAddressCopied();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

  const rail =
    ready && authenticated ? (
      <div className="flex flex-col gap-3">
        <div
          className="p-4"
          style={{
            background: PANEL,
            borderRadius: 16,
            border: `1px solid ${FAINT}`,
          }}
        >
          <Stamp label="Wallet" />
          <div
            className="mt-3 break-all font-mono text-[11px]"
            style={{ color: wallet?.address ? FG : DIM }}
          >
            {wallet?.address ?? "GENERATING WALLET..."}
          </div>
        </div>

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
      mainClassName={`${ready && authenticated ? "" : "[&+aside]:hidden"} lg:overflow-y-auto`}
    >
      <div
        className="flex min-h-screen w-full flex-col px-5 pt-12 pb-32 lg:h-full lg:min-h-0 lg:max-w-3xl lg:px-6 lg:pt-6"
        style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
      >
      <div>
        <Headline size={30}>{`"SETTINGS"`}</Headline>
        <p
          className="mt-1 text-[10px] font-black uppercase tracking-[0.22em]"
          style={{ color: DIM }}
        >
          DEPOSIT · WALLET · FEED
        </p>
      </div>

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
          {/* Buy with card — primary CTA */}
          <div className="mt-5">
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
          </div>

          {/* Deposit address card */}
          <div className="mt-5">
            <Stamp label="OR SEND USDC (SOLANA)" />
            <div
              className="mt-2 p-4"
              style={{
                background: PANEL,
                borderRadius: 18,
                border: `1px solid ${FAINT}`,
              }}
            >
              <div
                className="mt-1 break-all font-mono text-[12px]"
                style={{ color: FG, opacity: 0.85 }}
              >
                {wallet?.address ?? "GENERATING WALLET…"}
              </div>
              <button
                onClick={copy}
                disabled={!wallet?.address}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
              >
                {copied ? (
                  <>
                    <Check size={14} strokeWidth={3} style={{ color: GREEN }} />
                    <span style={{ color: GREEN }}>COPIED</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} strokeWidth={2.8} />
                    COPY ADDRESS
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Feed prefs */}
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
