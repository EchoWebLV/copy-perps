export type PulseHeadlineTone = "green" | "red";
export type PulseHeadlineRole = "percentage";

export interface PulseHeadlinePart {
  text: string;
  tone?: PulseHeadlineTone;
  role?: PulseHeadlineRole;
}

const PERFORMANCE_WORD_RE = /\bis already (up|down)(?:\s+([+-]?\d+(?:\.\d+)?%))?/i;
const BRUSH_VARIANT_COUNT = 3;

export function getPulseHeadlineBrushVariant(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % BRUSH_VARIANT_COUNT;
}

export function splitPulseHeadline(headline: string): PulseHeadlinePart[] {
  const match = PERFORMANCE_WORD_RE.exec(headline);
  const word = match?.[1];
  if (!match || !word) return [{ text: headline }];

  const wordOffset = match[0].toLowerCase().lastIndexOf(word.toLowerCase());
  const wordStart = match.index + wordOffset;
  const wordEnd = wordStart + word.length;
  const tone: PulseHeadlineTone = word.toLowerCase() === "up" ? "green" : "red";
  const pct = match[2];

  if (!pct) {
    const parts: PulseHeadlinePart[] = [
      { text: headline.slice(0, wordStart) },
      { text: headline.slice(wordStart, wordEnd), tone },
      { text: headline.slice(wordEnd) },
    ];
    return parts.filter((part) => part.text.length > 0);
  }

  const pctOffset = match[0].lastIndexOf(pct);
  const pctStart = match.index + pctOffset;
  const pctEnd = pctStart + pct.length;

  const parts: PulseHeadlinePart[] = [
    { text: headline.slice(0, wordStart) },
    { text: headline.slice(wordStart, wordEnd), tone },
    { text: headline.slice(wordEnd, pctStart) },
    { text: headline.slice(pctStart, pctEnd), role: "percentage" },
    { text: headline.slice(pctEnd) },
  ];
  return parts.filter((part) => part.text.length > 0);
}
