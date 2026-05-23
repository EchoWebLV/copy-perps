export function formatWhalePositionAge(openedAtMs: number, nowMs: number): string {
  if (
    nowMs <= 0 ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(openedAtMs)
  ) {
    return "...";
  }
  const diff = Math.max(0, nowMs - openedAtMs);
  const totalMinutes = Math.floor(diff / 60_000);
  if (totalMinutes < 1) return "<1M";

  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}D ${hours}H` : `${days}D`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}H ${minutes}M` : `${hours}H`;
  }
  return `${minutes}M`;
}
