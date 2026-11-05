/**
 * Browser half of the MMSP model adapter: the provider-card extension the
 * Models settings page dispatches for this adapter family's namespace
 * (`settings.models.provider-card`, keyed `entryKey = settingsNs`).
 *
 * The page's built-in editor ships curated layouts for `llm-deepseek` and
 * `llm-pi-ai` only; every other adapter family is addressed through this
 * keyed slot. The card below edits one MMSP route's profile — display name,
 * base URL, thinking default, thinking replay, and the curated model list —
 * as minimal path ops against the stored settings section, and stores a typed
 * API key through the credential seam under the profile's named reference
 * (deriving `<ROUTE>_API_KEY` when the profile names none, matching the
 * page's own rule). Model discovery interrogates the endpoint through the
 * same `llm/discoverModels` remote the page's own editors use.
 *
 * The card mirrors the page's own visual language (field/label metrics,
 * button sizes, model-entry borders, theme aliases) through one scoped
 * stylesheet rendered with the component, so no host CSS module is imported
 * and the bundle stays self-contained.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

const NS = 'llm-mmsp'

const ZH = {
  title: 'MMSP 路由设置',
  key: 'API 密钥',
  keySaved: '已存储',
  keyMissing: '未配置',
  keyPlaceholder: '留空使用已保存凭据',
  displayName: '显示名称',
  baseURL: '接入地址(MMSP Base URL)',
  baseURLHint: '以 /stream 之前结尾,如 https://go.penguin.ooo/api/v1',
  thinking: '默认思考档位',
  thinkingUnset: '未设置(跟随服务端默认)',
  replay: '回放思考内容(多数中转会拒绝,保持关闭)',
  models: '模型列表',
  modelAdd: '添加模型',
  modelDiscover: '从服务端获取',
  modelDiscoverBusy: '获取中…',
  modelId: '模型 ID',
  modelName: '名称',
  modelContext: '上下文',
  modelMaxTokens: '输出上限',
  modelInput: '输入',
  modelRemove: '删除',
  apply: '保存',
  applying: '保存中…',
  reset: '重置',
  conflict: '设置已被其他页面修改,已重新加载,请重试',
  invalidModel: '模型 {i}:ID 不能为空',
  invalidNumber: '模型 {i}:容量必须是正整数',
}

const EN = {
  title: 'MMSP route settings',
  key: 'API key',
  keySaved: 'stored',
  keyMissing: 'missing',
  keyPlaceholder: 'Leave blank to use the stored credential',
  displayName: 'Display name',
  baseURL: 'Base URL (MMSP)',
  baseURLHint: 'Ends before /stream, e.g. https://go.penguin.ooo/api/v1',
  thinking: 'Default thinking level',
  thinkingUnset: 'Unset (server default)',
  replay: 'Replay thinking (most relays reject it; keep off)',
  models: 'Models',
  modelAdd: 'Add model',
  modelDiscover: 'Fetch from server',
  modelDiscoverBusy: 'Fetching…',
  modelId: 'Model ID',
  modelName: 'Name',
  modelContext: 'Context',
  modelMaxTokens: 'Max output',
  modelInput: 'Input',
  modelRemove: 'Remove',
  apply: 'Save',
  applying: 'Saving…',
  reset: 'Reset',
  conflict: 'Settings changed elsewhere; reloaded, try again',
  invalidModel: 'Model {i}: id is required',
  invalidNumber: 'Model {i}: capacities must be positive integers',
}

/**
 * One scoped stylesheet mirroring the Models page's own metrics and theme
 * aliases (dsh-client-ui-settings-models' ModelsSection.module.css values);
 * rendered with the card so it unmounts with it.
 */
