"use client";

export type CardPhase = "idle" | "tap" | "pending" | "confirmed";

interface CardProps {
  phase: CardPhase;
  progress: number;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function fmtMc(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

// ── Meme card ─────────────────────────────────────────────

export function MockMemeCard({ phase, progress }: CardProps) {
  const change = 18.4;
  const mc = 2.10e9;

  return (
    <div
      className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-4 text-white"
      style={{
        background:
          "radial-gradient(ellipse at top, hsl(20 80% 13%), #050505 65%)",
      }}
    >
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#ff5e3a] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Coin
      </span>
      <div
        className="absolute top-[56px] right-5 flex h-14 w-14 items-center justify-center rounded-full ring-1 ring-white/10"
        style={{
          background: "linear-gradient(135deg, #f0abfc, #fb923c)",
        }}
      >
        <span className="text-2xl">🐶</span>
      </div>

      <div className="mt-[60px] text-[44px] font-black tracking-tight leading-none">
        $WIF
      </div>
      <div className="mt-1 text-sm text-neutral-500">dogwifhat · Solana</div>

      <div className="mt-7">
        <div className="text-[11px] font-bold uppercase tracking-[1.5px] text-neutral-500">
          Market cap
        </div>
        <div className="mt-1 text-4xl font-extrabold">{fmtMc(mc)}</div>
        <div
          className="mt-1 text-base font-semibold"
          style={{ color: "#22c55e" }}
        >
          +{change.toFixed(1)}% · 24h
        </div>
      </div>

      <div
        className="relative mt-5 h-[90px] rounded"
        style={{
          background:
            "linear-gradient(180deg, rgba(34,197,94,0.15), transparent)",
        }}
      >
        <svg
          viewBox="0 0 300 90"
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <path
            d="M0,72 L25,68 L50,75 L75,55 L100,60 L125,40 L150,48 L175,30 L200,38 L225,22 L250,28 L275,15 L300,18"
            fill="none"
            stroke="#22c55e"
            strokeWidth={2.5}
          />
        </svg>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Chip text="Up 18.4% past 24h" level="green" />
        <Chip text="Trading $84M today" level="green" />
        <Chip text="Top trending on DexScreener" level="green" />
      </div>

      <div className="mt-auto pt-4">
        <div className="flex gap-2">
          <StakeBtn label="$10" variant="ghost" />
          <StakeBtn label="$20" variant="ghost" />
          <StakeBtn
            label="$50"
            variant="primary"
            phase={phase}
            progress={progress}
            target
            confirmedLabel="✓ Bought"
          />
        </div>
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Jupiter Swap · ↑ swipe for next
        </div>
      </div>
    </div>
  );
}

// ── Prediction card ───────────────────────────────────────

export function MockPredictionCard({ phase, progress }: CardProps) {
  const yesC = 38;
  const noC = 62;

  return (
    <div
      className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-4 text-white"
      style={{
        background:
          "radial-gradient(ellipse at top, hsl(218 75% 12%), #050505 65%)",
      }}
    >
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#2563eb] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Market
      </span>
      <div
        className="absolute top-[56px] right-5 flex h-14 w-14 items-center justify-center rounded-full ring-1 ring-white/10"
        style={{
          background: "linear-gradient(135deg, #fbbf24, #f97316)",
        }}
      >
        <span className="text-2xl font-black text-white">₿</span>
      </div>

      <div className="mt-14 pr-16 text-2xl font-bold leading-tight">
        Will Bitcoin hit $200k by end of 2026?
      </div>
      <div className="mt-3 text-xs text-neutral-500">
        Resolves Dec 31, 2026 · $4.2M volume
      </div>

      <div className="mt-6 flex gap-2.5">
        <div className="flex-1 rounded-2xl bg-white/[0.04] p-4">
          <div className="text-[11px] tracking-[1px] text-neutral-500 uppercase">
            YES
          </div>
          <div className="mt-1 text-3xl font-extrabold text-[#22c55e]">
            {yesC}¢
          </div>
        </div>
        <div className="flex-1 rounded-2xl bg-white/[0.04] p-4">
          <div className="text-[11px] tracking-[1px] text-neutral-500 uppercase">
            NO
          </div>
          <div className="mt-1 text-3xl font-extrabold text-[#ef4444]">
            {noC}¢
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <Chip text="Volume up 3× past 24h" level="green" />
        <Chip text="$4.2M traded · 24h" level="green" />
      </div>

      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 gap-2">
          <YesNoBtn
            variant="yes"
            phase={phase}
            progress={progress}
            target
          />
          <YesNoBtn variant="no" />
        </div>
        <div className="mt-2 flex gap-2">
          {[5, 10, 20].map((amt) => (
            <button
              key={amt}
              type="button"
              disabled
              className="flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white opacity-100"
            >
              ${amt} YES
            </button>
          ))}
        </div>
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Jupiter Prediction · ↑ swipe for next
        </div>
      </div>
    </div>
  );
}

// ── Whale card ────────────────────────────────────────────

export function MockWhaleCard({ phase, progress }: CardProps) {
  return (
    <div
      className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-4 text-white"
      style={{
        background:
          "radial-gradient(ellipse at top, hsl(275 70% 13%), #050505 65%)",
      }}
    >
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#7c3aed] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Whale open
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/perps/sol.svg"
        alt="SOL"
        className="absolute top-[56px] right-5 h-14 w-14 rounded-full bg-white/5 object-contain p-1.5 ring-1 ring-white/10"
      />

      <div className="mt-14 flex items-center gap-3">
        <div
          className="h-11 w-11 shrink-0 rounded-full"
          style={{
            background: "linear-gradient(135deg, #7c3aed, #ec4899)",
          }}
        />
        <div>
          <div className="text-base font-bold">Bjg7…eP4f</div>
          <div className="text-xs font-medium text-[#22c55e]">
            +$2.4M PnL · 30d
          </div>
        </div>
      </div>

      <div className="mt-6 text-3xl font-extrabold tracking-tight">
        SOL 10× LONG
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        Hyperliquid · 12 min ago
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Size" value="$480k" />
        <Stat label="Entry" value="$172.40" />
        <Stat label="Liq" value="$128.60" />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <Chip text="Top whale · 30d" level="green" />
        <Chip text="Wins 64% of trades" level="amber" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-neutral-400">
          Tail = same direction, scaled
        </span>
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-neutral-400">
          Fade = opposite
        </span>
      </div>

      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 gap-2">
          <TailFadeBtn
            variant="tail"
            phase={phase}
            progress={progress}
            target
          />
          <TailFadeBtn variant="fade" />
        </div>
        <div className="mt-2 flex gap-2">
          {[5, 10, 20].map((amt) => (
            <button
              key={amt}
              type="button"
              disabled
              className="flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white opacity-100"
            >
              ${amt}
            </button>
          ))}
        </div>
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Drift Perps · ↑ swipe for next
        </div>
      </div>
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────

function Chip({
  text,
  level,
}: {
  text: string;
  level: "green" | "amber" | "purple";
}) {
  const dotClass =
    level === "green"
      ? "bg-[#22c55e] shadow-[0_0_8px_#22c55e]"
      : level === "amber"
        ? "bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]"
        : "bg-[#a855f7] shadow-[0_0_8px_#a855f7]";
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      <span>{text}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}

function StakeBtn({
  label,
  variant,
  phase = "idle",
  progress = 0,
  target = false,
  confirmedLabel,
}: {
  label: string;
  variant: "ghost" | "primary";
  phase?: CardPhase;
  progress?: number;
  target?: boolean;
  confirmedLabel?: string;
}) {
  const isPending = target && phase === "pending";
  const isConfirmed = target && phase === "confirmed";
  const isTap = target && phase === "tap";
  const scale = isTap ? 1 - 0.05 * Math.sin(progress * Math.PI) : 1;

  const baseClass =
    variant === "primary"
      ? "border-white bg-white text-black"
      : "border-white/5 bg-white/10 text-white";
  const confirmedClass = "border-[#22c55e] bg-[#22c55e] text-black";

  return (
    <button
      type="button"
      disabled
      className={`relative flex-1 overflow-hidden rounded-2xl border px-0 py-3.5 text-[15px] font-bold transition disabled:opacity-100 ${
        isConfirmed ? confirmedClass : baseClass
      }`}
      style={{ transform: `scale(${scale})` }}
    >
      <span className="relative z-10">
        {isConfirmed
          ? (confirmedLabel ?? "✓")
          : isPending
            ? "…"
            : label}
      </span>
      {isTap && <Ripple progress={progress} />}
    </button>
  );
}

function YesNoBtn({
  variant,
  phase = "idle",
  progress = 0,
  target = false,
}: {
  variant: "yes" | "no";
  phase?: CardPhase;
  progress?: number;
  target?: boolean;
}) {
  const isPending = target && phase === "pending";
  const isConfirmed = target && phase === "confirmed";
  const isTap = target && phase === "tap";
  const scale = isTap ? 1 - 0.05 * Math.sin(progress * Math.PI) : 1;
  const ringClass = isConfirmed ? "ring-4 ring-white/40" : "";

  const colorClass =
    variant === "yes"
      ? "border-[#22c55e] bg-[#22c55e] text-black"
      : "border-[#ef4444] bg-[#ef4444] text-white";

  const label = variant === "yes" ? "$50 YES" : "$50 NO";
  const confirmedLabel =
    variant === "yes" ? "✓ Bought $50 YES" : "✓ Bought $50 NO";

  return (
    <button
      type="button"
      disabled
      className={`relative overflow-hidden rounded-2xl border px-0 py-3.5 text-[14px] font-bold transition disabled:opacity-100 ${colorClass} ${ringClass}`}
      style={{ transform: `scale(${scale})` }}
    >
      <span className="relative z-10">
        {isConfirmed ? confirmedLabel : isPending ? "…" : label}
      </span>
      {isTap && <Ripple progress={progress} />}
    </button>
  );
}

function TailFadeBtn({
  variant,
  phase = "idle",
  progress = 0,
  target = false,
}: {
  variant: "tail" | "fade";
  phase?: CardPhase;
  progress?: number;
  target?: boolean;
}) {
  const isPending = target && phase === "pending";
  const isConfirmed = target && phase === "confirmed";
  const isTap = target && phase === "tap";
  const scale = isTap ? 1 - 0.05 * Math.sin(progress * Math.PI) : 1;
  const ringClass = isConfirmed ? "ring-4 ring-white/40" : "";

  const colorClass =
    variant === "tail"
      ? "border-[#22c55e] bg-[#22c55e] text-black"
      : "border-neutral-700 bg-neutral-800 text-white";

  const label = variant === "tail" ? "Tail $50" : "Fade $50";
  const confirmedLabel = variant === "tail" ? "✓ Tailing" : "✓ Fading";

  return (
    <button
      type="button"
      disabled
      className={`relative overflow-hidden rounded-2xl border px-0 py-3.5 text-[14px] font-bold transition disabled:opacity-100 ${colorClass} ${ringClass}`}
      style={{ transform: `scale(${scale})` }}
    >
      <span className="relative z-10">
        {isConfirmed ? confirmedLabel : isPending ? "…" : label}
      </span>
      {isTap && <Ripple progress={progress} />}
    </button>
  );
}

function Ripple({ progress }: { progress: number }) {
  const eased = easeOut(progress);
  const scale = 0.4 + eased * 1.6;
  const opacity = (1 - eased) * 0.55;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 h-[80px] w-[80px] rounded-full bg-white"
      style={{
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
      }}
    />
  );
}
