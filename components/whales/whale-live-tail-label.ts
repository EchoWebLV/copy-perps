export function buildWhaleLiveTailButtonLabel({
  stale,
}: {
  stale: boolean;
}): string {
  return stale ? "TAIL DISABLED" : "TAIL THIS POSITION";
}
