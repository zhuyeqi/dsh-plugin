import { fetchEastmoney, fetchKlineEastmoney, searchEastmoney, type KlineOptions, type KlineResult } from './providers/eastmoney';
import { fetchTencent, fetchTencentIntraday, fetchTencentKline, type IntradayResult } from './providers/tencent';
import { fetchSina } from './providers/sina';
import { fetchPremium, type PremiumName } from './providers/premium-adapter';
import type { Quote, QuoteProvider, QuoteSearchHit } from './types';
import { historyMetrics, LOOKBACK_DAYS, snapshotMetrics } from './derived';

/** History-level slice of the derived analytics payload. */
type DerivedOnQuote = NonNullable<Quote['derived']>;
type HistoryMetrics = Pick<DerivedOnQuote, 'pctFrom52wHigh' | 'pctFrom52wLow' | 'maDev'>;
type SnapshotMetrics = Pick<DerivedOnQuote, 'amplitude' | 'dayRangePos' | 'relativePct'>;

export type { IntradayResult } from './providers/tencent';

export interface QuoteCnConfig {
  pollIntervalMs: number;
  maxConcurrentFetches: number;
  cacheTtlMs: number;
  defaultProvider: string;
  premium: {
    provider: string;
    tokenEnv: string;
  };
}

export interface QuoteCn {
  get(codes: string[]): Quote[];
  fetch(codes: string[]): Promise<Quote[]>;
  search(query: string, market?: string): Promise<QuoteSearchHit[]>;
  kline(code: string, opts?: KlineOptions): Promise<KlineResult>;
  intraday(code: string): Promise<IntradayResult>;
  /** Snapshot enriched with derived analytics (amplitude, day range, relative strength, 52w position, MA deviations). */
  fetchDerived(codes: string[]): Promise<Quote[]>;
  subscribe(codes: string[]): void;
  unsubscribe(codes: string[]): void;
  listWatchlist(): string[];
  poll(): Promise<Quote[]>;
}

export function createQuoteCnService(config: QuoteCnConfig): QuoteCn {
  const cache = new Map<string, { quote: Quote; at: number }>();
  const klineCache = new Map<string, { result: KlineResult; at: number }>();
  const intradayCache = new Map<string, { result: IntradayResult; at: number }>();
  const subs = new Set<string>();
  const provider = pickProviderChain(config);

  const get = (codes: string[]): Quote[] =>
    codes.map((code) => cache.get(normalize(code))?.quote).filter((q): q is Quote => q !== undefined);

  const put = (quotes: Quote[]) => {
    const now = Date.now();
    for (const quote of quotes) cache.set(normalize(quote.code), { quote, at: now });
  };

  const fetchFresh = async (codes: string[]): Promise<Quote[]> => {
    const unique = [...new Set(codes.map(normalize).filter(Boolean))];
    if (unique.length === 0) return [];
    const now = Date.now();
    const stale: string[] = [];
    const fresh: Quote[] = [];
    for (const code of unique) {
      const hit = cache.get(code);
      if (hit && now - hit.at < config.cacheTtlMs) fresh.push(hit.quote);
      else stale.push(code);
    }
    if (stale.length === 0) return orderBy(fresh, unique);
    const fetched = await provider(stale.slice(0, config.maxConcurrentFetches * 4));
    put(fetched);
    return orderBy([...fresh, ...fetched], unique);
  };

  return {
    get,
    fetch: fetchFresh,
    async search(query: string, market?: string) {
      let hits = await searchEastmoney(query);
      if (market) {
        const prefix = market.toLowerCase();
        hits = hits.filter((hit) => hit.code.startsWith(prefix));
      }
      return hits;
    },
    kline(code: string, opts: KlineOptions = {}) {
      const key = `${normalize(code)}|${opts.period ?? 'day'}|${opts.count ?? 60}|${opts.adjust ?? 'qfq'}`;
      const hit = klineCache.get(key);
      // Daily bars barely move intraday; a 10 min TTL shields the upstream from refetches.
      if (hit && Date.now() - hit.at < 600_000) return Promise.resolve(hit.result);
      // Tencent serves day/week/month with qfq/hfq; minute periods & raw prices stay on Eastmoney.
      const canTencent = ['day', 'week', 'month'].includes(opts.period ?? 'day')
        && (opts.adjust ?? 'qfq') !== 'none';
      const run = async (): Promise<KlineResult> => {
        if (canTencent) {
          try {
            return await fetchTencentKline(code, opts);
          } catch {
            /* fall through to eastmoney */
          }
        }
        return fetchKlineEastmoney(code, opts);
      };
      return run().then((result) => {
        klineCache.set(key, { result, at: Date.now() });
        return result;
      });
    },
    intraday(code: string) {
      const key = normalize(code);
      const hit = intradayCache.get(key);
      // Minute data updates once per minute; 60s TTL is plenty after close.
      if (hit && Date.now() - hit.at < 60_000) return Promise.resolve(hit.result);
      return fetchTencentIntraday(code).then((result) => {
        intradayCache.set(key, { result, at: Date.now() });
        return result;
      });
    },
    async fetchDerived(codes: string[]) {
      const quotes = await fetchFresh(codes);
      if (quotes.length === 0) return quotes;
      // Benchmark: Shanghai index pct, fetched through the same cache.
      let indexPct = 0;
      try {
        const index = (await fetchFresh(['sh000001']))[0];
        if (index) indexPct = index.pct;
      } catch {
        /* benchmark unavailable -> relativePct degrades to raw pct */
      }
      // Snapshot-level metrics are synchronous; history metrics share the
      // 10-min kline cache so watchlist polling adds no upstream pressure.
      await Promise.allSettled(quotes.map(async (quote) => {
        const base = snapshotMetrics(quote, indexPct);
        let hist: HistoryMetrics | undefined;
        try {
          const kline = await this.kline(quote.code, { period: 'day', count: LOOKBACK_DAYS, adjust: 'qfq' });
          const closes = kline.bars.map((bar) => bar.close).filter((close) => Number.isFinite(close) && close > 0);
          // Refresh the price basis so pre-market snapshots stay meaningful.
          if (closes.length > 0 && quote.price > 0) closes[closes.length - 1] = quote.price;
          if (closes.length > 0) hist = historyMetrics(closes);
        } catch {
          /* kline unavailable -> history metrics omitted */
        }
        quote.derived = hist
          ? {
              amplitude: base.amplitude,
              dayRangePos: base.dayRangePos,
              relativePct: base.relativePct,
              pctFrom52wHigh: hist.pctFrom52wHigh,
              pctFrom52wLow: hist.pctFrom52wLow,
              maDev: hist.maDev,
            }
          : { amplitude: base.amplitude, dayRangePos: base.dayRangePos, relativePct: base.relativePct } as DerivedOnQuote;
      }));
      return quotes;
    },
    subscribe(codes: string[]) {
      for (const code of codes.map(normalize).filter(Boolean)) subs.add(code);
    },
    unsubscribe(codes: string[]) {
      for (const code of codes.map(normalize)) subs.delete(code);
    },
    listWatchlist() {
      return [...subs];
    },
    async poll() {
      if (!isAShareSession(new Date()) || subs.size === 0) return [];
      return fetchFresh([...subs]);
    },
  };
}

