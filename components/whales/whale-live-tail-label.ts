export function buildWhaleLiveTailButtonLabel({
  stale,
  copyableOnPacifica = true,
}: {
  stale: boolean;
  copyableOnPacifica?: boolean;
}): string {
  if (stale) return "TAIL DISABLED";
  return copyableOnPacifica ? "TAIL THIS POSITION" : "PACIFICA UNAVAILABLE";
}
