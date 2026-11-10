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

## 性能（v0.5.1）

每次模型调用都要过一遍本插件（含子代理、压缩、标题生成），所以热路径做了三层设计：

- **前缀预筛 + 预编译顺序检测器**：所有内置 key 都有特征前缀（`sk-`/`AKIA`/`AIza`/…）。
  一条廉价前缀正则先扫，未命中（绝大多数字符串）则完全跳过检测；命中后跑模块加载时
  就已预编译好的 10 条正则——不是每串重新编译 10 个正则。

  **不做融合**：v0.5.0 曾把 10 条模式合成一条 alternation 追求"单遍扫描"，这是一个
  安全回归，已在 v0.5.1 回退。融合把"逐模式改写"变成"按位置单遍扫描"：列表靠后的分支
  可能先吃掉靠前 token 的前缀，停在 `_` 处，使靠前分支的 `\b` 锚点再也无法匹配，密钥
  **后半段以明文出境**（`xoxb-…-ghp_…` 这类 `-` 紧邻形态会泄露 30+ 字节 key body）。
  实测融合不带来性能收益（暖路径 0.0115ms vs 顺序版 0.0113ms），故直接回退。
  测试 15 现以"全对偶语料"（每族 × 每族 × 每种分隔符）锁定该语义。

- **冻结消息 memoization**：DSH 对会话消息 deep-freeze 一次、之后按对象身份复用，
  因此按 `WeakMap<message>` 缓存脱敏结果，规则变更（epoch）整体失效。稳态下每请求
  只扫描**新增消息**，而非整个上下文——实测 300～1000 条消息的冻结上下文从
  1.5～2.2ms/请求降到 **0.01～0.04ms/请求**（实测约 75～80×），暖路径开销约
  **30ns/消息**。仅缓存"消息、content 数组、每个 block 都冻结"的对象，任何一层可变
  都永远现算（防陈旧漏检）；缓存值在发布前递归冻结，下游误写会抛错而不是静默污染缓存。

- **无密钥请求零重复扫描**：非冻结请求被 `maskRequest` 扫过且干净时直接放行，不再
  进入克隆路径二次全量扫描。

注册使用默认（非 prepend）顺序。v0.5.0 曾用 `prepend: true` 求"最外层"，但那是加载
竞态：`dsh-session-title` 同为 prepend，而 loader 并发创建 entry，谁在外层取决于模块
加载完成顺序；key-guard 抢到外层时，重入的 clone 不是 loop 标记请求、被 session-title
的 `isAgentLoopRequest` 守卫跳过，**掩码会话的标题记账会静默停摆**。而且 commit 声称的
收益（"标题记账原本跑两遍"）并不存在——同一守卫早已保证重入是 no-op。默认顺序下代价
只是 session checkpoint 每请求多 flush 一次（幂等落盘检查），已回退。

`guard.stats().perf` 暴露扫描数/预筛跳过数/缓存命中率/掩码与还原耗时，停机时汇总
打印一行。

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

**已知残余风险**：

- `web_fetch` 发出的请求体（`POST` 场景）若无 URL 字段则不在守卫范围；请求头中的密钥
  始终不脱敏。这两点是有意为之的取舍。
- `node:http` 出口只扫描 **string** chunk：Buffer/protobuf body（部分 OTLP 导出器）不在
  范围；单段 body 超过 1MiB 会告警一次后放行。
- 冻结请求的**重入**走 `llm.stream(clone)`，无法复用调用方的一次性 `preparedCall` 句柄
  （插件侧不可见）。因此每个掩码请求会多跑一次 adapter `prepareCall`，且绕开 DSH
  "prepared call 只派发一次 / HMR 不混用 adapter 注册"的约定。当前各 adapter 的
  `prepareCall` 都是进程内廉价操作，故风险为中低；彻底解决需要上游提供"派发前一次性
  替换 options、不重跑整条瀑布"的官方钩子。
- 设置页变更通知 `settings/document-updated` 的命名空间取自 loader entry id（默认就是
  `key-guard`）。若用户通过 profile patch 改了 entry id，检测规则的**热更新**不会触发
  （开关与出口豁免仍逐请求读取，立即生效）。

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
node smoke.mjs        # 20 组用例：出站脱敏/拆分 delta 还原/工具参数/重试幂等/redact/防探测/
                      # 预筛超集 + 全对偶顺序等价（1000 组配对）/冻结消息 memoization/
                      # 规则热更新失效/缓存值不可变/统计默认不泄露 key 片段/perf 计数…
node smoke-egress.mjs # 15 组用例：fetch/http 出口/豁免列表实时失效与碰撞/损坏配置 fail-closed/
                      # 翻译守卫/工具 URL 守卫
```

## 边界说明

- 密钥经 `bash`、`web_fetch` 等工具**主动**发往第三方属于用户本意，不在拦截范围；
  本插件保证的是"密钥不随模型请求离开本机"。
- `exactKeys` 以明文存于 profile 配置中；如需更安全的存储可后续接入 credentials。
