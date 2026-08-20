import { defineTool } from '@deepseek-ai/dsh-tools';
import type { QuoteCn } from '../service/quote-cn-service';
import type { Quote } from '../service/types';

export function registerQuoteGetTool(ctx: any, service: QuoteCn) {
  ctx.systemPrompt.section({
    name: 'tool:quote_get',
    order: 200,
    text:
`Use quote_get to fetch real-time A-share quotes (price, change, pe, etc).
Stock codes are 6 digits with exchange prefix: 'sh600000', 'sz000001', 'bj830799'.
Always call this BEFORE making investment-related claims.`,
  });

  ctx.tools.register(defineTool({
    name: 'quote_get',
    description: 'Get real-time A-share quote snapshot for one or more stocks. Returns price, change, pct, OHLC, volume, turnover, pe, pb, marketCap, plus derived analytics (derived.amplitude 振幅%, derived.dayRangePos 日内位置0-1, derived.relativePct 相对上证超额%, derived.pctFrom52wHigh/pctFrom52wLow 距52周高低点%, derived.maDev 距MA20/60/120均线偏离%).',
    parameters: {
      codes: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Stock codes with exchange prefix, e.g. ["sh600000","sz000001"]. sh=沪市, sz=深市, bj=北交所.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code:         { type: 'string', required: true },
            name:         { type: 'string', required: true },
            price:        { type: 'number', required: true },
            change:       { type: 'number', required: true },
            pct:          { type: 'number', required: true },
            open:         { type: 'number' },
            high:         { type: 'number' },
            low:          { type: 'number' },
            prevClose:    { type: 'number' },
            volume:       { type: 'number' },
            turnover:     { type: 'number' },
            turnoverRate: { type: 'number' },
            pe:           { type: 'number' },
            pb:           { type: 'number' },
            marketCap:    { type: 'number' },
            derived: {
              type: 'object',
              additionalProperties: false,
              properties: {
                amplitude:      { type: 'number', description: '振幅 (high-low)/prevClose, %' },
                dayRangePos:    { type: 'number', description: '日内位置 (price-low)/(high-low), 0..1' },
                relativePct:    { type: 'number', description: '相对上证指数超额涨跌, %' },
                pctFrom52wHigh: { type: 'number', description: '距52周高点, % (<=0)' },
                pctFrom52wLow:  { type: 'number', description: '距52周低点, % (>=0)' },
                maDev: {
                  type: 'object',
                  additionalProperties: false,
                  description: '距N日均线偏离度 (price-MA_N)/MA_N, %; keys: 20/60/120',
                  properties: {
                    '20':  { type: 'number' },
                    '60':  { type: 'number' },
                    '120': { type: 'number' },
                  },
                },
              },
            },
            ts:           { type: 'number', required: true },
          },
        },
      },
      render: (_args: unknown, value: Quote[]) => [{
        type: 'text',
        text: value.map((q) => {
          let line =
            `${q.code} ${q.name}: ¥${q.price.toFixed(2)} ` +
            `(${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} ` +
            `${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%)`;
          const d = q.derived;
          if (d) {
            const ma = ['20', '60', '120']
              .filter((n) => Number.isFinite(d.maDev?.[n]))
              .map((n) => `MA${n} ${fmtPct(d.maDev[n])}`);
            line += ` | 振幅 ${d.amplitude.toFixed(2)}% 日内位 ${(d.dayRangePos * 100).toFixed(0)}% ` +
              `相对上证 ${fmtPct(d.relativePct)}`;
            if (Number.isFinite(d.pctFrom52wHigh)) {
              line += ` 距52周高 ${fmtPct(d.pctFrom52wHigh)}/低 +${d.pctFrom52wLow.toFixed(2)}%`;
            }
            if (ma.length > 0) line += ` | ${ma.join(' ')}`;
          }
          return line;
        }).join('\n'),
      }],
      presentationMeta: ((_args: unknown, value: Quote[]) => ({ quotes: value })) as never,
    },
    isConcurrencySafe: () => true,
    async execute(args: { codes: string[] }) {
      const quotes = await service.fetchDerived(args.codes);
      if (quotes.length === 0) {
        throw new Error(
          `No data for codes [${args.codes.join(', ')}]. ` +
          `Codes may be invalid. Valid prefixes: sh (沪市), sz (深市), bj (北交所).`,
        );
      }
      return quotes;
    },
    presentCall: (args: { codes: string[] }) => ({
      card: 'generic' as const,
      kind: 'fetch' as const,
      title: `行情 ${args.codes.join(', ')}`,
    }),
    presentResult: (_args: unknown, result: { isError: boolean }) =>
      result.isError ? undefined : ({
        card: 'generic' as const,
        title: '行情快照',
      }),
  }));
}

function fmtPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
