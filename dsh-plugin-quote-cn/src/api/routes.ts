import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestUrl, sendJson } from './http';
import type { QuoteCn } from '../service/quote-cn-service';

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}

export function mountQuoteRoutes(webServer: WebServerLike, service: QuoteCn): () => void {
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: '/quote-cn/health',
      handler: (_req, res) => {
        sendJson(res, 200, { ok: true, plugin: '@your-org/dsh-plugin-quote-cn' });
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/quote-cn/snapshot',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' });
          res.end();
          return;
        }
        const codes = (requestUrl(req).searchParams.get('codes') ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        try {
          const quotes = requestUrl(req).searchParams.get('derived') === '1'
            ? await service.fetchDerived(codes)
            : await service.fetch(codes);
          sendJson(res, 200, quotes);
        } catch (error) {
          sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/quote-cn/search',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' });
          res.end();
          return;
        }
        const query = requestUrl(req).searchParams.get('q')?.trim() ?? '';
        if (!query) {
          sendJson(res, 400, { error: 'missing q' });
          return;
        }
        try {
          sendJson(res, 200, await service.search(query, requestUrl(req).searchParams.get('market') ?? undefined));
        } catch (error) {
          sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/quote-cn/kline',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' });
          res.end();
          return;
        }
        const params = requestUrl(req).searchParams;
        const code = params.get('code')?.trim().toLowerCase() ?? '';
        if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
          sendJson(res, 400, { error: 'invalid code, expected e.g. sh600519' });
          return;
        }
        const period = params.get('period') ?? 'day';
        if (!['day', 'week', 'month', '5', '15', '30', '60'].includes(period)) {
          sendJson(res, 400, { error: 'invalid period' });
          return;
        }
        const adjust = params.get('adjust') ?? 'qfq';
        if (!['qfq', 'hfq', 'none'].includes(adjust)) {
          sendJson(res, 400, { error: 'invalid adjust' });
          return;
        }
        const countRaw = Number(params.get('count') ?? 30);
        const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.trunc(countRaw), 1), 500) : 30;
        try {
          sendJson(res, 200, await service.kline(code, { period, count, adjust }));
        } catch (error) {
          sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/quote-cn/intraday',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' });
          res.end();
          return;
        }
        const code = requestUrl(req).searchParams.get('code')?.trim().toLowerCase() ?? '';
        if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
          sendJson(res, 400, { error: 'invalid code, expected e.g. sh600519' });
          return;
        }
        try {
          const intraday = await service.intraday(code);
          const quote = service.get([code])[0];
          sendJson(res, 200, {
            code: intraday.code,
            date: intraday.date,
            minutes: intraday.minutes,
            prevClose: quote?.prevClose ?? 0,
          });
        } catch (error) {
          sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
