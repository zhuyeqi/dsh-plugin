import type { Context } from '@deepseek-ai/cordis';
// Types-only: pulls the `ctx.systemPrompt` Context augmentation into this program.
import type {} from '@deepseek-ai/dsh-system-prompt';
import { registerQuoteGetTool } from './quote-get';
import { registerQuoteSearchTool } from './quote-search';
import { registerQuoteKlineTool } from './quote-kline';
import type { QuoteCn } from '../service/quote-cn-service';

export function registerQuoteTools(ctx: Context, service: QuoteCn) {
  registerQuoteGetTool(ctx, service);
  registerQuoteSearchTool(ctx, service);
  registerQuoteKlineTool(ctx, service);
}
