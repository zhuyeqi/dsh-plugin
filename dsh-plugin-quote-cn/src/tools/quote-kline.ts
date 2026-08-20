import { defineTool } from '@deepseek-ai/dsh-tools';
import type { QuoteCn } from '../service/quote-cn-service';

export function registerQuoteKlineTool(ctx: any, service: QuoteCn) {
  ctx.systemPrompt.section({
    name: 'tool:quote_kline',
    order: 202,
    text:
`Use quote_kline to fetch OHLCV history for an A-share stock.
Supports daily/weekly/monthly and minute-level (5/15/30/60min).`,
  });

  ctx.tools.register(defineTool({
    name: 'quote_kline',
    description: 'Get OHLCV (open, high, low, close, volume) history for an A-share stock. Returns up to 500 bars.',
    parameters: {
      code:   { type: 'string', required: true, description: 'Stock code with prefix, e.g. "sh600000"' },
      period: { type: 'string', default: 'day', description: 'day | week | month | 5 | 15 | 30 | 60 (分钟)' },
      count:  { type: 'number', default: 60, description: '返回 K 线根数,最大 500' },
      adjust: { type: 'string', default: 'qfq', description: 'qfq (前复权) | hfq (后复权) | none (不复权)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code:   { type: 'string', required: true },
          period: { type: 'string', required: true },
          bars: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts:       { type: 'string', required: true },
                open:     { type: 'number', required: true },
                high:     { type: 'number', required: true },
                low:      { type: 'number', required: true },
                close:    { type: 'number', required: true },
                volume:   { type: 'number', required: true },
                turnover: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args: unknown, value: { code: string; period: string; bars: Array<{ close: number }> }) => [{
        type: 'text',
        text:
`${value.code} ${value.period} ${value.bars.length} bars. ` +
`Last close: ¥${value.bars[value.bars.length - 1]?.close.toFixed(2)}`,
      }],
      presentationMeta: (_args: unknown, value: unknown) => value as Record<string, unknown>,
    },
    isConcurrencySafe: () => true,
    async execute(args: { code: string; period: string; count: number; adjust: string }) {
      return service.kline(args.code, {
        period: args.period,
        count: args.count,
        adjust: args.adjust,
      });
    },
    presentCall: (args: { code: string; period: string }) => ({
      card: 'generic' as const,
      kind: 'fetch' as const,
      title: `K线 ${args.code} ${args.period ?? 'day'}`,
    }),
    presentResult: (_args: unknown, result: { isError: boolean }) =>
      result.isError ? undefined : ({ card: 'generic' as const, title: 'K 线' }),
  }));
}
