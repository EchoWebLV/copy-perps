export const PROFILE_CODE_SIZE = 15;

export function profileSharePath(handle: string): string {
  return `/u/${stripAt(handle)}`;
}

export function buildProfileShareUrl(origin: string, handle: string): string {
  return new URL(profileSharePath(handle), origin).toString();
}

export function makeProfileCodePattern(seed: string): boolean[][] {
  const size = PROFILE_CODE_SIZE;
  const pattern = Array.from({ length: size }, () => Array(size).fill(false));
  const rand = seededRandom(seed || "gwk_anon");

  placeFinder(pattern, 0, 0);
  placeFinder(pattern, size - 5, 0);
  placeFinder(pattern, 0, size - 5);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inFinder(x, y, size)) continue;
      pattern[y][x] = rand() > 0.54;
    }
  }

  // Keep one unmistakable quiet corner so the code feels deliberately custom.
  pattern[size - 1][size - 1] = false;
  return pattern;
}

function stripAt(handle: string): string {
  return handle.trim().replace(/^@+/, "");
}

function placeFinder(pattern: boolean[][], startX: number, startY: number) {
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const edge = x === 0 || x === 4 || y === 0 || y === 4;
      const core = x >= 2 && x <= 3 && y >= 2 && y <= 3;
      pattern[startY + y][startX + x] = edge || core;
    }
  }
}

function inFinder(x: number, y: number, size: number): boolean {
  return (
    (x < 5 && y < 5) ||
    (x >= size - 5 && y < 5) ||
    (x < 5 && y >= size - 5)
  );
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
