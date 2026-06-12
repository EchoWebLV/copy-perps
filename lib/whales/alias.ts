// lib/whales/alias.ts
//
// Deterministic memorable aliases for whales whose only "name" is a wallet
// address. "HL 0X8DEF…2DAE" tells nobody anything; "Patient Orca" is a
// character you can recognize, screenshot, and talk about. Curated names
// (JohnLockePAC etc.) are NEVER aliased — only auto/address-ish ones.
//
// Pure + deterministic (FNV-1a over the account string), so the same wallet
// gets the same alias on every render, device, and session — no storage.

const ADJECTIVES = [
  "Patient", "Tilted", "Liquid", "Leveraged", "Feral", "Quiet", "Turbo",
  "Velvet", "Sigma", "Rogue", "Crimson", "Midnight", "Solvent", "Diamond",
  "Paper", "Golden", "Iron", "Neon", "Ghost", "Greedy", "Fearless",
  "Sleepy", "Rabid", "Lucky", "Cursed", "Blessed", "Degen", "Zen",
  "Manic", "Stoic", "Hasty", "Slick", "Smug", "Humble", "Savage",
  "Cosmic", "Static", "Volatile", "Stable", "Phantom", "Electric",
  "Frozen", "Molten", "Hollow", "Gilded", "Reckless", "Careful", "Loud",
  "Silent", "Crooked", "Honest", "Sweaty", "Icy", "Blazing", "Grim",
  "Jolly", "Sneaky", "Bold", "Wired", "Numb", "Vicious", "Gentle",
  "Mythic", "Feverish",
] as const;

const CREATURES = [
  "Orca", "Shark", "Whale", "Kraken", "Marlin", "Piranha", "Barracuda",
  "Dolphin", "Narwhal", "Squid", "Octopus", "Manta", "Stingray", "Tuna",
  "Grouper", "Eel", "Urchin", "Angler", "Swordfish", "Hammerhead",
  "Leviathan", "Walrus", "Seal", "Otter", "Penguin", "Albatross",
  "Pelican", "Heron", "Falcon", "Vulture", "Raven", "Owl", "Wolf",
  "Bear", "Bull", "Stag", "Ram", "Viper", "Cobra", "Mongoose",
  "Badger", "Lynx", "Panther", "Jackal", "Hyena", "Gorilla", "Yeti",
  "Goblin", "Mantis", "Hornet", "Scorpion", "Tarantula", "Moray",
  "Sailfish", "Anchovy", "Grizzly", "Bison", "Moose", "Condor",
  "Osprey", "Magpie", "Ferret", "Wolverine", "Ox",
] as const;

/** FNV-1a 32-bit — tiny, stable, good-enough dispersion for name picking. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** "Patient Orca" — deterministic two-word alias for a wallet account.
 *  Adjective and creature come from two INDEPENDENT hashes — shifted bits
 *  of one hash correlate and produced duplicate aliases on a 24-whale
 *  roster (two SLICK BULLs, observed live). */
export function whaleAlias(sourceAccount: string): string {
  const adj = ADJECTIVES[fnv1a(sourceAccount) % ADJECTIVES.length]!;
  const creature =
    CREATURES[fnv1a(`${sourceAccount}/creature`) % CREATURES.length]!;
  return `${adj} ${creature}`;
}

/** True when a display name is an auto-generated address-ish placeholder
 *  rather than a curated human name. */
export function isAutoWhaleName(displayName: string): boolean {
  const name = displayName.trim();
  if (name.length === 0) return true;
  if (/^whale_/i.test(name)) return true;
  if (/0x[0-9a-f]{2,}/i.test(name)) return true;
  if (name.includes("…") || name.includes("...")) return true;
  // Bare base58-ish blobs (Solana accounts shown raw).
  if (/^[1-9A-HJ-NP-Za-km-z]{16,}$/.test(name)) return true;
  return false;
}

/** Curated names pass through; address-ish placeholders become aliases. */
export function whaleDisplayName(
  displayName: string,
  sourceAccount: string,
): string {
  return isAutoWhaleName(displayName) ? whaleAlias(sourceAccount) : displayName;
}

/** `0x8def…2dae` / `7nYB…k2Qf` — short form for subtitles. */
export function shortWhaleAccount(account: string): string {
  if (account.length <= 11) return account;
  return `${account.slice(0, 6)}…${account.slice(-4)}`;
}
