"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, CreditCard } from "lucide-react";
import { PhoneFrame } from "../PhoneFrame";

type Phase =
  | "idle"
  | "tap"
  | "sheetIn"
  | "form"
  | "tapPay"
  | "processing"
  | "success"
  | "sheetOut"
  | "balanceUp"
  | "hold";

const SEGMENTS: { phase: Phase; dur: number }[] = [
  { phase: "idle", dur: 1300 },
  { phase: "tap", dur: 350 },
  { phase: "sheetIn", dur: 520 },
  { phase: "form", dur: 1500 },
  { phase: "tapPay", dur: 350 },
  { phase: "processing", dur: 1100 },
  { phase: "success", dur: 1600 },
  { phase: "sheetOut", dur: 500 },
  { phase: "balanceUp", dur: 1100 },
  { phase: "hold", dur: 1400 },
];

const TOTAL_DUR = SEGMENTS.reduce((s, x) => s + x.dur, 0);

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

interface ReelState {
  phase: Phase;
  progress: number;
}

function getState(elapsed: number): ReelState {
  const t = ((elapsed % TOTAL_DUR) + TOTAL_DUR) % TOTAL_DUR;
  let cursor = 0;
  for (const seg of SEGMENTS) {
    if (t < cursor + seg.dur) {
      return {
        phase: seg.phase,
        progress: Math.max(0, Math.min(1, (t - cursor) / seg.dur)),
      };
    }
    cursor += seg.dur;
  }
  return { phase: "idle", progress: 0 };
}

