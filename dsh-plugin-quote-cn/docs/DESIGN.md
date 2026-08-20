# DSH A 股行情插件 — 设计方案

> 一个能在 DeepSeek Harness 中**直接看 A 股行情**、并让模型**实时查询行情做研究**的 bundle 插件。
> 本文是设计文档。代码示例展示**真实可工作的关键片段**，落地时把它们填到对应文件即可。

---

## 1. 设计目标 & 设计取舍

### 1.1 用户视角

| 视角 | 体验 |
|---|---|
| 普通用户 | Web UI 左侧栏多一个 **「行情」** Tab，自选股 + 三大指数 + 板块热力图，刷新频率 5 s（A 股交易时段）。 |
| 模型用户 | 模型可调用 `quote_get` / `quote_search` / `quote_kline` 三个工具查询行情；工具结果在对话中渲染为**专用的红绿 K 线卡片**。 |
| 高级用户 | 支持接入付费数据源（长桥/富途/通联），并保留免费数据源作为回退。 |

### 1.2 与 DSH 现有契约对齐的取舍

- **bundle 而非单 client**：行情数据来自远端 HTTP，需要在 Node 端轮询/聚合 → 选 `dsh.bundle`（带 `cordis.patch.yml`）而不是 `dsh.client`。
- **host / client 双面**：行情面板和模型工具都要落地 → 单包双入口（`lib/index.js` + `lib/client.js`），遵循 `dsh-client-ui-*` 的 dual-face 约定。
- **不引入新底座**：复用 `@deepseek-ai/dsh-tools` 的 `defineTool`、复用 `@deepseek-ai/dsh-api-remotes` 的 Remote 暴露给浏览器、复用 `@deepseek-ai/dsh-client-ui-sidebar` 提供的侧边栏 slot、复用 `@deepseek-ai/dsh-client-ui-tool` 提供的 `tool.call.toolview` slot。**所有 UI 挂载都走 slot**，不抄 `appends`，这是架构红头文件 ui-tool README 第 17–34 行明文规定的。
- **不破坏 host plane / agent plane 划分**：自选股、行情面板属于 host plane（用户偏好，会话间共享）；工具则挂在 agent preset 上，由 preset 自己决定暴露给哪些 agent。这与 `cordis.patch.yml` 中 `disabled: true` 工具的处理方式保持一致。
- **不引入 SSE/WebSocket 长连接进 dsh-host-webserver**：用 host 端 `cordis-plugin-timer` 做 5 s 轮询，简化部署。后续要换 WebSocket 只需把 `QuoteCnService` 内部实现换掉，API 不变。

### 1.3 非目标

- ❌ 不做交易/下单（A 股监管要求严格，本地插件不涉及）。
- ❌ 不做分钟级回放（数据源不支持）。
- ❌ 不做板块/指数成分股的实时计算（只展示行情源返回的现成数据）。

---

## 2. 插件形态与包结构

### 2.1 包名建议

```
@zhuyeqi/dsh-plugin-quote-cn
```

DSH 现有的命名风格是 `@deepseek-ai/dsh-*-<role>`；第三方插件保持 `@<org>/dsh-plugin-<feature>` 即可避免和官方包冲突。

### 2.2 目录骨架

