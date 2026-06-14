"use client";

// Bull/bear bias meter for an arena bot. Presentational only — fed a signed
// bias in [-1, +1] and the dominant side from botDirectionalBias(). A center
// zero tick, a fill spanning from center to the needle, green=bull/red=bear,
// dimmed + centered when the bot is flat. Two sizes: compact (card) and
// larger (profile).

import type { ArenaSide } from "@/lib/arena/decode";
import { DIM, FAINT, GREEN, RED } from "@/components/v2/ui";

export function BullBearMeter({
  bias,
  side,
  size = "card",
}: {
  /** Signed needle position in [-1, +1] (from botDirectionalBias). */
  bias: number;
  /** Dominant side, or null when flat → neutral, dimmed reading. */
  side: ArenaSide | null;
  size?: "card" | "profile";
}) {
  const big = size === "profile";
  const color = side === "long" ? GREEN : side === "short" ? RED : DIM;
  const pct = Math.round(Math.abs(bias) * 100);
  const label =
    side === "long" ? `BULL ${pct}%` : side === "short" ? `BEAR ${pct}%` : "NEUTRAL";

  const needleLeft = 50 + bias * 50; // [-1,1] → 0..100%
  const fillLeft = Math.min(50, needleLeft);
  const fillWidth = Math.abs(needleLeft - 50);
  const dot = big ? 14 : 11;

  return (
    <div className="w-full">
      <div
        className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em]"
        style={{ color: DIM }}
      >
        <span>bias</span>
        <span style={{ color }}>{label}</span>
      </div>
      <div
        className="relative mt-1.5 w-full rounded-full"
        style={{ height: big ? 10 : 7, background: "rgba(250,250,242,0.08)" }}
      >
        {/* center zero tick */}
        <span
          className="absolute top-0 bottom-0"
          style={{ left: "50%", width: 1, transform: "translateX(-0.5px)", background: FAINT }}
          aria-hidden
        />
        {/* fill from center toward the needle */}
        {side && (
          <span
            className="absolute top-0 bottom-0 rounded-full"
            style={{
              left: `${fillLeft}%`,
              width: `${fillWidth}%`,
              background: color,
              opacity: 0.35,
              transition: "left 400ms ease, width 400ms ease, background 400ms ease",
            }}
            aria-hidden
          />
        )}
        {/* needle */}
        <span
          className="absolute rounded-full"
          style={{
            top: "50%",
            left: `${needleLeft}%`,
            width: dot,
            height: dot,
            transform: "translate(-50%, -50%)",
            background: color,
            boxShadow: side ? `0 0 8px ${color}` : "none",
            transition: "left 400ms ease, background 400ms ease",
          }}
          aria-hidden
        />
      </div>
      {big && (
        <div
          className="mt-1 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.2em]"
          style={{ color: DIM }}
        >
          <span style={{ color: side === "short" ? RED : DIM }}>bear</span>
          <span style={{ color: side === "long" ? GREEN : DIM }}>bull</span>
        </div>
      )}
    </div>
  );
}
