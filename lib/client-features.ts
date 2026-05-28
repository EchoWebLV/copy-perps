// Client-safe feature flags. Only use NEXT_PUBLIC_* variables here.

export function depositDevToolsVisible(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS === "true";
}

export function feedRailPrefsVisible(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS === "true";
}
