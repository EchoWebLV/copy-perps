// lib/flash-v2/resolve.ts
import { FEATURE_FLASH_V2 } from "./constants";
import { flashV2Venue, type FlashV2Venue } from "./venue";

/**
 * The single place routes ask for the Flash v2 venue. Returns the venue only
 * when FEATURE_FLASH_V2 is on; null otherwise so the caller keeps the Pacifica
 * default path. Keeps the flag check out of every handler.
 */
export function getFlashV2Venue(): FlashV2Venue | null {
  return FEATURE_FLASH_V2 ? flashV2Venue() : null;
}
