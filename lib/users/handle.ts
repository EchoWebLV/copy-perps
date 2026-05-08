// Public-safe display handle derived from a user's Solana pubkey.
// We don't have a username field yet, so we project the wallet to a
// short, stable, anonymous-but-unique label for the leaderboard.
//
// Format: `gwk_<first4>` (e.g. `gwk_4Hx2`). Short enough to fit on a
// share card, not so short that two random users collide visually
// inside one feed (~16M slots in the prefix space).
export function handleFromPubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return "gwk_anon";
  return `gwk_${pubkey.slice(0, 4)}`;
}
