import Link from "next/link";
import { MOCK_BOT, MOCK_CHATTER } from "../mock-data";

export const dynamic = "force-static";

const MAGENTA = "#ff2bd6";
const CYAN = "#22e9ff";
const ACID = "#bbff00";
const RED = "#ff3344";
const BG = "#04020a";

function CornerFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* corner brackets */}
      <span
        className="pointer-events-none absolute -top-1 -left-1 h-3 w-3 border-t-2 border-l-2"
        style={{ borderColor: CYAN }}
      />
      <span
        className="pointer-events-none absolute -top-1 -right-1 h-3 w-3 border-t-2 border-r-2"
        style={{ borderColor: CYAN }}
      />
      <span
        className="pointer-events-none absolute -bottom-1 -left-1 h-3 w-3 border-b-2 border-l-2"
        style={{ borderColor: CYAN }}
      />
      <span
        className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2"
        style={{ borderColor: CYAN }}
      />
      {children}
    </div>
  );
}

export default function CyberpunkDesignPage() {
  const b = MOCK_BOT;

  return (
    <main
      className="relative min-h-screen w-full overflow-hidden px-4 py-5 font-sans text-[13px] text-white"
      style={{
        background: `radial-gradient(120% 80% at 50% 0%, rgba(255,43,214,0.10), transparent 60%),
                     radial-gradient(80% 60% at 50% 100%, rgba(34,233,255,0.08), transparent 70%),
                     ${BG}`,
      }}
    >
      {/* Scanlines overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px)",
        }}
      />

      {/* Top wiretap header */}
      <div className="mb-4">
        <CornerFrame>
          <div
            className="flex items-center justify-between border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.3em]"
            style={{ borderColor: "rgba(34,233,255,0.4)" }}
          >
            <span style={{ color: CYAN, textShadow: `0 0 8px ${CYAN}` }}>
              ⊡ WIRETAP / GWAK_NET
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ background: RED, boxShadow: `0 0 8px ${RED}` }}
              />
              <span style={{ color: RED }}>REC</span>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>21:54:59</span>
            </span>
          </div>
        </CornerFrame>
      </div>

      {/* Operator badge */}
      <CornerFrame>
        <div
          className="border p-4"
          style={{
            borderColor: "rgba(255,43,214,0.3)",
            background:
              "linear-gradient(180deg, rgba(255,43,214,0.04), rgba(255,43,214,0))",
          }}
        >
          <div
            className="text-[9px] font-bold uppercase tracking-[0.3em]"
            style={{ color: MAGENTA }}
          >
            OPERATOR_ID
          </div>
          <div className="mt-1 flex items-center gap-3">
            {/* biometric circle */}
            <div
              className="relative grid h-14 w-14 place-items-center rounded-full border-2"
              style={{
                borderColor: MAGENTA,
                boxShadow: `0 0 24px rgba(255,43,214,0.55)`,
              }}
            >
              <span className="text-3xl">{b.avatarEmoji}</span>
              <span
                className="absolute -top-1 -right-1 rounded-sm px-1 text-[8px] font-bold"
                style={{ background: ACID, color: BG }}
              >
                ID
              </span>
            </div>
            <div className="flex-1">
              <div
                className="font-bold uppercase tracking-wide"
                style={{
                  fontSize: "22px",
                  color: "white",
                  textShadow: `0 0 12px ${MAGENTA}`,
                  letterSpacing: "0.05em",
                }}
              >
                {b.name}
              </div>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                style={{ background: `rgba(187,255,0,0.12)`, color: ACID, boxShadow: `inset 0 0 0 1px ${ACID}` }}
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: ACID, boxShadow: `0 0 6px ${ACID}` }} />
                STATUS // {b.mood}
              </div>
            </div>
          </div>

          {/* Bankroll bar */}
          <div className="mt-4">
            <div
              className="text-[9px] font-bold uppercase tracking-[0.3em]"
              style={{ color: CYAN }}
            >
              BANKROLL // EQUITY
            </div>
            <div
              className="mt-1 font-mono"
              style={{
                fontSize: "32px",
                color: "white",
                textShadow: `0 0 16px ${CYAN}`,
                letterSpacing: "0.02em",
              }}
            >
              ${b.bankrollUsd.toFixed(0)}
            </div>
            <div
              className="text-[11px] font-mono"
              style={{
                color: b.lifetimeReturnPct >= 0 ? ACID : RED,
                textShadow: `0 0 8px ${b.lifetimeReturnPct >= 0 ? ACID : RED}`,
              }}
            >
              {b.lifetimeReturnPct >= 0 ? "▲" : "▼"} {b.lifetimeReturnPct >= 0 ? "+" : ""}
              {(b.lifetimeReturnPct * 100).toFixed(1)}%
            </div>
          </div>

          {/* Mini stat row */}
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              ["TRADES", b.stats.totalTrades],
              ["WR", `${(b.stats.winRate * 100).toFixed(0)}%`],
              ["24H", `+$${b.stats.paperPnl24hUsd}`],
              ["7D", `+$${b.stats.paperPnl7dUsd}`],
            ].map(([k, v]) => (
              <div
                key={k as string}
                className="border px-1 py-1"
                style={{ borderColor: "rgba(255,255,255,0.1)" }}
              >
                <div
                  className="text-[8px] font-bold uppercase tracking-widest"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  {k}
                </div>
                <div className="font-mono text-[12px]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </CornerFrame>

      {/* Position feed */}
      <div className="mt-5">
        <div
          className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]"
          style={{ color: CYAN }}
        >
          <span>{"▮▮▮▮"}</span>
          POSITION_FEED
          <span style={{ color: "rgba(255,255,255,0.3)" }}>
            {">>"} {b.positions.length}/04 ACTIVE
          </span>
        </div>

        <div className="space-y-3">
          {b.positions.map((p) => {
            const profit = p.pnlUsd >= 0;
            const sideColor = p.side === "long" ? ACID : RED;
            return (
              <CornerFrame key={p.id}>
                <div
                  className="border p-3"
                  style={{
                    borderColor: `${sideColor}40`,
                    background: `linear-gradient(180deg, ${sideColor}08, transparent)`,
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="rounded-sm px-1.5 text-[10px] font-bold uppercase tracking-widest"
                        style={{
                          background: `${sideColor}25`,
                          color: sideColor,
                          boxShadow: `inset 0 0 0 1px ${sideColor}`,
                        }}
                      >
                        ╳ {p.side}
                      </span>
                      <span
                        className="font-bold tracking-wide"
                        style={{
                          fontSize: "20px",
                          color: "white",
                          textShadow: `0 0 8px ${sideColor}`,
                        }}
                      >
                        {p.asset}
                      </span>
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        ×{p.leverage}
                      </span>
                    </div>
                    <span
                      className="font-mono text-[10px]"
                      style={{ color: "rgba(255,255,255,0.4)" }}
                    >
                      T+{p.openSinceMin}m
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        ENTRY{" "}
                      </span>
                      <span>{p.entryMark.toFixed(2)}</span>
                    </div>
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        NOW{" "}
                      </span>
                      <span style={{ color: profit ? ACID : RED }}>
                        {p.currentMark.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        P/L{" "}
                      </span>
                      <span
                        style={{
                          color: profit ? ACID : RED,
                          textShadow: `0 0 6px ${profit ? ACID : RED}`,
                        }}
                      >
                        {profit ? "+" : "-"}${Math.abs(p.pnlUsd).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div
                    className="mt-2 border-l-2 pl-2 text-[12px] italic"
                    style={{
                      borderColor: MAGENTA,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    &gt; {p.narration}
                  </div>
                </div>
              </CornerFrame>
            );
          })}
        </div>
      </div>

      {/* Wiretap chatter */}
      <div className="mt-6">
        <div
          className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]"
          style={{ color: MAGENTA }}
        >
          <span>{"⌬"}</span>
          INTERCEPT // CHATTER
        </div>
        <div className="space-y-2 font-mono text-[11px]">
          {MOCK_CHATTER.map((c) => {
            const isOpen = c.action === "opened";
            const accent = isOpen ? CYAN : MAGENTA;
            return (
              <div
                key={c.id}
                className="border-l-2 pl-2"
                style={{ borderColor: `${accent}80` }}
              >
                <div className="flex items-baseline gap-2">
                  <span style={{ color: "rgba(255,255,255,0.3)" }}>
                    -{c.ago.padStart(3)}
                  </span>
                  <span className="text-[15px]">{c.avatarEmoji}</span>
                  <span style={{ color: accent, textShadow: `0 0 6px ${accent}` }}>
                    {c.botName}
                  </span>
                  <span
                    className="rounded-sm px-1 text-[9px] font-bold uppercase tracking-widest"
                    style={{
                      background: `${accent}25`,
                      color: accent,
                      boxShadow: `inset 0 0 0 1px ${accent}`,
                    }}
                  >
                    {isOpen ? "OPEN" : "CLOSE"} {c.side} {c.asset} ×{c.leverage}
                  </span>
                  {c.pnlUsd != null && (
                    <span
                      style={{
                        color: c.pnlUsd >= 0 ? ACID : RED,
                        textShadow: `0 0 6px ${c.pnlUsd >= 0 ? ACID : RED}`,
                      }}
                    >
                      {c.pnlUsd >= 0 ? "+" : "-"}${Math.abs(c.pnlUsd).toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="ml-7 italic" style={{ color: "rgba(255,255,255,0.75)" }}>
                  &gt; {c.quote}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Link
        href="/design"
        className="mt-8 inline-block text-[10px] font-bold uppercase tracking-widest opacity-50 hover:opacity-100"
        style={{ color: CYAN }}
      >
        ◀ BACK TO STYLES
      </Link>
    </main>
  );
}
