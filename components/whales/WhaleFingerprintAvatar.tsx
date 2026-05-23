import { ACCENT, BG, FAINT, GREEN, RED, STREAK } from "@/components/v2/ui";
import {
  buildWhaleFingerprintAvatarModel,
  WHALE_FINGERPRINT_GRID_SIZE,
} from "./whale-fingerprint";

const MOOD_RING: Record<string, string> = {
  HUNTING: GREEN,
  LOADED: ACCENT,
  WOUNDED: RED,
  ON_STREAK: STREAK,
  DORMANT: FAINT,
  BUSTED: "#666",
};

export function WhaleFingerprintAvatar({
  sourceAccount,
  label,
  mood,
  size = 56,
  pulse = false,
}: {
  sourceAccount: string;
  label?: string;
  mood?: string;
  size?: number;
  pulse?: boolean;
}) {
  const model = buildWhaleFingerprintAvatarModel(sourceAccount);
  const ringColor = (mood && MOOD_RING[mood]) || model.colors.primary;
  const labelText = label ? `${label} wallet fingerprint` : "Wallet fingerprint";

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${pulse ? "animate-pulse" : ""}`}
      data-whale-fingerprint-avatar={sourceAccount}
      role="img"
      aria-label={labelText}
      style={{
        width: size,
        height: size,
        padding: 2,
        background: ringColor,
        boxShadow: `0 0 10px ${ringColor}44`,
      }}
    >
      <div
        className="h-full w-full overflow-hidden rounded-full"
        style={{ background: BG }}
      >
        <svg
          viewBox={`0 0 ${WHALE_FINGERPRINT_GRID_SIZE} ${WHALE_FINGERPRINT_GRID_SIZE}`}
          className="h-full w-full"
          aria-hidden="true"
          focusable="false"
          shapeRendering="crispEdges"
        >
          <rect
            width={WHALE_FINGERPRINT_GRID_SIZE}
            height={WHALE_FINGERPRINT_GRID_SIZE}
            fill={model.colors.background}
          />
          {model.cells.map((cell) => (
            <rect
              key={`${cell.col}-${cell.row}-${cell.role}`}
              x={cell.col}
              y={cell.row}
              width="1"
              height="1"
              fill={cell.color}
              opacity={cell.opacity}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