```
dsh-plugin-quote-cn/
├── package.json                        # 声明 dsh.bundle + dsh.client
├── cordis.patch.yml                    # host 层 row 注入
├── src/
│   ├── index.ts                        # Node 侧入口（cordis apply + tool 注册）
│   ├── client.ts                       # Browser 侧入口（__ModuleLoader__）
│   ├── service/
│   │   ├── quote-cn-service.ts         # 行情聚合/缓存/调度服务
│   │   └── providers/
│   │       ├── eastmoney.ts            # 东财 push2（默认免费源）
│   │       ├── sina.ts                 # 新浪 hq.sinajs.cn（备份）
│   │       └── premium-adapter.ts      # 付费源适配（可选）
│   ├── tools/
│   │   ├── quote-get.ts                # 单只实时行情
│   │   ├── quote-search.ts             # 按名称/代码搜索
│   │   └── quote-kline.ts              # K 线/历史
│   ├── api/
│   │   └── remote.ts                   # @deepseek-ai/dsh-api-remotes 暴露给浏览器
│   └── client/
│       ├── sidebar.tsx                 # 注册侧边栏「行情」Tab
│       ├── quote-card.tsx              # tool.call.toolview 的 K 线卡片
│       └── components/                 # UI 内部组件
├── lib/                                # 构建产物（tsdown）
│   ├── index.js
│   ├── client.js
│   ├── invariant.js
│   └── types/                          # *.d.ts
├── tsconfig.json
└── README.md
```

### 2.3 package.json（关键字段）

```jsonc
{
  "name": "@zhuyeqi/dsh-plugin-quote-cn",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".":             { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client":      { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./invariant":   { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./src/*":       "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml"],

  // ① 声明这是一个 dsh.bundle：host 启动时 loader 会把 ./cordis.patch.yml
  //    加入 profile 的 bundle 层栈。
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-tool",
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-api-remotes"
      ],
      "platform": "web"
    }
  },

  "peerDependencies": {
    "react": "^18.2.0",
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-invariants": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-api-remotes": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-ui-sidebar": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-ui-tool": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-locale": "^0.1.0-rc.7"
  },
  "dependencies": {
    "clsx": "^2.0.0"
  },
  "scripts": {
    "bundle": "tsdown",
    "watch":  "tsdown --watch"
  }
}
```

> 对齐点：`dsh.bundle.patch` 的语义来自 `lib/plugin-*.js` 第 25–33 行：`exportsPatch` 用 `dsh.bundle.patch` 字段判断是否是 bundle。`dsh.client.inject` 来自 `dsh-client-ui-tool/package.json` 第 32–41 行的同样约定，声明这个客户端模块运行时需要哪些宿主模块先到位。


---

## 3. Host 端 — 数据服务 + 模型工具

### 3.1 cordis.patch.yml（注入三行 row）

```yaml
# dsh-plugin-quote-cn/cordis.patch.yml
# 该插件对 dsh-web-app 的扩展。所有 row 都用唯一 id，绝不与基础层冲突。

# ── row 1：行情服务（host plane，单例） ────────────────────────────────────
- id: quote-cn-service
  name: '@zhuyeqi/dsh-plugin-quote-cn/service'
  inject: [timer]                   # 需要定时器能力
  config:
    pollIntervalMs: 5000            # 交易时段 5 s 轮询
    maxConcurrentFetches: 4
    cacheTtlMs: 4000                # 防抖
    defaultProvider: eastmoney      # 'eastmoney' | 'sina' | 'premium'
    premium:                         # 可选；不填则跳过付费源
      provider: longbridge          # 用户可换成 futu/tonglian
      tokenEnv: LONGBRIDGE_TOKEN

# ── row 2：行情 Remote 网关（host → browser RPC 通道） ───────────────────────
#    浏览器侧 UI 通过 ctx.connection.call('quote-cn.<method>') 访问行情缓存。
- id: quote-cn-api
  name: '@zhuyeqi/dsh-plugin-quote-cn/api'

# ── row 3：模型工具（agent plane，每个 preset 决定挂不挂） ──────────────────
#    注意：tool 行必须放在能 inject 'tools' 和 'systemPrompt' 的位置。
- id: quote-cn-tools
  name: '@zhuyeqi/dsh-plugin-quote-cn/tools'
  inject: [tools, systemPrompt, quote-cn-service]
```

> 对齐点：
> - **「patch 替换整段 config」**的语义来自 `cordis.patch.yml` 第 6 行注释；要重设某 row 的 config 时必须重列每个字段。
> - **`inject: [...]`** 是 Cordis 的依赖声明，与 `dsh-agent-tool-presentation/lib/index.js` 第 29 行 `const inject = ["tools"];` 是同一套约定。
> - **host plane vs agent plane** 的归属与 `dsh-web-app/cordis.patch.yml` 第 282–356 行的判断准则一致：服务进程级共享的放 host（行情缓存），模型用的工具挂 agent preset。

