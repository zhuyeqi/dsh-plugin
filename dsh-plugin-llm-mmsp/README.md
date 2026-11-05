# dsh-plugin-llm-mmsp

DeepSeek Harness 的 **MMSP(Model Message Stream Protocol)原生 LLM 适配器**插件。让 DSH 直接讲 MMSP 协议接入任意 MMSP 服务器 —— 不再需要 `mmsp-bridge` 这类本地 OpenAI 兼容代理。

```
DeepSeek Harness ──MMSP POST {base}/stream (SSE UniEvent)──▶ MMSP server(如 go.penguin.ooo)
```

## 为什么需要它

- MMSP 服务器线上只讲 MMSP:`POST {base}/stream` + SSE UniEvent 流、`GET {base}/models` 列模型,没有 `/v1/chat/completions`。
- DSH 的 LLM 服务(`ctx.llm`)只认 `LlmAdapter`;本插件实现了一个 MMSP `LlmAdapter` 并通过 `registerAdapter` 注册,于是 DSH 的会话、子代理、工具调用、thinking 全部原生跑在 MMSP 模型上。
- 有些 relay(如 go.penguin.ooo)虽然也挂了 OpenAI/Anthropic 兼容端点,但非 VIP key 只有 MMSP 通道放行 —— 之前只能靠 bridge 翻译,现在插件直连。

## 安装

在 DSH 里安装本 bundle(profile 级插件,重启后仍生效):插件管理器选择本目录(`dsh-plugin-llm-mmsp/`)执行本地目录安装,或调用 `install_bundle`。安装会**链接本目录**,所以改完源码要重新 `npm run bundle` 生成 `lib/` 后再次安装(模块生成需重启加载)。

安装后,`cordis.patch.yml` 里自带一条 `penguin-go` 路由的预配置(见下),可在模型设置页修改或删除。

## 配置

配置是 `providers` dict,key 就是 DSH 的 provider 路由名;字段(schema 同样在模型设置页可改):

| 字段 | 说明 |
|---|---|
| `baseURL` | MMSP 服务器 base,**以 `/stream` 之前结尾**,如 `https://go.penguin.ooo/api/v1`(SDK 语义,自动追加 `/stream`、`/models`) |
| `apiKeyEnv` | 凭据引用(环境变量名);经凭据服务解析,模型设置页可直接写入。缺省时回退读环境变量 `MMSP_API_KEY` |
| `displayName` | 选择器里显示的名字(默认路由名) |
| `models[]` | 预置模型清单:`id`(线上模型名)、`name`、`contextWindow`、`maxTokens`、`input`(`['text','image']`)、`thinkingLevels` |
| `defaultContextWindow` / `defaultInput` | 未在 `models` 里声明的模型的兜底容量 / 输入模态 |
| `thinkingLevel` | 本路由默认思考档位(`none…max`),映射 MMSP `config.thinking_level` |
| `replayThinking` | 是否把助手历史中的 thinking 回传为 `thinking.done`(默认 **关**:多数 relay/上游拒绝无签名思考回放) |
| `headers` | 额外请求头 |
| `streamIdleTimeoutMs` | 流式读空闲看门狗(默认 300000) |
| `retryPolicy` | 同 dsh-llm-retry 的策略 schema |

### 接入 go.penguin.ooo 的最短路径

1. 安装插件(自带 `penguin-go` 路由,`baseURL` 已指向 `https://go.penguin.ooo/api/v1`)。
2. 把 relay key 存为凭据 `MMSP_API_KEY`(模型设置页写入),或在 App 启动环境里 `export MMSP_API_KEY=…`。
3. 在会话的模型选择器里选 `Penguin Go (MMSP) / deepseek-flash` 即可。

自定义路由示例(等价 YAML,也可全在模型设置页操作):

```yaml
- id: llm-mmsp
  name: '@zhuyeqi/dsh-plugin-llm-mmsp'
  config:
    providers:
      penguin-go:
        displayName: Penguin Go (MMSP)
        baseURL: https://go.penguin.ooo/api/v1
        apiKeyEnv: MMSP_API_KEY
        models:
          - id: deepseek-flash
            name: DeepSeek Flash
            contextWindow: 131072
            maxTokens: 8192
          - id: deepseek-v4-pro
            name: DeepSeek V4 Pro
            contextWindow: 131072
            maxTokens: 16384
          - id: gemini-3.5-flash
            name: Gemini 3.5 Flash
            contextWindow: 1048576
            maxTokens: 65536
            input: [text, image]
```

