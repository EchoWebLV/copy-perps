// lib/flash-v2/client-flag.ts
//
// Client-visible Flash v2 flag. MUST be kept in sync with the server-side
// FEATURE_FLASH_V2 (lib/flash-v2/constants.ts): set NEXT_PUBLIC_FEATURE_FLASH_V2
// to the same value. When true, the UI routes supported opens to the flash-v2
// rails; when false (default) it stays on the current Flash v1 /api/flash/perp
// rail, so flag-off is exactly today's behavior. A function (not a const) so it
// reads the inlined value at call time and is unit-testable via process.env.
export function isFlashV2Client(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_FLASH_V2 === "true";
}
