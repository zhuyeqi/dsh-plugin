import { registerQuoteGetTool } from './quote-get';
import { registerQuoteSearchTool } from './quote-search';
import { registerQuoteKlineTool } from './quote-kline';
import type { QuoteCn } from '../service/quote-cn-service';

export function registerQuoteTools(ctx: any, service: QuoteCn) {
  registerQuoteGetTool(ctx, service);
  registerQuoteSearchTool(ctx, service);
  registerQuoteKlineTool(ctx, service);
}
