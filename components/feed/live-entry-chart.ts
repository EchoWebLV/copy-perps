export interface ChartCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartPoint {
  x: number;
  y: number;
  price: number;
  ts: number;
}

export interface ChartRangeBar {
  x: number;
  yHigh: number;
  yLow: number;
  yOpen: number;
  yClose: number;
  up: boolean;
}

export interface ChartVolumeBar {
  x: number;
  y: number;
  height: number;
  up: boolean;
}

export interface LiveEntryChartModel {
  width: number;
  height: number;
  plot: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    volumeTop: number;
  };
  minPrice: number;
  maxPrice: number;
  linePath: string;
  areaPath: string;
  points: ChartPoint[];
  rangeBars: ChartRangeBar[];
  volumeBars: ChartVolumeBar[];
  yTicks: Array<{ price: number; y: number }>;
  entry: ChartPoint & { clamped: boolean };
  current: ChartPoint;
}

const WIDTH = 600;
const HEIGHT = 246;
const PLOT = {
  left: 44,
  right: 582,
  top: 20,
  bottom: 184,
  volumeTop: 202,
};

export function buildLiveEntryChartModel({
  candles,
  entryMark,
  currentMark,
  openSinceMs,
  nowMs,
}: {
  candles: ChartCandle[];
  entryMark: number;
  currentMark: number;
  openSinceMs: number;
  nowMs?: number;
}): LiveEntryChartModel {
  const cleanCandles = candles
    .filter(
      (c) =>
        Number.isFinite(c.ts) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .sort((a, b) => a.ts - b.ts)
    .slice(-90);

  const fallbackStart = Math.max(0, openSinceMs - 30 * 60_000);
  const fallbackEnd = Math.max(fallbackStart + 60_000, nowMs ?? Date.now());
  const minTs = cleanCandles[0]?.ts ?? fallbackStart;
  const lastTs = cleanCandles[cleanCandles.length - 1]?.ts ?? fallbackEnd;
  const currentTs = Math.max(lastTs, nowMs ?? lastTs);
  const maxTs = Math.max(lastTs, currentTs, minTs + 1);

  const priceValues = [
    entryMark,
    currentMark,
    ...cleanCandles.flatMap((c) => [c.high, c.low, c.open, c.close]),
  ].filter(Number.isFinite);
  const rawMin = Math.min(...priceValues);
  const rawMax = Math.max(...priceValues);
  const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.002, 1);
  const minPrice = rawMin - span * 0.12;
  const maxPrice = rawMax + span * 0.12;
  const priceSpan = maxPrice - minPrice;

  const scaleX = (ts: number) => {
    const clamped = Math.min(maxTs, Math.max(minTs, ts));
    return PLOT.left + ((clamped - minTs) / (maxTs - minTs)) * (PLOT.right - PLOT.left);
  };
  const scaleY = (price: number) => {
    return PLOT.bottom - ((price - minPrice) / priceSpan) * (PLOT.bottom - PLOT.top);
  };

  const points = cleanCandles.map((c) => ({
    x: scaleX(c.ts),
    y: scaleY(c.close),
    price: c.close,
    ts: c.ts,
  }));
  const current: ChartPoint = {
    x: scaleX(currentTs),
    y: scaleY(currentMark),
    price: currentMark,
    ts: currentTs,
  };
  const linePoints = points.length > 0 ? [...points, current] : [
    { x: PLOT.left, y: scaleY(entryMark), price: entryMark, ts: minTs },
    current,
  ];
  const linePath = pathFromPoints(linePoints);
  const areaPath = `${linePath} L ${current.x.toFixed(2)} ${PLOT.bottom} L ${linePoints[0].x.toFixed(2)} ${PLOT.bottom} Z`;

  const maxVolume = Math.max(1, ...cleanCandles.map((c) => c.volume || 0));
  const volumeHeight = HEIGHT - PLOT.volumeTop - 14;
  const rangeBars = cleanCandles.map((c) => ({
    x: scaleX(c.ts),
    yHigh: scaleY(c.high),
    yLow: scaleY(c.low),
    yOpen: scaleY(c.open),
    yClose: scaleY(c.close),
    up: c.close >= c.open,
  }));
  const volumeBars = cleanCandles.map((c) => {
    const height = Math.max(1, ((c.volume || 0) / maxVolume) * volumeHeight);
    return {
      x: scaleX(c.ts),
      y: PLOT.volumeTop + volumeHeight - height,
      height,
      up: c.close >= c.open,
    };
  });

  const entryClamped = openSinceMs < minTs || openSinceMs > maxTs;
  const entry: ChartPoint & { clamped: boolean } = {
    x: scaleX(openSinceMs),
    y: scaleY(entryMark),
    price: entryMark,
    ts: openSinceMs,
    clamped: entryClamped,
  };

  return {
    width: WIDTH,
    height: HEIGHT,
    plot: PLOT,
    minPrice,
    maxPrice,
    linePath,
    areaPath,
    points: linePoints,
    rangeBars,
    volumeBars,
    yTicks: [
      { price: maxPrice, y: PLOT.top },
      { price: minPrice + priceSpan / 2, y: PLOT.top + (PLOT.bottom - PLOT.top) / 2 },
      { price: minPrice, y: PLOT.bottom },
    ],
    entry,
    current,
  };
}

function pathFromPoints(points: ChartPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}