export function MoonPayReel() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      setElapsed(now - startRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const state = getState(elapsed);

  const sheetVisible =
    state.phase === "sheetIn" ||
    state.phase === "form" ||
    state.phase === "tapPay" ||
    state.phase === "processing" ||
    state.phase === "success" ||
    state.phase === "sheetOut";

  const sheetY =
    state.phase === "sheetIn"
      ? (1 - easeOut(state.progress)) * 700
      : state.phase === "sheetOut"
        ? easeIn(state.progress) * 700
        : sheetVisible
          ? 0
          : 700;

  const overlayOpacity =
    state.phase === "sheetIn"
      ? easeOut(state.progress)
      : state.phase === "sheetOut"
        ? 1 - easeIn(state.progress)
        : sheetVisible
          ? 1
          : 0;

  const balanceUsd =
    state.phase === "balanceUp"
      ? easeOut(state.progress) * 25
      : state.phase === "hold"
        ? 25
        : 0;

  const balanceLabel = `$${balanceUsd.toFixed(2)} ready`;

  const balancePulse =
    state.phase === "balanceUp" ? Math.sin(state.progress * Math.PI) : 0;

  const tapBtnPhase: "idle" | "tap" = state.phase === "tap" ? "tap" : "idle";
  const tapBtnProgress = state.phase === "tap" ? state.progress : 0;

  const wrapStyle: CSSProperties = {
    "--phone-scale": "min(1, calc(100vw / 410), calc(100dvh / 864))",
    width: "calc(410px * var(--phone-scale))",
    height: "calc(864px * var(--phone-scale))",
  } as CSSProperties;

  return (
    <div style={wrapStyle} className="relative">
      <div
        style={{
          width: 410,
          height: 864,
          transform: "scale(var(--phone-scale))",
          transformOrigin: "top left",
        }}
      >
        <PhoneFrame
          activeTab="deposit"
          balance={balanceLabel}
          balancePulse={balancePulse}
        >
          <div className="relative h-full w-full overflow-hidden bg-black">
            <DepositScreen
              tapPhase={tapBtnPhase}
              tapProgress={tapBtnProgress}
            />

            {sheetVisible && (
              <div
                className="absolute inset-0 bg-black"
                style={{ opacity: overlayOpacity * 0.55 }}
              />
            )}

            {sheetVisible && (
              <MoonPaySheet
                translateY={sheetY}
                phase={state.phase}
                progress={state.progress}
              />
            )}

            {state.phase === "success" && (
              <FlyingTokens progress={state.progress} />
            )}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}

function DepositScreen({
  tapPhase,
  tapProgress,
}: {
  tapPhase: "idle" | "tap";
  tapProgress: number;
}) {
  const isTap = tapPhase === "tap";
  const scale = isTap ? 1 - 0.05 * Math.sin(tapProgress * Math.PI) : 1;

  return (
    <div className="absolute inset-0 flex flex-col items-center px-6 pt-12 text-center text-white">
      <h1 className="text-3xl font-bold">Deposit</h1>
      <p className="mt-3 max-w-sm text-sm text-neutral-400">
        Fund with a card, or send USDC (Solana) directly.
      </p>

      <button
        type="button"
        disabled
        className="relative mt-8 flex w-full max-w-sm items-center justify-center gap-2 overflow-hidden rounded-2xl bg-green-500 px-6 py-4 text-base font-bold text-black shadow-[0_10px_30px_-10px_rgba(34,197,94,0.6)] disabled:opacity-100"
        style={{ transform: `scale(${scale})` }}
      >
        <CreditCard size={18} />
        <span className="relative z-10">Buy USDC with card</span>
        {isTap && <Ripple progress={tapProgress} />}
      </button>

      <div className="mt-6 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
        <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
          Or send USDC (Solana) to
        </div>
        <div className="mt-2 break-all font-mono text-[11px] text-neutral-300">
          GwAk7zVnKp9F3rJ8mQxPyL5cN2vR4tHjB6sD1eU3wXf
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-xs font-semibold text-white">
          <Copy size={14} />
          Copy address
        </div>
      </div>
    </div>
  );
}

function MoonPaySheet({
  translateY,
  phase,
  progress,
}: {
  translateY: number;
  phase: Phase;
  progress: number;
}) {
  const isSuccess = phase === "success" || phase === "sheetOut";
  const successProgress = phase === "success" ? progress : 1;

  const formOpacity = isSuccess ? Math.max(0, 1 - successProgress * 4) : 1;
  const formShift = isSuccess ? -successProgress * 24 : 0;
  const successOpacity = isSuccess
    ? Math.min(1, Math.max(0, (successProgress - 0.15) * 3))
    : 0;
  const successShift = isSuccess
    ? (1 - Math.min(1, successProgress * 2)) * 30
    : 30;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl text-white"
      style={{
        transform: `translateY(${translateY}px)`,
        height: 540,
        background:
          "linear-gradient(180deg, #0f0f12 0%, #07070a 60%, #050507 100%)",
        boxShadow:
          "0 -20px 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex justify-center pt-3">
        <div className="h-1 w-10 rounded-full bg-white/15" />
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <MoonPayLogo size={20} />
        <span className="text-sm font-bold tracking-tight">MoonPay</span>
      </div>

      <div className="relative mt-2 h-[480px]">
        <div
          className="absolute inset-x-0 top-0 px-5"
          style={{
            opacity: formOpacity,
            transform: `translateY(${formShift}px)`,
          }}
        >
          <PaymentForm phase={phase} progress={progress} />
        </div>

        {isSuccess && (
          <div
            className="absolute inset-x-0 top-0 px-5"
            style={{
              opacity: successOpacity,
              transform: `translateY(${successShift}px)`,
            }}
          >
            <SuccessState progress={successProgress} />
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentForm({ phase, progress }: { phase: Phase; progress: number }) {
  const isProcessing = phase === "processing";
  const isPayTap = phase === "tapPay";
  const payScale = isPayTap ? 1 - 0.04 * Math.sin(progress * Math.PI) : 1;

  return (
    <div className="flex h-full flex-col">
      <div className="mt-2 text-center text-[10px] uppercase tracking-[1.5px] text-neutral-500">
        You're buying
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-1">
        <span className="text-[44px] font-black leading-none tracking-tight">
          $25
        </span>
        <span className="text-2xl font-semibold leading-none text-neutral-500">
          .00
        </span>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-neutral-400">
        <UsdcLogo size={14} />
        <span>25 USDC on Solana</span>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[10px] uppercase tracking-[1.5px] text-neutral-500">
          Pay with
        </div>
        <CreditCardPreview />
      </div>

      <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
        <Row label="You receive" value="25.00 USDC" />
        <Row label="Network fee" value="$0.00" />
        <Row label="Processing" value="$0.85" />
        <div className="mt-2 border-t border-white/5 pt-2">
          <Row label="Total" value="$25.85" bold />
        </div>
      </div>

      <div className="mt-auto pb-5 pt-4">
        <button
          type="button"
          disabled
          className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-white px-6 py-4 text-base font-bold text-black disabled:opacity-100"
          style={{ transform: `scale(${payScale})` }}
        >
          {isProcessing ? (
            <>
              <Spinner />
              <span>Processing payment</span>
            </>
          ) : (
            <span className="relative z-10">Pay $25.85</span>
          )}
          {isPayTap && <Ripple progress={progress} dark />}
        </button>
        <div className="mt-2.5 text-center text-[10px] uppercase tracking-wider text-neutral-600">
          Secured by MoonPay
        </div>
      </div>
    </div>
  );
}

function SuccessState({ progress }: { progress: number }) {
  const checkScale = Math.min(1, easeOut(progress * 1.6));
  const ringPulse = Math.sin(Math.min(1, progress * 1.4) * Math.PI) * 0.3;

  return (
    <div className="flex h-full flex-col items-center justify-center pb-8 text-center">
      <div className="relative">
        <div
          className="absolute inset-0 rounded-full bg-green-500/30"
          style={{
            transform: `scale(${1 + ringPulse * 1.5})`,
            opacity: 1 - ringPulse * 2,
          }}
        />
        <div
          className="relative flex h-24 w-24 items-center justify-center rounded-full bg-green-500/20 ring-2 ring-green-500/50"
          style={{ transform: `scale(${checkScale})` }}
        >
          <Check size={48} className="text-green-400" strokeWidth={3} />
        </div>
      </div>

      <div className="mt-7 text-3xl font-black tracking-tight">
        $25.00 USDC
      </div>
      <div className="mt-1 text-sm text-neutral-400">Sent to your wallet</div>

      <div className="mt-6 flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1.5 text-[11px] font-semibold text-green-300">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_#4ade80]" />
        Funds arrive in seconds
      </div>
    </div>
  );
}

function CreditCardPreview() {
  return (
    <div
      className="relative h-[140px] w-full overflow-hidden rounded-2xl p-4 text-white shadow-lg"
      style={{
        background:
          "linear-gradient(135deg, #1d4ed8 0%, #1e293b 50%, #0f172a 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.10) 45%, transparent 60%)",
        }}
      />

      <div className="relative">
        <div
          className="h-7 w-9 rounded-md"
          style={{
            background:
              "linear-gradient(135deg, #fde68a 0%, #ca8a04 50%, #fde68a 100%)",
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)",
          }}
        />
      </div>

      <div className="relative mt-5 font-mono text-[18px] tracking-[0.18em]">
        •••• •••• •••• 4242
      </div>

      <div className="relative mt-3 flex items-end justify-between text-[10px] tracking-wider">
        <div>
          <div className="text-white/40">CARDHOLDER</div>
          <div className="mt-0.5 font-bold">JANE DEGEN</div>
        </div>
        <div className="text-right">
          <div className="text-white/40">EXPIRES</div>
          <div className="mt-0.5 font-bold">12/27</div>
        </div>
        <div className="text-lg font-black italic">VISA</div>
      </div>
    </div>
  );
}

function FlyingTokens({ progress }: { progress: number }) {
  const COUNT = 7;
  const tokens = [];
  for (let i = 0; i < COUNT; i++) {
    const delay = i * 0.07;
    const flyDur = 0.7;
    const localT = (progress - delay) / flyDur;
    if (localT <= 0 || localT >= 1) continue;
    const eased = easeOut(localT);
    const startX = 195 + (i - (COUNT - 1) / 2) * 14 + Math.sin(i * 1.3) * 6;
    const startY = 480;
    const endX = 205;
    const endY = 75;
    const x = startX + (endX - startX) * eased;
    const arc = -110 * Math.sin(localT * Math.PI);
    const y = startY + (endY - startY) * eased + arc;
    const opacity =
      localT < 0.12
        ? localT / 0.12
        : localT > 0.85
          ? Math.max(0, (1 - localT) / 0.15)
          : 1;
    const scale = 0.7 + 0.5 * Math.sin(localT * Math.PI);
    tokens.push(
      <div
        key={i}
        className="pointer-events-none absolute z-30"
        style={{
          left: x - 11,
          top: y - 11,
          opacity,
          transform: `scale(${scale})`,
        }}
      >
        <UsdcLogo size={22} glow />
      </div>,
    );
  }
  return <>{tokens}</>;
}

function Ripple({
  progress,
  dark = false,
}: {
  progress: number;
  dark?: boolean;
}) {
  const eased = easeOut(progress);
  const scale = 0.4 + eased * 1.8;
  const opacity = (1 - eased) * 0.55;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute left-1/2 top-1/2 h-[80px] w-[80px] rounded-full ${dark ? "bg-black" : "bg-white"}`}
      style={{
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
      }}
    />
  );
}

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between py-0.5">
      <span className={bold ? "font-bold text-white" : "text-neutral-400"}>
        {label}
      </span>
      <span className={bold ? "font-bold text-white" : "text-neutral-200"}>
        {value}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
  );
}

function MoonPayLogo({ size = 20 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #7B66FF 0%, #5B47E0 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
      }}
    >
      <span
        className="font-black text-white"
        style={{ fontSize: size * 0.55, lineHeight: 1 }}
      >
        M
      </span>
    </div>
  );
}

function UsdcLogo({ size = 14, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <div
      className="flex items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #2775CA 0%, #1a5ba1 100%)",
        boxShadow: glow
          ? "0 0 12px rgba(39,117,202,0.6), inset 0 1px 0 rgba(255,255,255,0.25)"
          : "inset 0 1px 0 rgba(255,255,255,0.18)",
      }}
    >
      <span
        className="font-black text-white"
        style={{ fontSize: size * 0.62, lineHeight: 1 }}
      >
        $
      </span>
    </div>
  );
}
