/**
 * Browser half of the MMSP model adapter: the provider-card extension the
 * Models settings page dispatches for this adapter family's namespace
 * (`settings.models.provider-card`, keyed `entryKey = settingsNs`).
 *
 * The page's built-in editor ships curated layouts for `llm-deepseek` and
 * `llm-pi-ai` only; every other adapter family is addressed through this
 * keyed slot. The card below edits one MMSP route's profile and mirrors the
 * page's own editor STRUCTURE, not just its metrics: a write-only API key
 * with reveal and credential-state hints, the secondary fields folded into a
 * 自定义设置 disclosure, a model catalog whose rows collapse to id + display
 * name and disclose capacities (K/M spellings), input types, and per-model
 * thinking levels, catalog-wide fetch through a candidate picker that keeps
 * hand-tuned rows, and the shared 取消/保存 footer. Controls come from the
 * web module table's `@deepseek-ai/dsh-client-ui-primitives` (the same atoms
 * the page itself renders); the stylesheet mirrors the page's CSS module
 * values under `llmmspc-` names, since the page's own hashed classes cannot
 * be imported. Profile edits land as minimal `settings.mutate` path ops
 * against the stored section; a typed key stores through the credential seam
 * under the profile's named reference (deriving `<ROUTE>_API_KEY` when the
 * profile names none, matching the page's own rule). Model discovery
 * interrogates the endpoint through the same `llm/discoverModels` remote the
 * page's own editors use.
 *
 * Like every other provider row, the fields appear when the row's 编辑
 * button opens the page's editor; the page's own editor for this family is
 * the unknown-layout card (a hint plus a permanently disabled save), so this
 * component keeps a zero-visibility mount point alive inside the slot anchor
 * at all times, watches the row for that editor appearing, hides it, and
 * renders this family's real editor in its place until the edit closes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AnimatedRows, Checkbox, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconDragHandleOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular, Switch,
  useRowDragPreview,
} from '@deepseek-ai/dsh-client-ui-primitives'

const NS = 'llm-mmsp'

const ZH = {
  model: '模型',
  key: 'API 密钥',
  authHelp: '认证说明',
  keyHelp: '密钥保存在凭据存储中（引用 {ref}）；留空则继续使用已保存的密钥。留空且未保存时，回退读取启动环境变量。',
  keyPlaceholderSaved: '留空使用已保存凭据',
  keyPlaceholderFallback: '留空使用环境认证（{hint}）',
  keyFallbackMissing: '未检测到环境变量。请填写 API 密钥，或设置环境变量 {hint}。',
  keyFallbackUnchecked: '环境凭据状态尚未确认',
  keyReveal: '显示密钥',
  keyHide: '隐藏密钥',
  keyBlank: '请输入 API 密钥；留空则保持已存储的密钥。',
  keyIllegalCharacters: '该 API 密钥格式错误，请检查。',
  customized: '自定义设置',
  displayName: '显示名称',
  baseUrl: 'API 地址',
  baseUrlHint: 'MMSP Base URL：/stream 之前的部分，例如 https://go.penguin.ooo/api/v1',
  thinking: '默认思考档位',
  thinkingUnset: '未设置（跟随服务端默认）',
  replay: '回放思考内容',
  replayHelp: '开启后把模型的思考过程回放进上下文；多数中转会拒绝，保持关闭。',
  models: '模型目录',
  modelsInherited: '正在使用适配器默认模型',
  modelsCustomized: '已自定义模型目录',
  resetModels: '恢复默认模型',
  fetchModels: '获取可用模型',
  fetching: '正在询问服务端…',
  fetchNeedsBaseUrl: '请先填写 API 地址，再获取。',
  fetchTitle: '选择模型',
  fetchDescription: '以下是模型提供商的可用模型，勾选的模型即为模型列表。',
  fetchSearch: '搜索模型',
  fetchSelectAll: '全选',
  fetchDeselectAll: '取消全选',
  fetchAdopt: '更新列表',
  fetchKeepOne: '请至少保留一个勾选的模型。',
  fetchNoMatches: '没有匹配的模型。',
  fetchEmpty: '该提供商没有列出任何模型，请手动添加。',
  close: '关闭',
  cancel: '取消',
  apply: '保存',
  applying: '保存中…',
  addModel: '添加模型',
  modelsEmpty: '模型选择器中将不显示任何模型；可从服务端获取或手动添加。',
  modelId: '模型 ID',
  modelName: '显示名称',
  contextWindow: '上下文窗口',
  maxTokens: '最大输出 token 数',
  contextWindowPlaceholder: '使用提供商默认值',
  maxTokensPlaceholder: '例如 8192 或 64K',
  modelAdvanced: '模型选项',
  removeModel: '删除模型',
  reorderModel: '调整模型顺序',
  reorderModelHelp: '拖动排序，或使用上下方向键调整顺序。',
  modelInputTypes: '输入类型',
  modelInputText: '文本',
  modelInputImage: '图片',
  modelThinkingLevels: '思考档位',
  modelThinkingLevelsHelp: '未自定义时开放全部档位；勾选限定该模型在模型选择器中可用的档位。',
  modelIdRequired: '模型 ID 不能为空。',
  modelIdDuplicate: '模型 ID 不能重复。',
  modelNameInvalid: '显示名称不能为空。',
  modelContextInvalid: '上下文窗口必须是正数，例如 131072、256K 或 1M。',
  modelMaxTokensInvalid: '最大输出 token 数必须是正数，例如 8192、64K 或 1M。',
  modelThinkingLevelsInvalid: '思考档位至少保留一个，且必须是 MMSP thinking_level 值。',
  conflict: '这张卡片打开期间，这些设置已被其他地方改动。请关闭后重新打开，在当前值上编辑。',
  loadFailed: '设置加载失败',
}

const EN = {
  model: 'Model',
  key: 'API key',
  authHelp: 'Authentication help',
  keyHelp: 'The key is stored in the credential store under {ref}; leave blank to keep using the saved key. With nothing saved, the launch environment variable is the fallback.',
  keyPlaceholderSaved: 'Leave blank to use saved credentials',
  keyPlaceholderFallback: 'Leave blank to use env as auth ({hint})',
  keyFallbackMissing: 'No environment variable detected. Enter an API key, or set {hint}.',
  keyFallbackUnchecked: 'Environment credential status unconfirmed',
  keyReveal: 'Show key',
  keyHide: 'Hide key',
  keyBlank: 'Enter an API key; leave blank to keep the stored one.',
  keyIllegalCharacters: 'That API key is malformed; check and paste it again.',
  customized: 'Customized settings',
  displayName: 'Display name',
  baseUrl: 'Base URL',
  baseUrlHint: 'MMSP base URL: the part before /stream, e.g. https://go.penguin.ooo/api/v1',
  thinking: 'Default thinking level',
  thinkingUnset: 'Unset (server default)',
  replay: 'Replay thinking',
  replayHelp: 'Replays the model\'s reasoning into the context; most relays reject it, keep it off.',
  models: 'Models',
  modelsInherited: 'Using the adapter defaults',
  modelsCustomized: 'Customized model catalog',
  resetModels: 'Restore defaults',
  fetchModels: 'Fetch available models',
  fetching: 'Asking the provider…',
  fetchNeedsBaseUrl: 'Enter a base URL before fetching.',
  fetchTitle: 'Choose models',
  fetchDescription: 'These are the provider\'s available models; the checked ones become the model list.',
  fetchSearch: 'Search models',
  fetchSelectAll: 'Select all',
  fetchDeselectAll: 'Deselect all',
  fetchAdopt: 'Update list',
  fetchKeepOne: 'Keep at least one checked model.',
  fetchNoMatches: 'No matching models.',
  fetchEmpty: 'The provider lists no models; add them by hand.',
  close: 'Close',
  cancel: 'Cancel',
  apply: 'Save',
  applying: 'Saving…',
  addModel: 'Add model',
  modelsEmpty: 'No models will be shown in the selector. Fetch from the server or add them by hand.',
  modelId: 'Model ID',
  modelName: 'Display name',
  contextWindow: 'Context window',
  maxTokens: 'Max output tokens',
  contextWindowPlaceholder: 'Use provider default',
  maxTokensPlaceholder: 'e.g. 8192 or 64K',
  modelAdvanced: 'Model options',
  removeModel: 'Remove model',
  reorderModel: 'Reorder model',
  reorderModelHelp: 'Drag to reorder, or use the arrow keys.',
  modelInputTypes: 'Input types',
  modelInputText: 'Text',
  modelInputImage: 'Image',
  modelThinkingLevels: 'Thinking levels',
  modelThinkingLevelsHelp: 'All levels are offered until customized; checking limits the levels this model offers in the model picker.',
  modelIdRequired: 'Model ID is required.',
  modelIdDuplicate: 'Model IDs must be unique.',
  modelNameInvalid: 'Display name cannot be empty.',
  modelContextInvalid: 'Context window must be a positive number, e.g. 131072, 256K, or 1M.',
  modelMaxTokensInvalid: 'Max output tokens must be a positive number, e.g. 8192, 64K, or 1M.',
  modelThinkingLevelsInvalid: 'Keep at least one thinking level; values must be MMSP thinking_level names.',
  conflict: 'These settings changed elsewhere while this card was open. Close and reopen it to edit the current values.',
  loadFailed: 'Failed to load settings',
}

/**
 * One scoped stylesheet mirroring the Models page's own metrics, structure,
 * and theme aliases (dsh-client-ui-settings-models' ModelsSection.module.css
 * values); rendered with the card so it unmounts with it.
 */