/**
 * Ordered fallback chain of snapshot providers. The configured provider leads;
 * the remaining free sources back it up. First non-empty result wins, so one
 * dead upstream never blanks the panel.
 */
function pickProviderChain(config: QuoteCnConfig): QuoteProvider {
  const free: Record<string, QuoteProvider> = {
    tencent: fetchTencent,
    eastmoney: fetchEastmoney,
    sina: fetchSina,
  };
  const lead = pickLeadProvider(config);
  const chain: QuoteProvider[] = [];
  if (lead === 'premium') {
    const premium = fetchPremium(config.premium.provider as PremiumName, process.env[config.premium.tokenEnv] ?? '');
    // Premium with silent fallback already built in; free sources still back it up.
    chain.push(premium);
  } else if (free[lead]) {
    chain.push(free[lead]);
  }
  for (const key of ['tencent', 'eastmoney', 'sina']) {
    if (!chain.includes(free[key])) chain.push(free[key]);
  }
  return async (codes) => {
    let lastError: unknown;
    for (const fetcher of chain) {
      try {
        const quotes = await fetcher(codes);
        if (quotes.length > 0) return quotes;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    return [];
  };
}

function pickLeadProvider(config: QuoteCnConfig): string {
  switch (config.defaultProvider) {
    case 'eastmoney':
      return 'eastmoney';
    case 'sina':
      return 'sina';
    case 'premium': {
      const name = config.premium.provider as PremiumName;
      const token = config.premium.tokenEnv ? process.env[config.premium.tokenEnv] ?? '' : '';
      if (!token || (name !== 'longbridge' && name !== 'futu' && name !== 'tonglian')) {
        return 'tencent';
      }
      return 'premium';
    }
    case 'tencent':
    default:
      return 'tencent';
  }
}

function normalize(code: string): string {
  return code.trim().toLowerCase();
}

function orderBy(quotes: Quote[], codes: string[]): Quote[] {
  const map = new Map(quotes.map((q) => [normalize(q.code), q]));
  return codes.map((code) => map.get(code)).filter((q): q is Quote => q !== undefined);
}

function isAShareSession(now: Date): boolean {
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const beijing = new Date(utc + 8 * 3600_000);
  const day = beijing.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = beijing.getHours() * 60 + beijing.getMinutes();
  return (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes < 15 * 60);
}