const CARD_CSS = `
/* Hide the page's unknown-layout (disabled) editor only in rows that carry
 * this family's mount point: the row is identified by the slot anchor
 * actually containing this card's mount element, never by the anchor alone —
 * every row renders an empty anchor for unmatched dispatch keys. */
li:has(> div[data-slot="settings.models.provider-card"] > .llmmspc-mount) > div[class*="editor"] { display: none !important; }
li > div[class*="editor"]:has(~ div[data-slot="settings.models.provider-card"] > .llmmspc-mount) { display: none !important; }
.llmmspc-body { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.llmmspc-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.llmmspc-label { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.llmmspc-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.llmmspc-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.llmmspc-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.llmmspc-input:disabled { opacity: 0.6; cursor: default; }
select.llmmspc-input { max-width: 240px; cursor: pointer; }
.llmmspc-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.llmmspc-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.llmmspc-btn:disabled { opacity: 0.6; cursor: default; }
.llmmspc-btn-secondary { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }
.llmmspc-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.llmmspc-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; line-height: 18px; }
.llmmspc-catalog { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.llmmspc-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.llmmspc-catalog-title { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.llmmspc-catalog-actions { display: flex; gap: 6px; }
.llmmspc-list { display: flex; flex-direction: column; gap: 8px; }
.llmmspc-entry { border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg); padding: 6px; }
.llmmspc-entry-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 88px 88px auto auto; gap: 6px; align-items: center; }
.llmmspc-chips { display: flex; gap: 10px; align-items: center; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; padding: 0 2px; }
.llmmspc-chips label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
.llmmspc-remove { width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; font: inherit; font-size: 14px; }
.llmmspc-remove:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
.llmmspc-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.llmmspc-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.llmmspc-footer { display: flex; justify-content: flex-end; gap: 8px; }
`

/** Conventional credential reference for a route without a named one. */
function deriveKeyRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** Fields this card manages; everything else in the profile is never touched. */
const MANAGED_KEYS = ['displayName', 'baseURL', 'thinkingLevel', 'replayThinking', 'apiKeyEnv', 'models']

const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']

/** One editable model row, mirroring the page's model-entry card. */
function ModelRow({ index, row, disabled, t, onChange, onRemove }) {
  const numberOrEmpty = (value) => (value === undefined ? '' : String(value))
  const positiveInt = (raw) => {
    if (raw === '') return undefined
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : Number.NaN
  }
  const inputs = row.input ?? ['text']
  return (
    <div className="llmmspc-entry">
      <div className="llmmspc-entry-row">
        <input
          className="llmmspc-input" value={row.id ?? ''} disabled={disabled}
          placeholder={t('modelId')} aria-label={`${t('modelId')} ${index + 1}`}
          onChange={event => onChange(index, { ...row, id: event.target.value })}
        />
        <input
          className="llmmspc-input" value={row.name ?? ''} disabled={disabled}
          placeholder={t('modelName')} aria-label={`${t('modelName')} ${index + 1}`}
          onChange={event => onChange(index, { ...row, name: event.target.value === '' ? undefined : event.target.value })}
        />
        <input
          className="llmmspc-input" inputMode="numeric" value={numberOrEmpty(row.contextWindow)} disabled={disabled}
          placeholder={t('modelContext')} aria-label={`${t('modelContext')} ${index + 1}`}
          onChange={event => onChange(index, { ...row, contextWindow: positiveInt(event.target.value) })}
        />
        <input
          className="llmmspc-input" inputMode="numeric" value={numberOrEmpty(row.maxTokens)} disabled={disabled}
          placeholder={t('modelMaxTokens')} aria-label={`${t('modelMaxTokens')} ${index + 1}`}
          onChange={event => onChange(index, { ...row, maxTokens: positiveInt(event.target.value) })}
        />
        <span className="llmmspc-chips">
          {['text', 'image'].map((modality) => {
            const checked = inputs.includes(modality)
            return (
              <label key={modality}>
                <input
                  type="checkbox" disabled={disabled} checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? (inputs.includes('text') ? ['text', 'image'] : ['image', 'text'])
                      : ['text']
                    onChange(index, { ...row, input: next })
                  }}
                />
                {modality}
              </label>
            )
          })}
        </span>
        <button
          type="button" className="llmmspc-remove" disabled={disabled}
          title={t('modelRemove')} aria-label={`${t('modelRemove')} ${index + 1}`}
          onClick={() => onRemove(index)}
        >✕</button>
      </div>
    </div>
  )
}

