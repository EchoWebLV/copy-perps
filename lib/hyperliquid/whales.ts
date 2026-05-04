/**
 * Curated set of Hyperliquid addresses to track for the whale feed.
 * Empty / inactive addresses are tolerated by the refresh pipeline —
 * they just contribute zero cards.
 */
export interface CuratedWhale {
  address: string;
  label?: string;
}

export const CURATED_WHALES: CuratedWhale[] = [
  { address: "0x010461c14e146ac35fe42271bdc1134ee31c703a" },
  { address: "0x31ca8395cf837de08b24da3f660e77761dfb974b" },
  { address: "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0", label: "HLP vault" },
  { address: "0x86fcb31b4e5c8d4ff3e0de98d7cf5b9cb3bcb7d4" },
  { address: "0xf3F496C9486BE5924a93D67e98298733Bb47057c" },
];

export function truncateEthAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
