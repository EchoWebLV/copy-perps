import Link from "next/link";
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
  StoryAvatar,
  Stamp,
  Headline,
  BigNum,
  PnlPill,
  StreakBadge,
} from "@/components/v2/ui";
import { V2BottomNav, V2Header, PANEL_STYLE } from "../shell";

export const dynamic = "force-static";

const MOCK_EQUITY = {
  totalUsd: 247.82,
  change24hUsd: 18.40,
  change24hPct: 8.0,
  invested: 180,
  cash: 67.82,
};

const OPEN_TAILS = [
  {
    botName: "Liquidation Lizard",
    avatarEmoji: "🦎",
    mood: "HUNTING",
    asset: "HYPE",
    side: "short" as const,
    leverage: 50,
    stakeUsd: 50,
    entryMark: 42.10,
    currentMark: 41.85,
    livePnlUsd: 14.85,
    livePnlPct: 0.297,
    openSinceMin: 8,
  },
  {
    botName: "Momo Max Aggressive",
    avatarEmoji: "🚀",
    mood: "ON_STREAK",
    asset: "BTC",
    side: "long" as const,
    leverage: 50,
    stakeUsd: 100,
    entryMark: 81450.0,
    currentMark: 81598.5,
    livePnlUsd: 9.12,
    livePnlPct: 0.091,
    openSinceMin: 14,
  },
  {
    botName: "Funding Phoebe Lite",
    avatarEmoji: "📊",
    mood: "LOADED",
    asset: "AVAX",
    side: "short" as const,
    leverage: 8,
    stakeUsd: 30,
    entryMark: 10.04,
    currentMark: 10.08,
    livePnlUsd: -0.96,
    livePnlPct: -0.032,
    openSinceMin: 67,
  },
];

const CLOSED_HISTORY = [
  {
    botName: "Liquidation Lizard",
    avatarEmoji: "🦎",
    asset: "SOL",
    side: "short" as const,
    pnlUsd: 12.40,
    ago: "2h",
  },
  {
    botName: "Vol Vector",
    avatarEmoji: "💥",
    asset: "ETH",
    side: "long" as const,
    pnlUsd: -8.20,
    ago: "5h",
  },
  {
    botName: "Boomer Trend",
    avatarEmoji: "🐢",
    asset: "BTC",
    side: "long" as const,
    pnlUsd: 24.50,
    ago: "1d",
  },
];

