export const WHALE_FINGERPRINT_GRID_SIZE = 16;

export type WhaleFingerprintCellRole = "finder" | "data";

export type WhaleFingerprintCell = {
  col: number;
  row: number;
  color: string;
  opacity: number;
  role: WhaleFingerprintCellRole;
};

export type WhaleFingerprintAvatarModel = {
  cells: WhaleFingerprintCell[];
  colors: {
    background: string;
    primary: string;
    secondary: string;
    accent: string;
    ink: string;
  };
  rotationDeg: number;
};

const FINDER_SIZE = 4;
const FINDER_ORIGINS = [
  [0, 0],
  [WHALE_FINGERPRINT_GRID_SIZE - FINDER_SIZE, 0],
  [0, WHALE_FINGERPRINT_GRID_SIZE - FINDER_SIZE],
] as const;

export function buildWhaleFingerprintAvatarModel(
  sourceAccount: string,
): WhaleFingerprintAvatarModel {
  const normalized = normalizeSeed(sourceAccount);
  const random = seededRandom(fnv1a(normalized));
  const baseHue = Math.floor(random() * 360);
  const secondaryHue = (baseHue + 88 + Math.floor(random() * 88)) % 360;
  const accentHue = (baseHue + 196 + Math.floor(random() * 72)) % 360;
  const colors = {
    background: `hsl(${(baseHue + 232) % 360} 46% 8%)`,
    primary: `hsl(${baseHue} 96% 62%)`,
    secondary: `hsl(${secondaryHue} 88% 56%)`,
    accent: `hsl(${accentHue} 96% 68%)`,
    ink: `hsl(${(baseHue + 18) % 360} 92% 76%)`,
  };
  const cells: WhaleFingerprintCell[] = [];
  const reserved = new Set<string>();

  for (const [originCol, originRow] of FINDER_ORIGINS) {
    for (let row = 0; row < FINDER_SIZE; row += 1) {
      for (let col = 0; col < FINDER_SIZE; col += 1) {
        const cellCol = originCol + col;
        const cellRow = originRow + row;
        reserved.add(cellKey(cellCol, cellRow));
        if (col >= 1 && col <= 2 && row >= 1 && row <= 2) {
          cells.push({
            col: cellCol,
            row: cellRow,
            color: colors.accent,
            opacity: 1,
            role: "finder",
          });
          continue;
        }
        cells.push({
          col: cellCol,
          row: cellRow,
          color:
            col === 0 || row === 0 || col === 2 || row === 2
              ? colors.primary
              : colors.secondary,
          opacity: 0.95,
          role: "finder",
        });
      }
    }
  }

  for (let row = 0; row < WHALE_FINGERPRINT_GRID_SIZE; row += 1) {
    for (let col = 0; col < WHALE_FINGERPRINT_GRID_SIZE; col += 1) {
      if (reserved.has(cellKey(col, row))) continue;
      const edgeBias =
        row === 0 ||
        col === 0 ||
        row === WHALE_FINGERPRINT_GRID_SIZE - 1 ||
        col === WHALE_FINGERPRINT_GRID_SIZE - 1
          ? 0.08
          : 0;
      if (random() < 0.68 + edgeBias) continue;
      cells.push({
        col,
        row,
        color: colors.primary,
        opacity: 0.94,
        role: "data",
      });
    }
  }

  return {
    cells,
    colors,
    rotationDeg: Math.floor(random() * 360),
  };
}

function normalizeSeed(sourceAccount: string): string {
  const trimmed = sourceAccount.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "anonymous-whale";
}

function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
