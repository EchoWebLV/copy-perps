export function formatSignedWhaleUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";

  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

/** General USD amount: separators always, cents only below $1k. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs < 1000 ? 2 : 0;
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${value < 0 ? "-" : ""}$${formatted}`;
}

/** Mark/entry price: decimals scale down as magnitude grows, the way
 *  exchange tick ladders do. Keeps BTC at $62,386 and microcaps at
 *  $0.0423 without per-asset config. */
export function formatPriceUsd(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${value < 0 ? "-" : ""}$${formatted}`;
}
