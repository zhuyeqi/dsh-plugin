/**
 * Reproduce the browser's module load + plugin activation for lib/client.js
 * outside the app: stub `window.__ModuleLoader__` and `document` for the
 * style injector, feed the factory the REAL react/react-dom/jsx-runtime from
 * the harness checkout, then run `apply()` against stub cordis faces. Any
 * module-eval or activation error surfaces with its true stack here.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const requireReal = createRequire('/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/package.json')
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(entry) { registration = entry },
  },
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.window.window = globalThis.window
globalThis.document = {
  createElement: () => ({ style: {}, set textContent(value) { this._text = value } }),
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
}

const sandboxRequire = (spec) => {
  if (spec === 'react' || spec === 'react/jsx-runtime' || spec === 'react-dom' || spec === 'react-dom/client') {
    return requireReal(spec)
  }
  throw new Error(`sandbox require miss: ${spec}`)
}

try {
  vm.runInThisContext(code, { filename: 'lib/client.js' })
  console.log('STEP1 module script evaluated; registration captured:', registration?.id)
  const exports = registration.factory(sandboxRequire)
  console.log('STEP2 factory ran; exports:', Object.keys(exports), 'inject:', exports.inject)
  const events = []
  const ctx = {
    locale: {
      bind: ns => key => `${ns}:${key}`,
      register: (ns) => { events.push(`locale.register(${ns})`); return () => {} },
    },
    effect: (fn) => { const dispose = fn(); events.push('effect ran'); return typeof dispose === 'function' ? dispose : () => {} },
    slots: {
      inject: (slot, begin) => { events.push(`slots.inject(${slot})`); begin() },
      register: (options, component) => { events.push(`slots.register(${JSON.stringify(options)})`); return { component } },
    },
    remote: {},
  }
  exports.apply(ctx)
  console.log('STEP3 apply() ran; events:')
  for (const event of events) console.log('  -', event)
  console.log('REPRO_OK')
} catch (error) {
  console.error('REPRO_FAILURE:')
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
}
