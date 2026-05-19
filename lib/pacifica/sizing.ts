function decimalPlaces(value: string): number {
  const [, decimals = ""] = value.split(".");
  return decimals.replace(/0+$/, "").length;
}

export function formatLotSizedAmount(amount: number, lotSize: string): string {
  const lot = Number(lotSize);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Order amount must be positive");
  }
  if (!Number.isFinite(lot) || lot <= 0) {
    throw new Error(`Invalid Pacifica lot size: ${lotSize}`);
  }
  const lots = Math.floor(amount / lot + 1e-9);
  if (lots <= 0) {
    throw new Error(`Order amount ${amount} is below lot size ${lotSize}`);
  }
  return (lots * lot).toFixed(decimalPlaces(lotSize));
}

export function lotSizedAmountFromNotional(params: {
  notionalUsd: number;
  price: number;
  lotSize: string;
}): string {
  if (!Number.isFinite(params.price) || params.price <= 0) {
    throw new Error("Order price must be positive");
  }
  return formatLotSizedAmount(params.notionalUsd / params.price, params.lotSize);
}
