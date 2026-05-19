import { describe, expect, it } from "vitest";
import {
  PACIFICA_MIN_DEPOSIT_USDC,
  recentDepositCoversRequired,
  requiredPacificaDepositUsdc,
  requiredPacificaCollateralUsdc,
  pacificaDepositTopUpUsdc,
} from "./funding";

describe("Pacifica funding math", () => {
  it("sizes first deposit from the selected stake instead of a hidden buffer", () => {
    expect(
      requiredPacificaCollateralUsdc({ stakeUsdc: 5, leverage: 10 }),
    ).toBe(5.12);
    expect(requiredPacificaDepositUsdc({ stakeUsdc: 5, leverage: 10 })).toBe(
      PACIFICA_MIN_DEPOSIT_USDC,
    );
  });

  it("tops up the shortfall while obeying Pacifica's minimum deposit", () => {
    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 3,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(PACIFICA_MIN_DEPOSIT_USDC);

    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 6,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(0);
  });

  it("treats a recent vault deposit as covering a missing Pacifica account", () => {
    expect(
      recentDepositCoversRequired({
        recentDepositUsdc: 5.12,
        requiredUsdc: 5.12,
      }),
    ).toBe(true);

    expect(
      recentDepositCoversRequired({
        recentDepositUsdc: 5,
        requiredUsdc: 5.12,
      }),
    ).toBe(false);
  });
});
