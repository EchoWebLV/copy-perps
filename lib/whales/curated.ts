export interface CuratedWhale {
  sourceAccount: string;
  displayName?: string;
  avatarUrl?: string | null;
  tags?: string[];
  pinned?: boolean;
}

export const CURATED_PACIFICA_WHALES: CuratedWhale[] = [];
