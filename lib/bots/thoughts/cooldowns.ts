// lib/bots/thoughts/cooldowns.ts
//
// Two pure functions used by the orchestrator. Race-tolerant by design:
// the orchestrator reads "last thought" and "thoughts in last 60s" once
// per tick, then checks against those values for every candidate. A
// concurrent tick could blow past the cap by 1-2 — acceptable.

export function isCooledDown(
  lastThoughtAt: Date | null,
  cooldownSeconds: number,
): boolean {
  if (lastThoughtAt === null) return true;
  const elapsedMs = Date.now() - lastThoughtAt.getTime();
  return elapsedMs >= cooldownSeconds * 1000;
}

export function isUnderGlobalCap(
  thoughtsInLastMinute: number,
  maxPerMinute: number,
): boolean {
  return thoughtsInLastMinute < maxPerMinute;
}
