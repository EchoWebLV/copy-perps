"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PhoneFrame } from "./PhoneFrame";
import {
  MockMemeCard,
  MockPredictionCard,
  MockWhaleCard,
  type CardPhase,
} from "./MockCards";
import { MockPortfolio } from "./MockPortfolio";

export type Rail = "meme" | "prediction" | "whale";

type Phase =
  | "idle"
  | "tap"
  | "pending"
  | "confirmed"
  | "navOut"
  | "glimpse"
  | "navBack";

const SEGMENTS: { phase: Phase; dur: number }[] = [
  { phase: "idle", dur: 1100 },
  { phase: "tap", dur: 300 },
  { phase: "pending", dur: 800 },
  { phase: "confirmed", dur: 800 },
  { phase: "navOut", dur: 400 },
  { phase: "glimpse", dur: 1800 },
  { phase: "navBack", dur: 800 },
];

const RAILS: Rail[] = ["meme", "prediction", "whale"];
const RAIL_DUR = SEGMENTS.reduce((s, x) => s + x.dur, 0);
const TOTAL_DUR = RAIL_DUR * RAILS.length;

interface ReelState {
  rail: Rail;
  railIdx: number;
  phase: Phase;
  progress: number;
}

function getState(elapsed: number): ReelState {
  const t = ((elapsed % TOTAL_DUR) + TOTAL_DUR) % TOTAL_DUR;
  const railIdx = Math.floor(t / RAIL_DUR);
  const railT = t - railIdx * RAIL_DUR;
  let cursor = 0;
  for (const seg of SEGMENTS) {
    if (railT < cursor + seg.dur) {
      return {
        rail: RAILS[railIdx],
        railIdx,
        phase: seg.phase,
        progress: Math.max(0, Math.min(1, (railT - cursor) / seg.dur)),
      };
    }
    cursor += seg.dur;
  }
  return { rail: RAILS[railIdx], railIdx, phase: "idle", progress: 0 };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function MockReel() {
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

  const cardRail =
    state.phase === "navBack"
      ? RAILS[(state.railIdx + 1) % RAILS.length]
      : state.rail;

  const portfolioVisible =
    state.phase === "navOut" ||
    state.phase === "glimpse" ||
    state.phase === "navBack";

  const portfolioOpacity =
    state.phase === "navOut"
      ? easeOut(state.progress)
      : state.phase === "glimpse"
        ? 1
        : state.phase === "navBack"
          ? 1 - easeOut(state.progress)
          : 0;

  const portfolioTranslateY =
    state.phase === "navOut"
      ? (1 - easeOut(state.progress)) * 30
      : state.phase === "glimpse"
        ? 0
        : state.phase === "navBack"
          ? easeOut(state.progress) * 30
          : 30;

  const cardOpacity =
    state.phase === "navBack" ? easeOut(state.progress) : 1;
  const cardTranslateY =
    state.phase === "navBack"
      ? (1 - easeOut(state.progress)) * 24
      : 0;

  const cardPhase: CardPhase =
    cardRail !== state.rail
      ? "idle"
      : state.phase === "tap" ||
          state.phase === "pending" ||
          state.phase === "confirmed"
        ? state.phase
        : "idle";

  const cardPhaseProgress =
    state.phase === "tap" ||
    state.phase === "pending" ||
    state.phase === "confirmed"
      ? state.progress
      : 0;

  const activeTab: "feed" | "portfolio" =
    state.phase === "navOut"
      ? state.progress > 0.5
        ? "portfolio"
        : "feed"
      : state.phase === "glimpse"
        ? "portfolio"
        : state.phase === "navBack"
          ? state.progress > 0.5
            ? "feed"
            : "portfolio"
          : "feed";

  // Cumulative portfolio: rails bought so far in this loop.
  // - During idle/tap/pending/confirmed of rail N: rails before N
  // - During navOut/glimpse/navBack of rail N: rails through N (N just bought)
  const portfolioRails: Rail[] =
    state.phase === "navOut" ||
    state.phase === "glimpse" ||
    state.phase === "navBack"
      ? RAILS.slice(0, state.railIdx + 1)
      : RAILS.slice(0, state.railIdx);

  // Responsive scaling: chassis is 410x864; fill the viewport up to native
  // size, never above. The export viewport is sized to match the phone, so
  // the phone fills the entire frame edge-to-edge.
  const wrapStyle: CSSProperties = {
    "--phone-scale":
      "min(1, calc(100vw / 410), calc(100dvh / 864))",
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
        <PhoneFrame activeTab={activeTab}>
          <div className="relative h-full w-full">
            <div
              className="absolute inset-0"
              style={{
                opacity: cardOpacity,
                transform: `translateY(${cardTranslateY}px)`,
              }}
            >
              {cardRail === "meme" ? (
                <MockMemeCard phase={cardPhase} progress={cardPhaseProgress} />
              ) : cardRail === "prediction" ? (
                <MockPredictionCard
                  phase={cardPhase}
                  progress={cardPhaseProgress}
                />
              ) : (
                <MockWhaleCard
                  phase={cardPhase}
                  progress={cardPhaseProgress}
                />
              )}
            </div>
            {portfolioVisible && (
              <div
                className="absolute inset-0"
                style={{
                  opacity: portfolioOpacity,
                  transform: `translateY(${portfolioTranslateY}px)`,
                }}
              >
                <MockPortfolio rails={portfolioRails} />
              </div>
            )}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}
