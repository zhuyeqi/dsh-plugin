# dsh-plugin-brand

可配置的 DeepSeek Harness 侧边栏品牌名插件。

## 功能

- **品牌名可配置**：侧边栏品牌行的文字不再写死，由 `brand` settings namespace 驱动，修改即时生效（`applies: live`），持久化在 `~/.dsh/settings.yaml`。
- **设置入口**：Settings → General 里新增「品牌名 Brand name」一行，输入后回车或点保存生效；被用户覆盖过时出现「重置」按钮。
- **三层配置**（低 → 高）：schema 默认值 `KK` → 组合层 `defaultName`（本包 cordis.patch.yml 的 `config:`，即部署默认）→ 用户设置层。重置即回到组合层默认。

## 结构

- Host（`src/index.ts`）：注册 `brand` settings namespace（schema + `base` 来自 row config）。
- Client（`src/client.ts`）：
  - `sidebar.brand.name` — 渲染当前品牌名（遮蔽官方字标，注册方式与官方 brand-official 插件一致）；
  - `settings.general.item` — General 设置页的编辑行，走 `ctx.settingsScope` 读写。

## 构建与安装

```bash
pnpm install && pnpm bundle   # 产出 lib/index.js + lib/client.js（ModuleLoader 工厂格式）
pnpm typecheck                # tsc --noEmit（strict，禁用 any）

# 装进 web profile（目录形式 → link: 软链本仓库，改码重启即生效）
dsh plugin --profile web add .
```

或手动 link：在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加
`"dsh-plugin-brand": "link:<本目录绝对路径>"`，并把 `dsh.profile.bundles` 加上
`"dsh-plugin-brand"`，然后在 profile 目录执行 `pnpm install`，重启 `dsh web`。

## 换默认名

编辑本目录 `cordis.patch.yml` 的 `defaultName` 后重启 DSH（只影响未在界面里覆盖过的用户）。
