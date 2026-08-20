/**
 * Browser entry: settings section (watchlist) + keyed tool views.
 * tsdown wraps this file in window.__ModuleLoader__.load({ id, factory }).
 */
import { createElement as h } from 'react';
import { WatchlistPanel } from './client/sidebar';
import { KLineCard, QuoteCard, SearchCard } from './client/quote-card';
import { en, zh } from './client/locales';

const NS = 'quote-cn';

interface QuoteClientContext {
  effect(callback: () => unknown, label?: string): void;
  locale: {
    register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown;
    bind(namespace: string): (key: string) => string;
  };
  slots: {
    inject(name: string, register: () => unknown): void;
    register(options: Record<string, unknown>, render: unknown): unknown;
  };
}

export const name = 'quote-cn';
export const inject = ['slots', 'locale'];

export function apply(ctx: QuoteClientContext) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quote-cn: dictionaries');
  const t = ctx.locale.bind(NS);

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'quote-cn',
    order: 45,
    label: () => t('nav'),
    locale: NS,
  }, () => h(WatchlistPanel, { t })));

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'quote_get',
      locale: NS,
    }, QuoteCard);
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'quote_search',
      locale: NS,
    }, SearchCard);
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'quote_kline',
      locale: NS,
    }, KLineCard);
  });
}
