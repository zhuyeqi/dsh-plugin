# key-guard — 密钥不出本机 / keys never leave this machine

DeepSeek Harness 插件：在**每一次模型请求**发出前，自动检测上下文中的大模型/AI API
Key 并模糊替换为占位符 `<<DSHKEY#n>>`；模型返回中使用到该占位符时（正文、思考、工具
调用参数，即使被流式 delta 拆开），在本地自动还原为真实 Key。真实密钥永远不会到达
远端模型服务商。

## 对模型行为的影响与提示注入

v0.3.2 起，插件会在系统提示里注入一段简短说明：`<<DSHKEY#n>>` 形式的记号是本地
脱敏的密钥占位符，**直接原样引用即可，本地会在执行前还原为真实密钥**。模型因此
不会停下来追问 key 内容，也不会对占位符做无谓评论。示例编号刻意用非数字 `#n`，
永远不会被还原逻辑误匹配。

需要模型**审视 key 内容本身**的任务（识别服务商、验证格式）仍无法完成——这是
"key 不出本机"的固有代价，需要时临时关闭 `enabled` 即可。

## 工作原理

插件挂在 Host 的 `llm/stream` waterfall 上——它包裹本进程内**所有**模型调用（agent
步骤、子代理、压缩、标题生成、重试、重放），与具体 adapter 无关：

```
本地上下文（含真实 key）──mask──▶ 请求（占位符）──▶ 远端模型
本地工具执行（真实 key）◀──restore── 模型回复（占位符）◀── 远端模型
```

DSH 会 deep-freeze 每个模型请求，因此脱敏走两条路径：

1. **可变请求**：copy-on-write 原地替换 `messages` / `system`；
2. **冻结请求**（DSH 常态）：构建脱敏的解冻副本，经 `llm.stream()` **重入瀑布**——
   副本已无明文密钥，二次进入本插件时直接透传，其余中间件（重试/校验/路由）照常
   参与新流，无递归风险。

- **出站脱敏**：对话正文、历史消息、系统提示、工具结果中的密钥统一替换为
  `<<DSHKEY#n>>`（每个真实 key 拥有进程内稳定编号，多轮对话编号一致，不影响上下文
  缓存）。会话原始日志对象不会被改动。
- **入站还原**：模型回显的占位符（大小写不敏感）在流式 delta 与 block-end 两个层面
  都被还原，因此 UI 显示、会话日志、工具执行看到的都是可用的真实 key。
- **防探测**：只还原**本次请求出站时实际出现过的编号**。注入指令猜测 `<<DSHKEY#99>>`
  无法套取它从未见过的 key。
- **redact 模式**：配置 `mode: redact` 时替换为固定 `<<REDACTED>>` 且永不还原（硬隐私
  模式，工具将拿到占位符）。

## llm/stream 之外的出口（v0.4.0）

`llm/stream` 只覆盖**模型调用**。本机还有若干路径会把文本送到远端，且完全不经过这条
瀑布。实测确认的泄漏面与对应守卫：

| 出口 | 目的地 | 守卫 |
|---|---|---|
| 思维链翻译 `cotTranslation` | `edge.microsoft.com` / `translate.googleapis.com` | `installTranslatorGuard` |
| MCP（streamable-http / SDK） | `open.bigmodel.cn` 等 | 出口守卫 `globalThis.fetch` |
| OTLP 遥测导出 | `harness-telemetry.deepseeksvc.com` | 出口守卫 `node:http(s)` |
| `web_fetch` | 任意 URL（含环回/内网） | 工具 URL 守卫（拒绝） |

三个守卫都可从设置页热开关：`guardEgress`、`guardTranslator`、`guardToolUrls`。

**出口守卫**（`egress.js`）包裹 `globalThis.fetch` 与 `node:http`/`node:https`，对
**请求体与 URL** 做脱敏。要点：

- **不脱敏请求头**。`Authorization: Bearer <key>` 是所有服务商的鉴权方式，遮蔽它等于
  让每次调用失败，而不是保护它。
- **环回与内网地址始终豁免**。本地流程本就端到端携带真实密钥（设置页保存 key、本地
  API 网关），遮蔽只会打断它们而不产生安全收益。
- `syncBuiltinESMExports()` 是必需的：内置模块的 ESM 命名导出在首次求值时被快照，
  仅改 CommonJS 对象对 `import('node:http')` 的消费者不可见——而 OTLP 导出器恰好
  写的是 `const { request } = await import('http')`。

**思维链翻译守卫**（`boundaries.js`）包裹 `ctx.translator.translate`：出站前把
`spec.text` 中的密钥替换为占位符，译文返回后再本地还原，因此阅读面板仍显示真实值。
附带效果是 Session 日志里记录的 `plugin:translator/request` 也变成占位符。

**工具 URL 守卫**是唯一能做"拒绝"的地方，因为 `undici` 的 ESM 命名导出不可打补丁
（对命名空间 `defineProperty` 会抛错，`syncBuiltinESMExports` 只管 Node 内置模块），
而 `tools/pre-execute` 只能返回 allow/ask/deny、无法改写参数。范围刻意收窄：只检查
`url`/`uri`/`endpoint` 一类字段、只针对远端非豁免主机、只在命中检测器时拒绝。bash、
文件写入、本地端点均不受影响。

**已知残余风险**：`web_fetch` 发出的请求体（`POST` 场景）若无 URL 字段则不在守卫范围；
请求头中的密钥始终不脱敏。这两点是有意为之的取舍。

## 内置检测模式

OpenAI/DeepSeek 等 `sk-`、Anthropic `sk-ant-`、AWS `AKIA…`、Google `AIza…`、
GitHub `ghp_/github_pat_`、Slack `xox?`、GitLab `glpat-`、HuggingFace `hf_`、
Replicate `r8_`。均带长度/词边界约束，避免普通代码误伤。

## 配置（设置界面直接编辑，免重启）

**设置（Settings）→ 密钥守卫**：插件自带设置分区（v0.3.1+），装好后刷新一次页面即可看到：

- **脱敏模式**：下拉切换 `占位符（可还原）` / `永久遮蔽（不还原）`
- **自定义正则**：每行一条，如 `MyCorp-[A-Za-z0-9]{8,}`
- **精确密钥**：每行一条，保存后**不再回显**（只显示已配置条数）——secret 语义，界面永远不读回明文

所有字段免重启：保存 → `settings/document-updated` → host 检测器立即重建，key 编号
vault 保持稳定。也仍可通过 profile 用户层 YAML 覆盖（`- id: key-guard` + `config`），
两层叠加。

## 测试

```bash
node smoke.mjs   # 11 组用例：出站脱敏/拆分 delta 还原/工具参数/重试幂等/redact/防探测…
```

## 边界说明

- 密钥经 `bash`、`web_fetch` 等工具**主动**发往第三方属于用户本意，不在拦截范围；
  本插件保证的是"密钥不随模型请求离开本机"。
- `exactKeys` 以明文存于 profile 配置中；如需更安全的存储可后续接入 credentials。