const CARD_CSS = `
/* Hide the page's unknown-layout (disabled) editor only in rows that carry
 * this family's mount point: the row is identified by the slot anchor
 * actually containing this card's mount element, never by the anchor alone —
 * every row renders an empty anchor for unmatched dispatch keys. */
li:has(> div[data-slot="settings.models.provider-card"] > .llmmspc-mount) > div[class*="editor"] { display: none !important; }
li > div[class*="editor"]:has(~ div[data-slot="settings.models.provider-card"] > .llmmspc-mount) { display: none !important; }
/* Editing surface: a filled module on the panel, matching the page's .editor. */
.llmmspc-editor { border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-module-platform); padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.llmmspc-editorHeader { display: flex; align-items: baseline; gap: 8px; }
.llmmspc-editorTitle { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.llmmspc-editorRoute { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.llmmspc-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.llmmspc-fieldLabel { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.llmmspc-helpButton { width: 16px; height: 16px; padding: 0; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 50%; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 15px; text-align: center; cursor: help; }
.llmmspc-helpButton:focus-visible { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-tertiary); }
@media (hover: hover) { .llmmspc-helpButton:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-tertiary); } }
.llmmspc-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
select.llmmspc-input { max-width: 240px; cursor: pointer; }
.llmmspc-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.llmmspc-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.llmmspc-input:disabled { opacity: 0.6; cursor: default; }
.llmmspc-selectInput { appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; background-size: 12px 12px; }
.llmmspc-keyInput { position: relative; }
.llmmspc-keyInputFilled { padding-right: 40px; }
.llmmspc-keyToggle { position: absolute; inset: 1px 1px 1px auto; display: inline-flex; align-items: center; justify-content: center; width: 32px; padding: 0; border: none; border-radius: var(--dsw-radius-md); background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
@media (hover: hover) { .llmmspc-keyToggle:hover:not(:disabled) { color: var(--dsw-alias-label-primary); } }
.llmmspc-keyToggle:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.llmmspc-keyToggle:disabled { opacity: 0.6; cursor: default; }
.llmmspc-customized { border-top: 0.5px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.llmmspc-customizedSummary { display: flex; align-items: center; gap: 6px; width: fit-content; padding: 2px 4px; margin-left: -4px; border-radius: var(--dsw-radius-sm); cursor: pointer; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); list-style: none; }
.llmmspc-customizedSummary::-webkit-details-marker { display: none; }
.llmmspc-customizedSummary::before { content: ''; width: 5px; height: 5px; border-right: 1.5px solid currentcolor; border-bottom: 1.5px solid currentcolor; transform: rotate(-45deg) translate(-1px, -1px); transition: transform 120ms ease; }
.llmmspc-customized[open] > .llmmspc-customizedSummary::before { transform: rotate(45deg) translate(-1px, -1px); }
.llmmspc-customizedSummary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
@media (hover: hover) { .llmmspc-customizedSummary:hover { color: var(--dsw-alias-label-primary); } }
.llmmspc-customizedBody { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.llmmspc-modelCatalog { position: relative; display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.llmmspc-modelCatalogHeading { display: flex; flex-direction: column; gap: 2px; }
.llmmspc-modelCatalogTitle { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.llmmspc-modelCatalogMeta, .llmmspc-modelEmpty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.llmmspc-modelListHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.llmmspc-modelList { display: flex; flex-direction: column; gap: 8px; }
.llmmspc-modelEntry { container: llmmspc-model-row / inline-size; position: relative; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg); padding: 6px; }
.llmmspc-modelRow { display: grid; grid-template-columns: auto minmax(0, 1.4fr) minmax(0, 1fr) auto auto; align-items: center; gap: 6px; }
.llmmspc-modelName { grid-column: 3; grid-row: 1; }
.llmmspc-modelNameLabel { display: none; }
@container llmmspc-model-row (max-width: 440px) {
  .llmmspc-modelRow { grid-template-columns: auto minmax(0, 1fr) auto auto; }
  .llmmspc-modelRow .llmmspc-modelName { display: none; grid-column: 1 / -1; grid-row: 2; padding: 2px 4px 0; }
  .llmmspc-modelRow[data-expanded] .llmmspc-modelName { display: flex; }
  .llmmspc-modelNameLabel { display: block; }
}
.llmmspc-modelDragHandle:not(:disabled) { cursor: grab; }
.llmmspc-modelEntry[data-dragging] { opacity: 0.5; }
.llmmspc-modelEntry[data-drop-target] { z-index: 1; }
.llmmspc-modelDragPreview { background: var(--dsw-alias-bg-module-platform); }
.llmmspc-modelEntry::before, .llmmspc-modelEntry::after { content: ''; position: absolute; z-index: 1; left: 0; right: 0; height: 4px; }
.llmmspc-modelEntry::before { top: -4px; }
.llmmspc-modelEntry::after { bottom: -4px; }
.llmmspc-modelEntry[data-drop-target='before']::before, .llmmspc-modelEntry[data-drop-target='after']::after {
  height: 12px;
  background:
    linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat,
    linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat,
    linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;
}
.llmmspc-modelEntry[data-drop-target='before']::before { top: -10px; }
.llmmspc-modelEntry[data-drop-target='after']::after { bottom: -10px; }
.llmmspc-iconButton { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
@media (hover: hover) { .llmmspc-iconButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
.llmmspc-iconButton:disabled { cursor: default; opacity: 0.4; }
@media (hover: hover) { .llmmspc-iconButtonDanger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); } }
.llmmspc-modelAdvanced { display: grid; grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 2px 4px; }
.llmmspc-modelField { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
.llmmspc-modelFieldLabel { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.llmmspc-modelInputTypes { grid-column: 1 / -1; min-width: 0; margin: 0; padding: 0; border: none; }
.llmmspc-modelInputTypes legend { padding: 0; margin-bottom: 4px; }
.llmmspc-modelInputChoices { display: flex; flex-wrap: wrap; gap: 16px; min-height: 32px; align-items: center; }
.llmmspc-modelEmpty { padding: 12px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg); text-align: center; }
.llmmspc-addModelButton { box-sizing: border-box; align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
@media (hover: hover) { .llmmspc-addModelButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); } }
.llmmspc-linkButton { box-sizing: border-box; display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
@media (hover: hover) { .llmmspc-linkButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); } }
.llmmspc-advancedHint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.llmmspc-notice { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-label); }
.llmmspc-savedNotice { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
.llmmspc-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.llmmspc-editorActions { display: flex; justify-content: flex-end; gap: 8px; }
.llmmspc-secondaryButton, .llmmspc-primaryButton { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.llmmspc-primaryButton { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
@media (hover: hover) { .llmmspc-primaryButton:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); } }
.llmmspc-secondaryButton { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }
@media (hover: hover) { .llmmspc-secondaryButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); } }
.llmmspc-secondaryButton:disabled, .llmmspc-primaryButton:disabled, .llmmspc-linkButton:disabled, .llmmspc-addModelButton:disabled { opacity: 0.4; cursor: default; }
.llmmspc-secondaryButton:focus-visible, .llmmspc-primaryButton:focus-visible, .llmmspc-linkButton:focus-visible, .llmmspc-addModelButton:focus-visible, .llmmspc-iconButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
/* Native <dialog> picker: showModal() supplies the top layer and backdrop. */
.llmmspc-dialog { width: min(520px, calc(100vw - 32px)); border: none; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); padding: 0; }
.llmmspc-dialog::backdrop { background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #000) 60%, transparent); }
.llmmspc-dialogBody { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.llmmspc-dialogHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.llmmspc-dialogTitle { font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.llmmspc-dialogDescription { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.llmmspc-candidateToolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.llmmspc-candidateSearch { min-width: 0; flex: 1 1 240px; }
.llmmspc-candidateList { display: flex; flex-direction: column; gap: 2px; max-height: 320px; margin: 0; overflow-y: auto; padding: 0; list-style: none; }
.llmmspc-candidate { border-radius: var(--dsw-radius-md); }
.llmmspc-candidateLabel { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; }
.llmmspc-candidateId { flex: 1 1 auto; min-width: 0; font-family: var(--ds-font-family-code); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.llmmspc-candidateEmpty { margin: 24px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; text-align: center; }
@media (prefers-reduced-motion: reduce) { .llmmspc-customizedSummary::before { transition: none; } }
`

