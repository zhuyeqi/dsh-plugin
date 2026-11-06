import type { Context } from '@deepseek-ai/cordis';
// Types-only: pulls the `ctx.systemPrompt` Context augmentation into this program.
import type {} from '@deepseek-ai/dsh-system-prompt';
import { registerQuoteGetTool } from './quote-get';
import { registerQuoteSearchTool } from './quote-search';
import { registerQuoteKlineTool } from './quote-kline';
import type { QuoteCn } from '../service/quote-cn-service';

/**
 * Raw tool-definition shape accepted by `ctx.tools.register` on DSH 0.2.x.
 *
 * The plugin no longer imports `defineTool` from `@deepseek-ai/dsh-tools`:
 * Node resolves this bundle's runtime imports along its own checkout tree,
 * which still pins the stale 0.1.0-rc.7 copy, while the host registry now
 * runs 0.2.x and enforces the raw JSON Schema subset at registration
 * (`assertSupportedJsonSchema`). Authoring the enforced subset directly —
 * object-level `required` arrays, boolean `additionalProperties`, annotation
 * keywords only — keeps the definitions valid for the host registry without
 * any cross-version dependency.
 */
export interface ToolOutputSpec {
  schema: Record<string, unknown>;
  render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>;
  presentationMeta?(args: unknown, value: unknown): unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Wire parameter schema: object-rooted raw JSON Schema (open root). */
  parameters: Record<string, unknown>;
  output: ToolOutputSpec;
  isConcurrencySafe?: (args: unknown) => boolean;
  execute(args: unknown): Promise<unknown>;
  presentCall?(args: unknown): unknown;
  presentResult?(args: unknown, result: { isError: boolean }): unknown;
}

/** Present a number as a signed percentage-ish string, e.g. `+1.23`. */
export function fmtPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Coerce the model-provided args object into a plain record. */
export function argsRecord(args: unknown): Record<string, unknown> {
  return (args !== null && typeof args === 'object') ? args as Record<string, unknown> : {};
}

export function registerQuoteTools(ctx: Context, service: QuoteCn) {
  registerQuoteGetTool(ctx, service);
  registerQuoteSearchTool(ctx, service);
  registerQuoteKlineTool(ctx, service);
}
