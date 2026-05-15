import Link from "next/link";
import { MOCK_BOT, MOCK_CHATTER } from "../mock-data";

export const dynamic = "force-static";

const ACCENT = "#fae500"; // acid yellow — status / highlights only
const BG = "#f3f1ec"; // bone
const FG = "#0a0a0a"; // ink
const GREEN = "#1ca35e"; // P/L positive
const RED = "#d3262d"; // P/L negative

interface SlideProps {
  index: number;
  total: number;
  inverted: boolean;
  children: React.ReactNode;
}

function Slide({ index, total, inverted, children }: SlideProps) {
  const bg = inverted ? FG : BG;
  const fg = inverted ? BG : FG;
  return (
    <section
      className="flex h-screen w-full snap-start flex-col"
      style={{
        background: bg,
        color: fg,
        fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
      }}
    >
      <div className="flex flex-1 flex-col px-5 py-4">
        {/* Slide counter header */}
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">
            {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
            <span className="ml-2">GWAK SERIES 01</span>
          </div>
          <div className="text-[10px] font-bold tracking-widest opacity-40">
            LZRD-50/01
          </div>
        </div>

        {/* Slide content */}
        <div className="flex flex-1 flex-col justify-center">{children}</div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Slide content blocks
// ──────────────────────────────────────────────────────────────────────────

function IdentityContent({ inverted }: { inverted: boolean }) {
  const b = MOCK_BOT;
  return (
    <>
      <div className="text-[11px] font-black uppercase tracking-[0.3em] opacity-60">
        {`"PAPER OPERATOR"`}
      </div>
      <h1
        className="mt-1 font-black uppercase leading-[0.9]"
        style={{
          fontSize: "56px",
          letterSpacing: "-0.03em",
          fontStretch: "condensed",
        }}
      >
        {`"${b.name}"`}
      </h1>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-5xl leading-none">{b.avatarEmoji}</span>
        <div
          className="inline-flex items-center gap-2 border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
          style={{ borderColor: inverted ? BG : FG }}
        >
          <span
            className="inline-block h-1.5 w-1.5"
            style={{ background: ACCENT }}
          />
          STATUS — {b.mood}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4">
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest opacity-50">
            BANKROLL
          </div>
          <div className="mt-1 text-[26px] font-black leading-none">
            ${b.bankrollUsd}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest opacity-50">
            LIFETIME
          </div>
          <div
            className="mt-1 text-[26px] font-black leading-none"
            style={{ color: b.lifetimeReturnPct >= 0 ? GREEN : RED }}
          >
            {b.lifetimeReturnPct >= 0 ? "+" : ""}
            {(b.lifetimeReturnPct * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest opacity-50">
            OPEN
          </div>
          <div className="mt-1 text-[26px] font-black leading-none">
            {String(b.positions.length).padStart(2, "0")}/04
          </div>
        </div>
      </div>
    </>
  );
}

function PositionContent({
  pos,
  posIndex,
  inverted,
}: {
  pos: (typeof MOCK_BOT)["positions"][number];
  posIndex: number;
  inverted: boolean;
}) {
  const profit = pos.pnlUsd >= 0;
  return (
    <>
      <div className="text-[11px] font-black uppercase tracking-[0.3em] opacity-60">
        POSITION {String(posIndex).padStart(2, "0")} / OF{" "}
        {String(MOCK_BOT.positions.length).padStart(2, "0")}
      </div>

      <div className="mt-2 flex items-baseline gap-3">
        <span
          className="px-2 py-1 text-[12px] font-black uppercase tracking-widest"
          style={{
            background: pos.side === "short" ? (inverted ? BG : FG) : ACCENT,
            color: pos.side === "short" ? (inverted ? FG : BG) : FG,
          }}
        >
          {pos.side}
        </span>
        <span
          className="font-black uppercase leading-[0.9]"
          style={{
            fontSize: "72px",
            letterSpacing: "-0.03em",
            fontStretch: "condensed",
          }}
        >
          {pos.asset}
        </span>
      </div>

      <div className="mt-1 text-[14px] font-black opacity-60">
        ×{pos.leverage} LEVERAGE · {pos.openSinceMin}M AGO
      </div>

      <div
        className="mt-6 grid grid-cols-3 gap-3 border-t-2 pt-3"
        style={{ borderColor: inverted ? BG : FG }}
      >
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest opacity-50">
            ENTRY
          </div>
          <div className="mt-0.5 text-[20px] font-black">
            ${pos.entryMark.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest opacity-50">
            NOW
          </div>
          <div className="mt-0.5 text-[20px] font-black">
            ${pos.currentMark.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest opacity-50">
            P/L
          </div>
          <div
            className="mt-0.5 inline-block px-1.5 text-[20px] font-black"
            style={{ background: profit ? GREEN : RED, color: "#fff" }}
          >
            {profit ? "+" : "-"}${Math.abs(pos.pnlUsd).toFixed(2)}
          </div>
        </div>
      </div>

      <p className="mt-6 text-[18px] font-bold leading-tight">
        {`"${pos.narration}"`}
      </p>
    </>
  );
}

function ChatterContent({
  ev,
  eventIndex,
  inverted,
}: {
  ev: (typeof MOCK_CHATTER)[number];
  eventIndex: number;
  inverted: boolean;
}) {
  const isOpen = ev.action === "opened";
  return (
    <>
      <div className="text-[11px] font-black uppercase tracking-[0.3em] opacity-60">
        CHATTER NO. {String(287 + eventIndex).padStart(3, "0")} · — {ev.ago}{" "}
        AGO
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-5xl leading-none">{ev.avatarEmoji}</span>
        <div
          className="text-[20px] font-black uppercase leading-[0.95]"
          style={{
            letterSpacing: "-0.02em",
            fontStretch: "condensed",
          }}
        >
          {ev.botName}
        </div>
      </div>

      <div className="mt-3">
        <span
          className="px-2 py-1 text-[12px] font-black uppercase tracking-widest"
          style={{
            background: isOpen ? ACCENT : inverted ? BG : FG,
            color: isOpen ? FG : inverted ? FG : BG,
          }}
        >
          {ev.action} {ev.side} {ev.asset} ×{ev.leverage}
        </span>
      </div>

      <p className="mt-6 text-[26px] font-black leading-[1.05]">
        {`"${ev.quote}"`}
      </p>

      {ev.pnlUsd != null && (
        <div
          className="mt-4 inline-block px-2 py-1 text-[16px] font-black tracking-widest"
          style={{
            background: ev.pnlUsd >= 0 ? GREEN : RED,
            color: "#fff",
          }}
        >
          P/L {ev.pnlUsd >= 0 ? "+" : "-"}$
          {Math.abs(ev.pnlUsd).toFixed(2)}
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function HypebeastDesignPage() {
  // Slide assembly: bot identity, two positions, then five chatter events.
  // Slides alternate bone (false) → ink (true) → bone → ink → ...
  const slides: Array<{ render: (inv: boolean) => React.ReactNode }> = [
    { render: (inv) => <IdentityContent inverted={inv} /> },
    ...MOCK_BOT.positions.map((pos, i) => ({
      render: (inv: boolean) => (
        <PositionContent pos={pos} posIndex={i + 1} inverted={inv} />
      ),
    })),
    ...MOCK_CHATTER.map((ev, i) => ({
      render: (inv: boolean) => (
        <ChatterContent ev={ev} eventIndex={i} inverted={inv} />
      ),
    })),
  ];
  const total = slides.length;

  return (
    <main
      className="h-screen w-full snap-y snap-mandatory overflow-y-scroll"
      style={{
        scrollSnapStop: "always",
      }}
    >
      {slides.map((s, i) => {
        const inverted = i % 2 === 1;
        return (
          <Slide
            key={i}
            index={i + 1}
            total={total}
            inverted={inverted}
          >
            {s.render(inverted)}
          </Slide>
        );
      })}

      {/* Final back-link slide */}
      <section
        className="flex h-screen w-full snap-start flex-col items-center justify-center"
        style={{
          background: BG,
          color: FG,
          fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
        }}
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60">
            END OF SERIES
          </div>
          <Link
            href="/design"
            className="border-2 px-4 py-2 text-[12px] font-black uppercase tracking-widest"
            style={{ borderColor: FG }}
          >
            ← BACK TO STYLES
          </Link>
          <div className="mt-2 text-[9px] font-black uppercase tracking-widest opacity-50">
            MADE IN GWAK / 2026 · SERIES 01 OF 12
          </div>
        </div>
      </section>
    </main>
  );
}
