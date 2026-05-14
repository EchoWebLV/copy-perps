// Centralized feature flags. Server-only — do not import from client
// modules; surface flag state via API responses or via NEXT_PUBLIC_*
// vars instead.

export function legacyRailsEnabled(): boolean {
  return process.env.FEATURE_LEGACY_RAILS === "true";
}

export function copyTradeEnabled(): boolean {
  return process.env.FEATURE_COPY_TRADE === "true";
}

export function casinoModeEnabled(): boolean {
  return process.env.FEATURE_CASINO_MODE === "true";
}
