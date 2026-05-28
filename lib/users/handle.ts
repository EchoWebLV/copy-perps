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

export type NormalizedHandle =
  | { ok: true; handle: string }
  | { ok: false; error: string };

export const HANDLE_RULE =
  "Handle must be 3 to 24 letters, numbers, or underscores.";

export function normalizeHandleInput(input: unknown): NormalizedHandle {
  if (typeof input !== "string") {
    return { ok: false, error: HANDLE_RULE };
  }

  const handle = input.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
    return { ok: false, error: HANDLE_RULE };
  }

  return { ok: true, handle };
}
