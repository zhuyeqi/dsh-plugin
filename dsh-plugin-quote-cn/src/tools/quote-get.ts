import type { Context } from '@deepseek-ai/cordis';
import { argsRecord, type ToolSpec } from './index';
import type { QuoteCn } from '../service/quote-cn-service';
import type { Quote } from '../service/types';

/**
 * Real-time snapshot tool. The output schema is the enforced raw JSON Schema
 * subset: `required` is an object-level array, `additionalProperties` is a
 * boolean on every object, and only annotation keywords describe fields.
 */
const OUTPUT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', description: '带交易所前缀的代码, e.g. sh600519' },
      name: { type: 'string', description: '股票名称' },
      price: { type: 'number', description: '现价' },
      change: { type: 'number', description: '涨跌额' },
      pct: { type: 'number', description: '涨跌幅 %' },
      open: { type: 'number', description: '今开' },
      high: { type: 'number', description: '最高' },
      low: { type: 'number', description: '最低' },
      prevClose: { type: 'number', description: '昨收' },
      volume: { type: 'number', description: '成交量(手)' },
      turnover: { type: 'number', description: '成交额(元)' },
      turnoverRate: { type: 'number', description: '换手率 %' },
      pe: { type: 'number', description: '市盈率' },
      pb: { type: 'number', description: '市净率' },
      marketCap: { type: 'number', description: '总市值(元)' },
      derived: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amplitude: { type: 'number', description: '振幅 (high-low)/prevClose, %' },
          dayRangePos: { type: 'number', description: '日内位置 (price-low)/(high-low), 0..1' },
          relativePct: { type: 'number', description: '相对上证指数超额涨跌, %' },
          pctFrom52wHigh: { type: 'number', description: '距52周高点, % (<=0)' },
          pctFrom52wLow: { type: 'number', description: '距52周低点, % (>=0)' },
          maDev: {
            type: 'object',
            additionalProperties: false,
            description: '距N日均线偏离度 (price-MA_N)/MA_N, %; keys: 20/60/120',
            properties: {
              '20': { type: 'number' },
              '60': { type: 'number' },
              '120': { type: 'number' },
            },
          },
        },
      },
      ts: { type: 'number', description: '数据时间戳 (ms)' },
    },
    required: ['code', 'name', 'price', 'change', 'pct', 'ts'],
  },
} as const;

export function registerQuoteGetTool(ctx: Context, service: QuoteCn) {
  ctx.systemPrompt.section({
    name: 'tool:quote_get',
    order: 200,
    text:
`Use quote_get to fetch real-time A-share quotes (price, change, pe, etc).
Stock codes are 6 digits with exchange prefix: 'sh600000', 'sz000001', 'bj830799'.
Always call this BEFORE making investment-related claims.`,
  });

  const definition: ToolSpec = {
    name: 'quote_get',
    description: 'Get real-time A-share quote snapshot for one or more stocks. Returns price, change, pct, OHLC, volume, turnover, pe, pb, marketCap, plus derived analytics (derived.amplitude 振幅%, derived.dayRangePos 日内位置0-1, derived.relativePct 相对上证超额%, derived.pctFrom52wHigh/pctFrom52wLow 距52周高低点%, derived.maDev 距MA20/60/120均线偏离%).',
    parameters: {
      type: 'object',
      properties: {
        codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Stock codes with exchange prefix, e.g. ["sh600000","sz000001"]. sh=沪市, sz=深市, bj=北交所.',
        },
      },
      required: ['codes'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: (value as Quote[]).map((q) => {
          let line =
            `${q.code} ${q.name}: ¥${q.price.toFixed(2)} ` +
            `(${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} ` +
            `${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%)`;
          const d = q.derived;
          if (d) {
            const ma = ['20', '60', '120']
              .filter((n) => Number.isFinite(d.maDev?.[n]))
              .map((n) => `MA${n} ${fmtSigned(d.maDev[n])}`);
            line += ` | 振幅 ${d.amplitude.toFixed(2)}% 日内位 ${(d.dayRangePos * 100).toFixed(0)}% ` +
              `相对上证 ${fmtSigned(d.relativePct)}%`;
            if (Number.isFinite(d.pctFrom52wHigh)) {
              line += ` 距52周高 ${fmtSigned(d.pctFrom52wHigh)}%/低 +${d.pctFrom52wLow.toFixed(2)}%`;
            }
            if (ma.length > 0) line += ` | ${ma.join(' ')}`;
          }
          return line;
        }).join('\n'),
      }],
      presentationMeta: (_args, value) => ({ quotes: value }),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const raw = argsRecord(args).codes;
      const codes = Array.isArray(raw)
        ? raw.filter((c): c is string => typeof c === 'string')
        : typeof raw === 'string' ? [raw] : [];
      const quotes = await service.fetchDerived(codes);
      if (quotes.length === 0) {
        throw new Error(
          `No data for codes [${codes.join(', ')}]. ` +
          `Codes may be invalid. Valid prefixes: sh (沪市), sz (深市), bj (北交所).`,
        );
      }
      return quotes;
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      kind: 'fetch' as const,
      title: `行情 ${renderCodes(args)}`,
    }),
    presentResult: (_args, result) =>
      result.isError ? undefined : ({
        card: 'generic' as const,
        title: '行情快照',
      }),
  };

  ctx.tools.register(definition);
}

function renderCodes(args: unknown): string {
  const raw = argsRecord(args).codes;
  const codes = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return codes.join(', ');
}

function fmtSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
