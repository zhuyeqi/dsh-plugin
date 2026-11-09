# dsh-plugin

DeepSeek Harness 插件集合。

## 插件

### dsh-plugin-quote-cn

A 股行情插件：侧边栏自选盯盘（自选/指数/分时/K线/sparkline/衍生指标/拖拽排序）+ 模型工具（quote_get / quote_search / quote_kline）。

安装：

```bash
dsh plugin --profile web add github:zhuyeqi/dsh-plugin/dsh-plugin-quote-cn
# 或本地（目录形式 → link: 软链本仓库，改码重启即生效；勿用 file: 快照）
dsh plugin --profile web add ./dsh-plugin-quote-cn
```

详见 [dsh-plugin-quote-cn/README.md](./dsh-plugin-quote-cn/README.md)。

### dsh-plugin-brand

可配置的侧边栏品牌名插件：`brand` settings namespace + Settings → General 编辑行，修改即时生效，持久化在 `~/.dsh/settings.yaml`。安装方式同上（`add ./dsh-plugin-brand`）。

### dsh-plugin-water-reminder

喝水提醒：输入框下方常驻条显示今日杯数/目标/进度与下次提醒倒计时（`+一杯`、`暂停`），到点在右下角浮层弹出提醒卡片（`喝好了 +1` / `5 分钟后再提醒` / 关闭）；杯数按日期存 `localStorage`，跨天归零。安装方式同上（`add ./dsh-plugin-water-reminder`）。

详见 [dsh-plugin-water-reminder/README.md](./dsh-plugin-water-reminder/README.md)。

### dsh-plugin-llm-mmsp

MMSP（Model Message Stream Protocol）**原生 LLM 适配器**：实现一个 MMSP `LlmAdapter` 并 `registerAdapter` 注册，让 DSH 的会话/子代理/工具调用/thinking 直接跑在 MMSP 服务器上（`POST {base}/stream` + SSE UniEvent），不再需要 `mmsp-bridge` 这类本地 OpenAI 兼容代理。

- 自带 `penguin-go` 路由预配置（`baseURL: https://go.penguin.ooo/api/v1`），凭据用 `MMSP_API_KEY`；模型设置页可改 provider/模型列表，无需重启。
- 协议映射按 mmsp-bridge 实测行为移植：system → `config.system_prompt`、role `tool` → `tool_result.done`、工具 id 越界自动重映射、`finish_reason` 在工具调用后纠偏为 `tool-calls`、keep-alive 注释喂空闲看门狗、错误码统一归一。
- 依赖（`@deepseek-ai/*`）经 tsdown 全部打进 `lib/index.js`，`node_modules/` 不入库。

安装方式同上（`add ./dsh-plugin-llm-mmsp`，目录形式 → `link:` 软链）。详见 [dsh-plugin-llm-mmsp/README.md](./dsh-plugin-llm-mmsp/README.md)。

### dsh-plugin-key-guard

密钥安全插件：挂在 `llm/stream` waterfall 上包裹**每一次模型调用**——出站请求中的 AI/大模型 Key 自动替换为 `<<DSHKEY#n>>` 占位符，模型返回使用时（正文/思考/工具参数，含被流式 delta 拆开的）在本地还原为真实密钥，**真实 Key 永远不会到达模型服务商**。

- 内置 10 类常见格式（`sk-`/`sk-ant-`/`AKIA`/`AIza`/GitHub/Slack/GitLab/HF/Replicate），零配置开箱即用；设置页可追加自定义正则与精确密钥（secret 语义，保存后不回显），全部免重启热生效。
- DSH 深冻结请求对象，插件用"脱敏副本重入 `llm.stream()`"绕过（无递归，其余中间件照常参与新流）；只还原本次请求出现过的编号，注入指令猜 id 套不出没见过的 key。
- 系统提示自动注入占位符说明，模型直接原样引用占位符即可，不会停下来追问密钥内容。
- `redact` 模式可切换为永久遮蔽（`<<REDACTED>>`，永不还原）。

安装方式同上（`add ./dsh-plugin-key-guard`）。详见 [dsh-plugin-key-guard/README.md](./dsh-plugin-key-guard/README.md)。

## 故障排查

dsh 插件出问题，先定位故障层，再对症：**解析层**（node_modules 里有没有/新不新）→ **组合层**（entry 树是否正确叠出）→ **加载层**（fiber 卡 PENDING/FAILED）→ **缓存层**（代码改了没生效）。`dsh --profile web --dump-config` 一条命令排掉前两层，值得作为第一反应。

| 症状 | 根因 | 修复 |
|---|---|---|
| 启动报 `Cannot find package '<旧包名>'` | profile `node_modules` 里是改名/重打包前的旧快照，其 `cordis.patch.yml` 仍按旧包名插 loader entry | 删 `node_modules/<scope>/` 后在 profile 重跑 `pnpm install`；根治见下条 |
| 改了代码重启也无效，或重装才能生效 | 用了 `file:` 安装（拷贝快照，不跟随源码） | 改用目录安装生成 `link:` 软链：`dsh plugin --profile web add <目录>` |
| 启动时报 bundle 解析失败（cannot resolve 一类错误） | bundle 声明了 `link:` 但目录不存在，或声明后没跑 install | 先建目录（含 `package.json` + `dsh.bundle` 声明）再 add；补跑 `pnpm install` |
| 插件装了但"什么都没发生" | fiber 停在 PENDING：`inject` 声明的服务无人提供 | 枚举 `ctx.registry` 查 fiber 状态，补齐服务提供方或去掉 inject |
| 代码改动只有部分生效（配置热了、代码没热） | web 端热重载只覆盖配置层（`cordis.patch.yml` 重组），代码受 ESM 模块缓存影响 | 属已知限制：热加载新装插件走 profile `cordis.patch.yml` 的 `insert`；改代码仍需重启 |

加新插件的最小闭环：**建目录 → `dsh plugin --profile web add <目录>` → `--dump-config` 体检 → 重启 `dsh web`**。

