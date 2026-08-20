import { defineTool } from '@deepseek-ai/dsh-tools';
import type { QuoteCn } from '../service/quote-cn-service';

export function registerQuoteSearchTool(ctx: any, service: QuoteCn) {
  ctx.systemPrompt.section({
    name: 'tool:quote_search',
    order: 201,
    text:
`Use quote_search to find an A-share stock by Chinese name or partial code.
Returns up to 10 matches; pair with quote_get for full quote.`,
  });

  ctx.tools.register(defineTool({
    name: 'quote_search',
    description: 'Search A-share stocks by Chinese name or 6-digit code. Returns up to 10 matches.',
    parameters: {
      query:  { type: 'string', required: true, description: '搜索关键词 (中文名或部分代码)' },
      market: { type: 'string', description: '市场过滤: sh / sz / bj, 不传则全部' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true },
            name: { type: 'string', required: true },
            type: { type: 'string' },
          },
        },
      },
      render: (_args: unknown, value: Array<{ code: string; name: string }>) => [{
        type: 'text',
        text: value.length === 0
          ? 'No matching stocks found.'
          : value.map((v) => `${v.code} ${v.name}`).join('\n'),
      }],
      presentationMeta: (_args: unknown, value: unknown) => ({ matches: value }),
    },
    isConcurrencySafe: () => true,
    async execute(args: { query: string; market?: string }) {
      return service.search(args.query, args.market);
    },
    presentCall: (args: { query: string }) => ({
      card: 'generic' as const,
      kind: 'search' as const,
      title: `搜股 ${args.query}`,
    }),
    presentResult: (_args: unknown, result: { isError: boolean }) =>
      result.isError ? undefined : ({ card: 'generic' as const, title: '股票搜索' }),
  }));
}