### 3.2 src/service/quote-cn-service.ts（聚合服务）

```ts
import { definePlugin } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { fetchEastmoney } from './providers/eastmoney';
import { fetchSina }      from './providers/sina';
import { fetchPremium }   from './providers/premium-adapter';

export const name = 'quote-cn-service';
export const inject = ['timer'];

// 与 dsh-settings 配套：用户在 settings.yaml 里改 pollIntervalMs 后无需重启。
export const Config = z.object({
  pollIntervalMs:     z.number().int().min(1000).default(5000),
  maxConcurrentFetches: z.number().int().min(1).max(16).default(4),
  cacheTtlMs:         z.number().int().min(500).default(4000),
  defaultProvider:    z.enum(['eastmoney', 'sina', 'premium']).default('eastmoney'),
  premium: z.object({
    provider: z.enum(['longbridge', 'futu', 'tonglian']).optional(),
    tokenEnv: z.string().optional(),
  }).optional(),
});

interface Quote {
  code: string; name: string;
  price: number; change: number; pct: number;
  open: number; high: number; low: number; prevClose: number;
  volume: number; turnover: number; turnoverRate: number;
  pe: number; pb: number; marketCap: number;
  ts: number; // server-side 行情时间戳
}

export async function apply(ctx, config) {
  // ① 内存行情缓存（key = 6 位代码，如 "sh600000"）。
  const cache = new Map<string, Quote>();
  const subs  = new Set<string>();
  let provider = pickProvider(config);

  // ② 注册到 ctx 上：UI 与 Remote 都通过 ctx.quoteCn.* 拿到同一份缓存。
  ctx.quoteCn = {
    get(codes)         { return codes.map(c => cache.get(c)).filter(Boolean); },
    subscribe(codes)   { codes.forEach(c => subs.add(c)); },
    unsubscribe(codes) { codes.forEach(c => subs.delete(c)); },
    listWatchlist()    { return [...subs]; },
  };

  // ③ 交易时段判断（A 股：工作日 9:30-11:30, 13:00-15:00 北京时间）。
  const isTrading = () => isA_shareSession(new Date());

  // ④ 定时轮询：交易时段内才启动。
  const disposable = ctx.timer.setInterval(async () => {
    if (!isTrading() || subs.size === 0) return;
    const batch = [...subs].slice(0, config.maxConcurrentFetches * 4);
    const quotes = await provider(batch);
    for (const q of quotes) cache.set(q.code, q);
    // ⑤ 主动推送：Remote 监听 quoteCn/update 事件。
    ctx.emit('quoteCn/update', quotes);
  }, config.pollIntervalMs);

  ctx.effect(async () => { disposable(); }, 'quote-cn poll cleanup');
}

function pickProvider(cfg) {
  switch (cfg.defaultProvider) {
    case 'eastmoney': return fetchEastmoney;
    case 'sina':      return fetchSina;
    case 'premium':
      if (!cfg.premium?.provider || !process.env[cfg.premium.tokenEnv ?? ''])
        return fetchEastmoney;     // 缺凭据时静默回退
      return fetchPremium(cfg.premium);
  }
}

function isA_shareSession(now: Date): boolean {
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const bj  = new Date(utc + 8 * 3600_000);
  const day = bj.getDay();
  if (day === 0 || day === 6) return false;
  const m = bj.getHours() * 60 + bj.getMinutes();
  return (m >= 9 * 60 + 30 && m < 11 * 60 + 30) ||
         (m >= 13 * 60      && m < 15 * 60);
}
```

### 3.3 src/tools/quote-get.ts（单只实时行情工具）

