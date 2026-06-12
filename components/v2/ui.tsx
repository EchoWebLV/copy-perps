// Design tokens + shared atoms for /design/v2/* mocks.
// Aesthetic: dark trading-app substrate, Snapchat-yellow CTA + story-ring
// avatars, hypebeast condensed headlines + factory stamps.

import React from "react";
import type { ReactNode } from "react";

export const BG = "#0e0d10"; // warm near-black
export const PANEL = "#17151b"; // raised surface
export const PANEL_2 = "#221f28"; // input / row hover
export const FG = "#fafaf2"; // bone, never pure white
export const DIM = "rgba(250,250,242,0.5)"; // secondary text
export const FAINT = "rgba(250,250,242,0.18)"; // hairlines
export const ACCENT = "#fae500"; // snapchat-y acid yellow
export const GREEN = "#1de78b"; // P/L positive — vibrant trading-app green
export const RED = "#ff3b54"; // P/L negative
export const STREAK = "#ff8a2a"; // streak fire orange
export const AI = "#b79bff"; // AI-bot purple — badge text + avatar ring
export const AI_DIM = "#251b40"; // AI-bot purple — card background tint
export const AI_BORDER = "#3b2f66"; // AI-bot purple — card border
export const TEAL = "#41d6c3"; // Real-wallet teal — whale badge text
export const TEAL_DIM = "#0c2b28"; // Real-wallet teal — whale badge background

// var(--font-archivo) is loaded via next/font in app/layout.tsx — a real
// webfont so the brand renders identically on Apple/Android/Windows.
export const FONT_DISPLAY =
  "var(--font-archivo), 'Helvetica Neue', Helvetica, sans-serif";
export const FONT_BODY =
  "var(--font-archivo), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ──────────────────────────────────────────────────────────────────────────
// Reusable atoms
// ──────────────────────────────────────────────────────────────────────────

const MOOD_RING: Record<string, string> = {
  HUNTING: GREEN,
  LOADED: ACCENT,
  WOUNDED: RED,
  ON_STREAK: STREAK,
  DORMANT: FAINT,
  BUSTED: "#666",
};

/** Snapchat-style story ring around a bot's avatar. Ring color = mood.
 *  Renders a generated portrait when imageUrl is set, else falls back
 *  to the emoji. */
export function StoryAvatar({
  emoji,
  imageUrl,
  mood,
  size = 56,
  pulse = false,
}: {
  emoji: string;
  imageUrl?: string | null;
  mood?: string;
  size?: number;
  pulse?: boolean;
}) {
  const ringColor = (mood && MOOD_RING[mood]) || FAINT;
  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full ${pulse ? "animate-pulse" : ""}`}
      style={{
        width: size,
        height: size,
        padding: 3,
        background: `conic-gradient(from 0deg, ${ringColor}, ${ringColor}cc, ${ringColor}, ${ringColor}88, ${ringColor})`,
        boxShadow: `0 0 18px ${ringColor}55`,
      }}
    >
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"
        style={{
          background: BG,
          fontSize: size * 0.55,
          lineHeight: 1,
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          emoji
        )}
      </div>
    </div>
  );
}

/** Hypebeast factory stamp — small all-caps tracked label with optional value. */
export function Stamp({
  label,
  value,
  bordered = false,
}: {
  label: string;
  value?: string | ReactNode;
  bordered?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 font-black uppercase ${bordered ? "border-2 px-2 py-0.5" : ""}`}
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: "9px",
        letterSpacing: "0.24em",
        borderColor: bordered ? FG : undefined,
        color: FG,
      }}
    >
      <span style={{ opacity: 0.55 }}>{label}</span>
      {value != null && <span style={{ opacity: 1 }}>{value}</span>}
    </span>
  );
}

/** Compact tabular number — uses display font with letter spacing pulled in. */
export function BigNum({
  children,
  size = 28,
  color = FG,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="font-black"
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: `${size}px`,
        letterSpacing: "-0.02em",
        lineHeight: 0.95,
        color,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

/** Hypebeast condensed headline. Used for asset names, page titles, bot names. */
export function Headline({
  children,
  size = 44,
  color = FG,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="font-black uppercase"
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: `${size}px`,
        letterSpacing: "-0.03em",
        fontStretch: "condensed",
        lineHeight: 0.9,
        color,
      }}
    >
      {children}
    </span>
  );
}

/** P/L pill — green/red bg, white text, rounded slightly (Snapchat lean).
 *  Optional `pulse` flashes a ring shadow on each tick (the inline
 *  green/red bg blocks bg-flash, so we use box-shadow for the visual
 *  pop instead). */
export function PnlPill({
  pnlUsd,
  size = 14,
  pulse,
}: {
  pnlUsd: number;
  size?: number;
  pulse?: "up" | "down" | null;
}) {
  const profit = pnlUsd >= 0;
  const pulseClass =
    pulse === "up" ? "pulse-up" : pulse === "down" ? "pulse-down" : "";
  return (
    <span
      className={`inline-block rounded font-black tabular-nums ${pulseClass}`}
      style={{
        background: profit ? GREEN : RED,
        color: BG,
        padding: `2px 8px`,
        fontFamily: FONT_DISPLAY,
        fontSize: `${size}px`,
        letterSpacing: "-0.01em",
      }}
    >
      {profit ? "+" : "-"}${Math.abs(pnlUsd).toFixed(2)}
    </span>
  );
}

/** Yellow snapchat-style chunky button. */
export function YellowButton({
  children,
  onClick,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const padding =
    size === "sm" ? "py-2 px-3" : size === "lg" ? "py-4 px-5" : "py-3 px-4";
  const fontSize = size === "sm" ? "11px" : size === "lg" ? "16px" : "13px";
  return (
    <button
      onClick={onClick}
      type="button"
      className={`rounded-2xl font-black uppercase tracking-widest transition active:scale-[0.97] ${padding} ${className}`}
      style={{
        background: ACCENT,
        color: BG,
        fontFamily: FONT_DISPLAY,
        fontSize,
      }}
    >
      {children}
    </button>
  );
}

/** Purple "AI BOT" badge used on every bot card surface.
 *  `size="md"` (default) → text-[8px] chrome; `size="sm"` → same.
 *  Pass custom `children` to override the chip text (e.g. "AI BOTS" for roster header). */
export function AiBotBadge({
  size = "md",
  children = "AI BOT",
}: {
  size?: "sm" | "md";
  children?: React.ReactNode;
}) {
  const _ = size; // reserved for future padding differences
  return (
    <span
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest leading-none"
      style={{ color: AI, background: AI_DIM, border: `1px solid ${AI_BORDER}` }}
    >
      {children}
    </span>
  );
}

/** Teal "REAL WALLET" badge used on every whale card surface. */
export function RealWalletBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const _ = size; // reserved for future padding differences
  return (
    <span
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest leading-none"
      style={{ color: TEAL, background: TEAL_DIM, border: `1px solid ${TEAL}44` }}
    >
      REAL WALLET
    </span>
  );
}

/** Snapchat-style streak counter — fire emoji + tabular number. */
export function StreakBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{
        background: `${STREAK}22`,
        color: STREAK,
        fontFamily: FONT_DISPLAY,
        fontSize: "11px",
        fontWeight: 900,
        letterSpacing: "0.05em",
      }}
    >
      🔥<span className="tabular-nums">{count}</span>
    </span>
  );
}