/** Conventional credential reference for a route without a named one. */
function deriveKeyRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** Fields this card manages; everything else in the profile is never touched. */
const MANAGED_KEYS = ['displayName', 'baseURL', 'thinkingLevel', 'replayThinking']

const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']

/* Capacity spellings: a decimal count with an optional K/M suffix, shared
 * with the page's own catalog editors so both surfaces read and write one
 * K/M vocabulary (256K, 1M). Stored values stay plain token counts. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 }

function parseCapacity(text) {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

function formatCapacity(value) {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/* Twin of the page's apiKey judgment: printable ASCII without space, with a
 * wrapped `NAME=value` environment line and quoted pastes reading as
 * malformed rather than as a key. */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

function isQuoted(value) {
  const first = value[0]
  if (first !== '"' && first !== '\'' && first !== '`') return false
  return value.length > 1 && value.endsWith(first)
}

function apiKeyFailure(draft) {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value) || isQuoted(value)) return 'keyIllegalCharacters'
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}

/** First invalid row of a drafted catalog, or undefined when acceptable. */
function validateModels(rows) {
  const seen = new Set()
  for (const [index, row] of rows.entries()) {
    const id = typeof row.id === 'string' ? row.id.trim() : undefined
    if (id === undefined || id.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(id)) return { index, key: 'modelIdDuplicate' }
    seen.add(id)
    if (row.name !== undefined && (typeof row.name !== 'string' || row.name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    for (const [field, key] of [['contextWindow', 'modelContextInvalid'], ['maxTokens', 'modelMaxTokensInvalid']]) {
      const value = row[field]
      if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
        return { index, key }
      }
    }
    if (row.thinkingLevels !== undefined) {
      const ok = Array.isArray(row.thinkingLevels) && row.thinkingLevels.length > 0
        && row.thinkingLevels.every(level => THINKING_LEVELS.includes(level))
      if (!ok) return { index, key: 'modelThinkingLevelsInvalid' }
    }
  }
  return undefined
}

/** Read a path inside a settings layer; undefined when any hop is absent. */
function walkLayer(node, path) {
  let current = node
  for (const key of path) {
    current = current !== null && typeof current === 'object' ? current[key] : undefined
  }
  return current
}

const userAt = (view, path) => walkLayer(view?.user, path)
const baseAt = (view, path) => walkLayer(view?.base, path)

/** Catalog rows as plain editable copies (non-object entries drop to {}). */
function rowsOf(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(row => row !== null && typeof row === 'object')
    .map(row => ({ ...row }))
}

/**
 * Local model-row identities, disclosures, capacity text, and draft ordering
 * — the page's useModelRows contract, so editing a model ID never replaces
 * its controls and reorder state survives a row's own edits.
 */
function useModelRows(models, disabled) {
  const nextKey = useRef(0)
  const [stored, setRows] = useState(() => models.map(() => createRow(nextKey.current++)))
  const [dragged, setDragged] = useState(undefined)
  const [target, setTarget] = useState(undefined)

  function createRow(key) {
    return { key, expanded: false, editing: new Map() }
  }

  const entries = models.map((model, index) => ({ model, state: stored[index] ?? createRow(nextKey.current++) }))
  const rows = entries.map(entry => entry.state)
  if (stored.length !== models.length) setRows(rows)

  const endDrag = () => { setDragged(undefined); setTarget(undefined) }
  const move = (from, to) => {
    if (disabled || from === to || from < 0 || to < 0 || to >= models.length) return false
    const order = [...entries]
    const moved = order.splice(from, 1)
    order.splice(to, 0, ...moved)
    setRows(order.map(entry => entry.state))
    return { from, to, order: order.map(entry => entry.model) }
  }

  return {
    rows: entries.map(({ model, state }, index) => ({
      ...state,
      model,
      order: {
        dragging: dragged === state.key,
        target: target?.key === state.key ? target.half : undefined,
        canDrop: !disabled && dragged !== undefined,
        onStart: () => { setDragged(state.key) },
        onEnd: endDrag,
        onOver: (half) => {
          setTarget(current => current?.key === state.key && current.half === half ? current : { key: state.key, half })
        },
        onLeave: () => { setTarget(current => current?.key === state.key ? undefined : current) },
        onDrop: (half, onReorder) => {
          const from = rows.findIndex(row => row.key === dragged)
          const insertion = index + (half === 'after' ? 1 : 0)
          const result = move(from, insertion > from ? insertion - 1 : insertion)
          endDrag()
          if (result !== false) onReorder(result.order)
        },
        onMove: (offset, onReorder) => {
          const result = move(index, index + offset)
          if (result !== false) onReorder(result.order)
        },
      },
    })),
    toggle: (index) => {
      setRows(rows.map((row, at) => at === index ? { ...row, expanded: !row.expanded } : row))
    },
    edit: (index, field, text) => {
      setRows(rows.map((row, at) => {
        if (at !== index) return row
        const editing = new Map(row.editing)
        if (text === undefined) editing.delete(field)
        else editing.set(field, text)
        return { ...row, editing }
      }))
    },
    forget: (removed) => {
      setRows(rows.filter((_row, index) => !removed.has(index)))
      endDrag()
    },
    reset: () => { setRows(models.map(() => createRow(nextKey.current++))); endDrag() },
  }
}

const EYE_CONTOUR = 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z'
const EYE_PATH = `${EYE_CONTOUR}M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z`
const EYE_OFF_PATH = `${EYE_CONTOUR}M2.5 2.5L13.5 13.5`

/** Input-type declarations for one row, displaying inherited types first. */
function ModelInputTypes({ model, position, disabled, fallback, t, onChange }) {
  const selected = Array.isArray(model.input) && model.input.length > 0 ? model.input : fallback ?? ['text']
  return (
    <fieldset className="llmmspc-modelInputTypes" aria-label={`${t('modelInputTypes')} ${String(position)}`}>
      <legend className="llmmspc-modelFieldLabel">{t('modelInputTypes')}</legend>
      <div className="llmmspc-modelInputChoices">
        {(['text', 'image']).map((modality) => (
          <Checkbox
            key={modality}
            label={t(modality === 'text' ? 'modelInputText' : 'modelInputImage')}
            checked={selected.includes(modality)}
            disabled={disabled || (selected.length === 1 && selected.includes(modality))}
            onChange={(checked) => {
              const nextSelected = (['text', 'image']).filter(value => value === modality ? checked : selected.includes(value))
              onChange({ ...model, input: nextSelected })
            }}
          />
        ))}
      </div>
    </fieldset>
  )
}

/** Per-model thinking levels; the adapter offers all six until customized. */
function ModelThinkingLevels({ model, position, disabled, t, onChange }) {
  const selected = Array.isArray(model.thinkingLevels) && model.thinkingLevels.length > 0 ? model.thinkingLevels : THINKING_LEVELS
  return (
    <fieldset className="llmmspc-modelInputTypes" aria-label={`${t('modelThinkingLevels')} ${String(position)}`}>
      <legend className="llmmspc-modelFieldLabel">
        <span className="llmmspc-fieldLabel" style={{ gap: 6 }}>
          {t('modelThinkingLevels')}
          <button type="button" className="llmmspc-helpButton" aria-label={t('modelThinkingLevelsHelp')} title={t('modelThinkingLevelsHelp')}>?</button>
        </span>
      </legend>
      <div className="llmmspc-modelInputChoices">
        {THINKING_LEVELS.map((level) => (
          <Checkbox
            key={level}
            label={level}
            checked={selected.includes(level)}
            disabled={disabled || (selected.length === 1 && selected.includes(level))}
            onChange={(checked) => {
              const nextSelected = THINKING_LEVELS.filter(value => value === level ? checked : selected.includes(value))
              onChange({ ...model, thinkingLevels: nextSelected })
            }}
          />
        ))}
      </div>
    </fieldset>
  )
}

/** One catalog row: collapsed to id + name, advanced fields disclosed. */
function ModelRowEditor({
  rowKey, order, model, position, expanded, disabled, t,
  capacities, inputFallback, onFieldChange, onIdBlur, onChange, onToggle, onRemove, onReorder,
}) {
  const preview = useRowDragPreview('llmmspc-modelDragPreview')
  const modelField = (field) => (
    <label className={`llmmspc-modelField ${field === 'name' ? 'llmmspc-modelName' : ''}`}>
      {field === 'name'
        ? <span className={`llmmspc-modelFieldLabel llmmspc-modelNameLabel`}>{t('modelName')}</span>
        : null}
      <input
        className="llmmspc-input"
        type="text"
        value={typeof model[field] === 'string' ? model[field] : ''}
        placeholder={t(field === 'id' ? 'modelId' : 'modelName')}
        aria-label={`${t(field === 'id' ? 'modelId' : 'modelName')} ${String(position)}`}
        disabled={disabled}
        onFocus={field === 'name' && !expanded ? onToggle : undefined}
        onChange={(event) => {
          const value = event.target.value
          onFieldChange(field, field === 'name' && value === '' ? undefined : value)
        }}
        onBlur={field === 'id' ? event => onIdBlur(event.target.value) : undefined}
      />
    </label>
  )
  const rowHalf = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  return (
    <div
      className="llmmspc-modelEntry"
      data-row-key={rowKey}
      data-dragging={order.dragging || undefined}
      data-drop-target={order.dragging ? undefined : order.target}
      onDragOver={(event) => {
        if (!order.canDrop) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        order.onOver(rowHalf(event))
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        order.onLeave()
      }}
      onDrop={(event) => {
        if (!order.canDrop) return
        event.preventDefault()
        order.onDrop(rowHalf(event), onReorder)
      }}
    >
      <div className="llmmspc-modelRow" data-expanded={expanded || undefined}>
        <button
          type="button"
          className="llmmspc-iconButton llmmspc-modelDragHandle"
          aria-label={`${t('reorderModel')} ${String(position)}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          title={t('reorderModelHelp')}
          disabled={disabled}
          draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('application/x-dsh-model-order', String(position))
              order.onStart()
              preview.start(event, event.currentTarget.closest('[data-row-key]'))
            }}
            onDragEnd={() => { if (preview.clear()) order.onEnd() }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              event.stopPropagation()
              order.onMove(event.key === 'ArrowUp' ? -1 : 1, onReorder)
            }}
          >
            <IconDragHandleOutlineRegular size={14} />
          </button>
        {modelField('id')}
        <button
          type="button"
          className="llmmspc-iconButton"
          aria-label={`${t('modelAdvanced')} ${String(position)}`}
          aria-expanded={expanded}
          title={t('modelAdvanced')}
          onClick={(event) => { event.currentTarget.focus(); onToggle() }}
        >
          {expanded ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
        </button>
        <button
          type="button"
          className="llmmspc-iconButton llmmspc-iconButtonDanger"
          aria-label={`${t('removeModel')} ${String(position)}`}
          title={t('removeModel')}
          disabled={disabled}
          onClick={onRemove}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
        {modelField('name')}
        {expanded
          ? (
            <div className="llmmspc-modelAdvanced">
              {(['contextWindow', 'maxTokens']).map((field) => (
                <label className="llmmspc-modelField" key={field}>
                  <span className="llmmspc-modelFieldLabel">{t(field)}</span>
                  <input
                    className="llmmspc-input"
                    type="text"
                    inputMode="numeric"
                    value={capacities[field].value}
                    placeholder={capacities[field].placeholder}
                    aria-label={`${t(field)} ${String(position)}`}
                    disabled={disabled}
                    onChange={(event) => { capacities[field].onChange(event.target.value) }}
                    onBlur={capacities[field].onBlur}
                  />
                </label>
              ))}
              <ModelInputTypes
                model={model} position={position} disabled={disabled}
                fallback={inputFallback} t={t} onChange={onChange}
              />
              <ModelThinkingLevels
                model={model} position={position} disabled={disabled} t={t} onChange={onChange}
              />
            </div>
          )
          : null}
      </div>
    </div>
  )
}

/**
 * The Models-page card for one MMSP route: the family's real editor, shown
 * while the page's 编辑 is open (the host editor is hidden by the observer).
 */
function MmspEditor({ provider: entry, keyConfigured, t, operations }) {
  const route = entry.provider
  const settingsPath = useMemo(() => [...entry.settingsPath], [entry.settingsPath])
  const [view, setView] = useState(undefined)
  const [loadError, setLoadError] = useState(undefined)
  const [draft, setDraft] = useState(undefined)
  const [rowNonce, setRowNonce] = useState(0)
  const [dirty, setDirty] = useState(() => new Set())
  const [keyDraft, setKeyDraft] = useState('')
  const [keyRevealed, setKeyRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [failure, setFailure] = useState(undefined)
  const [candidates, setCandidates] = useState(undefined)
  const [flipped, setFlipped] = useState(() => new Set())
  const [candidateQuery, setCandidateQuery] = useState('')

  const rowState = useModelRows(draft?.models ?? [], false)

  const readView = async () => {
    const response = await operations.describeSettings()
    if (!response.ok) { setLoadError(response.error.message); return }
    const next = response.value.namespaces.find(entry => entry.ns === NS)
    if (next === undefined) { setLoadError(`settings namespace "${NS}" is not mounted`); return }
    const profileUser = userAt(next, settingsPath) ?? {}
    const profileBase = baseAt(next, settingsPath) ?? {}
    const overridden = profileUser.models !== undefined
    const inherited = rowsOf(profileBase.models)
    const textOf = (value) => typeof value === 'string' && value.length > 0 ? value : undefined
    setLoadError(undefined)
    setView(next)
    setDraft({
      displayName: textOf(profileUser.displayName),
      baseURL: textOf(profileUser.baseURL),
      thinkingLevel: textOf(profileUser.thinkingLevel),
      replayThinking: profileUser.replayThinking === true,
      modelsOverridden: overridden,
      models: overridden ? rowsOf(profileUser.models) : inherited,
      inheritedModels: inherited,
    })
    setDirty(new Set())
    setKeyDraft('')
    setKeyRevealed(false)
    setRowNonce(current => current + 1)
  }

  useEffect(() => { void readView() }, [route])

  // Fresh row identities on every (re)load so disclosures and typing state
  // never outlive the draft they belonged to.
  useEffect(() => { rowState.reset() }, [rowNonce])

  const disabled = busy || view === undefined || draft === undefined
  const listDisabled = disabled || listBusy

  const markModelsDirty = () => {
    setDirty(current => new Set(current).add('models'))
  }

  const setField = (key, value) => {
    setDraft(current => ({ ...current, [key]: value }))
    setDirty(current => new Set(current).add(key))
  }

  const stringAt = (value) => typeof value === 'string' && value.trim().length > 0 ? value : undefined
  const setTextField = (key, next) => {
    setField(key, next === undefined || next.trim().length === 0 ? undefined : next)
  }

  const setModels = (next, overridden = true) => {
    setDraft(current => ({ ...current, models: next, modelsOverridden: overridden ? true : current.modelsOverridden }))
    markModelsDirty()
  }

  const reorderModels = (next) => { setModels(next) }

  const patchRow = (index, next) => {
    setDraft((current) => {
      const models = current.models.map((model, at) => {
        if (at !== index) return model
        const cleared = new Set(
          Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
        )
        return Object.fromEntries(
          Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
        )
      })
      return { ...current, models, modelsOverridden: true }
    })
    markModelsDirty()
  }

  const changeRow = (index, nextRow) => {
    setDraft(current => ({
      ...current,
      models: current.models.map((model, at) => at === index ? nextRow : model),
      modelsOverridden: true,
    }))
    markModelsDirty()
  }

  const removeRow = (index) => {
    rowState.forget(new Set([index]))
    setDraft(current => ({
      ...current,
      models: current.models.filter((_model, at) => at !== index),
      modelsOverridden: true,
    }))
    markModelsDirty()
  }

  const addRow = () => {
    setDraft(current => ({ ...current, models: [...current.models, { id: '' }], modelsOverridden: true }))
    markModelsDirty()
  }

  const resetModels = () => {
    rowState.reset()
    setDraft(current => ({ ...current, models: current.inheritedModels, modelsOverridden: false }))
    markModelsDirty()
  }

  const keyValue = keyDraft.trim()
  const keyFailure = apiKeyFailure(keyDraft)

  const effectiveProfile = draft === undefined || view === undefined
    ? {}
    : (baseAt(view, settingsPath) ?? {})
  const namedRef = stringAt(draft?.apiKeyEnv) ?? stringAt(effectiveProfile.apiKeyEnv)
  const ambientRefs = (entry.nativeAuth?.env ?? []).filter(ref => !ref.toLowerCase().includes('oauth'))
  const keyHint = namedRef ?? ambientRefs[0]
  const keyRef = namedRef ?? deriveKeyRef(route)
  const savedCredential = keyConfigured === true
  const keyPlaceholder = keyHint === undefined
    ? t('keyPlaceholderSaved')
    : savedCredential ? t('keyPlaceholderSaved') : t('keyPlaceholderFallback').replace('{hint}', () => keyHint)
  const credentialHint = keyDraft.length > 0 || keyHint === undefined
    ? undefined
    : namedRef !== undefined
      ? savedCredential ? undefined : { text: t('keyFallbackMissing').replace('{hint}', () => namedRef), tone: 'notice' }
      : { text: t('keyFallbackUnchecked'), tone: 'advanced' }
  const shownKeyFailure = keyFailure

  const modelFailure = draft === undefined ? undefined : validateModels(draft.models)

  // Capacities: the live keystrokes win, then the stored count spelled short.
  const capacityText = (model, index, field) => {
    const typed = rowState.rows[index]?.editing.get(field)
    if (typed !== undefined) return typed
    const value = model[field]
    return typeof value === 'number' ? formatCapacity(value) : ''
  }
  const settleCapacity = (index, field) => {
    const typed = rowState.rows[index]?.editing.get(field)
    if (typed === undefined) return
    const parsed = parseCapacity(typed)
    if (parsed !== undefined && Number.isNaN(parsed)) return
    rowState.edit(index, field, undefined)
  }
  const editCapacity = (index, field, text) => {
    rowState.edit(index, field, text)
    patchRow(index, { [field]: parseCapacity(text) })
  }
  const contextWindowDefault = typeof effectiveProfile.defaultContextWindow === 'number'
    ? effectiveProfile.defaultContextWindow
    : undefined
  const capacityInputs = (model, index) => ({
    contextWindow: {
      value: capacityText(model, index, 'contextWindow'),
      placeholder: contextWindowDefault === undefined ? t('contextWindowPlaceholder') : formatCapacity(contextWindowDefault),
      onChange: (text) => { editCapacity(index, 'contextWindow', text) },
      onBlur: () => { settleCapacity(index, 'contextWindow') },
    },
    maxTokens: {
      value: capacityText(model, index, 'maxTokens'),
      placeholder: t('maxTokensPlaceholder'),
      onChange: (text) => { editCapacity(index, 'maxTokens', text) },
      onBlur: () => { settleCapacity(index, 'maxTokens') },
    },
  })

  // The write: minimal path ops against the STORED user section, naming only
  // the fields this card can see. The key travels after the profile write.
  const applyOnce = async () => {
    if (view === undefined || draft === undefined) return t('loadFailed')
    const committedUser = userAt(view, settingsPath) ?? {}
    const ops = []
    if (dirty.has('models')) {
      if (draft.modelsOverridden) {
        const after = draft.models.map((row) => {
          const next = { id: typeof row.id === 'string' ? row.id.trim() : '' }
          if (typeof row.name === 'string' && row.name !== '') next.name = row.name
          if (typeof row.contextWindow === 'number') next.contextWindow = row.contextWindow
          if (typeof row.maxTokens === 'number') next.maxTokens = row.maxTokens
          if (Array.isArray(row.input)) next.input = [...row.input]
          if (Array.isArray(row.thinkingLevels)) next.thinkingLevels = [...row.thinkingLevels]
          return next
        })
        if (JSON.stringify(committedUser.models) !== JSON.stringify(after)) {
          ops.push({ op: 'set', path: [...settingsPath, 'models'], value: after })
        }
      } else if (committedUser.models !== undefined) {
        ops.push({ op: 'unset', path: [...settingsPath, 'models'] })
      }
    }
    for (const key of MANAGED_KEYS) {
      if (!dirty.has(key)) continue
      const after = draft[key]
      const clears = after === undefined || (key === 'replayThinking' && after === false)
      const storedValue = clears ? undefined : after
      if (JSON.stringify(committedUser[key]) === JSON.stringify(storedValue)) continue
      if (clears) {
        if (committedUser[key] !== undefined) ops.push({ op: 'unset', path: [...settingsPath, key] })
      } else {
        ops.push({ op: 'set', path: [...settingsPath, key], value: after })
      }
    }
    // Storing a key for a profile that names no reference materializes the
    // conventional one, exactly as the page's own pi-ai editor does.
    if (keyValue.length > 0 && namedRef === undefined && !dirty.has('apiKeyEnv')
      && committedUser.apiKeyEnv === undefined && effectiveProfile.apiKeyEnv === undefined) {
      ops.push({ op: 'set', path: [...settingsPath, 'apiKeyEnv'], value: keyRef })
    }
    if (ops.length > 0) {
      const written = await operations.writeSettings(NS, ops, view.revision)
      if (!written.ok) {
        if (written.error.code === 'settings/conflict') await readView()
        return written.error.code === 'settings/conflict' ? t('conflict') : written.error.message
      }
      setView(written.value)
    }
    if (keyValue.length > 0) {
      const stored = await operations.storeCredential(keyRef, keyValue)
      if (stored !== undefined) return stored
    }
    setKeyDraft('')
    setDirty(new Set())
    return undefined
  }

  const apply = async () => {
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await applyOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      closeHostEditor()
    } finally {
      setBusy(false)
    }
  }

  // After this card saves or cancels, close the page's hidden editor through
  // its own cancel button so the row's 编辑 toggle state stays consistent.
  // DOM contract (see MmspProviderCard): this editor's root sits inside the
  // mount point, which sits inside the slot anchor, whose parent is the row.
  const closeHostEditor = () => {
    let node = rootAnchorRef.current
    let row
    for (let depth = 0; node !== undefined && node !== null && depth < 4; depth += 1) {
      const parent = node.parentElement
      if (parent === null) return false
      if (typeof parent.getAttribute === 'function' && parent.getAttribute('data-slot') === 'settings.models.provider-card') {
        row = parent.parentElement
        break
      }
      node = parent
    }
    if (row === undefined || row === null) return false
    for (const child of row.children) {
      if (child.tagName !== 'DIV') continue
      if (typeof child.getAttribute === 'function' && child.getAttribute('data-slot') !== null) continue
      if (!(typeof child.className === 'string' && /editor/i.test(child.className))) continue
      for (const button of child.querySelectorAll('button')) {
        const label = (button.textContent ?? '').trim()
        if (label === '取消' || label === 'Cancel') {
          button.click()
          return true
        }
      }
      return child.querySelector('button')?.click() === true
    }
    return false
  }

  // Discovery asks about the endpoint the form currently shows, including a
  // key typed but not yet stored — the page's own probe semantics.
  const probeBaseURL = stringAt(draft?.baseURL) ?? stringAt(effectiveProfile.baseURL)
  const askable = probeBaseURL !== undefined
  const fetchModels = async () => {
    if (listBusy || shownKeyFailure !== undefined) return
    setListBusy(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(NS, {
        provider: route,
        ...(probeBaseURL === undefined ? {} : { baseURL: probeBaseURL }),
        ...(keyValue.length === 0 ? {} : { apiKey: keyValue }),
      })
      if (!answer.ok) { setFailure(answer.error.message); return }
      const found = answer.value
      if (found.length === 0) { setFailure(t('fetchEmpty')); return }
      setCandidateQuery('')
      setFlipped(new Set())
      setCandidates([...new Map(found.map(model => [model.id, model])).values()])
    } finally {
      setListBusy(false)
    }
  }

  // The picker opens on the current list: configured rows start checked, and
  // a listing with nothing configured yet checks every candidate.
  const activeCandidates = candidates ?? []
  const configuredIds = new Set((draft?.models ?? []).map(model => typeof model.id === 'string' ? model.id : '').filter(id => id.length > 0))
  const pickedByDefault = (id) => configuredIds.size === 0 || configuredIds.has(id)
  const isPicked = (id) => pickedByDefault(id) !== flipped.has(id)
  const listed = new Set(activeCandidates.map(candidate => candidate.id))
  const removedRows = new Set()
  ;(draft?.models ?? []).forEach((model, at) => {
    const id = typeof model.id === 'string' ? model.id : ''
    if (listed.has(id) && !isPicked(id)) removedRows.add(at)
  })
  const keptRows = (draft?.models ?? []).filter((_model, at) => !removedRows.has(at))
  const keptIds = new Set(keptRows.map(model => typeof model.id === 'string' ? model.id : ''))
  const adopt = (candidate) => ({
    id: candidate.id,
    ...(candidate.name === undefined ? {} : { name: candidate.name }),
    ...(candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow }),
    ...(candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens }),
    ...(candidate.inputModalities === undefined ? {} : { input: [...candidate.inputModalities] }),
  })
  const addedRows = activeCandidates
    .filter(candidate => isPicked(candidate.id) && !keptIds.has(candidate.id))
    .map(adopt)
  const emptiesList = (draft?.models ?? []).length > 0 && keptRows.length === 0 && addedRows.length === 0
  const adoptPicked = () => {
    rowState.forget(removedRows)
    setModels([...keptRows, ...addedRows])
    closePicker()
  }
  const closePicker = () => {
    setCandidates(undefined)
    setFlipped(new Set())
    setCandidateQuery('')
  }
  const normalizedQuery = candidateQuery.trim().toLowerCase()
  const visibleCandidates = normalizedQuery.length === 0
    ? activeCandidates
    : activeCandidates.filter(candidate => candidate.id.toLowerCase().includes(normalizedQuery)
      || candidate.name?.toLowerCase().includes(normalizedQuery) === true)
  const allVisiblePicked = visibleCandidates.length > 0 && visibleCandidates.every(candidate => isPicked(candidate.id))
  const toggleVisibleCandidates = () => {
    const target = !allVisiblePicked
    setFlipped((current) => {
      const next = new Set(current)
      for (const candidate of visibleCandidates) {
        if (pickedByDefault(candidate.id) === target) next.delete(candidate.id)
        else next.add(candidate.id)
      }
      return next
    })
  }

  const rootAnchorRef = useRef(undefined)

  if (draft === undefined) {
    return (
      <div ref={rootAnchorRef}>
        <style>{CARD_CSS}</style>
        {loadError !== undefined ? <p role="alert" className="llmmspc-error">{`${route}: ${loadError}`}</p> : null}
      </div>
    )
  }

  const inputFallback = Array.isArray(effectiveProfile.defaultInput) ? effectiveProfile.defaultInput : undefined

  return (
    <div ref={rootAnchorRef} className="llmmspc-editor">
      <style>{CARD_CSS}</style>
      <div className="llmmspc-editorHeader">
        <span className="llmmspc-editorTitle">{entry.displayName}</span>
        {entry.provider !== entry.displayName
          ? <span className="llmmspc-editorRoute">{entry.provider}</span>
          : null}
      </div>
      <div className="llmmspc-field">
        <span className="llmmspc-fieldLabel">
          {t('key')}
          <button type="button" className="llmmspc-helpButton" aria-label={t('authHelp')} title={t('keyHelp').replace('{ref}', () => keyRef)}>?</button>
        </span>
        <div className="llmmspc-keyInput">
          <input
            className={`llmmspc-input ${keyDraft.length > 0 ? 'llmmspc-keyInputFilled' : ''}`}
            type={keyRevealed ? 'text' : 'password'}
            autoComplete="new-password"
            value={keyDraft}
            placeholder={keyPlaceholder}
            aria-label={t('key')}
            aria-invalid={shownKeyFailure !== undefined}
            aria-describedby={credentialHint === undefined ? undefined : `${route}-credential-hint`}
            disabled={busy}
            onChange={(event) => { setKeyDraft(event.target.value); setKeyRevealed(false) }}
          />
          {keyDraft.length === 0 ? null : (
            <button
              type="button"
              className="llmmspc-keyToggle"
              aria-label={t(keyRevealed ? 'keyHide' : 'keyReveal')}
              aria-pressed={keyRevealed}
              disabled={busy}
              onClick={() => { setKeyRevealed(current => !current) }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden="true">
                <path d={keyRevealed ? EYE_OFF_PATH : EYE_PATH} />
              </svg>
            </button>
          )}
        </div>
        {credentialHint === undefined ? null : (
          <p id={`${route}-credential-hint`} className={credentialHint.tone === 'notice' ? 'llmmspc-notice' : 'llmmspc-advancedHint'}>
            {credentialHint.text}
          </p>
        )}
        {shownKeyFailure === undefined ? null : <p className="llmmspc-error">{t(shownKeyFailure)}</p>}
      </div>
      <details className="llmmspc-customized">
        <summary className="llmmspc-customizedSummary">{t('customized')}</summary>
        <div className="llmmspc-customizedBody">
          <div className="llmmspc-field">
            <span className="llmmspc-fieldLabel">{t('displayName')}</span>
            <input
              className="llmmspc-input"
              type="text"
              value={draft.displayName ?? ''}
              placeholder={stringAt(baseAt(view, settingsPath)?.displayName) ?? route}
              aria-label={t('displayName')}
              disabled={disabled}
              onChange={(event) => { setTextField('displayName', event.target.value === '' ? undefined : event.target.value) }}
            />
          </div>
          <div className="llmmspc-field">
            <span className="llmmspc-fieldLabel">{t('baseUrl')}</span>
            <input
              className="llmmspc-input"
              type="text"
              value={draft.baseURL ?? ''}
              placeholder={probeBaseURL === undefined ? t('baseUrlHint') : probeBaseURL}
              aria-label={t('baseUrl')}
              aria-describedby={`${route}-endpoint-hint`}
              disabled={disabled}
              onChange={(event) => { setTextField('baseURL', event.target.value === '' ? undefined : event.target.value) }}
            />
            <span id={`${route}-endpoint-hint`} className="llmmspc-advancedHint">{t('baseUrlHint')}</span>
          </div>
          <div className="llmmspc-field">
            <span className="llmmspc-fieldLabel">{t('thinking')}</span>
            <select
              className="llmmspc-input llmmspc-selectInput"
              value={draft.thinkingLevel ?? ''}
              aria-label={t('thinking')}
              disabled={disabled}
              onChange={(event) => { setField('thinkingLevel', event.target.value === '' ? undefined : event.target.value) }}
            >
              <option value="">{t('thinkingUnset')}</option>
              {THINKING_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
          <div className="llmmspc-field">
            <span className="llmmspc-fieldLabel">
              {t('replay')}
              <button type="button" className="llmmspc-helpButton" aria-label={t('replayHelp')} title={t('replayHelp')}>?</button>
            </span>
            <Switch
              checked={draft.replayThinking === true}
              label={t('replay')}
              disabled={disabled}
              onChange={(on) => { setField('replayThinking', on ? true : undefined) }}
            />
          </div>
        </div>
      </details>
      <section className="llmmspc-modelCatalog" aria-label={t('models')}>
        <div className="llmmspc-modelListHead">
          <div className="llmmspc-modelCatalogHeading">
            <span className="llmmspc-modelCatalogTitle">{t('models')}</span>
            <span className="llmmspc-modelCatalogMeta">
              {draft.modelsOverridden ? t('modelsCustomized') : t('modelsInherited')}
            </span>
          </div>
          {draft.modelsOverridden
            ? (
              <button
                type="button"
                className="llmmspc-linkButton"
                disabled={listDisabled}
                onClick={resetModels}
              >
                {t('resetModels')}
              </button>
            )
            : null}
          <button
            type="button"
            className="llmmspc-linkButton"
            disabled={listDisabled || !askable || shownKeyFailure !== undefined}
            title={shownKeyFailure !== undefined
              ? t(shownKeyFailure)
              : askable ? undefined : t('fetchNeedsBaseUrl')}
            onClick={() => { void fetchModels() }}
          >
            {listBusy ? t('fetching') : t('fetchModels')}
          </button>
        </div>
        {draft.models.length === 0 ? <p className="llmmspc-modelEmpty">{t('modelsEmpty')}</p> : null}
        <AnimatedRows className="llmmspc-modelList" rowKeys={rowState.rows.map(row => String(row.key))} ready resetKey="">
          {rowState.rows.map(({ model, key, expanded, order }, index) => (
            <ModelRowEditor
              key={key}
              rowKey={key}
              order={order}
              model={model}
              position={index + 1}
              inputFallback={inputFallback}
              expanded={expanded}
              disabled={disabled}
              t={t}
              capacities={capacityInputs(model, index)}
              onFieldChange={(field, value) => { patchRow(index, { [field]: value }) }}
              onIdBlur={(value) => {
                const trimmed = value.trim()
                if (trimmed !== value) patchRow(index, { id: trimmed })
              }}
              onChange={(next) => { changeRow(index, next) }}
              onToggle={() => { rowState.toggle(index) }}
              onRemove={() => { removeRow(index) }}
              onReorder={reorderModels}
            />
          ))}
        </AnimatedRows>
        <button type="button" className="llmmspc-addModelButton" disabled={disabled} onClick={addRow}>
          <IconPlusOutlineRegular size={14} />
          {t('addModel')}
        </button>
      </section>
      {failure !== undefined ? <p role="alert" className="llmmspc-error">{failure}</p> : null}
      {modelFailure === undefined
        ? null
        : (
          <p className="llmmspc-advancedHint">
            {`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}
          </p>
        )}
      <div className="llmmspc-editorActions">
        <button type="button" className="llmmspc-secondaryButton" disabled={busy} onClick={() => { closeHostEditor() }}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="llmmspc-primaryButton"
          disabled={busy || modelFailure !== undefined || shownKeyFailure !== undefined}
          onClick={() => { void apply() }}
        >
          {busy ? t('applying') : t('apply')}
        </button>
      </div>
      <PickerDialog
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        cancelLabel={t('cancel')}
        adoptLabel={t('fetchAdopt')}
        adoptDisabled={emptiesList}
        adoptTitle={emptiesList ? t('fetchKeepOne') : undefined}
        onAdopt={adoptPicked}
        selectAllLabel={t(allVisiblePicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
        selectAllDisabled={visibleCandidates.length === 0}
        onToggleSelectAll={toggleVisibleCandidates}
        searchLabel={t('fetchSearch')}
        query={candidateQuery}
        onQuery={setCandidateQuery}
        visibleCandidates={visibleCandidates}
        isPicked={isPicked}
        onToggleCandidate={(id) => {
          setFlipped((current) => {
            const next = new Set(current)
            if (!next.delete(id)) next.add(id)
            return next
          })
        }}
        noMatchesLabel={t('fetchNoMatches')}
      />
    </div>
  )
}

/**
 * The fetch picker as a native <dialog>: showModal() supplies the top layer,
 * backdrop, and Escape handling without any portal dependency, keeping the
 * client bundle free of react-dom (the installed runtime's module table does
 * not seed it for third-party bundles).
 */
function PickerDialog(props) {
  const ref = useRef(undefined)
  useEffect(() => {
    const dialog = ref.current
    if (dialog === undefined) return undefined
    if (props.open && !dialog.open) dialog.showModal()
    else if (!props.open && dialog.open) dialog.close()
    return undefined
  }, [props.open])
  return (
    <dialog
      ref={ref}
      className="llmmspc-dialog"
      aria-label={props.title}
      onClose={props.onClose}
      onClick={(event) => { if (event.target === ref.current) props.onClose() }}
    >
      <div className="llmmspc-dialogBody">
        <div className="llmmspc-dialogHead">
          <span className="llmmspc-dialogTitle">{props.title}</span>
          <button
            type="button" className="llmmspc-iconButton" aria-label={props.closeLabel} title={props.closeLabel}
            onClick={props.onClose}
          >✕</button>
        </div>
        <p className="llmmspc-dialogDescription">{props.description}</p>
        <div className="llmmspc-candidateToolbar">
          <input
            className="llmmspc-input llmmspc-candidateSearch"
            type="search"
            value={props.query}
            placeholder={props.searchLabel}
            aria-label={props.searchLabel}
            onChange={(event) => { props.onQuery(event.target.value) }}
          />
          <button
            type="button" className="llmmspc-linkButton"
            disabled={props.selectAllDisabled}
            onClick={props.onToggleSelectAll}
          >
            {props.selectAllLabel}
          </button>
        </div>
        {props.visibleCandidates.length === 0
          ? <p className="llmmspc-candidateEmpty" role="status">{props.noMatchesLabel}</p>
          : (
            <ul className="llmmspc-candidateList">
              {props.visibleCandidates.map(candidate => (
                <li key={candidate.id} className="llmmspc-candidate">
                  <label className="llmmspc-candidateLabel">
                    <input
                      type="checkbox"
                      checked={props.isPicked(candidate.id)}
                      onChange={() => { props.onToggleCandidate(candidate.id) }}
                    />
                    <span className="llmmspc-candidateId" title={candidate.name ?? candidate.id}>
                      {candidate.id}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        <div className="llmmspc-editorActions">
          <button type="button" className="llmmspc-secondaryButton" onClick={props.onClose}>
            {props.cancelLabel}
          </button>
          <button
            type="button" className="llmmspc-primaryButton"
            disabled={props.adoptDisabled} title={props.adoptTitle}
            onClick={props.onAdopt}
          >
            {props.adoptLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}

/**
 * Slot entry: the permanent invisible mount point when the page's edit mode
 * is closed; the family's real editor (see {@link MmspEditor}) while it is
 * open, with the host editor hidden.
 */
function MmspProviderCard({ provider, keyConfigured, t, operations }) {
  const route = provider.provider
  const rootRef = useRef(undefined) // the permanent mount point inside the slot anchor
  const [editMode, setEditMode] = useState(false) // the page's 编辑 is open

  // The row's 编辑 button toggles the page's own editor, which for this
  // adapter family is the unknown-layout card: a hint plus a permanently
  // disabled save. This card is the family's real editor (via the keyed
  // slot), so while that host editor is open it is hidden and this card's
  // editor renders in its place; closing the edit unmounts it again.
  // DOM contract: the slot outlet wraps this component in an anchor
  // `div[data-slot="settings.models.provider-card"]` (display:contents), and
  // the row element is that anchor's parent — so the row is found by
  // climbing to the anchor, never by searching for the editor itself.
  const rowOf = () => {
    let node = rootRef.current
    for (let depth = 0; node !== undefined && node !== null && depth < 4; depth += 1) {
      const parent = node.parentElement
      if (parent === null) return undefined
      if (typeof parent.getAttribute === 'function' && parent.getAttribute('data-slot') === 'settings.models.provider-card') {
        return parent.parentElement ?? undefined
      }
      node = parent
    }
    return undefined
  }
  // The host editor is the row's direct child div whose hashed class names
  // the page's editor style; slot anchors (data-slot) are never it.
  const editorIn = (row) => {
    for (const child of row.children) {
      if (child.tagName !== 'DIV') continue
      if (typeof child.getAttribute === 'function' && child.getAttribute('data-slot') !== null) continue
      if (typeof child.className === 'string' && /editor/i.test(child.className)) return child
    }
    return undefined
  }
  // The mount point renders on every pass, so the observer installs once on
  // mount with the row already addressable.
  useEffect(() => {
    const row = rowOf()
    if (row === undefined) return undefined
    let lastPresent = false
    const reconcile = () => {
      const editor = editorIn(row)
      const present = editor !== undefined
      if (present) {
        editor.style.display = 'none'
        if (!lastPresent) setEditMode(true)
      } else if (lastPresent) {
        setEditMode(false)
      }
      lastPresent = present
    }
    reconcile()
    const observer = new MutationObserver(reconcile)
    observer.observe(row, { childList: true })
    return () => observer.disconnect()
  }, [])

  if (!editMode) {
    return (
      <div ref={rootRef} className="llmmspc-mount">
        <style>{CARD_CSS}</style>
      </div>
    )
  }
  return (
    <div ref={rootRef} className="llmmspc-mount">
      <style>{CARD_CSS}</style>
      <MmspEditor provider={provider} keyConfigured={keyConfigured} t={t} operations={operations} />
    </div>
  )
}

export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings', 'remote.credentials']

/** Test seam: the editor components, so the render smoke test can exercise JSX bodies the load test cannot. */
export const __testComponents = { MmspProviderCard, MmspEditor, ModelRowEditor, ModelInputTypes, ModelThinkingLevels, PickerDialog }

export function apply(ctx) {
  const t = ctx.locale.bind(`${NS}.card`)
  ctx.effect(() => ctx.locale.register(`${NS}.card`, { zh: ZH, en: EN }), 'llm-mmsp: card copy dictionaries')
  const operations = {
    describeSettings: async () => ctx.remote.settings.describe(),
    writeSettings: async (ns, pathOps, expectedRevision) => ctx.remote.settings.mutate(ns, pathOps, expectedRevision),
    storeCredential: async (ref, value) => {
      const response = await ctx.remote.credentials.set(ref, value)
      return response.ok ? undefined : response.error.message
    },
    discoverModels: async (settingsNs, request) => ctx.remote.llm.discoverModels(settingsNs, request),
  }
  ctx.slots.inject('settings.models.provider-card', () => {
    ctx.slots.register({
      name: 'settings.models.provider-card',
      key: NS,
    }, props => <MmspProviderCard {...props} t={t} operations={operations} />)
  })
}
