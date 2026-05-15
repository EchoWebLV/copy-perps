import Link from "next/link";
import { MOCK_BOT, MOCK_CHATTER } from "../mock-data";

export const dynamic = "force-static";

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n, " ");
}
function rpad(s: string | number, n: number): string {
  return String(s).padStart(n, " ");
}

const RULE = "─".repeat(38);

export default function TerminalDesignPage() {
  const b = MOCK_BOT;
  const yellow = "#ffb000"; // amber phosphor
  const green = "#3eff9a";
  const red = "#ff4d6d";
  const dim = "rgba(255,176,0,0.45)";

  return (
    <main
      className="min-h-screen w-full px-4 py-3 font-mono text-[12px] leading-snug"
      style={{
        background: "#0a0805",
        color: yellow,
        // soft phosphor afterglow
        textShadow: "0 0 6px rgba(255,176,0,0.25)",
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border border-current px-2 py-1">
        <span className="font-bold tracking-widest">GWAK TERMINAL v0.1</span>
        <span style={{ color: dim }}>21:54:59 UTC</span>
      </div>

      {/* Bot ticker block */}
      <pre className="mt-3 whitespace-pre-wrap">{`${b.id.toUpperCase()}  ${pad(b.name, 22)}    F${b.leverage}x
${RULE}
STATUS    : `}<span style={{ color: green }}>{b.mood}</span>{`
BANKROLL  : ${rpad("$" + b.bankrollUsd, 8)}    LIFETIME: `}<span style={{ color: b.lifetimeReturnPct >= 0 ? green : red }}>{`${b.lifetimeReturnPct >= 0 ? "+" : ""}${(b.lifetimeReturnPct * 100).toFixed(1)}%`}</span>{`
CASH      : ${rpad("$" + b.cashUsd, 8)}    OPEN    : ${b.positions.length}
TRADES    : ${rpad(b.stats.totalTrades, 8)}    WR      : ${(b.stats.winRate * 100).toFixed(0)}%
24H P/L   : `}<span style={{ color: b.stats.paperPnl24hUsd >= 0 ? green : red }}>{`${b.stats.paperPnl24hUsd >= 0 ? "+" : ""}$${b.stats.paperPnl24hUsd}`}</span>{`    7D P/L  : `}<span style={{ color: b.stats.paperPnl7dUsd >= 0 ? green : red }}>{`${b.stats.paperPnl7dUsd >= 0 ? "+" : ""}$${b.stats.paperPnl7dUsd}`}</span>
      </pre>

      {/* Open positions block */}
      <div className="mt-3">
        <div className="font-bold tracking-wider">OPEN POSITIONS</div>
        <div style={{ color: dim }}>{RULE}</div>
        {b.positions.map((p, i) => {
          const sideUp = p.side.toUpperCase();
          const profit = p.pnlUsd >= 0;
          return (
            <pre key={p.id} className="mt-1 whitespace-pre-wrap">
{`[${i + 1}] ${sideUp} ${pad(p.asset, 5)} ${p.leverage}x @ ${p.entryMark.toFixed(2)} → ${p.currentMark.toFixed(2)}
    P/L      : `}<span style={{ color: profit ? green : red }}>{`${profit ? "+" : "-"}$${Math.abs(p.pnlUsd).toFixed(2)} (${profit ? "+" : ""}${(p.pnlPct * 100).toFixed(1)}%)`}</span>{`
    STAKE    : $${p.stakeUsd}        AGE: ${p.openSinceMin}m
    EVIDENCE : liq=$${(Number(p.evidence.liqUsd) / 1000).toFixed(0)}k  side=${p.evidence.side}  via=${p.evidence.venue}
    > "${p.narration}"`}
            </pre>
          );
        })}
      </div>

      {/* Chatter tape */}
      <div className="mt-4">
        <div className="font-bold tracking-wider">CHATTER FEED</div>
        <div style={{ color: dim }}>{RULE}</div>
        {MOCK_CHATTER.map((c) => {
          const isOpen = c.action === "opened";
          const pnlClr = c.pnlUsd != null && c.pnlUsd >= 0 ? green : red;
          return (
            <pre key={c.id} className="mt-1 whitespace-pre-wrap">
{`-${c.ago.padStart(3)}  ${pad(c.botName, 24)}  ${isOpen ? "OPEN " : "CLOSE"}  ${c.side.toUpperCase()} ${pad(c.asset, 5)} ${c.leverage}x`}{c.pnlUsd != null && (
                <span style={{ color: pnlClr }}>{`  ${c.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(c.pnlUsd).toFixed(2)}`}</span>
              )}{`
        > "${c.quote}"`}
            </pre>
          );
        })}
      </div>

      {/* Prompt */}
      <div className="mt-5 flex items-center gap-1">
        <span style={{ color: green }}>{">"}</span>
        <span className="inline-block h-3 w-2 animate-pulse" style={{ background: yellow }} />
      </div>

      <Link
        href="/design"
        className="mt-8 inline-block text-[10px] tracking-wider opacity-50 hover:opacity-100"
      >
        ← BACK TO STYLES
      </Link>
    </main>
  );
}
