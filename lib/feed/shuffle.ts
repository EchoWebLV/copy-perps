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
 * Interleave a shuffled pool so memes never run more than `maxMemeRun` in a
 * row while non-memes (predictions + whales) are available. Once the
 * non-meme bucket is drained the remaining memes spill out at the tail —
 * unavoidable when memes outnumber the rest 7:1.
 *
 * Same seed → same sequence, so paginated batches stay consistent.
 */
export function interleaveByRail<T extends Typed>(
  signals: readonly T[],
  seed: number,
  maxMemeRun = 2,
): T[] {
  const memes: T[] = [];
  const others: T[] = [];
  for (const s of signals) {
    (s.type === "meme" ? memes : others).push(s);
  }
  const shuffledMemes = seededShuffle(memes, seed);
  // XOR to derive an independent stream so the same seed doesn't produce
  // the same relative order for both buckets.
  const shuffledOthers = seededShuffle(others, seed ^ 0x9e3779b9);

  const out: T[] = [];
  let mi = 0;
  let oi = 0;
  while (mi < shuffledMemes.length || oi < shuffledOthers.length) {
    for (let k = 0; k < maxMemeRun && mi < shuffledMemes.length; k++) {
      out.push(shuffledMemes[mi++]);
    }
    if (oi < shuffledOthers.length) {
      out.push(shuffledOthers[oi++]);
    }
  }
  return out;
}
