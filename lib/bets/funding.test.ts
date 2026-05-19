import { describe, expect, it } from "vitest";
import {
  requiredPacificaCollateralUsdc,
  pacificaDepositTopUpUsdc,
} from "./funding";

describe("Pacifica funding math", () => {
  it("sizes first deposit from the selected stake instead of a hidden buffer", () => {
    expect(
      requiredPacificaCollateralUsdc({ stakeUsdc: 5, leverage: 10 }),
    ).toBe(5.12);
  });

  it("only tops up the shortfall when Pacifica already has collateral", () => {
    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 3,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(2.12);

    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 6,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(0);
  });
});
