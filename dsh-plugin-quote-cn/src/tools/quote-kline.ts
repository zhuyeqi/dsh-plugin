import type { Context } from '@deepseek-ai/cordis';
import { argsRecord, type ToolSpec } from './index';
import type { QuoteCn } from '../service/quote-cn-service';

const PERIODS = ['day', 'week', 'month', '5', '15', '30', '60'] as const;
const ADJUSTS = ['qfq', 'hfq', 'none'] as const;

export function registerQuoteKlineTool(ctx: Context, service: QuoteCn) {
  ctx.systemPrompt.section({
    name: 'tool:quote_kline',
    order: 202,
    text:
`Use quote_kline to fetch OHLCV history for an A-share stock.
Supports daily/weekly/monthly and minute-level (5/15/30/60min).`,
  });

  const definition: ToolSpec = {
    name: 'quote_kline',
    description: 'Get OHLCV (open, high, low, close, volume) history for an A-share stock. Returns up to 500 bars.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Stock code with prefix, e.g. "sh600000"' },
        period: { type: 'string', description: 'day | week | month | 5 | 15 | 30 | 60 (分钟)' },
        count: { type: 'number', description: '返回 K 线根数,最大 500' },
        adjust: { type: 'string', description: 'qfq (前复权) | hfq (后复权) | none (不复权)' },
      },
      required: ['code'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          period: { type: 'string' },
          bars: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'string' },
                open: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' },
                close: { type: 'number' },
                volume: { type: 'number' },
                turnover: { type: 'number' },
              },
              required: ['ts', 'open', 'high', 'low', 'close', 'volume'],
            },
          },
        },
        required: ['code', 'period', 'bars'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: (() => {
          const { code, period, bars } = value as { code: string; period: string; bars: Array<{ close: number }> };
          return `${code} ${period} ${bars.length} bars. ` +
            `Last close: ¥${bars[bars.length - 1]?.close.toFixed(2)}`;
        })(),
      }],
      presentationMeta: (_args, value) => value,
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const record = argsRecord(args);
      const code = typeof record.code === 'string' ? record.code : '';
      const period = typeof record.period === 'string' && (PERIODS as readonly string[]).includes(record.period)
        ? record.period : 'day';
      const adjust = typeof record.adjust === 'string' && (ADJUSTS as readonly string[]).includes(record.adjust)
        ? record.adjust : 'qfq';
      const countRaw = Number(record.count);
      const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(Math.trunc(countRaw), 500) : 60;
      return service.kline(code, { period, count, adjust });
    },
    presentCall: (args) => {
      const record = argsRecord(args);
      return {
        card: 'generic' as const,
        kind: 'fetch' as const,
        title: `K线 ${record.code ?? ''} ${typeof record.period === 'string' ? record.period : 'day'}`,
      };
    },
    presentResult: (_args, result) =>
      result.isError ? undefined : ({ card: 'generic' as const, title: 'K 线' }),
  };

  ctx.tools.register(definition);
}
