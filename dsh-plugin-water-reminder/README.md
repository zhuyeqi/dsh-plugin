# dsh-plugin-water-reminder

喝水提醒插件（DeepSeek Harness Web UI 插件）。

## 功能

- **输入框下方常驻条**（`conversation.composer.dock`）：显示今日喝了几杯 / 目标杯数、进度条、下次提醒倒计时，并提供 `+一杯` 与 `暂停/继续` 按钮。
- **到点提醒卡片**（`shell.overlay`）：倒计时归零时右下角弹出，可 `喝好了 +1 / 5 分钟后再提醒 / 先关掉（10 分钟后）`。
- 页面处于后台标签时，若浏览器已授权通知，会额外发一条系统通知。
- 今日杯数、下次提醒时间、暂停状态存于 `localStorage`（键 `water-reminder.v1`），刷新后保留；杯数按日期分桶，跨天自动归零。

## 默认值

| 项 | 默认 | 位置 |
|---|---|---|
| 提醒间隔 | 45 分钟 | `client.js` 中 `DEFAULT_INTERVAL_MIN` |
| 每日目标 | 8 杯 | `client.js` 中 `DEFAULT_GOAL` |

界面文案通过 Client locale 服务注册（`locale/en.json`、`locale/zh.json` 提供插件元数据，界面字典在 `client.js` 的 `DICTS`）。

## 安装

```bash
# 目录形式安装 → link: 软链本仓库，改码重启即生效；勿用 file: 快照
dsh plugin --profile web add ./dsh-plugin-water-reminder
```

也可以在 Harness 里让 plugin manager 以 `install_bundle` 安装本包目录。

安装后 `~/.dsh/profiles/<profile>/package.json` 会增加
`"@zhuyeqi/dsh-plugin-water-reminder": "link:.../dsh-plugin-water-reminder"`，
并由 bundle 层插入下面这行（不需要手写进 profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: water-reminder
      name: '@zhuyeqi/dsh-plugin-water-reminder'
```

## 结构

```
package.json          # dsh.bundle.patch + dsh.client
cordis.patch.yml      # 插入 Host 行
index.js              # Host half（无逻辑，渲染全在 Client）
client.js             # Client half：状态、定时器、两个 Slot 组件、样式
locale/en.json        # 插件标题/描述（英文）
locale/zh.json        # 插件标题/描述（中文）
icon.svg              # 插件图标
```

## 卸载

用 Harness 的 plugin manager `remove_bundle`（target `@zhuyeqi/dsh-plugin-water-reminder`）移除，或：

```bash
dsh plugin --profile web remove @zhuyeqi/dsh-plugin-water-reminder
```

残留的 `localStorage` 状态键（`water-reminder.v1`）可手动清理。

