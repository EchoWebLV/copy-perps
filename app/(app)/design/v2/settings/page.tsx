import Link from "next/link";
import {
  BG,
  FG,
  ACCENT,
  GREEN,
  DIM,
  FAINT,
  PANEL_2,
  FONT_DISPLAY,
  StoryAvatar,
  Stamp,
  BigNum,
  Headline,
  YellowButton,
} from "@/components/v2/ui";
import { V2BottomNav, V2Header, PANEL_STYLE } from "../shell";
import {
  Copy,
  ChevronRight,
  Bell,
  Shield,
  LogOut,
  Zap,
  Wallet,
} from "lucide-react";

export const dynamic = "force-static";

const MOCK_USER = {
  handle: "@degen_007",
  avatar: "🦊",
  walletShort: "5oZ4...Wpkj",
  balanceUsd: 247.82,
  joinedDays: 42,
};

function Row({
  icon: Icon,
  label,
  value,
  toggle,
  toggleOn,
}: {
  icon: typeof Bell;
  label: string;
  value?: string;
  toggle?: boolean;
  toggleOn?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5"
      style={{ borderBottom: `1px solid ${FAINT}` }}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: PANEL_2, color: FG }}
      >
        <Icon size={16} strokeWidth={2.4} />
      </div>
      <div className="flex-1 text-[13px] font-black uppercase tracking-widest">
        {label}
      </div>
      {value && (
        <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
          {value}
        </div>
      )}
      {toggle ? (
        <div
          className="relative h-6 w-10 rounded-full transition"
          style={{
            background: toggleOn ? ACCENT : PANEL_2,
          }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
            style={{
              left: toggleOn ? "calc(100% - 22px)" : "2px",
              background: toggleOn ? BG : FG,
            }}
          />
        </div>
      ) : (
        <ChevronRight size={16} style={{ color: DIM }} strokeWidth={2.5} />
      )}
    </div>
  );
}

export default function SettingsV2Page() {
  return (
    <main
      className="min-h-screen w-full pb-32"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <V2Header title={`"SETTINGS"`} subtitle="ACCOUNT · WALLET · NOTIFICATIONS" />

      {/* Profile hero */}
      <div className="px-5 pt-5">
        <div className="flex items-center gap-4 p-4" style={PANEL_STYLE}>
          <StoryAvatar emoji={MOCK_USER.avatar} mood="LOADED" size={64} pulse />
          <div className="min-w-0 flex-1">
            <Headline size={26}>{MOCK_USER.handle}</Headline>
            <div className="mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              <span>JOINED {MOCK_USER.joinedDays}D AGO</span>
              <span>·</span>
              <span style={{ color: ACCENT }}>🔥 4 STREAK</span>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet section */}
      <div className="mt-6 px-5">
        <Stamp label="WALLET" />
        <div className="mt-2 overflow-hidden" style={PANEL_STYLE}>
          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                  BALANCE
                </div>
                <div className="mt-1">
                  <BigNum size={32}>${MOCK_USER.balanceUsd.toFixed(2)}</BigNum>
                </div>
                <div className="mt-1 text-[10px] font-black uppercase tracking-widest" style={{ color: GREEN }}>
                  USDC · SOLANA
                </div>
              </div>
              <YellowButton size="md">
                <span className="inline-flex items-center gap-1">
                  <Zap size={14} strokeWidth={3} fill={BG} />
                  TOP UP
                </span>
              </YellowButton>
            </div>

            <div
              className="mt-4 flex items-center gap-2 rounded-xl p-3"
              style={{ background: PANEL_2 }}
            >
              <Wallet size={16} strokeWidth={2.4} style={{ color: DIM }} />
              <span className="font-mono text-[12px]" style={{ color: FG }}>
                {MOCK_USER.walletShort}
              </span>
              <button
                type="button"
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-widest"
                style={{ background: BG, color: FG }}
              >
                <Copy size={11} strokeWidth={2.8} />
                COPY
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-2xl py-3 font-black uppercase tracking-widest active:scale-[0.97]"
                style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}`, fontSize: "11px" }}
              >
                WITHDRAW
              </button>
              <button
                type="button"
                className="rounded-2xl py-3 font-black uppercase tracking-widest active:scale-[0.97]"
                style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}`, fontSize: "11px" }}
              >
                EXPORT KEY
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="mt-6 px-5">
        <Stamp label="NOTIFICATIONS" />
        <div className="mt-2 overflow-hidden" style={PANEL_STYLE}>
          <Row icon={Bell} label="Bot opens position" toggle toggleOn />
          <Row icon={Bell} label="Bot closes (win)" toggle toggleOn />
          <Row icon={Bell} label="Bot closes (loss)" toggle toggleOn={false} />
          <Row icon={Bell} label="Daily summary" toggle toggleOn />
          <Row icon={Bell} label="Streak alerts" toggle toggleOn />
        </div>
      </div>

      {/* Preferences */}
      <div className="mt-6 px-5">
        <Stamp label="PREFERENCES" />
        <div className="mt-2 overflow-hidden" style={PANEL_STYLE}>
          <Row icon={Shield} label="Default stake size" value="$10" />
          <Row icon={Shield} label="Auto-tail filter" value="ALL BOTS" />
          <Row icon={Shield} label="Theme" value="DARK" />
        </div>
      </div>

      {/* Danger zone */}
      <div className="mt-6 px-5">
        <Stamp label="ACCOUNT" />
        <div className="mt-2 overflow-hidden" style={PANEL_STYLE}>
          <Row icon={Shield} label="Privacy & data" />
          <Row icon={Shield} label="Terms · Privacy policy" />
          <Row icon={LogOut} label="Sign out" />
        </div>
      </div>

      {/* Factory stamp */}
      <div className="mt-8 px-5">
        <div
          className="border-2 p-3 text-[9px] font-black uppercase tracking-[0.24em]"
          style={{ borderColor: FAINT, color: DIM }}
        >
          MADE IN GWAK / 2026
          <br />
          SERIES 01 OF 12 · NOT FOR RESALE
          <br />
          v0.1.4-paper
        </div>
      </div>

      <Link
        href="/design/v2"
        className="mt-6 inline-block px-5 text-[10px] font-black uppercase tracking-widest"
        style={{ opacity: 0.5 }}
      >
        ← BACK TO SURFACES
      </Link>

      <V2BottomNav />
    </main>
  );
}
