// Centralized feature flags. Server-only — do not import from client
// modules; surface flag state via API responses or via NEXT_PUBLIC_*
// vars instead.

export function whaleSocialEnabled(): boolean {
  return process.env.FEATURE_WHALE_SOCIAL !== "false";
}
