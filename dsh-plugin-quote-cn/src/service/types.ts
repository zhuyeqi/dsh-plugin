/** Unified A-share quote snapshot. */
export interface Quote {
  /** Prefixed code, e.g. `sh600000`. */
  code: string;
  name: string;
  /** Last price in yuan. */
  price: number;
  change: number;
  /** Percent change, e.g. 1.23 means +1.23%. */
  pct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  turnover: number;
  turnoverRate: number;
  pe: number;
  pb: number;
  marketCap: number;
  /** Upstream timestamp in ms. */
  ts: number;
  /** Derived analytics; optional so degraded fetches never break consumers. */
  derived?: {
    amplitude: number;
    dayRangePos: number;
    relativePct: number;
    pctFrom52wHigh: number;
    pctFrom52wLow: number;
    /** (price - MA_N) / MA_N in percent, N = 20/60/120. */
    maDev: Record<string, number>;
  };
}

export interface QuoteSearchHit {
  code: string;
  name: string;
  type: string;
}

export type QuoteProvider = (codes: string[]) => Promise<Quote[]>;
