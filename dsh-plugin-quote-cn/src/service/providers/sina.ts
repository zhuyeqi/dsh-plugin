import type { Quote } from '../types';

/**
 * 新浪 hq.sinajs.cn 备份数据源。
 * 返回格式: var hq_str_sh600000="贵州茅台,1680.50,1690.00,...";
 * 字段顺序(逗号分隔,30 个):
 *   0 名字 1 今开 2 昨收 3 当前价 4 今日最高 5 今日最低
 *   6 买一价 7 卖一价 8 成交量(股) 9 成交额
 *   ... 30 时间
 */
export async function fetchSina(codes: string[]): Promise<Quote[]> {
  if (codes.length === 0) return [];
  const listParam = codes.join(',');
  const url = `https://hq.sinajs.cn/list=${listParam}`;

  const resp = await fetch(url, {
    headers: {
      'Referer': 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!resp.ok) return [];
  const body = await resp.text();

  const quotes: Quote[] = [];
  const lines = body.split(/\n/);
  let idx = 0;
  for (const line of lines) {
    const m = line.match(/var hq_str_(\w+)="([^"]*)"/);
    if (!m) continue;
    const code = m[1];
    const fields = m[2].split(',');
    if (fields.length < 32 || idx >= codes.length) { idx++; continue; }
    const price = num(fields[3]);
    if (price === 0) { idx++; continue; }
    const prevClose = num(fields[2]);
    quotes.push({
      code,
      name:      fields[0],
      price,
      open:      num(fields[1]),
      prevClose,
      high:      num(fields[4]),
      low:       num(fields[5]),
      change:    price - prevClose,
      pct:       prevClose === 0 ? 0 : (price - prevClose) / prevClose * 100,
      volume:    num(fields[8]),
      turnover:  num(fields[9]),
      turnoverRate: 0,
      pe: 0, pb: 0, marketCap: 0,
      ts:        parseSinaTime(fields[30], fields[31]),
    });
    idx++;
  }
  return quotes;
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseSinaTime(date: string, time: string): number {
  // 形如 "2024-05-20", "15:00:00"
  if (!date || !time) return Date.now();
  const t = new Date(`${date}T${time}+08:00`).getTime();
  return Number.isFinite(t) ? t : Date.now();
}
