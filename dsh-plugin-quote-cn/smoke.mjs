import * as host from './lib/index.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else    { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

console.log('\n[1] host 导出');
check('apply 是函数', typeof host.apply === 'function');
check('name = quote-cn', host.name === 'quote-cn');
check('inject 含 timer', Array.isArray(host.inject) && host.inject.includes('timer'));
check('Config 存在', host.Config !== undefined);

console.log('\n[2] client ModuleLoader 产物');
const client = readFileSync('lib/client.js', 'utf8');
check('client.js 含 ModuleLoader id', client.includes('window.__ModuleLoader__.load') && client.includes('@zhuyeqi/dsh-plugin-quote-cn'));
check('client.js 导出 apply', /exports\.apply\s*=/.test(client) || /exports\["apply"\]/.test(client) || client.includes('exports.apply'));

console.log('\n[3] 工具注册 (mock ctx)');
const registeredTools = {};
const sections = [];
const mockCtx = {
  systemPrompt: { section: (s) => { sections.push(s); } },
  tools: { register: (t) => { registeredTools[t.name] = t; } },
};
const service = {
  fetch: async (codes) => codes.map((c) => ({
    code: c, name: 'mock-' + c,
    price: 100, change: 1.5, pct: 1.5,
    open: 99, high: 101, low: 98, prevClose: 98.5,
    volume: 1000, turnover: 100000, turnoverRate: 0.5,
    pe: 20, pb: 3, marketCap: 1e9, ts: Date.now(),
  })),
  search: async (query) => [{ code: 'sh600519', name: query, type: '1' }],
  get: () => [], subscribe: () => {}, unsubscribe: () => {}, listWatchlist: () => [], poll: async () => [],
};

const nested = [];
const ctx = {
  timer: { setInterval: (fn, ms) => { nested.push(['interval', ms]); return () => {}; } },
  effect: (fn, label) => { nested.push(['effect', label]); return fn(); },
  inject: (deps, cb) => { nested.push(['inject', deps.join(',')]); if (deps.includes('tools')) cb(mockCtx); },
};
host.apply(ctx, {
  pollIntervalMs: 5000, maxConcurrentFetches: 4, cacheTtlMs: 4000,
  defaultProvider: 'eastmoney',
  premium: { provider: 'longbridge', tokenEnv: 'LONGBRIDGE_TOKEN' },
});
check('注册了 3 个工具', Object.keys(registeredTools).length === 3, `got: ${Object.keys(registeredTools).join(',')}`);
check('quote_get / search / kline', !!registeredTools.quote_get && !!registeredTools.quote_search && !!registeredTools.quote_kline);
check('注册了 3 个 prompt section', sections.length === 3);

console.log('\n[4] quote_get render / presentCall');
const qg = registeredTools.quote_get;
const fakeQuotes = [{
  code: 'sh600000', name: '浦发银行', price: 10.5, change: 0.2, pct: 1.94,
  open: 10.3, high: 10.6, low: 10.2, prevClose: 10.3,
  volume: 1, turnover: 1, turnoverRate: 1, pe: 1, pb: 1, marketCap: 1, ts: Date.now(),
}];
const blocks = qg.output.render({ codes: ['sh600000'] }, fakeQuotes);
check('render 含价格', /¥/.test(blocks[0]?.text));
const callView = qg.presentCall({ codes: ['sh600000'] });
check('presentCall card=generic', callView?.card === 'generic');

console.log('\n[5] HTTP health 路由形状');
let routes = [];
const apiCtx = {
  timer: { setInterval: () => () => {} },
  effect: (fn) => fn(),
  inject: (deps, cb) => {
    if (!deps.includes('webServer')) return;
    cb({
      webServer: { register: (route) => { routes.push(route.path); return () => {}; } },
      effect: (fn) => fn(),
    });
  },
};
host.apply(apiCtx, {
  pollIntervalMs: 5000, maxConcurrentFetches: 4, cacheTtlMs: 4000,
  defaultProvider: 'eastmoney',
  premium: { provider: 'longbridge', tokenEnv: 'LONGBRIDGE_TOKEN' },
});
check('/quote-cn/health', routes.includes('/quote-cn/health'));
check('/quote-cn/snapshot', routes.includes('/quote-cn/snapshot'));
check('/quote-cn/search', routes.includes('/quote-cn/search'));
check('/quote-cn/kline', routes.includes('/quote-cn/kline'));
check('/quote-cn/intraday', routes.includes('/quote-cn/intraday'));

console.log('\n[6] quote_kline 走共享 service（离线断言，不触发真实上游）');
const kl = registeredTools.quote_kline;
check('execute 已绑定', typeof kl.execute === 'function');
check('presentCall 标题含 code/period', /sh600519/.test(String(kl.presentCall({ code: 'sh600519', period: 'day' })?.title)));

console.log(`\n=== 总计: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
