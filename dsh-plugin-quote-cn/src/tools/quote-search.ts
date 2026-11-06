import type { Context } from '@deepseek-ai/cordis';
import { argsRecord, type ToolSpec } from './index';
import type { QuoteCn } from '../service/quote-cn-service';

export function registerQuoteSearchTool(ctx: Context, service: QuoteCn) {
  ctx.systemPrompt.section({
    name: 'tool:quote_search',
    order: 201,
    text:
`Use quote_search to find an A-share stock by Chinese name or partial code.
Returns up to 10 matches; pair with quote_get for full quote.`,
  });

  const definition: ToolSpec = {
    name: 'quote_search',
    description: 'Search A-share stocks by Chinese name or 6-digit code. Returns up to 10 matches.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词 (中文名或部分代码)' },
        market: { type: 'string', description: '市场过滤: sh / sz / bj, 不传则全部' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
          },
          required: ['code', 'name'],
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value as Array<{ code: string; name: string }>).length === 0
          ? 'No matching stocks found.'
          : (value as Array<{ code: string; name: string }>).map((v) => `${v.code} ${v.name}`).join('\n'),
      }],
      presentationMeta: (_args, value) => ({ matches: value }),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const record = argsRecord(args);
      const query = typeof record.query === 'string' ? record.query : '';
      const market = typeof record.market === 'string' ? record.market : undefined;
      return service.search(query, market);
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      kind: 'search' as const,
      title: `搜股 ${argsRecord(args).query ?? ''}`,
    }),
    presentResult: (_args, result) =>
      result.isError ? undefined : ({ card: 'generic' as const, title: '股票搜索' }),
  };

  ctx.tools.register(definition);
}
