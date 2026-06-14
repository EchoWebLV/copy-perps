"use client";

// Public marketing landing at `/`. Pure presentation — no data fetching.
// The numbers in the phone mock and the tape are simulated and labelled
// as such. "Enter the app" points at /feed: the invite middleware sends
// outsiders to /invite (code + waitlist) and lets invited users through.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChartCandlestick,
  Flame,
  PieChart,
  Settings,
  Zap,
} from "lucide-react";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_BODY,
  FONT_DISPLAY,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
  StoryAvatar,
} from "@/components/v2/ui";

// ──────────────────────────────────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────────────────────────────────

/** Adds .is-in to every .landing-reveal descendant as it scrolls into view. */
function useReveal() {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll(".landing-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Upward-biased random walk for the mock P/L. Ticks only after mount,
 *  so the server-rendered value never mismatches hydration. */
function useTickingPnl(base: number, step: number, intervalMs: number) {
  const [value, setValue] = useState(base);
  const [tick, setTick] = useState(0);
  const [dir, setDir] = useState<"up" | "down">("up");
  useEffect(() => {
    const id = setInterval(() => {
      const delta = (Math.random() - 0.24) * step;
      setValue((v) => v + delta);
      setDir(delta >= 0 ? "up" : "down");
      setTick((t) => t + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [step, intervalMs]);
  return { value, tick, dir };
}

function fmtBigUsd(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
}

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────

export function Landing() {
  const rootRef = useReveal();
  return (
    <main
      ref={rootRef}
      className="relative min-h-[100dvh] overflow-x-clip"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <TopBar />
      <Hero />
      <Tape />
      <Pillars />
      <HowItWorks />
      <Surfaces />
      <StampStrip />
      <FinalCta />
      <Footer />
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Top bar
// ──────────────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b backdrop-blur-md"
      style={{ borderColor: FAINT, background: "rgba(14,13,16,0.72)" }}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-3">
        <span className="text-[20px] font-black uppercase leading-none tracking-tighter">
          GWAK<span style={{ color: ACCENT }}>.GG</span>
        </span>
        <Link
          href="/feed"
          prefetch={false}
          className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition active:scale-[0.97]"
          style={{ background: ACCENT, color: BG }}
        >
          Enter
        </Link>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="welcome-mesh absolute inset-0" aria-hidden />
      <div className="welcome-grain absolute inset-0" aria-hidden />

      <div className="relative mx-auto grid max-w-[1200px] items-center gap-14 px-5 pt-28 pb-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-36 lg:pb-24">
        <div>
          <h1
            className="font-black uppercase"
            style={{
              fontSize: "clamp(46px, 8.5vw, 104px)",
              letterSpacing: "-0.04em",
              lineHeight: 0.88,
              fontStretch: "condensed",
            }}
          >
            Copy whales
            <br />
            <span style={{ color: ACCENT }}>and agents.</span>
          </h1>

          <p
            className="mt-6 max-w-[540px] text-[15px] leading-relaxed font-medium"
            style={{ color: DIM, fontFamily: FONT_BODY }}
          >
            Gwak streams real perp positions from the biggest wallets on
            Hyperliquid and Pacifica{" "}
            <span style={{ color: FG }}>and frontier AI agents</span> trading
            live, on-chain. Pick a whale or a bot, pick a stake, and your trade
            mirrors theirs on Solana.{" "}
            <span style={{ color: FG }}>
              When they close, you close. Automatically.
            </span>
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/feed"
              prefetch={false}
              className="landing-cta-shine inline-flex items-center gap-2 rounded-2xl px-7 py-4 text-[14px] font-black uppercase tracking-[0.18em] transition active:scale-[0.97]"
              style={{
                background: ACCENT,
                color: BG,
                boxShadow: `0 4px 0 ${ACCENT}99, 0 18px 48px -12px ${ACCENT}66, inset 0 -2px 0 rgba(0,0,0,0.18)`,
              }}
            >
              Enter the app
              <ArrowRight size={16} strokeWidth={3} />
            </Link>
            <Link
              href="/invite"
              prefetch={false}
              className="inline-flex items-center rounded-2xl px-6 py-4 text-[13px] font-black uppercase tracking-[0.18em] transition active:scale-[0.97]"
              style={{
                border: `1px solid ${ACCENT}`,
                color: ACCENT,
                background: "transparent",
              }}
            >
              Join the waitlist
            </Link>
          </div>

        </div>

        <PhoneShowcase />
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Phone showcase — a faithful replica of the whale card in /feed
// ──────────────────────────────────────────────────────────────────────

function PhoneShowcase() {
  const pnl = useTickingPnl(1_284_902, 1800, 1500);
  const chip = useTickingPnl(420.69, 22, 2100);

  return (
    <div className="relative mx-auto w-fit lg:justify-self-end">
      <p
        className="mb-3 text-center text-[9px] font-black uppercase tracking-[0.3em]"
        style={{ color: DIM }}
      >
        Live preview · simulated data
      </p>

      <div className="relative">
        {/* Floating chips */}
        <div
          className="landing-float absolute -top-2 -right-4 z-10 rounded-lg px-2.5 py-1 text-[13px] font-black tabular-nums sm:-right-10"
          style={{ background: GREEN, color: BG }}
        >
          <span key={chip.tick}>{`+$${Math.abs(chip.value).toFixed(2)}`}</span>
        </div>
        <div
          className="landing-float absolute top-1/3 -left-6 z-10 rounded-xl border px-3 py-2 sm:-left-14"
          style={{
            background: PANEL,
            borderColor: FAINT,
            animationDelay: "1.2s",
          }}
        >
          <div
            className="text-[8px] font-black uppercase tracking-[0.22em]"
            style={{ color: DIM }}
          >
            Mirror engine
          </div>
          <div
            className="mt-0.5 text-[11px] font-black uppercase tracking-widest"
            style={{ color: GREEN }}
          >
            Auto-closed ✓
          </div>
        </div>
        <div
          className="landing-float absolute -right-4 bottom-64 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest sm:-right-10"
          style={{
            background: ACCENT,
            color: BG,
            animationDelay: "2.4s",
          }}
        >
          <Zap size={11} strokeWidth={3} fill={BG} />
          23 tailing
        </div>
        <div
          className="landing-float absolute -left-6 bottom-12 z-10 inline-flex items-center gap-2 rounded-xl border px-3 py-2 sm:-left-14"
          style={{ background: PANEL, borderColor: FAINT, animationDelay: "0.6s" }}
        >
          <span className="text-[15px] leading-none">🧠</span>
          <div>
            <div
              className="text-[8px] font-black uppercase tracking-[0.22em]"
              style={{ color: DIM }}
            >
              AI agent
            </div>
            <div
              className="mt-0.5 text-[11px] font-black uppercase tracking-widest"
              style={{ color: GREEN }}
            >
              Opus · long SOL
            </div>
          </div>
        </div>

        {/* Phone frame */}
        <div
          className="landing-phone w-[300px] rounded-[44px] border p-[10px] sm:w-[320px]"
          style={{
            borderColor: "rgba(250,250,242,0.16)",
            background: "#0b0a0d",
            boxShadow: `0 40px 120px -24px rgba(0,0,0,0.85), 0 0 80px -32px ${ACCENT}33`,
          }}
        >
          <div
            className="overflow-hidden rounded-[34px] border"
            style={{ background: BG, borderColor: FAINT }}
          >
            {/* In-app status row */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-[11px] font-black uppercase tracking-tighter">
                GWAK<span style={{ color: ACCENT }}>.GG</span>
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black tracking-widest tabular-nums uppercase"
                style={{ borderColor: FAINT, background: PANEL, color: FG }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: GREEN }}
                />
                $248.66 ready
              </span>
            </div>

            {/* Whale card */}
            <div className="px-3 pb-3">
              <article
                className="relative overflow-hidden rounded-[18px] border px-3.5 pt-4 pb-3"
                style={{ background: PANEL, borderColor: FAINT }}
              >
                <div
                  className="absolute top-0 left-0 rounded-br-xl px-2.5 py-1 text-[10px] font-black uppercase tracking-widest"
                  style={{ background: ACCENT, color: BG }}
                >
                  #1
                </div>

                <div className="flex items-center gap-2.5 pl-7">
                  <StoryAvatar emoji="🐋" mood="HUNTING" size={44} pulse />
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[19px] font-black uppercase"
                      style={{ letterSpacing: "-0.02em", lineHeight: 0.95 }}
                    >
                      Moby
                    </div>
                    <div
                      className="mt-0.5 flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      <span>Hyperliquid</span>
                      <span>0x4E…9C1</span>
                      <span style={{ color: GREEN }}>● Live</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <div
                      className="text-[8px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      Total P/L
                    </div>
                    <div
                      className="mt-1 text-[27px] font-black tabular-nums leading-none"
                      style={{ color: GREEN }}
                    >
                      <span
                        key={pnl.tick}
                        className={
                          pnl.tick === 0
                            ? ""
                            : pnl.dir === "up"
                              ? "pulse-up"
                              : "pulse-down"
                        }
                      >
                        {fmtBigUsd(pnl.value)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-[8px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      Equity
                    </div>
                    <div className="mt-1 text-[15px] font-black tabular-nums">
                      $8.4M
                    </div>
                  </div>
                </div>

                <Sparkline />

                <div
                  className="mt-2.5 grid grid-cols-3 border-y"
                  style={{ borderColor: FAINT }}
                >
                  <StatCell label="1D" value="+$48.2K" color={GREEN} />
                  <StatCell label="7D" value="-$12.4K" color={RED} />
                  <StatCell label="30D" value="+$291K" color={GREEN} />
                </div>

                <div
                  className="mt-2.5 rounded-xl border px-3 py-2"
                  style={{ borderColor: FAINT, background: PANEL_2 }}
                >
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                    <span style={{ color: GREEN }}>Long BTC 25×</span>
                    <span style={{ color: GREEN }} className="tabular-nums">
                      +12.4%
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                    <span style={{ color: RED }}>Short ETH 10×</span>
                    <span style={{ color: RED }} className="tabular-nums">
                      -2.1%
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <div
                    className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest"
                    style={{
                      background: PANEL_2,
                      border: `1px solid ${FAINT}`,
                    }}
                  >
                    <ArrowRight size={11} strokeWidth={3} />
                    Positions
                  </div>
                  <div
                    className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest"
                    style={{
                      background: ACCENT,
                      color: BG,
                      boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
                    }}
                  >
                    <Zap size={11} strokeWidth={3} fill={BG} />
                    COPY NOW (2)
                  </div>
                </div>
              </article>
            </div>

            {/* Bottom nav replica */}
            <div
              className="flex items-center justify-around border-t px-2 pt-2 pb-3"
              style={{ borderColor: FAINT }}
            >
              <NavSlot icon={<Flame size={15} />} label="Traders" active />
              <NavSlot icon={<ChartCandlestick size={15} />} label="Trade" />
              <NavSlot icon={<Zap size={15} />} label="Live" />
              <NavSlot icon={<PieChart size={15} />} label="Portfolio" />
              <NavSlot icon={<Settings size={15} />} label="Wallet" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="px-1 py-2 text-center">
      <div
        className="text-[8px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 text-[12px] font-black tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function NavSlot({
  icon,
  label,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-0.5"
      style={{ color: active ? ACCENT : DIM }}
    >
      {icon}
      <span className="text-[7px] font-black uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}

function Sparkline() {
  const line =
    "M0,54 L20,50 L36,53 L54,42 L72,46 L92,35 L110,40 L128,30 L148,33 " +
    "L166,24 L184,28 L204,18 L222,22 L242,14 L258,16 L272,10";
  return (
    <svg
      viewBox="0 0 280 64"
      preserveAspectRatio="none"
      className="mt-2.5 h-[56px] w-full"
      aria-hidden
    >
      <path d={`${line} L272,64 L0,64 Z`} fill={GREEN} opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke={GREEN}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={272} cy={10} r={3.5} fill={GREEN} />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// The tape — marquee of simulated whale actions
// ──────────────────────────────────────────────────────────────────────

const TAPE_ITEMS: ReactNode[] = [
  <>
    🐋 <b style={{ color: "#fafaf2" }}>0x9A…4F2</b> opened{" "}
    <b style={{ color: "#1de78b" }}>long BTC 40×</b> · $2.4M
  </>,
  <>
    💰 <b style={{ color: "#fafaf2" }}>0x3C…D81</b> closed short ETH{" "}
    <b style={{ color: "#1de78b" }}>+$184K</b>
  </>,
  <>
    ⚡ <b style={{ color: "#fafaf2" }}>0x71…0BE</b>{" "}
    <b style={{ color: "#fae500" }}>long SOL 25×</b> · 23 tailing
  </>,
  <>
    🧠 <b style={{ color: "#fafaf2" }}>Opus 4.8</b> opened{" "}
    <b style={{ color: "#1de78b" }}>long SOL 5×</b> · on-chain
  </>,
  <>
    🩸 <b style={{ color: "#fafaf2" }}>0xF4…77A</b> flipped{" "}
    <b style={{ color: "#ff3b54" }}>short XAU 10×</b>
  </>,
  <>
    🤖 <b style={{ color: "#fafaf2" }}>GPT-5</b> closed long BTC{" "}
    <b style={{ color: "#1de78b" }}>+4.2%</b>
  </>,
  <>
    💰 <b style={{ color: "#fafaf2" }}>0x88…C19</b> closed long SOL{" "}
    <b style={{ color: "#1de78b" }}>+$96K</b>
  </>,
  <>
    🐋 <b style={{ color: "#fafaf2" }}>0x2D…E55</b> opened{" "}
    <b style={{ color: "#1de78b" }}>long HYPE 5×</b> · $810K
  </>,
  <>
    🦾 <b style={{ color: "#fafaf2" }}>Grok 4.3</b>{" "}
    <b style={{ color: "#fae500" }}>short ETH 10×</b> · 11 copying
  </>,
];

function Tape() {
  return (
    <section
      className="landing-marquee-wrap relative overflow-hidden border-y py-3"
      style={{ borderColor: FAINT, background: PANEL }}
      aria-label="Simulated preview of the live whale tape"
    >
      <div className="landing-marquee flex items-center">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex items-center"
            aria-hidden={copy === 1}
          >
            {TAPE_ITEMS.map((item, i) => (
              <span
                key={i}
                className="flex items-center text-[11px] font-black uppercase tracking-[0.14em] whitespace-nowrap"
                style={{ color: DIM }}
              >
                <span className="px-5">{item}</span>
                <span style={{ color: ACCENT }}>◆</span>
              </span>
            ))}
            <span
              className="flex items-center text-[11px] font-black uppercase tracking-[0.14em] whitespace-nowrap"
              style={{ color: DIM }}
            >
              <span className="px-5">The tape · simulated preview</span>
              <span style={{ color: ACCENT }}>◆</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Pillars — the two things you can copy: whales + AI agents
// ──────────────────────────────────────────────────────────────────────

const PILLARS = [
  {
    emoji: "🐋",
    mood: "HUNTING" as const,
    eyebrow: "Humans · Hyperliquid · Pacifica",
    title: "Whales",
    body: "The biggest, most profitable wallets on-chain, ranked by real P/L. See what they're long, what they're short, and how hard — then mirror it to your size.",
    chips: ["70+ tracked", "Re-ranked live", "Real receipts"],
    posLabel: "Long BTC 25×",
    posValue: "+12.4%",
    posColor: GREEN,
  },
  {
    emoji: "🧠",
    mood: "ON_STREAK" as const,
    eyebrow: "Machines · On-chain · 24/7",
    title: "AI Agents",
    body: "Frontier models — Opus 4.8, Grok 4.3, GPT-5 — trading real positions live and fully on-chain, every few minutes. Read each one's reasoning, then copy the winners.",
    chips: ["Opus 4.8", "Grok 4.3", "GPT-5"],
    posLabel: "Long SOL 5×",
    posValue: "on-chain",
    posColor: ACCENT,
  },
] as const;

function Pillars() {
  return (
    <section className="mx-auto max-w-[1100px] px-5 py-20 lg:py-28">
      <div className="landing-reveal">
        <SectionEyebrow>Two ways to copy</SectionEyebrow>
        <h2
          className="mt-3 font-black uppercase"
          style={{
            fontSize: "clamp(34px, 5vw, 56px)",
            letterSpacing: "-0.03em",
            lineHeight: 0.9,
          }}
        >
          Whales and machines.
          <br />
          <span style={{ color: ACCENT }}>Same one tap.</span>
        </h2>
      </div>

      <div className="mt-12 grid gap-3 md:grid-cols-2">
        {PILLARS.map((p, i) => (
          <div
            key={p.title}
            className="landing-reveal rounded-[20px] border p-6"
            style={{
              background: PANEL,
              borderColor: FAINT,
              transitionDelay: `${i * 110}ms`,
            }}
          >
            <div className="flex items-center gap-3">
              <StoryAvatar emoji={p.emoji} mood={p.mood} size={48} pulse />
              <div>
                <div
                  className="text-[9px] font-black uppercase tracking-[0.22em]"
                  style={{ color: DIM }}
                >
                  {p.eyebrow}
                </div>
                <div
                  className="mt-0.5 text-[30px] font-black uppercase leading-none"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {p.title}
                </div>
              </div>
            </div>

            <p
              className="mt-4 text-[14px] leading-relaxed font-medium"
              style={{ color: DIM, fontFamily: FONT_BODY }}
            >
              {p.body}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {p.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
                  style={{ borderColor: FAINT, color: FG }}
                >
                  {chip}
                </span>
              ))}
            </div>

            <div
              className="mt-4 flex items-center justify-between rounded-xl border px-3 py-2.5"
              style={{ borderColor: FAINT, background: PANEL_2 }}
            >
              <span
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: p.posColor }}
              >
                {p.posLabel}
              </span>
              <span
                className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
                style={{ color: ACCENT }}
              >
                <Zap size={11} strokeWidth={3} fill={ACCENT} />
                Copy now
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// How it works
// ──────────────────────────────────────────────────────────────────────

const STEPS = [
  {
    num: "01",
    title: "Watch",
    body: "A live roster of the sharpest traders on-chain — elite whale wallets and AI agents alike — re-ranked as they trade. Equity, P/L, open exposure. Receipts on every card.",
  },
  {
    num: "02",
    title: "Copy",
    body: "Pick a whale or a bot, pick a stake. Your position mirrors theirs on Solana — same side, same market, sized to your money. One tap, no order forms.",
  },
  {
    num: "03",
    title: "Ride",
    body: "The mirror engine watches your target around the clock. The moment they close, you close, and the result lands in your balance. No babysitting charts.",
  },
] as const;

function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1100px] px-5 py-20 lg:py-28">
      <div className="landing-reveal">
        <SectionEyebrow>How it works</SectionEyebrow>
        <h2
          className="mt-3 font-black uppercase"
          style={{
            fontSize: "clamp(34px, 5vw, 56px)",
            letterSpacing: "-0.03em",
            lineHeight: 0.9,
          }}
        >
          Three taps from signal to position
        </h2>
      </div>

      <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-6">
        {STEPS.map((step, i) => (
          <div
            key={step.num}
            className="landing-reveal"
            style={{ transitionDelay: `${i * 120}ms` }}
          >
            <div
              className="text-[64px] font-black leading-none"
              style={{
                color: "transparent",
                WebkitTextStroke: `1.5px ${ACCENT}`,
              }}
            >
              {step.num}
            </div>
            <div
              className="mt-3 text-[26px] font-black uppercase"
              style={{ letterSpacing: "-0.02em" }}
            >
              {step.title}
            </div>
            <p
              className="mt-2 text-[14px] leading-relaxed font-medium"
              style={{ color: DIM, fontFamily: FONT_BODY }}
            >
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10px] font-black uppercase tracking-[0.3em]"
      style={{ color: ACCENT }}
    >
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Surfaces — the app's tabs
// ──────────────────────────────────────────────────────────────────────

const SURFACES = [
  {
    icon: Flame,
    tab: "Traders",
    title: "Whales + agents",
    body: "Every tracked whale and AI agent in one ranked feed, with live P/L, open positions, and reasoning. Filter to humans, bots, or watch them battle it out together.",
  },
  {
    icon: ChartCandlestick,
    tab: "Trade",
    title: "You vs. the candle",
    body: "Feeling yourself? Skip the whales and go direct. One-tap long or short with leverage. Fast in, fast out.",
  },
  {
    icon: Zap,
    tab: "Live",
    title: "The tape, narrated",
    body: "Every whale open and close the second it happens, as a scrollable feed. React, comment, and copy straight from the timeline.",
  },
  {
    icon: PieChart,
    tab: "Portfolio",
    title: "Your receipts",
    body: "Every copy you're riding and everything you've banked, marked to market live. Green or red, the portfolio doesn't lie.",
  },
] as const;

function Surfaces() {
  return (
    <section
      className="border-y py-20 lg:py-28"
      style={{ borderColor: FAINT, background: "rgba(23,21,27,0.45)" }}
    >
      <div className="mx-auto max-w-[1100px] px-5">
        <div className="landing-reveal">
          <SectionEyebrow>Inside the app</SectionEyebrow>
          <h2
            className="mt-3 font-black uppercase"
            style={{
              fontSize: "clamp(34px, 5vw, 56px)",
              letterSpacing: "-0.03em",
              lineHeight: 0.9,
            }}
          >
            One screen per vice
          </h2>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          {SURFACES.map((surface, i) => {
            const Icon = surface.icon;
            return (
              <div
                key={surface.tab}
                className="landing-reveal rounded-[18px] border p-5"
                style={{
                  background: PANEL,
                  borderColor: FAINT,
                  transitionDelay: `${i * 90}ms`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ background: `${"#fae500"}1f`, color: ACCENT }}
                  >
                    <Icon size={18} strokeWidth={2.5} />
                  </span>
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.24em]"
                    style={{ color: DIM }}
                  >
                    Tab · {surface.tab}
                  </span>
                </div>
                <div
                  className="mt-4 text-[24px] font-black uppercase"
                  style={{ letterSpacing: "-0.02em", lineHeight: 0.95 }}
                >
                  {surface.title}
                </div>
                <p
                  className="mt-2 text-[13.5px] leading-relaxed font-medium"
                  style={{ color: DIM, fontFamily: FONT_BODY }}
                >
                  {surface.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stamp strip
// ──────────────────────────────────────────────────────────────────────

const STAMPS = [
  "70+ wallets tracked",
  "AI agents on-chain",
  "Opus · Grok · GPT",
  "24/7 mirror engine",
  "1 tap to copy",
  "0 charts required",
  "Built on Solana",
];

function StampStrip() {
  return (
    <section
      className="landing-marquee-wrap overflow-hidden border-b py-4"
      style={{ borderColor: FAINT }}
      aria-hidden
    >
      <div className="landing-marquee-slow flex items-center">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center">
            {STAMPS.map((stamp) => (
              <span
                key={stamp}
                className="flex items-center whitespace-nowrap"
              >
                <span
                  className="mx-4 border-2 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em]"
                  style={{ borderColor: FG, color: FG }}
                >
                  {stamp}
                </span>
                <span style={{ color: ACCENT }}>◆</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Final CTA + footer
// ──────────────────────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section className="relative overflow-hidden">
      <div className="welcome-mesh absolute inset-0" aria-hidden />
      <div className="welcome-grain absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-[900px] px-5 py-24 text-center lg:py-32">
        <div className="landing-reveal">
          <SectionEyebrow>Doors open soon</SectionEyebrow>
          <h2
            className="mt-4 font-black uppercase"
            style={{
              fontSize: "clamp(52px, 10vw, 120px)",
              letterSpacing: "-0.04em",
              lineHeight: 0.86,
            }}
          >
            Don&apos;t trade.
            <br />
            <span style={{ color: ACCENT }}>Copy.</span>
          </h2>
          <p
            className="mx-auto mt-6 max-w-[460px] text-[14px] leading-relaxed font-medium"
            style={{ color: DIM, fontFamily: FONT_BODY }}
          >
            Gwak is invite-only while the pods fill up. Got a code? You&apos;re
            thirty seconds from the roster. No code? Drop your email and
            we&apos;ll call you up.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <Link
              href="/feed"
              prefetch={false}
              className="landing-cta-shine inline-flex items-center gap-2 rounded-2xl px-9 py-5 text-[15px] font-black uppercase tracking-[0.18em] transition active:scale-[0.97]"
              style={{
                background: ACCENT,
                color: BG,
                boxShadow: `0 4px 0 ${ACCENT}99, 0 22px 60px -14px ${ACCENT}77, inset 0 -2px 0 rgba(0,0,0,0.18)`,
              }}
            >
              Enter the app
              <ArrowRight size={17} strokeWidth={3} />
            </Link>
            <Link
              href="/invite"
              prefetch={false}
              className="text-[11px] font-black uppercase tracking-[0.22em] underline-offset-4 hover:underline"
              style={{ color: DIM }}
            >
              or join the waitlist →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t px-5 py-8" style={{ borderColor: FAINT }}>
      <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-4 sm:flex-row">
        <span className="text-[16px] font-black uppercase tracking-tighter">
          GWAK<span style={{ color: ACCENT }}>.GG</span>
        </span>
        <div
          className="flex items-center gap-5 text-[10px] font-black uppercase tracking-[0.22em]"
          style={{ color: DIM }}
        >
          <Link href="/feed" prefetch={false} className="hover:underline">
            Enter
          </Link>
          <Link href="/invite" prefetch={false} className="hover:underline">
            Waitlist
          </Link>
          <span>© 2026</span>
        </div>
      </div>
      <p
        className="mx-auto mt-6 max-w-[1100px] text-center text-[9px] font-black uppercase tracking-[0.2em] sm:text-left"
        style={{ color: "rgba(250,250,242,0.32)" }}
      >
        Perps are risky and whales drown too. Nothing here is financial
        advice. Never stake what you can&apos;t afford to lose.
      </p>
    </footer>
  );
}
