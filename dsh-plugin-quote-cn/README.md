# @your-org/dsh-plugin-quote-cn

A 股行情插件：设置页「行情」自选列表 + 模型可调用的 `quote_get` / `quote_search` / `quote_kline`。

## 数据源

默认 **腾讯**（`qt.gtimg.cn` 快照 + `ifzq.gtimg.cn` 分时/K 线），自动降级链 **腾讯 → 东财 → 新浪**：单一上游挂掉或返回空时自动切下一个，面板不会白屏。

| 能力 | 腾讯 | 东财 | 新浪 |
|---|---|---|---|
| 快照（PE/PB/市值/换手率全） | ✅ 默认 | ✅ | 残血 |
| 当日分时（240 分钟） | ✅ 独有 | — | — |
| 日/周/月 K（前/后复权） | ✅ 默认 | ✅（分钟 K 由东财承担） | — |
| 搜索 | — | ✅ 默认 | — |

雪球实测：裸请求 403（IP 黑名单），需先取 cookie 才可用且 token 会过期，未接入。付费源（长桥/富途/通联）预留 `premium` 适配器，配置 token 即启用并优先进链。

## 安装

```bash
cd dsh-plugin-quote-cn
pnpm install
pnpm run bundle

# 装进 web profile（会写入 dsh.profile.bundles，bundle 自带 cordis.patch.yml）
dsh plugin --profile web add file:$(pwd)

# 重启 web
dsh web
```

不要把 `cordis.patch.yml` 再抄进 `~/.dsh/profiles/web/cordis.patch.yml`。bundle 层已经注入 `quote-cn` 这一行；再抄一遍会重复 id。

## 使用

- Web：打开设置，左侧会出现「行情」。
  - **大盘指数**：上证指数 / 深证成指 / 创业板指常驻顶部，随轮询刷新。
  - **自选**：输入 `sh600519` 或「茅台」实时搜索，↑↓ 选择、回车或点击下拉候选项加入；完整代码可直接回车。
  - 每行显示现价、涨跌额、涨跌幅与 30 日迷你走势；点击行展开**当日分时图**（含昨收基准线）与详情网格（今开/最高/最低/昨收、成交额/量、换手率、振幅、PE/PB、总市值、数据时间）。停牌股显示灰色「停牌」。
- 对话：让模型查贵州茅台，它会调用 `quote_get` / `quote_search` / `quote_kline`。

## 工具

| 工具名 | 用途 |
|---|---|
| `quote_get` | 实时行情快照 |
| `quote_search` | 按名称搜索 |
| `quote_kline` | K 线 |

## 配置（可选）

`~/.dsh/settings.yaml`:

```yaml
plugins:
  '@your-org/dsh-plugin-quote-cn':
    pollIntervalMs: 3000
    defaultProvider: eastmoney
```

付费源凭据放 `~/.dsh/.credentials.yaml` 对应环境变量（默认读 `LONGBRIDGE_TOKEN`）。未配置时自动回退东财。

## 验证

- `pnpm run bundle` 成功，`lib/index.js` 与 `lib/client.js` 存在，且 `client.js` 以 `window.__ModuleLoader__.load` 开头。
- `dsh --profile web --dump-config` 能看到 `id: quote-cn`。
- 打开设置 →「行情」能加入自选并看到价格。
- `GET /quote-cn/health` 返回 `{ ok: true }`。

## 已知限制

- 免费源为 L1 快照，可能有延时（「数据时间」字段可对照本机时间）。
- 节假日只按周末跳过后台轮询；工具查询仍会拉最后收盘价。
