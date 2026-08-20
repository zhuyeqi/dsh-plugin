import type { Quote } from './types';

/** Derived analytics attached to every quote snapshot/tool output. */
export interface Derived {
  /** (high - low) / prevClose, in percent. */
  amplitude: number;
  /** Position of price inside today's [low, high], 0..1. */
  dayRangePos: number;
  /** pct minus the Shanghai index pct, in percent. */
  relativePct: number;
  /** (price - 52w high) / 52w high, in percent (<= 0). */
  pctFrom52wHigh: number;
  /** (price - 52w low) / 52w low, in percent (>= 0). */
  pctFrom52wLow: number;
  /** (price - MA_N) / MA_N, in percent, keyed by period. */
  maDev: Record<string, number>;
}

export const MA_PERIODS = [20, 60, 120] as const;
/** Trading days needed for 52-week high/low (with buffer for holidays). */
export const LOOKBACK_DAYS = 250;

/** Metrics computable from the snapshot alone (no kline fetch). */
export function snapshotMetrics(quote: Quote, indexPct: number): {
  amplitude: number;
  dayRangePos: number;
  relativePct: number;
} {
  const amplitude = quote.prevClose > 0
    ? round(((quote.high - quote.low) / quote.prevClose) * 100)
    : 0;
  const range = quote.high - quote.low;
  const dayRangePos = range > 0
    ? round(Math.min(Math.max((quote.price - quote.low) / range, 0), 1))
    : 0.5;
  return {
    amplitude,
    dayRangePos,
    relativePct: round(quote.pct - indexPct),
  };
}

/** Metrics that need daily kline closes (most recent last). */
export function historyMetrics(closes: number[]): Pick<
  Derived, 'pctFrom52wHigh' | 'pctFrom52wLow' | 'maDev'
> {
  const price = closes[closes.length - 1] ?? 0;
  const window = closes.slice(-LOOKBACK_DAYS);
  const high = Math.max(...window);
  const low = Math.min(...window);
  const maDev: Record<string, number> = {};
  for (const period of MA_PERIODS) {
    const ma = sma(closes, period);
    maDev[String(period)] = ma === null ? NaN : round(((price - ma) / ma) * 100);
  }
  return {
    pctFrom52wHigh: high > 0 ? round(((price - high) / high) * 100) : 0,
    pctFrom52wLow: low > 0 ? round(((price - low) / low) * 100) : 0,
    maDev,
  };
}

/** Simple moving average over the last `period` closes; null when insufficient data. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) sum += closes[i];
  return sum / period;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
