// Deterministic seeded shuffle so paginated batches stay consistent across
// requests as long as the client passes the same seed back.

export function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

interface Typed {
  type: string;
}

/**
 * Interleave a shuffled pool into a strict 1-meme / 1-non-meme rotation,
 * and within the non-meme slot alternate whale and prediction so the
 * smaller bucket (usually whales) gets equal billing instead of being
 * drowned out by predictions when picked at random. Whales count as
 * "perp", predictions and multipredictions both count as "market".
 *
 * Pattern: M W M P M W M P M W ... with predictions filling in once
 * whales exhaust, then memes spilling at the tail.
 *
 * Same seed → same sequence, so paginated batches stay consistent.
 */
export function interleaveByRail<T extends Typed>(
  signals: readonly T[],
  seed: number,
): T[] {
  const memes: T[] = [];
  const whales: T[] = [];
  const markets: T[] = [];
  for (const s of signals) {
    if (s.type === "meme") memes.push(s);
    else if (s.type === "whale") whales.push(s);
    else markets.push(s); // prediction + multiprediction
  }

  // XOR each shuffle seed so the three buckets don't end up in lock-step
  // when the same seed is used across requests.
  const sM = seededShuffle(memes, seed);
  const sW = seededShuffle(whales, seed ^ 0x9e3779b9);
  const sP = seededShuffle(markets, seed ^ 0x12345678);

  const out: T[] = [];
  let mi = 0;
  let wi = 0;
  let pi = 0;
  let nonMemeTick = 0;
  while (mi < sM.length || wi < sW.length || pi < sP.length) {
    if (mi < sM.length) out.push(sM[mi++]);

    // Alternate whale/market for the non-meme slot. If one bucket is
    // exhausted, fall through to the other so we don't emit empty slots.
    const preferWhale = nonMemeTick++ % 2 === 0;
    if (preferWhale) {
      if (wi < sW.length) out.push(sW[wi++]);
      else if (pi < sP.length) out.push(sP[pi++]);
    } else {
      if (pi < sP.length) out.push(sP[pi++]);
      else if (wi < sW.length) out.push(sW[wi++]);
    }
  }
  return out;
}
