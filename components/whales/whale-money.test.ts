import { describe, expect, it } from "vitest";
import {
  formatPriceUsd,
  formatSignedWhaleUsd,
  formatUsd,
} from "./whale-money";

describe("formatSignedWhaleUsd", () => {
  it("adds commas to positive and negative whale P/L values", () => {
    expect(formatSignedWhaleUsd(2_343_195)).toBe("+$2,343,195");
    expect(formatSignedWhaleUsd(-90_380)).toBe("-$90,380");
  });
});

describe("formatUsd", () => {
  it("always uses thousands separators", () => {
    expect(formatUsd(62386)).toBe("$62,386");
    expect(formatUsd(1194344)).toBe("$1,194,344");
  });

  it("shows cents only below $1k", () => {
    expect(formatUsd(434.58)).toBe("$434.58");
    expect(formatUsd(999.9)).toBe("$999.90");
    expect(formatUsd(2999)).toBe("$2,999");
  });

  it("handles negatives with a leading minus", () => {
    expect(formatUsd(-1234.5)).toBe("-$1,235");
  });
});

describe("formatPriceUsd", () => {
  it("scales decimals by magnitude like an exchange tick ladder", () => {
    expect(formatPriceUsd(62386)).toBe("$62,386");
    expect(formatPriceUsd(62012.75)).toBe("$62,013");
    expect(formatPriceUsd(434.58)).toBe("$434.58");
    expect(formatPriceUsd(65.07)).toBe("$65.07");
    expect(formatPriceUsd(2.4567)).toBe("$2.457");
    expect(formatPriceUsd(0.04231)).toBe("$0.0423");
  });
});