`models` 留空时,模型设置页的"获取模型列表"会调用 `GET {base}/models` 发现模型。

## 协议映射要点(与 mmsp-bridge 实测行为对齐)

- **system/developer → `config.system_prompt`**(多段合并);`max_tokens`/`temperature`/`tools`/`thinking_level` 逐一映射。
- **工具结果回传**:role `tool` → `tool_result.done`(挂在 user 消息上,连续合并)。
- **工具调用 id**:不匹配保守格式(`[A-Za-z0-9_-]{8,128}`)的历史 id(跨 provider 会话、手写数据)会在单次请求内一致地重映射为 `call_<hex>`,上游网关的 id 校验不会再 400。
- **thinking**:流式输出 `thinking.delta/done` → DSH `reasoning` 块;历史回放默认丢弃(`replayThinking` 可开)。
- **finish_reason 纠偏**:上游在工具调用后报 `stop`(而非 MMSP 规范的 `tool_call`)时,纠正为 `tool-calls`,保证 agent 循环派发工具。
- **usage 语义**:`prompt_tokens`=未命中缓存输入,`cached_tokens` 单列;`output = thoughts + response`;`reasoningTokens` 取 `thoughts_tokens`。
- **错误分类**:401/403/`vip_required`→`AUTH`;429→`RATE_LIMIT`;404→`UNKNOWN_MODEL`;上下文超限/欠费措辞→`CONTEXT_WINDOW_EXCEEDED`/`QUOTA`;HTTP 状态与流内 `{"error": ...}`(含内嵌 `status`)统一归一。
- **keep-alive**:模型静默期服务器的 SSE 注释行会喂给空闲看门狗,长思考不会误超时。
- 每个请求都带 Harness 归因头(`User-Agent: deepseek-harness/…`)。

## 与 mmsp-bridge 的关系

bridge 里的翻译逻辑(OpenAI/Anthropic → MMSP)已按其实测行为移植进本插件;DSH 内接入后 **bridge 可以停用**。bridge 面向的是"只会讲 OpenAI 协议"的外部工具(ZCode/Cursor/Claude Code…),那仍是它的使用场景;DSH 不再需要它。

## 已知边界

- `stop` 序列:`GenerateOptions.stop` 无 MMSP 对应字段,显式传入会报 `UNSUPPORTED_OPTION`。
- 助手历史中的图片块按文本占位回传(仅 user 消息图片走 `inline_data.done`);MMSP 服务端托管的非 function 工具不适用(DSH 工具全是本地 function)。
- 模型容量(`contextWindow`/`maxTokens`)以配置为准,relay 的 `/models` 通常不带容量,预置清单是合理默认值,可随时改。

## 开发

profile bundle 以**链接目录**安装,ESM 从 checkout 真实路径解析,裸导入(`@deepseek-ai/*`)永远碰不到 harness 运行时 —— 所以依赖必须经 tsdown 打包进 `lib/index.js`(与 dsh-plugin-quote-cn 同一模式):

```bash
pnpm install          # 安装 tsdown 与 @deepseek-ai/* devDependencies(构建/测试用)
pnpm bundle           # rm -rf lib && tsdown → lib/index.js(自包含,无裸导入)
node test/run-tests.mjs
```

`node_modules/` 里的 `@deepseek-ai/*` 链接既可由 `pnpm install` 从 registry 解析,也可以手动指到 deepseek-harness 源码 checkout 的已构建包(`packages/llm/llm`、`packages/util/launch-environment` 等)做离线构建。`node_modules/` 已 gitignore,不参与安装。

测试覆盖:请求翻译(system 合并、工具 id 重映射、thinking 回放开关)、流式翻译(text/thinking/tool_call、stop 纠偏、usage 映射)、keep-alive、空响应/流中断/流内错误/HTTP 错误分类、调用方中止、模型元数据、discovery(预置清单直答 + 端点探测)。