```ts
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

export function registerQuoteGetTool(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:quote_get',
    order: 200,
    text:
`Use quote_get to fetch real-time A-share quotes (price, change, pe, etc).
Stock codes are 6 digits with exchange prefix: 'sh600000', 'sz000001', 'bj830799'.
Always call this BEFORE making investment-related claims.`,
  });

  ctx.tools.register(defineTool({
    name: 'quote_get',
    description: 'Get real-time A-share quote snapshot for one or more stocks.',
    parameters: {
      codes: { type: 'array', required: true, items: { type: 'string' },
               description: 'Array of codes, e.g. ["sh600000","sz000001"]' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code:        { type: 'string',  required: true },
            name:        { type: 'string',  required: true },
            price:       { type: 'number',  required: true },
            change:      { type: 'number',  required: true },
            pct:         { type: 'number',  required: true },
            open:        { type: 'number' }, high: { type: 'number' },
            low:         { type: 'number' }, prevClose: { type: 'number' },
            volume:      { type: 'number' }, turnover:  { type: 'number' },
            turnoverRate:{ type: 'number' },
            pe:          { type: 'number' }, pb: { type: 'number' },
            marketCap:   { type: 'number' },
            ts:          { type: 'number',  required: true },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.map(q =>
          `${q.code} ${q.name}: ¥${q.price.toFixed(2)} ` +
          `(${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} ` +
          `${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%)`
        ).join('\n'),
      }],
      // 关键：把结构化数据塞进 meta，让前端能渲染红绿 K 线卡片。
      presentationMeta: (_args, value) => ({ quotes: value }),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const quotes = ctx.quoteCn.get(args.codes);
      if (quotes.length === 0)
        throw new Error('No data; codes may be invalid or market closed.');
      return quotes;
    },
    // 关键：注册到 ui-tool 的 tool.call.toolview slot 的渲染契约。
    presentCall:  () => ({ card: 'quote', kind: 'snapshot', title: args => args.codes.join(', ') }),
    presentResult: (_args, result) => result.isError ? undefined : ({
      card: 'quote',
      kind: 'snapshot',
      // 浏览器侧 ui-tool 会读取这个 view，从 meta 中拿 quotes 数据。
      quotes: result.meta?.quotes ?? [],
    }),
  }));
}
```

> 对齐点：`presentCall` / `presentResult` / `presentationMeta` 的契约来自 `dsh-tool-web/lib/index.js` 第 72–78、148–160、216–220 行；返回值 `{ card, kind, ... }` 会被 `dsh-client-ui-tool` 的 `ToolCallTree` 走「generic card → keyed toolview」分发到 `tool.call.toolview` slot，我们注册的 `quoteGetToolview` 命中 `key: 'quote_get'`。

### 3.4 src/api/remote.ts（暴露给浏览器）

```ts
// 把 ctx.quoteCn 暴露成 api-gateway 上的 Remote 方法。
// 浏览器侧通过 ctx.connection.call('quote-cn.subscribe', [...codes]) 访问。
export async function apply(ctx) {
  ctx.quoteCnRemote = {
    'subscribe':   async (_, codes) => { ctx.quoteCn.subscribe(codes); return true; },
    'unsubscribe': async (_, codes) => { ctx.quoteCn.unsubscribe(codes); return true; },
    'snapshot':    async (_, codes) => ctx.quoteCn.get(codes),
    'watchlist':   async ()           => ctx.quoteCn.listWatchlist(),
  };
  // 把 quoteCnRemote 注册到 api-gateway 的 namespace 'quote-cn'。
  // (具体注册方式以你本地 @deepseek-ai/dsh-api-remotes 暴露的 registerNamespace 为准)
  ctx.api.registerNamespace('quote-cn', ctx.quoteCnRemote);
}
```


---

## 4. Client 端 — 侧边栏 Tab + 工具卡片

### 4.1 src/client/sidebar.tsx（侧边栏「行情」Tab）

```tsx
// 浏览器模块入口：注册到 sidebar slot 的一个新 tab。
import { useEffect, useState } from 'react';
import { ctx } from '@deepseek-ai/dsh-client-runtime';
import { t }   from '@deepseek-ai/dsh-client-locale';
import { IconCandle14 } from '@deepseek-ai/dsh-client-ui-primitives';

const QUOTE_TAB_KEY = 'quote-cn';

export function apply(clientCtx) {
  // 1. 注册 sidebar tab —— 复用 ui-sidebar 的 slot，不重写 sidebar。
  clientCtx.slots.inject('sidebar.tab', () =>
    clientCtx.slots.register({
      name: 'sidebar.tab',
      key:  QUOTE_TAB_KEY,
      locale: { zh: '行情', en: 'Markets' },
      icon:  <IconCandle14 />,
      order: 30,                       // 在 settings 之前
    }, QuoteTabPanel));

  // 2. 初次挂载时把空订阅发上去，等用户加自选股后再追加。
  useEffect(() => { ctx.connection.call('quote-cn.watchlist', []); }, []);
}

// 2. tab 渲染内容
function QuoteTabPanel() {
  const [watch, setWatch] = useState<string[]>(loadLocal('quote-cn.watchlist', []));
  const [data, setData]   = useState<Record<string, Quote>>({});

  useEffect(() => {
    saveLocal('quote-cn.watchlist', watch);
    ctx.connection.call('quote-cn.subscribe', [watch]);
  }, [watch.join(',')]);

  // 监听 server 推送
  useEffect(() => {
    const off = ctx.connection.on('quote-cn/update', (quotes: Quote[]) => {
      setData(prev => {
        const next = { ...prev };
        for (const q of quotes) next[q.code] = q;
        return next;
      });
    });
    return () => off();
  }, []);

  return (
    <div className="quote-cn-panel">
      <Indices />                                  {/* sh000001 / sz399001 / sz399006 */}
      <WatchList data={data} watch={watch} onChange={setWatch} />
      <SectorHeatmap />                            {/* 板块热力（lazy fetch） */}
    </div>
  );
}
```

### 4.2 src/client/quote-card.tsx（tool.call.toolview 卡片）

```tsx
// 给 ui-tool 的 'tool.call.toolview' slot 注册一个 key='quote_get' 的渲染器。
// 当模型调用 quote_get 后，ui-tool 把 ToolCallBlock 通过这里渲染。
export function apply(clientCtx) {
  clientCtx.slots.inject('tool.call.toolview', () =>
    clientCtx.slots.register({
      name: 'tool.call.toolview',
      key:  'quote_get',
      locale: { zh: '行情快照', en: 'Quote' },
    }, QuoteCard));
}

function QuoteCard({ result }: { result: { quotes: Quote[] } }) {
  return (
    <div className="quote-cn-card">
      {result.quotes.map(q => (
        <div key={q.code} className={q.change >= 0 ? 'up' : 'down'}>
          <span className="name">{q.name} <code>{q.code}</code></span>
          <span className="price">¥{q.price.toFixed(2)}</span>
          <span className="pct">
            {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)}
            （{q.pct >= 0 ? '+' : ''}{q.pct.toFixed(2)}%）
          </span>
          <MiniSparkline code={q.code} />   {/* 用近 30 个 tick 自己画迷你图 */}
        </div>
      ))}
    </div>
  );
}
```

### 4.3 src/client.ts（打包入口）

```ts
import { apply as sidebarApply } from './client/sidebar';
import { apply as cardApply }    from './client/quote-card';

window.__ModuleLoader__.load({
  id: '@zhuyeqi/dsh-plugin-quote-cn',
  factory: () => ({
    apply(ctx) {
      sidebarApply(ctx);
      cardApply(ctx);
    },
  }),
});
```

> 对齐点：模式来自 `dsh-client-ui-tool/lib/client.js` 第 1–6 行 —— `window.__ModuleLoader__.load({id, factory: (require) => {...}})`。`client.js` 内部用 `require()` 拿其他 client 模块；我们的客户端包注入声明里把它们都列上了，loader 会保证顺序。

---

## 5. 与现有 dsh-web-app 的整合

### 5.1 用户配置路径

修改 `$DSH_HOME/profiles/web/cordis.patch.yml`，追加三行：

```yaml
# /Users/kk/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: quote-cn-service
      name: '@zhuyeqi/dsh-plugin-quote-cn/service'
      inject: [timer]
      config:
        pollIntervalMs: 5000

    - id: quote-cn-api
      name: '@zhuyeqi/dsh-plugin-quote-cn/api'

    - id: quote-cn-tools
      name: '@zhuyeqi/dsh-plugin-quote-cn/tools'
      inject: [tools, systemPrompt, quote-cn-service]
```

> 对齐点：用户 `web/cordis.patch.yml` 现在已经有 `mcp-context7`、`mcp-web-search`、`mcp-web-reader` 三组 row，新插件追加三行同构；最终配置树按 `dsh.bundle.bundles → profile/cordis.patch.yml → home/cordis.patch.yml → --patch` 顺序叠加，我们的 row 在所有 bundle 层之后被处理，等 `timer` / `tools` / `systemPrompt` / `api-gateway` 等基础 row 都到位后才会激活。

### 5.2 安装命令

```bash
# 1. 把插件源码放到某个目录，比如 ~/proj/dsh-plugin-quote-cn
cd ~/proj/dsh-plugin-quote-cn
pnpm install
pnpm run bundle                       # 产物进 lib/

# 2. 在 web profile 里以本地路径安装
dsh plugin --profile web add file:$(pwd)
#    ↑ dsh-plugin-*.js 第 108 行把这个命令转发给 pnpm，
#      pnpm 把 @zhuyeqi/dsh-plugin-quote-cn 写到 profile/package.json
#      并 append 进 dsh.profile.bundles。

# 3. 重启 web
dsh web
```

### 5.3 settings.yaml（用户级配置）

```yaml
# /Users/kk/.dsh/settings.yaml
plugins:
  '@zhuyeqi/dsh-plugin-quote-cn/service':
    pollIntervalMs: 3000           # 交易时段更密
    defaultProvider: premium
    premium:
      provider: longbridge
      tokenEnv: LONGBRIDGE_TOKEN
```

> 付费源凭据写入 `.credentials.yaml`（见 `$DSH_HOME/.credentials.yaml`，与 `dsh-web-search-deepseek/lib/index.js` 第 2 行 `credentialRef` 的用法一致），settings.yaml 里只引用环境变量名。

---

## 6. 关键边界与边界守护

| 边界 | 处理 |
|---|---|
| **CORS** | 东财/新浪部分接口有浏览器 Referer 白名单；行情接口统一在 host 端 fetch，浏览器只走 `/api`，避免 CORS。 |
| **数据延迟** | 免费东财接口有 15 分钟延迟；卡片上标注 `[延时 15m]`，付费源走真实时。 |
| **交易日判断** | host 端 `isA_shareSession()` 决定是否轮询；UI 在非交易时段显示「已收盘」。 |
| **股票代码前缀** | 沪 sh / 深 sz / 北 bj 必须带上；用正则 `^[sS][hzH]?[hzHZ]?\d{6}$|^\d{6}$` 校验；模型工具 schema `description` 里写明格式以减少幻觉。 |
| **停牌 / 退市** | provider 返回的字段若 price=0、change=0 → 卡片显示「停牌」，避免误读。 |
| **凭据泄露** | 付费源 token 只放在 `$DSH_HOME/.credentials.yaml`；settings.yaml 只引用环境变量名（参考 `web-search-deepseek`）。 |
| **竞态** | host 端用 `Promise.allSettled` + 简易信号量限制并发数；UI 端每次 `setState` 用函数式 `setData(prev => ...)` 避免陈旧闭包。 |
| **卸载** | `ctx.effect` 注册 disposable；service 用 `ctx.timer.setInterval` 的返回值；ctx 销毁时一并清除。 |

---

## 7. 测试与演进路线

### Phase 1（MVP，~1 周）
- [ ] 东财免费源 + 三个工具（get / search / kline）
- [ ] 侧边栏自选股 + 三大指数
- [ ] tool view 红绿卡片

### Phase 2（增强，~1 周）
- [ ] K 线（迷你蜡烛）
- [ ] 板块热力图
- [ ] 工具调用历史（model 用 quote_get 多少次统计）

### Phase 3（商业化）
- [ ] 付费源适配器抽象层
- [ ] watchlist 导入 / 导出（txt、csv）
- [ ] 提醒：「某只股票涨跌幅超过阈值」→ 通过 dsh-tool-notify 等已有渠道推送

### 验证清单（落地时必做）
- [ ] `pnpm run bundle` 后 `lib/index.js`、`lib/client.js` 产物存在
- [ ] `dsh --dump-config` 看到 `quote-cn-service` / `quote-cn-api` / `quote-cn-tools` 三行 row
- [ ] `dsh web` 启动后浏览器控制台 `window.__DSH_BOOT__.client` 包含本插件 id
- [ ] 浏览器侧边栏出现「行情」tab
- [ ] 在对话中发：「查一下茅台和宁德时代最新价」→ 模型调用 quote_get → 对话卡片红绿显示
- [ ] `pnpm dev` 时改 `src/client/quote-card.tsx` 触发 HMR 重载（依赖 `dsh-client-hmr` 已挂载）

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 东财接口变更 | 用 `premium-adapter` 抽象，切换 provider 不影响 UI；写契约测试 snapshot 关键字段名 |
| A 股交易日历与节假日 | 用 `china-holiday-cal` 或简单硬编码近 5 年；非交易日 UI 显示休市 |
| 浏览器长时间挂起后轮询积压 | `isPageVisible()` 时跳过本轮；UI 切回前台时主动 `ctx.connection.call('quote-cn.snapshot', watch)` |
| 与现有 ui-deliverables / ui-trajectory 冲突 | 所有 UI 都走 slot 注入，不 `appends` DOM，零侵入 |
| `tsdown` 产物对 `require()` 不可解析 | 客户端必须产物是 ESM 且字段都在 `exports` 里；遇到 `require` 解析失败，把对应依赖 `external` 化 |

---

## 附：本次设计的 DSH 架构依据（README/源码定位）

| 设计点 | DSH 源码出处 |
|---|---|
| bundle 通过 `dsh.bundle.patch` 识别 | `lib/plugin-*.js:25-33` |
| 用户用 `dsh plugin add file:...` 安装 | `lib/plugin-*.js:101-126` |
| 配置树按 bundles → profile → home → --patch 顺序 | `README.md` Profiles 节 |
| `cordis.patch.yml` 的 `!!js` 与 `id/name/config/inject/disabled` | `cordis.patch.yml` 全部 |
| cordis 插件 `apply(ctx, config)` + `inject` + `name` | `dsh-agent-tool-presentation/lib/index.js:23-49` |
| 工具用 `defineTool` + `systemPrompt.section` | `dsh-tool-web/lib/index.js:173-238` |
| `presentCall` / `presentResult` / `presentationMeta` 三件套 | `dsh-tool-web/lib/index.js:72-160, 216-220` |
| 客户端入口 `window.__ModuleLoader__.load({id, factory})` | `dsh-client-ui-tool/lib/client.js:1-10` |
| UI 走 slot：`tool.call.toolview`、`sidebar.tab` | `dsh-client-ui-tool/README.md:21-34` |
| host/agent plane 划分准则 | `dsh-web-app/cordis.patch.yml:282-356` |
| settings 命名空间 | `dsh-skill-filesystem/lib/index.js:30-44` |
| 凭据用 `credentialRef` + `.credentials.yaml` | `dsh-web-search-deepseek/lib/index.js:2` |

