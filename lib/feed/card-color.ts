import type { Signal } from "@/lib/types";

const FALLBACK = "radial-gradient(ellipse at top, #1a0a05, #050505 60%)";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Family {
  hueStart: number;
  hueRange: number;
  saturation: number;
  lightness: number;
}

const FAMILIES: Record<Signal["type"], Family> = {
  meme:             { hueStart: 0,   hueRange: 50, saturation: 80, lightness: 13 },
  prediction:       { hueStart: 200, hueRange: 40, saturation: 75, lightness: 12 },
  multiprediction:  { hueStart: 200, hueRange: 40, saturation: 75, lightness: 12 },
  whale:            { hueStart: 260, hueRange: 50, saturation: 70, lightness: 13 },
  pacifica_trader:  { hueStart: 165, hueRange: 30, saturation: 70, lightness: 13 },
  bot:              { hueStart: 45,  hueRange: 30, saturation: 75, lightness: 12 },
};

export function cardGradient(signal: Signal | undefined): string {
  if (!signal) return FALLBACK;
  const fam = FAMILIES[signal.type];
  if (!fam) return FALLBACK;
  const seed = hash(signal.id);
  const hue = fam.hueStart + (seed % 1000) / 1000 * fam.hueRange;
  return `radial-gradient(ellipse at top, hsl(${hue.toFixed(1)} ${fam.saturation}% ${fam.lightness}%), #050505 65%)`;
}
