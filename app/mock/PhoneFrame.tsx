"use client";

import { Flame, Wallet, PieChart } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

// Chassis: 410×864 outer, 10px bezel → 390×844 screen inside.
export function PhoneFrame({
  activeTab,
  children,
  balance = "$86.40 ready",
  balancePulse = 0,
}: {
  activeTab: "feed" | "portfolio" | "deposit";
  children: ReactNode;
  balance?: string;
  balancePulse?: number;
}) {
  return (
    <div
      className="relative shrink-0"
      style={{
        width: 410,
        height: 864,
        borderRadius: 56,
        padding: 10,
        background:
          "linear-gradient(160deg, #2c2c30 0%, #18181b 45%, #08080a 100%)",
        boxShadow: [
          "0 50px 100px -20px rgba(0,0,0,0.85)",
          "0 0 0 0.5px rgba(255,255,255,0.08)",
          "inset 0 1px 1.5px rgba(255,255,255,0.10)",
          "inset 0 -1px 1px rgba(0,0,0,0.4)",
        ].join(", "),
      }}
    >
      {/* Side buttons (decorative) */}
      <SideButton style={{ left: -2, top: 110, height: 28 }} />
      <SideButton style={{ left: -2, top: 165, height: 56 }} />
      <SideButton style={{ left: -2, top: 235, height: 56 }} />
      <SideButton style={{ right: -2, top: 215, height: 96 }} />

      {/* Inner screen */}
      <div
        className="relative h-full w-full overflow-hidden bg-black"
        style={{
          borderRadius: 46,
          boxShadow:
            "inset 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 12px rgba(0,0,0,0.5)",
        }}
      >
        <StatusBar />
        <DynamicIsland />
        <BalancePillMock label={balance} pulse={balancePulse} />
        <div className="absolute inset-x-0 top-[44px] bottom-[68px] overflow-hidden">
          {children}
        </div>
        <BottomNav activeTab={activeTab} />
      </div>
    </div>
  );
}

function SideButton({ style }: { style: CSSProperties }) {
  return (
    <div
      className="absolute"
      style={{
        width: 4,
        borderRadius: 2,
        background: "linear-gradient(90deg, #18181b 0%, #303034 60%, #1a1a1d 100%)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
        ...style,
      }}
    />
  );
}

function DynamicIsland() {
  return (
    <div
      className="absolute top-[10px] left-1/2 z-40 -translate-x-1/2 rounded-full"
      style={{
        width: 124,
        height: 34,
        background: "#000",
        boxShadow:
          "inset 0 0 6px rgba(0,0,0,1), 0 0 0 1px rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.4)",
      }}
    >
      {/* Camera dot */}
      <div
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 8,
          height: 8,
          background:
            "radial-gradient(circle at 30% 30%, #1a3a5a 0%, #0a1020 60%, #000 100%)",
          boxShadow:
            "inset 0 0 2px rgba(80,140,220,0.4), 0 0 0 0.5px rgba(255,255,255,0.05)",
        }}
      />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex h-[44px] items-center justify-between px-7 text-[14px] font-semibold text-white">
      <span className="pl-1">9:41</span>
      <span className="flex items-center gap-1.5 pr-1">
        <SignalIcon />
        <WifiIcon />
        <BatteryIcon />
      </span>
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
      <rect x="0" y="7" width="3" height="4" rx="0.6" />
      <rect x="4.5" y="5" width="3" height="6" rx="0.6" />
      <rect x="9" y="3" width="3" height="8" rx="0.6" />
      <rect x="13.5" y="0" width="3" height="11" rx="0.6" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
      <path
        d="M8 2c-2.7 0-5.2.9-7.2 2.5L8 11l7.2-6.5C13.2 2.9 10.7 2 8 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="26" height="13" viewBox="0 0 26 13" fill="none">
      <rect
        x="0.5"
        y="0.5"
        width="22"
        height="12"
        rx="3"
        stroke="currentColor"
        opacity="0.4"
      />
      <rect x="2" y="2" width="19" height="9" rx="2" fill="currentColor" />
      <rect
        x="23.5"
        y="4"
        width="2"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  );
}

function BalancePillMock({
  label,
  pulse,
}: {
  label: string;
  pulse: number;
}) {
  const scale = 1 + 0.08 * pulse;
  const glow = 0.18 + pulse * 0.55;
  return (
    <div
      className="pointer-events-none absolute top-[60px] left-1/2 z-20 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-3.5 py-1.5 text-[11px] font-semibold text-emerald-300 backdrop-blur-xl"
      style={{
        transform: `translateX(-50%) scale(${scale})`,
        boxShadow: `0 0 24px rgba(16,185,129,${glow})`,
      }}
    >
      {label}
    </div>
  );
}

function BottomNav({
  activeTab,
}: {
  activeTab: "feed" | "portfolio" | "deposit";
}) {
  const tabs = [
    { key: "feed", icon: Flame, label: "Feed" },
    { key: "deposit", icon: Wallet, label: "Deposit" },
    { key: "portfolio", icon: PieChart, label: "Portfolio" },
  ] as const;
  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 border-t border-white/5 bg-black/80 backdrop-blur-xl">
      <div className="flex items-stretch justify-around">
        {tabs.map(({ key, icon: Icon, label }) => {
          const active = key === activeTab;
          return (
            <div
              key={key}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-semibold uppercase tracking-wider transition ${
                active ? "text-white" : "text-neutral-500"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
