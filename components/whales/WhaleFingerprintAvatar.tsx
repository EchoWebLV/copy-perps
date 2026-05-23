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
  const pad = 4.5;
  const moduleStep = (64 - pad * 2) / WHALE_FINGERPRINT_GRID_SIZE;
  const moduleSize = moduleStep * 0.72;
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
        padding: 3,
        background: `conic-gradient(from ${model.rotationDeg}deg, ${model.colors.primary}, ${ringColor}, ${model.colors.secondary}, ${model.colors.accent}, ${model.colors.primary})`,
        boxShadow: `0 0 18px ${ringColor}55`,
      }}
    >
      <div
        className="h-full w-full overflow-hidden rounded-full"
        style={{ background: BG }}
      >
        <svg
          viewBox="0 0 64 64"
          className="h-full w-full"
          aria-hidden="true"
          focusable="false"
        >
          <rect width="64" height="64" rx="18" fill={model.colors.background} />
          <circle
            cx="47"
            cy="16"
            r="18"
            fill={model.colors.secondary}
            opacity="0.14"
          />
          <circle
            cx="18"
            cy="47"
            r="22"
            fill={model.colors.accent}
            opacity="0.1"
          />
          <path
            d="M16 45c4-10 13-15 24-13M18 52c5-9 13-13 23-10M21 58c6-8 13-10 22-8"
            fill="none"
            stroke={model.colors.ink}
            strokeLinecap="round"
            strokeWidth="1.7"
            opacity="0.35"
          />
          {model.cells.map((cell) => (
            <rect
              key={`${cell.col}-${cell.row}-${cell.role}`}
              x={pad + cell.col * moduleStep}
              y={pad + cell.row * moduleStep}
              width={moduleSize}
              height={moduleSize}
              rx={cell.role === "finder" ? 1.05 : 1.35}
              fill={cell.color}
              opacity={cell.opacity}
            />
          ))}
          <rect
            x="4.5"
            y="4.5"
            width="55"
            height="55"
            rx="15"
            fill="none"
            stroke={model.colors.ink}
            strokeWidth="1"
            opacity="0.22"
          />
        </svg>
      </div>
    </div>
  );
}
