export function formatWhalePositionAge(openedAtMs: number, nowMs: number): string {
  if (nowMs <= 0) return "<1M AGO";
  const diff = Math.max(0, nowMs - openedAtMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "<1M AGO";
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
}
