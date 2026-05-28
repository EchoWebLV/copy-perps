export function buildWhaleLiveTailButtonLabel({
  stale,
  copyableOnPacifica = true,
}: {
  stale: boolean;
  copyableOnPacifica?: boolean;
}): string {
  if (copyableOnPacifica === false) return "PACIFICA UNAVAILABLE";
  return stale ? "COPY SNAPSHOT" : "TAIL THIS POSITION";
}
