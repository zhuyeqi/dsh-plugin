/**
 * Host entry for the A-share quote plugin.
 *
 * One cordis row, named after this package so `dsh-client-modules` can
 * discover `dsh.client` and serve `/plugins/@zhuyeqi/dsh-plugin-quote-cn/client.js`.
 */
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
// Types-only: pulls the `ctx.timer` mixin declarations into this program (runtime is host-provided).
import type {} from '@deepseek-ai/cordis-plugin-timer';
import { createQuoteCnService, type QuoteCnConfig } from './service/quote-cn-service';
import { mountQuoteRoutes } from './api/routes';
import { registerQuoteTools } from './tools/index';

export const name = 'quote-cn';
export const inject = ['timer'];

export const Config = z.object({
  pollIntervalMs: z.number().min(1000).default(5000),
  maxConcurrentFetches: z.number().min(1).max(16).default(4),
  cacheTtlMs: z.number().min(500).default(4000),
  defaultProvider: z.string().default('tencent'),
  premium: z.object({
    provider: z.string().default('longbridge'),
    tokenEnv: z.string().default('LONGBRIDGE_TOKEN'),
  }).default({ provider: 'longbridge', tokenEnv: 'LONGBRIDGE_TOKEN' }),
});

export function apply(ctx: Context, config: QuoteCnConfig) {
  const service = createQuoteCnService(config);

  ctx.effect(
    () => ctx.timer.setInterval(() => { void service.poll(); }, config.pollIntervalMs),
    'quote-cn: poll',
  );

  ctx.inject(['webServer'], (host: Context) => {
    host.effect(
      () => mountQuoteRoutes(host.webServer, service),
      'quote-cn: http routes',
    );
  });

  ctx.inject(['tools', 'systemPrompt'], (agent: Context) => {
    registerQuoteTools(agent, service);
  });
}
