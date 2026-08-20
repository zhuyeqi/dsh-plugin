import { codeToSecid, prefixedCode } from '../secid';
import type { Quote, QuoteSearchHit } from '../types';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const REFERER = 'https://quote.eastmoney.com/';

/** Fields used by `qt/ulist.np/get` with `fltt=2` (prices already in yuan). */
const ULIST_FIELDS = [
  'f12', // code
  'f13', // market 1=SH 0=SZ
  'f14', // name
  'f2',  // last
  'f3',  // pct
  'f4',  // change
  'f15', // high
  'f16', // low
  'f17', // open
  'f18', // prev close
  'f5',  // volume
  'f6',  // turnover
  'f8',  // turnover rate
  'f9',  // PE
  'f23', // PB
  'f20', // market cap
  'f124', // timestamp
].join(',');

export async function fetchEastmoney(codes: string[]): Promise<Quote[]> {
  if (codes.length === 0) return [];
  const secids = codes.map(codeToSecid).join(',');
  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('np', '1');
  url.searchParams.set('fields', ULIST_FIELDS);
  url.searchParams.set('secids', secids);

  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: REFERER },
  });
  if (!resp.ok) return [];
  const json = await resp.json() as {
    data?: { diff?: Record<string, number | string>[] };
  };
  const rows = json.data?.diff ?? [];
  const quotes: Quote[] = [];
  for (const row of rows) {
    const digits = String(row.f12 ?? '');
    if (!digits) continue;
    const price = num(row.f2);
    quotes.push({
      code: prefixedCode(row.f13, digits),
      name: String(row.f14 ?? ''),
      price,
      pct: num(row.f3),
      change: num(row.f4),
      high: num(row.f15),
      low: num(row.f16),
      open: num(row.f17),
      prevClose: num(row.f18),
      volume: num(row.f5),
      turnover: num(row.f6),
      turnoverRate: num(row.f8),
      pe: num(row.f9),
      pb: num(row.f23),
      marketCap: num(row.f20),
      ts: num(row.f124) ? num(row.f124) * 1000 : Date.now(),
    });
  }
  return quotes;
}

export interface KlineBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
}

export interface KlineResult {
  code: string;
  period: string;
  bars: KlineBar[];
}

export interface KlineOptions {
  period?: string;
  count?: number;
  adjust?: string;
}

const KLT: Record<string, number> = { day: 101, week: 102, month: 103, '5': 5, '15': 15, '30': 30, '60': 60 };
const FQT: Record<string, number> = { qfq: 1, hfq: 2, none: 0 };

/** Daily/weekly/monthly & minute OHLCV history from Eastmoney (shared by tool + HTTP route). */
export async function fetchKlineEastmoney(code: string, opts: KlineOptions = {}): Promise<KlineResult> {
  const period = KLT[opts.period ?? 'day'] !== undefined ? (opts.period ?? 'day') : 'day';
  const adjust = FQT[opts.adjust ?? 'qfq'] !== undefined ? (opts.adjust ?? 'qfq') : 'qfq';
  const count = Math.min(Math.max(Math.trunc(opts.count ?? 60), 1), 500);

  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', codeToSecid(code));
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
  url.searchParams.set('klt', String(KLT[period]));
  url.searchParams.set('fqt', String(FQT[adjust]));
  url.searchParams.set('end', '20500101');
  url.searchParams.set('lmt', String(count));

  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: REFERER },
  });
  if (!resp.ok) throw new Error(`kline upstream HTTP ${resp.status}`);
  const json = await resp.json() as { data?: { klines?: string[] } };
  const bars = (json.data?.klines ?? []).map((line) => {
    const [ts, open, close, high, low, volume, turnover] = line.split(',');
    return {
      ts,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      turnover: turnover ? Number(turnover) : undefined,
    };
  });
  return { code, period, bars };
}

export async function searchEastmoney(query: string, limit = 10): Promise<QuoteSearchHit[]> {
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.searchParams.set('input', query);
  url.searchParams.set('type', '14');
  url.searchParams.set('count', String(limit));
  url.searchParams.set('token', 'D43BF722C8E33BDC906FB84D85E326E8');

  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`quote_search upstream HTTP ${resp.status}`);
  const json = await resp.json() as {
    QuotationCodeTable?: { Data?: Array<Record<string, unknown>> };
  };
  const list = json.QuotationCodeTable?.Data ?? [];
  return list
    .map((item) => {
      const digits = String(item.Code ?? '');
      const mkt = String(item.MktNum ?? '');
      return {
        code: prefixedCode(mkt, digits),
        name: String(item.Name ?? ''),
        type: mkt,
      };
    })
    .filter((hit) => /^\w{2}\d{6}$/.test(hit.code));
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}
