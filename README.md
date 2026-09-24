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

