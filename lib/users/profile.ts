import { handleFromPubkey } from "./handle";

export interface PublicUserProfile {
  displayName: string;
  handle: string;
  avatarSeed: string;
}

export interface UserProfileSource {
  id: string;
  privyId?: string | null;
  solanaPubkey?: string | null;
  displayName?: string | null;
  handle?: string | null;
  avatarSeed?: string | null;
}

export function buildPublicUserProfile(
  user: UserProfileSource,
): PublicUserProfile {
  const handle = clean(user.handle) ?? fallbackHandle(user);
  return {
    displayName: clean(user.displayName) ?? handle,
    handle,
    avatarSeed: clean(user.avatarSeed) ?? clean(user.solanaPubkey) ?? user.id,
  };
}

export function buildDefaultUserProfileValues(
  user: Omit<UserProfileSource, "displayName" | "handle" | "avatarSeed">,
): PublicUserProfile {
  return buildPublicUserProfile({
    ...user,
    displayName: null,
    handle: null,
    avatarSeed: null,
  });
}

function fallbackHandle(user: UserProfileSource): string {
  if (clean(user.solanaPubkey)) return handleFromPubkey(user.solanaPubkey);
  return `gwk_${compactId(user.id || user.privyId || "anon")}`;
}

function compactId(value: string): string {
  const compact = value.replace(/[^a-zA-Z0-9]/g, "");
  return (compact || "anon").slice(0, 4);
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
