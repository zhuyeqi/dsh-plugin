import type { Quote } from '../types';
import type { KlineBar, KlineOptions, KlineResult } from './eastmoney';

/**
 * 腾讯行情源（默认）。
 * - 快照: https://qt.gtimg.cn/q=sh600519,sz300750   (GBK 文本, ~ 分隔 88 字段)
 * - 日K:  https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,30,qfq
 * - 分时: https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519
 * 全部无需鉴权, 无 Referer 白名单（2026-08 实测）。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/** qt.gtimg.cn `~`-separated field indexes (verified against Eastmoney values). */
const F = {
  market: 0,
  name: 1,
  price: 3,
  prevClose: 4,
  open: 5,
  volume: 6,        // 手
  datetime: 30,     // yyyymmddHHMMSS
  change: 31,
  pct: 32,
  high: 33,
  low: 34,
  turnover: 37,     // 万元
  turnoverRate: 38, // %
  floatCap: 44,     // 亿元
  marketCap: 45,    // 亿元
  pb: 46,
  pe: 52,           // 动态市盈率, matches Eastmoney f9
} as const;

export async function fetchTencent(codes: string[]): Promise<Quote[]> {
  if (codes.length === 0) return [];
  const url = `https://qt.gtimg.cn/q=${codes.join(',')}`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`tencent snapshot HTTP ${resp.status}`);
  const text = new TextDecoder('gbk').decode(new Uint8Array(await resp.arrayBuffer()));

  const quotes: Quote[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) continue;
    const f = m[2].split('~');
    if (f.length < 60) continue;
    const price = num(f[F.price]);
    if (price <= 0) continue;
    quotes.push({
      code: m[1],
      name: f[F.name],
      price,
      prevClose: num(f[F.prevClose]),
      open: num(f[F.open]),
      high: num(f[F.high]),
      low: num(f[F.low]),
      change: num(f[F.change]),
      pct: num(f[F.pct]),
      volume: num(f[F.volume]),
      turnover: num(f[F.turnover]) * 1e4,
      turnoverRate: num(f[F.turnoverRate]),
      pe: num(f[F.pe]),
      pb: num(f[F.pb]),
      marketCap: num(f[F.marketCap]) * 1e8,
      ts: parseQtTime(f[F.datetime]),
    });
  }
  return quotes;
}

/** Daily/weekly/monthly bars via fqkline (复权). Minute periods are not handled here. */
export async function fetchTencentKline(code: string, opts: KlineOptions = {}): Promise<KlineResult> {
  const period = ['day', 'week', 'month'].includes(opts.period ?? 'day') ? (opts.period ?? 'day') : 'day';
  const adjust = opts.adjust === 'hfq' ? 'hfq' : 'qfq';
  const count = Math.min(Math.max(Math.trunc(opts.count ?? 60), 1), 500);

  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},${period},,,${count},${adjust}`)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`tencent kline HTTP ${resp.status}`);
  const json = await resp.json() as {
    code: number;
    data?: Record<string, Record<string, unknown>>;
  };
  if (json.code !== 0 || !json.data?.[code]) throw new Error('tencent kline empty payload');
  const payload = json.data[code];
  // Key is `${adjust}day` / `${adjust}week` / `${adjust}month`, but plain `day` on some days.
  const rows = (payload[`${adjust}${period}`] ?? payload[period]) as unknown;
  if (!Array.isArray(rows)) throw new Error('tencent kline missing rows');

  // Row: [date, open, close, high, low, volume, ...]
  const bars: KlineBar[] = rows.map((row) => {
    const r = row as string[];
    return {
      ts: r[0],
      open: Number(r[1]),
      close: Number(r[2]),
      high: Number(r[3]),
      low: Number(r[4]),
      volume: Number(r[5]),
    };
  });
  return { code, period, bars };
}

export interface IntradayResult {
  code: string;
  /** yyyy-mm-dd of the session. */
  date: string;
  /** Per-minute rows: [HHMM, price]. Lunch gap (11:30–13:00) has no rows. */
  minutes: Array<{ t: string; p: number }>;
}

/** 当日分时: one point per trading minute (≈240 rows for a full session). */
export async function fetchTencentIntraday(code: string): Promise<IntradayResult> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(code)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`tencent intraday HTTP ${resp.status}`);
  const json = await resp.json() as {
    code: number;
    data?: Record<string, { data?: { date?: string; data?: string[] } }>;
  };
  const payload = json.data?.[code]?.data;
  if (json.code !== 0 || !payload?.data) throw new Error('tencent intraday empty payload');
  const minutes = payload.data
    .map((row) => {
      const [t, p] = row.split(' ');
      return { t, p: Number(p) };
    })
    .filter((m) => m.t && Number.isFinite(m.p) && m.p > 0);
  return { code, date: payload.date ?? '', minutes };
}

function num(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `20260819161441` → epoch ms. */
function parseQtTime(raw: string | undefined): number {
  if (!raw || !/^\d{14}$/.test(raw)) return Date.now();
  const s = raw;
  return new Date(
    Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)),
    Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14)),
  ).getTime();
}
