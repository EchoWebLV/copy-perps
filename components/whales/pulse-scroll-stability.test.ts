import { describe, expect, it } from "vitest";
import {
  getVisiblePulsePositionId,
  restoreVisiblePulsePosition,
} from "./pulse-scroll-stability";

function fakeSection(positionId: string, top: number): HTMLElement {
  return {
    dataset: { pulsePositionId: positionId },
    getBoundingClientRect: () => ({ top }),
  } as unknown as HTMLElement;
}

function fakeContainer(args: {
  top: number;
  scrollTop: number;
  sections: HTMLElement[];
}): HTMLElement {
  let scrollTop = args.scrollTop;

  return {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
    getBoundingClientRect: () => ({ top: args.top }),
    querySelectorAll: () => args.sections,
    scrollTo: (options: ScrollToOptions) => {
      scrollTop = Number(options.top);
    },
  } as unknown as HTMLElement;
}

describe("pulse scroll stability", () => {
  it("detects the Pulse position closest to the snap container top", () => {
    const container = fakeContainer({
      top: 100,
      scrollTop: 600,
      sections: [
        fakeSection("older", -500),
        fakeSection("active", 104),
        fakeSection("newer", 820),
      ],
    });

    expect(getVisiblePulsePositionId(container)).toBe("active");
  });

  it("scrolls the same Pulse position back into view after refresh reorders cards", () => {
    const container = fakeContainer({
      top: 100,
      scrollTop: 600,
      sections: [
        fakeSection("newer", 100),
        fakeSection("active", 900),
        fakeSection("older", 1700),
      ],
    });

    expect(restoreVisiblePulsePosition(container, "active")).toBe(true);
    expect(container.scrollTop).toBe(1400);
  });

  it("leaves scroll alone when the active position closed during refresh", () => {
    const container = fakeContainer({
      top: 100,
      scrollTop: 600,
      sections: [fakeSection("newer", 100), fakeSection("older", 900)],
    });

    expect(restoreVisiblePulsePosition(container, "active")).toBe(false);
    expect(container.scrollTop).toBe(600);
  });
});