/** The Models-page card for one MMSP route.
 *
 * Like every other provider row, the fields appear when the row's 编辑 button
 * opens the page's editor; the page's own editor for this family is the
 * unknown-layout card (a hint plus a permanently disabled save), so this
 * component keeps a zero-visibility mount point alive inside the slot anchor
 * at all times, watches the row for that editor appearing, hides it, and
 * renders this family's real editor in its place until the edit closes.
 */
function MmspProviderCard({ provider, t, operations }) {
  const route = provider.provider
  const settingsPath = useMemo(() => [...provider.settingsPath], [provider.settingsPath])
  const rootRef = useRef(undefined) // the permanent mount point inside the slot anchor
  const [editMode, setEditMode] = useState(false) // the page's 编辑 is open
  const [view, setView] = useState(undefined) // SettingsNamespaceView for the namespace
  const [loadError, setLoadError] = useState(undefined)
  const [draft, setDraft] = useState(undefined) // managed profile fields
  const [dirty, setDirty] = useState(new Set())
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [failure, setFailure] = useState(undefined)

  const readView = async () => {
    const response = await operations.describeSettings()
    if (!response.ok) { setLoadError(response.error.message); return }
    const next = response.value.namespaces.find(entry => entry.ns === NS)
    if (next === undefined) { setLoadError(`settings namespace "${NS}" is not mounted`); return }
    setLoadError(undefined)
    setView(next)
    const profile = operations.subtreeAt(next, settingsPath)
    setDraft({
      displayName: profile.displayName,
      baseURL: profile.baseURL,
      thinkingLevel: profile.thinkingLevel,
      replayThinking: profile.replayThinking === true,
      apiKeyEnv: profile.apiKeyEnv,
      models: Array.isArray(profile.models)
        ? profile.models.map(row => ({ ...row }))
        : [],
    })
    setDirty(new Set())
  }

  // Refresh the draft each time the edit opens; the mount point renders on
  // the very first pass, so this effect also primes a first-run setup row
  // whose editor the observer below immediately converts into edit mode.
  useEffect(() => { void readView() }, [route, editMode])

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

  // After this card saves, close the page's hidden editor through its own
  // cancel button so the row's 编辑 toggle state stays consistent.
  const closeHostEditor = () => {
    const row = rowOf()
    if (row === undefined) return false
    const editor = editorIn(row)
    if (editor === undefined) return false
    for (const button of editor.querySelectorAll('button')) {
      const label = (button.textContent ?? '').trim()
      if (label === '取消' || label === 'Cancel') {
        button.click()
        return true
      }
    }
    return editor.querySelector('button')?.click() === true
  }


  const keyRef = draft?.apiKeyEnv !== undefined && draft.apiKeyEnv !== '' ? draft.apiKeyEnv : deriveKeyRef(route)

  const setField = (key, value) => {
    setDraft(current => ({ ...current, [key]: value }))
    setDirty(current => new Set(current).add(key))
  }

  const rowsInvalid = (draft?.models ?? []).reduce((found, row, index) => {
    if (found !== undefined) return found
    if (typeof row.id !== 'string' || row.id.trim().length === 0) return { index, kind: 'model' }
    for (const key of ['contextWindow', 'maxTokens']) {
      const value = row[key]
      if (value !== undefined && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1)) {
        return { index, kind: 'number' }
      }
    }
    return undefined
  }, undefined)

  const cleanRow = (row) => {
    const next = { id: row.id.trim() }
    if (row.name !== undefined && row.name !== '') next.name = row.name
    if (row.contextWindow !== undefined) next.contextWindow = row.contextWindow
    if (row.maxTokens !== undefined) next.maxTokens = row.maxTokens
    if (Array.isArray(row.input)) next.input = [...row.input]
    return next
  }

  const apply = async () => {
    if (busy || view === undefined || draft === undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      const committed = operations.subtreeAt(view, settingsPath)
      const ops = []
      for (const key of MANAGED_KEYS) {
        if (!dirty.has(key)) continue
        const after = key === 'models' ? draft.models.map(cleanRow) : draft[key]
        if (JSON.stringify(committed?.[key]) === JSON.stringify(after)) continue
        const clears = after === undefined || (key === 'replayThinking' && after === false)
        if (clears && committed?.[key] === undefined) continue
        if (clears) {
          ops.push({ op: 'unset', path: [...settingsPath, key] })
        } else {
          ops.push({ op: 'set', path: [...settingsPath, key], value: after })
        }
      }
      if (ops.length > 0) {
        const written = await operations.writeSettings(NS, ops, view.revision)
        if (!written.ok) {
          setFailure(written.error.code === 'settings/conflict' ? t('conflict') : written.error.message)
          if (written.error.code === 'settings/conflict') await readView()
          return
        }
        setView(written.value)
      }
      if (keyDraft.trim().length > 0) {
        const stored = await operations.storeCredential(keyRef, keyDraft.trim())
        if (stored !== undefined) { setFailure(stored); return }
      }
      setKeyDraft('')
      setDirty(new Set())
      closeHostEditor()
    } finally {
      setBusy(false)
    }
  }

  const discover = async () => {
    if (discovering) return
    setDiscovering(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(NS, { provider: route })
      if (!answer.ok) { setFailure(answer.error.message); return }
      setDraft(current => ({
        ...current,
        models: answer.value.map(model => ({
          id: model.id,
          ...(model.name === undefined ? {} : { name: model.name }),
          ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
          ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
          ...(model.inputModalities === undefined ? {} : { input: [...model.inputModalities] }),
        })),
      }))
      setDirty(current => new Set(current).add('models'))
    } finally {
      setDiscovering(false)
    }
  }

  // Outside the page's edit mode the family renders nothing visible: the
  // row looks exactly like a native provider's collapsed card. The mount
  // point stays alive so the edit-mode observer keeps its DOM address.
  if (!editMode) {
    return <div ref={rootRef} className="llmmspc-mount" />
  }
  const disabled = busy || view === undefined
  const editRow = (index, next) => {
    setDraft(current => {
      const models = [...current.models]
      models[index] = next
      return { ...current, models }
    })
    setDirty(current => new Set(current).add('models'))
  }
  const removeRow = (index) => {
    setDraft(current => ({ ...current, models: current.models.filter((_, at) => at !== index) }))
    setDirty(current => new Set(current).add('models'))
  }

  return (
    <div ref={rootRef} className="llmmspc-mount">
      <style>{CARD_CSS}</style>
      {loadError !== undefined
        ? <p role="alert" className="llmmspc-error">{`${route}: ${loadError}`}</p>
        : null}
      {draft === undefined
        ? null
        : (
          <div className="llmmspc-body">
            <div className="llmmspc-field">
              <span className="llmmspc-label">{t('key')}</span>
              <input
                className="llmmspc-input" type="password" autoComplete="off" value={keyDraft}
                disabled={disabled} placeholder={t('keyPlaceholder')}
                onChange={event => setKeyDraft(event.target.value)}
              />
              <p className="llmmspc-hint">{`存储为凭据 ${keyRef}`}</p>
            </div>
            <div className="llmmspc-field">
              <span className="llmmspc-label">{t('baseURL')}</span>
              <input
                className="llmmspc-input" value={draft.baseURL ?? ''} disabled={disabled}
                onChange={event => setField('baseURL', event.target.value === '' ? undefined : event.target.value)}
              />
              <p className="llmmspc-hint">{t('baseURLHint')}</p>
            </div>
            <div className="llmmspc-row">
              <div className="llmmspc-field" style={{ width: 220 }}>
                <span className="llmmspc-label">{t('displayName')}</span>
                <input
                  className="llmmspc-input" value={draft.displayName ?? ''} disabled={disabled}
                  onChange={event => setField('displayName', event.target.value === '' ? undefined : event.target.value)}
                />
              </div>
              <div className="llmmspc-field">
                <span className="llmmspc-label">{t('thinking')}</span>
                <select
                  className="llmmspc-input" value={draft.thinkingLevel ?? ''} disabled={disabled}
                  onChange={event => setField('thinkingLevel', event.target.value === '' ? undefined : event.target.value)}
                >
                  <option value="">{t('thinkingUnset')}</option>
                  {THINKING_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>
              <label className="llmmspc-label" style={{ cursor: 'pointer', paddingBottom: 7 }}>
                <input
                  type="checkbox" checked={draft.replayThinking === true} disabled={disabled}
                  onChange={event => setField('replayThinking', event.target.checked ? true : undefined)}
                />
                {t('replay')}
              </label>
            </div>
            <div className="llmmspc-catalog">
              <div className="llmmspc-catalog-head">
                <span className="llmmspc-catalog-title">{`${t('models')} (${draft.models.length})`}</span>
                <span className="llmmspc-catalog-actions">
                  <button type="button" className="llmmspc-btn llmmspc-btn-secondary llmmspc-btn-sm" disabled={disabled || discovering}
                    onClick={() => { void discover() }}>
                    {discovering ? t('modelDiscoverBusy') : t('modelDiscover')}
                  </button>
                  <button type="button" className="llmmspc-btn llmmspc-btn-secondary llmmspc-btn-sm" disabled={disabled}
                    onClick={() => { setDraft(current => ({ ...current, models: [...current.models, { id: '' }] })); setDirty(current => new Set(current).add('models')) }}>
                    {t('modelAdd')}
                  </button>
                </span>
              </div>
              <div className="llmmspc-list">
                {draft.models.map((row, index) => (
                  <ModelRow key={index} index={index} row={row} disabled={disabled} t={t}
                    onChange={editRow} onRemove={removeRow} />
                ))}
              </div>
              {rowsInvalid !== undefined
                ? (
                  <p role="alert" className="llmmspc-error">
                    {rowsInvalid.kind === 'model'
                      ? t('invalidModel').replace('{i}', String(rowsInvalid.index + 1))
                      : t('invalidNumber').replace('{i}', String(rowsInvalid.index + 1))}
                  </p>
                )
                : null}
            </div>
            {failure === undefined ? null : <p role="alert" className="llmmspc-error">{failure}</p>}
            <div className="llmmspc-footer">
              <button type="button" className="llmmspc-btn llmmspc-btn-secondary" disabled={disabled}
                onClick={() => { void readView() }}>
                {t('reset')}
              </button>
              <button type="button" className="llmmspc-btn llmmspc-btn-primary" disabled={disabled || rowsInvalid !== undefined}
                onClick={() => { void apply() }}>
                {busy ? t('applying') : t('apply')}
              </button>
            </div>
          </div>
        )}
    </div>
  )
}

export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings', 'remote.credentials']

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
    subtreeAt: (view, path) => {
      let node = view.user
      for (const key of path) {
        node = node !== null && typeof node === 'object' ? node[key] : undefined
      }
      if (node !== undefined) return node
      node = view.base
      for (const key of path) {
        node = node !== null && typeof node === 'object' ? node[key] : undefined
      }
      if (node !== undefined) return node
      node = view.value
      for (const key of path) {
        node = node !== null && typeof node === 'object' ? node[key] : undefined
      }
      return typeof node === 'object' && node !== null ? node : {}
    },
  }
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: NS,
  }, props => <MmspProviderCard {...props} t={t} operations={operations} />))
}
