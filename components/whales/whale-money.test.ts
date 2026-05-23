import { describe, expect, it } from "vitest";
import { formatSignedWhaleUsd } from "./whale-money";

describe("formatSignedWhaleUsd", () => {
  it("adds commas to positive and negative whale P/L values", () => {
    expect(formatSignedWhaleUsd(2_343_195)).toBe("+$2,343,195");
    expect(formatSignedWhaleUsd(-90_380)).toBe("-$90,380");
  });
});
