const PULSE_POSITION_SELECTOR = "[data-pulse-position-id]";

function pulseSections(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(PULSE_POSITION_SELECTOR),
  );
}

export function getVisiblePulsePositionId(
  container: HTMLElement,
): string | null {
  const sections = pulseSections(container);
  if (sections.length === 0) return null;

  const containerTop = container.getBoundingClientRect().top;
  let bestPositionId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const section of sections) {
    const positionId = section.dataset.pulsePositionId;
    if (!positionId) continue;
    const distance = Math.abs(section.getBoundingClientRect().top - containerTop);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPositionId = positionId;
    }
  }

  return bestPositionId;
}

export function restoreVisiblePulsePosition(
  container: HTMLElement,
  positionId: string,
): boolean {
  const target = pulseSections(container).find(
    (section) => section.dataset.pulsePositionId === positionId,
  );
  if (!target) return false;

  const delta =
    target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  if (Math.abs(delta) > 1) {
    container.scrollTo({
      top: container.scrollTop + delta,
      behavior: "auto",
    });
  }

  return true;
}
