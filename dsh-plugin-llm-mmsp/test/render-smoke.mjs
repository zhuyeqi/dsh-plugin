/**
 * Render smoke test: run the BUILT client bundle's editor components through
 * react-dom/server so every JSX body executes for real. The load repro
 * (repro-client-load.mjs) covers eval/apply/register only — a dangling
 * identifier inside a component body survives it and only crashes the page
 * the moment the component renders (exactly the rowStateRef incident).
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const requireReal = createRequire('/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/package.json')
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let registration
globalThis.window = {
  __ModuleLoader__: { load(entry) { registration = entry } },
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.window.window = globalThis.window
globalThis.document = {
  createElement: () => ({ style: {}, set textContent(v) { this._text = v } }),
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
}

vm.runInThisContext(code, { filename: 'lib/client.js' })
const exports = registration.factory((spec) => {
  if (spec === 'react' || spec === 'react/jsx-runtime' || spec === 'react-dom' || spec === 'react-dom/client') return requireReal(spec)
  throw new Error(`sandbox require miss: ${spec}`)
})
const components = exports.__testComponents
if (components === undefined) throw new Error('built bundle exports no __testComponents')

const React = requireReal('react')
const h = React.createElement
const { renderToString } = requireReal('react-dom/server')
const t = (key) => key
const operations = {
  describeSettings: async () => { throw new Error('not needed in smoke') },
  writeSettings: async () => { throw new Error('not needed in smoke') },
  storeCredential: async () => undefined,
  discoverModels: async () => { throw new Error('not needed in smoke') },
}
const entry = {
  provider: 'penguin-go', displayName: 'Penguin Go (MMSP)', settingsNs: 'llm-mmsp',
  settingsPath: ['providers', 'penguin-go'], nativeAuth: { env: ['MMSP_API_KEY'], oauth: false },
}
const order = { dragging: false, target: undefined, canDrop: false, onStart() {}, onEnd() {}, onOver() {}, onLeave() {}, onDrop() {}, onMove() {} }
const scenarios = {
  'provider card (collapsed)': () => h(components.MmspProviderCard, { provider: entry, keyConfigured: true, t, operations }),
  'editor (draft loading)': () => h(components.MmspEditor, { provider: entry, keyConfigured: true, t, operations }),
  'model row (expanded)': () => h(components.ModelRowEditor, {
      rowKey: 1, order, position: 1, expanded: true, disabled: false, t,
      model: { id: 'deepseek-flash', name: 'DeepSEek Flash', contextWindow: 131072, maxTokens: 8192, input: ['text', 'image'] },
      capacities: {
        contextWindow: { value: '128K', placeholder: '', onChange() {}, onBlur() {} },
        maxTokens: { value: '8192', placeholder: '', onChange() {}, onBlur() {} },
      },
      inputFallback: ['text'], onFieldChange() {}, onIdBlur() {}, onChange() {}, onToggle() {}, onRemove() {}, onReorder() {},
    }),
  'input types': () => h(components.ModelInputTypes, { model: { input: ['text', 'image'] }, position: 1, disabled: false, fallback: ['text'], t, onChange() {} }),
  'thinking levels': () => h(components.ModelThinkingLevels, { model: { thinkingLevels: ['low', 'high'] }, position: 1, disabled: false, t, onChange() {} }),
  'picker dialog (open)': () => h(components.PickerDialog, {
      open: true, onClose() {}, title: 'T', closeLabel: 'C', description: 'D', cancelLabel: 'X', adoptLabel: 'A',
      adoptDisabled: false, onAdopt() {}, selectAllLabel: 'S', selectAllDisabled: false, onToggleSelectAll() {},
      searchLabel: 'Q', query: '', onQuery() {},
      visibleCandidates: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
      isPicked: () => true, onToggleCandidate() {}, noMatchesLabel: 'N',
    }),
}
let failures = 0
for (const [name, render] of Object.entries(scenarios)) {
  try {
    const html = renderToString(render())
    console.log(`PASS ${name} (${html.length} chars)`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}:`, error?.stack ?? error)
  }
}
if (failures > 0) process.exitCode = 1
else console.log('RENDER_SMOKE_OK')
