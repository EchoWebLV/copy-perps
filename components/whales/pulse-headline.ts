export type PulseHeadlineTone = "green" | "red";

export interface PulseHeadlinePart {
  text: string;
  tone?: PulseHeadlineTone;
}

const PERFORMANCE_WORD_RE = /\bis already (up|down)\b/i;

export function splitPulseHeadline(headline: string): PulseHeadlinePart[] {
  const match = PERFORMANCE_WORD_RE.exec(headline);
  const word = match?.[1];
  if (!match || !word) return [{ text: headline }];

  const wordOffset = match[0].toLowerCase().lastIndexOf(word.toLowerCase());
  const wordStart = match.index + wordOffset;
  const wordEnd = wordStart + word.length;
  const tone: PulseHeadlineTone = word.toLowerCase() === "up" ? "green" : "red";

  return [
    { text: headline.slice(0, wordStart) },
    { text: headline.slice(wordStart, wordEnd), tone },
    { text: headline.slice(wordEnd) },
  ].filter((part) => part.text.length > 0);
}
