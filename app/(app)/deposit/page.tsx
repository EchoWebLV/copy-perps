"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useFundWallet,
  useWallets,
} from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  Bell,
  Check,
  Copy,
  CreditCard,
  LogOut,
} from "lucide-react";
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
  STREAK,
  FONT_DISPLAY,
  Headline,
} from "@/components/v2/ui";
import { InstallNudge } from "@/components/pwa/InstallNudge";

/** Card-money amounts the Buy chips offer. Drives the MoonPay `amount`. */
const BUY_AMOUNTS = [25, 50, 100, 250] as const;
const DEFAULT_BUY_AMOUNT = 50;

const CARD_STYLE = {
  background: PANEL,
  borderRadius: 24,
  border: `1px solid ${FAINT}`,
} as const;

/** Acid-yellow scanner reticle corner. */
function Bracket({
  pos,
}: {
  pos: "tl" | "tr" | "bl" | "br";
}) {
  const base: React.CSSProperties = {
    position: "absolute",
    width: 22,
    height: 22,
    borderColor: ACCENT,
    borderStyle: "solid",
    borderWidth: 0,
  };
  const corners: Record<typeof pos, React.CSSProperties> = {
    tl: { top: -7, left: -7, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
    tr: { top: -7, right: -7, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
    bl: { bottom: -7, left: -7, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
    br: { bottom: -7, right: -7, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  };
  return <span style={{ ...base, ...corners[pos] }} aria-hidden />;
}

export default function DepositPage() {
  const { ready, authenticated, getAccessToken, login, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { totalUsd, refresh } = useWalletBalance(wallet?.address);
  const { fundWallet } = useFundWallet();
  const [funding, setFunding] = useState(false);
  const [buyAmount, setBuyAmount] = useState<number>(DEFAULT_BUY_AMOUNT);
  const [customRaw, setCustomRaw] = useState("");
  const [isCustom, setIsCustom] = useState(false);
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

  // Active buy amount: the typed custom value when in custom mode, else the
  // selected preset chip. MoonPay validates its own floor/ceiling at checkout.
  const effectiveAmount = isCustom ? parseFloat(customRaw) : buyAmount;
  const amountValid = Number.isFinite(effectiveAmount) && effectiveAmount >= 1;
  const buyLabel = amountValid
    ? Number.isInteger(effectiveAmount)
      ? `$${effectiveAmount}`
      : `$${effectiveAmount.toFixed(2)}`
    : "$0";

  function onCustomChange(raw: string) {
    let s = raw.replace(/[^\d.]/g, "");
    const dot = s.indexOf(".");
    if (dot !== -1) {
      const intPart = s.slice(0, dot);
      const decPart = s.slice(dot + 1).replace(/\./g, "").slice(0, 2);
      s = `${intPart}.${decPart}`;
    }
    if (s.length > 1 && s[0] === "0" && s[1] !== ".") s = s.replace(/^0+/, "");
    setCustomRaw(s);
    setIsCustom(true);
  }

  const createAppWallet = useCallback(async () => {
    if (wallet || creatingWallet) return;
    setWalletError(null);
    setCreatingWallet(true);
    try {
      await createWallet();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Privy can report the embedded wallet already exists before
      // useWallets() surfaces it (hydration race on load). That's benign — the
      // wallet appears a moment later — so don't log it or show an error.
      if (/already has an embedded wallet/i.test(msg)) return;
      console.error("[deposit] create wallet error:", err);
      setWalletError(msg);
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

  const buyUsdc = async () => {
    if (!wallet?.address || funding || !amountValid) return;
    ev.fundWithCardClicked();
    setFunding(true);
    try {
      await fundWallet({
        address: wallet.address,
        options: {
          asset: "USDC",
          amount: String(effectiveAmount),
          defaultFundingMethod: "card",
          card: { preferredProvider: "moonpay" },
        },
      });
      ev.fundWithCardCompleted();
      void refresh();
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
        className="flex h-full w-full flex-col overflow-hidden"
        style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
      >
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-32 lg:px-6 lg:pb-8">
          <div className="mx-auto w-full lg:max-w-xl">
        {!ready && (
          <p
            className="mt-6 text-[11px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            LOADING…
          </p>
        )}

        {ready && !authenticated && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Headline size={44}>WALLET</Headline>
            <p
              className="mt-3 max-w-[16rem] text-[11px] font-black uppercase tracking-widest leading-relaxed"
              style={{ color: DIM }}
            >
              Log in to buy USDC, get your address, and cash out
            </p>
            <button
              onClick={() => {
                ev.loginClicked("deposit");
                login();
              }}
              className="mt-7 rounded-2xl px-8 py-3.5 text-[13px] font-black uppercase tracking-widest active:scale-[0.97]"
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
            {/* Header — brand identity + live network chip */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[15px] font-black"
                  style={{ background: ACCENT, color: BG }}
                >
                  G
                </span>
                <Headline size={22}>WALLET</Headline>
              </div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest"
                style={{ background: PANEL_2, color: DIM, border: `1px solid ${FAINT}` }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}
                />
                Solana · Mainnet
              </span>
            </div>

            {/* PWA install nudge — funding is the natural "set up your app" surface. */}
            <InstallNudge />

            {/* ── Balance hero ── */}
            <div className="relative overflow-hidden p-6" style={CARD_STYLE}>
              {/* soft acid glow behind the number */}
              <div
                aria-hidden
                className="pointer-events-none absolute -top-16 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full blur-3xl animate-pulse"
                style={{ background: `${ACCENT}22` }}
              />
              <div className="relative flex items-start justify-between">
                <div
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  Ready to trade
                </div>
                <WithdrawButton
                  maxUsd={totalUsd ?? 0}
                  onComplete={() => void refresh()}
                  triggerClassName="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition active:scale-[0.96] disabled:opacity-30"
                />
              </div>
              <div className="relative mt-3 flex items-end gap-1.5">
                <span
                  className="font-black tabular-nums leading-none"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 64,
                    letterSpacing: "-0.04em",
                    fontStretch: "condensed",
                    color: FG,
                  }}
                >
                  {totalUsd == null ? "$0.00" : `$${totalUsd.toFixed(2)}`}
                </span>
              </div>
              <div
                className="relative mt-3 text-[10px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                USDC balance · spendable now
              </div>
            </div>

            {/* ── Buy USDC ── */}
            <div className="mt-4 p-5" style={CARD_STYLE}>
              <div className="flex items-center justify-between">
                <div
                  className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest"
                  style={{ color: FG }}
                >
                  <CreditCard size={14} strokeWidth={2.8} style={{ color: ACCENT }} />
                  Buy USDC
                </div>
                <span
                  className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  Apple Pay · Card
                </span>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                {BUY_AMOUNTS.map((amt) => {
                  const active = !isCustom && buyAmount === amt;
                  return (
                    <button
                      key={amt}
                      onClick={() => {
                        setIsCustom(false);
                        setCustomRaw("");
                        setBuyAmount(amt);
                      }}
                      className="rounded-xl py-3 text-[14px] font-black tabular-nums transition active:scale-[0.96]"
                      style={
                        active
                          ? {
                              background: ACCENT,
                              color: BG,
                              boxShadow: `0 0 0 1px ${ACCENT}, 0 4px 14px ${ACCENT}33`,
                            }
                          : { background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }
                      }
                    >
                      ${amt}
                    </button>
                  );
                })}
              </div>

              {/* Custom amount */}
              <div
                className="mt-2 flex items-center gap-2 rounded-xl px-3.5 transition"
                style={
                  isCustom
                    ? { background: PANEL_2, boxShadow: `0 0 0 1px ${ACCENT}, 0 4px 14px ${ACCENT}22` }
                    : { background: PANEL_2, border: `1px solid ${FAINT}` }
                }
              >
                <span
                  className="text-[15px] font-black"
                  style={{ color: isCustom ? ACCENT : DIM }}
                >
                  $
                </span>
                <input
                  inputMode="decimal"
                  value={customRaw}
                  onFocus={() => setIsCustom(true)}
                  onChange={(e) => onCustomChange(e.target.value)}
                  placeholder="Custom amount"
                  className="w-full bg-transparent py-3 text-[14px] font-black tabular-nums outline-none placeholder:text-[12px] placeholder:font-black placeholder:uppercase placeholder:tracking-widest placeholder:text-white/40"
                  style={{ color: FG }}
                />
              </div>

              {wallet?.address ? (
                <button
                  onClick={buyUsdc}
                  disabled={funding || !amountValid}
                  className="mt-3 flex w-full items-center justify-center rounded-2xl py-4 text-[14px] font-black uppercase tracking-widest transition active:scale-[0.98] disabled:opacity-40"
                  style={{
                    background: ACCENT,
                    color: BG,
                    boxShadow: `0 4px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
                  }}
                >
                  {funding ? "OPENING CHECKOUT…" : `BUY ${buyLabel} USDC`}
                </button>
              ) : walletsReady ? (
                <button
                  onClick={createAppWallet}
                  disabled={creatingWallet}
                  className="mt-3 flex w-full items-center justify-center rounded-2xl py-4 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.98] disabled:opacity-40"
                  style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
                >
                  {creatingWallet ? "CREATING WALLET…" : "CREATE APP WALLET"}
                </button>
              ) : (
                <div
                  className="mt-3 flex w-full items-center justify-center rounded-2xl py-4 text-[12px] font-black uppercase tracking-widest"
                  style={{ background: PANEL_2, color: DIM, border: `1px solid ${FAINT}` }}
                >
                  WALLET LOADING…
                </div>
              )}
              {!wallet?.address && walletError ? (
                <p
                  className="mt-2 text-[10px] font-black uppercase tracking-widest leading-relaxed"
                  style={{ color: RED }}
                >
                  {walletError.slice(0, 120)}
                </p>
              ) : null}
            </div>

            {/* ── Receive USDC (QR) ── */}
            <div className="mt-4 p-5" style={CARD_STYLE}>
              <div className="flex items-center justify-between">
                <div
                  className="text-[12px] font-black uppercase tracking-widest"
                  style={{ color: FG }}
                >
                  Receive USDC
                </div>
                <span
                  className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  Scan to send
                </span>
              </div>

              <div className="mt-5 flex flex-col items-center">
                <div
                  className="relative flex items-center justify-center rounded-2xl p-4"
                  style={{
                    background: FG,
                    boxShadow: `0 0 32px ${ACCENT}22`,
                  }}
                >
                  <Bracket pos="tl" />
                  <Bracket pos="tr" />
                  <Bracket pos="bl" />
                  <Bracket pos="br" />
                  {wallet?.address ? (
                    <QRCodeSVG
                      value={wallet.address}
                      size={176}
                      level="M"
                      bgColor={FG}
                      fgColor={BG}
                      marginSize={0}
                    />
                  ) : (
                    <div
                      className="flex h-[176px] w-[176px] items-center justify-center rounded-lg text-[10px] font-black uppercase tracking-widest"
                      style={{ background: PANEL_2, color: DIM }}
                    >
                      Wallet loading…
                    </div>
                  )}
                </div>
              </div>

              <div
                className="mt-5 flex items-center gap-3 rounded-2xl p-3"
                style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
              >
                <div
                  className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed"
                  style={{ color: wallet?.address ? FG : DIM }}
                >
                  {wallet?.address ?? "Wallet not ready"}
                </div>
                <button
                  onClick={copyAddress}
                  disabled={!wallet?.address}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:opacity-40"
                  style={
                    copied
                      ? { background: GREEN, color: BG }
                      : { background: ACCENT, color: BG }
                  }
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

              {/* Network safety note — sending the wrong asset/chain is unrecoverable. */}
              <div
                className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: `${STREAK}12`, border: `1px solid ${STREAK}33` }}
              >
                <AlertTriangle size={13} strokeWidth={2.8} style={{ color: STREAK, marginTop: 1 }} />
                <p
                  className="text-[10px] font-black uppercase tracking-widest leading-relaxed"
                  style={{ color: STREAK }}
                >
                  Send only USDC on Solana. Other tokens or networks are lost forever.
                </p>
              </div>
            </div>

            {/* ── Push alerts ── */}
            {pushSupported ? (
              <div
                className="mt-4 flex items-center justify-between gap-3 p-4"
                style={{ background: PANEL, borderRadius: 20, border: `1px solid ${FAINT}` }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
                  >
                    <Bell size={15} strokeWidth={2.6} style={{ color: ACCENT }} />
                  </span>
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
                </div>
                {pushToggleState === "on" ? (
                  <span
                    className="shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
                    style={{ color: BG, background: GREEN }}
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

            {/* ── Log out ── */}
            <button
              onClick={logout}
              className="mx-auto mt-8 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition hover:opacity-100"
              style={{ color: DIM }}
            >
              <LogOut size={12} /> LOG OUT
            </button>

            {/* ── Factory stamp ── */}
            <div
              className="mt-6 flex items-center justify-between p-3 text-[9px] font-black uppercase tracking-[0.24em]"
              style={{ color: DIM, border: `1px solid ${FAINT}`, borderRadius: 14 }}
            >
              <span>MADE IN GWAK.GG / 2026</span>
              <span style={{ color: FAINT }}>SERIES 01 · v0.1.4</span>
            </div>
          </>
        )}
          </div>
        </div>
      </div>
      <BottomNav />
    </AppShell>
  );
}