export default function PortfolioV2Page() {
  const profit = MOCK_EQUITY.change24hUsd >= 0;

  return (
    <main
      className="min-h-screen w-full pb-32"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <V2Header
        title={`"PORTFOLIO"`}
        subtitle="YOUR TAIL TRADES"
        trailing={<StreakBadge count={4} />}
      />

      {/* Equity hero card */}
      <div className="px-5 pt-5">
        <div className="p-5" style={PANEL_STYLE}>
          <Stamp label="EQUITY · LIVE" />
          <div className="mt-2 flex items-baseline gap-3">
            <BigNum size={48}>${MOCK_EQUITY.totalUsd.toFixed(2)}</BigNum>
            <PnlPill pnlUsd={MOCK_EQUITY.change24hUsd} size={14} />
          </div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            24H · {profit ? "+" : ""}
            {MOCK_EQUITY.change24hPct.toFixed(1)}%
          </div>

          {/* Sparkline placeholder */}
          <svg viewBox="0 0 320 60" className="mt-4 h-14 w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GREEN} stopOpacity="0.4" />
                <stop offset="100%" stopColor={GREEN} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,40 L20,42 L40,38 L60,35 L80,38 L100,32 L120,30 L140,28 L160,32 L180,25 L200,22 L220,28 L240,20 L260,18 L280,12 L300,15 L320,10 L320,60 L0,60 Z"
              fill="url(#sparkFill)"
            />
            <path
              d="M0,40 L20,42 L40,38 L60,35 L80,38 L100,32 L120,30 L140,28 L160,32 L180,25 L200,22 L220,28 L240,20 L260,18 L280,12 L300,15 L320,10"
              fill="none"
              stroke={GREEN}
              strokeWidth="2.5"
            />
          </svg>

          <div
            className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-[10px] font-black uppercase tracking-widest"
            style={{ borderColor: FAINT }}
          >
            <div>
              <span style={{ color: DIM }}>DEPLOYED </span>
              <span>${MOCK_EQUITY.invested}</span>
            </div>
            <div>
              <span style={{ color: DIM }}>CASH </span>
              <span>${MOCK_EQUITY.cash.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Open tails */}
      <div className="mt-6 px-5">
        <div className="flex items-baseline justify-between">
          <Stamp label="OPEN TAILS" value={`${OPEN_TAILS.length}`} />
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: ACCENT }}>
            +$23.01 UNREALIZED
          </span>
        </div>
        <div className="mt-2 space-y-3">
          {OPEN_TAILS.map((t, i) => {
            const isLong = t.side === "long";
            const profit = t.livePnlUsd >= 0;
            return (
              <div key={i} className="p-4" style={PANEL_STYLE}>
                <div className="flex items-baseline justify-between">
                  <div className="flex items-center gap-2">
                    <StoryAvatar emoji={t.avatarEmoji} mood={t.mood} size={32} />
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest">
                        {t.botName}
                      </div>
                      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                        {t.openSinceMin}m AGO
                      </div>
                    </div>
                  </div>
                  <PnlPill pnlUsd={t.livePnlUsd} size={13} />
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest"
                    style={{
                      background: isLong ? `${GREEN}25` : `${RED}25`,
                      color: isLong ? GREEN : RED,
                    }}
                  >
                    {t.side}
                  </span>
                  <Headline size={26}>{t.asset}</Headline>
                  <span className="text-[12px] font-black" style={{ color: DIM }}>
                    ×{t.leverage}
                  </span>
                  <span className="ml-auto text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    ${t.stakeUsd} STAKE
                  </span>
                </div>

                <div
                  className="mt-2 grid grid-cols-3 gap-2 border-t pt-2 text-[10px] font-black uppercase tracking-widest"
                  style={{ borderColor: FAINT }}
                >
                  <div>
                    <span style={{ color: DIM }}>ENTRY </span>
                    <span>{t.entryMark.toFixed(2)}</span>
                  </div>
                  <div>
                    <span style={{ color: DIM }}>NOW </span>
                    <span style={{ color: profit ? GREEN : RED }}>
                      {t.currentMark.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: DIM }}>P/L% </span>
                    <span style={{ color: profit ? GREEN : RED }}>
                      {profit ? "+" : ""}
                      {(t.livePnlPct * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="mt-3 w-full rounded-2xl py-2.5 font-black uppercase tracking-widest active:scale-[0.97]"
                  style={{
                    background: PANEL_2,
                    color: FG,
                    border: `1px solid ${FAINT}`,
                    fontSize: "11px",
                  }}
                >
                  CLOSE TAIL
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Closed history */}
      <div className="mt-6 px-5">
        <Stamp label="RECENT HISTORY" />
        <div className="mt-2 space-y-2">
          {CLOSED_HISTORY.map((h, i) => (
            <div key={i} className="flex items-center gap-3 p-3" style={PANEL_STYLE}>
              <span className="text-2xl">{h.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black uppercase tracking-widest">
                  {h.botName}
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                  {h.side} {h.asset} · {h.ago} AGO
                </div>
              </div>
              <PnlPill pnlUsd={h.pnlUsd} size={13} />
            </div>
          ))}
        </div>
      </div>

      {/* Stats card */}
      <div className="mt-6 px-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 text-center" style={PANEL_STYLE}>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              WIN RATE
            </div>
            <div className="mt-1">
              <BigNum size={20}>72%</BigNum>
            </div>
          </div>
          <div className="p-3 text-center" style={PANEL_STYLE}>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              STREAK
            </div>
            <div className="mt-1" style={{ color: STREAK }}>
              <BigNum size={20} color={STREAK}>🔥 4</BigNum>
            </div>
          </div>
          <div className="p-3 text-center" style={PANEL_STYLE}>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              7D P/L
            </div>
            <div className="mt-1">
              <BigNum size={20} color={GREEN}>+$48</BigNum>
            </div>
          </div>
        </div>
      </div>

      <Link
        href="/design/v2"
        className="mt-8 inline-block px-5 text-[10px] font-black uppercase tracking-widest"
        style={{ opacity: 0.5 }}
      >
        ← BACK TO SURFACES
      </Link>

      <V2BottomNav />
    </main>
  );
}
