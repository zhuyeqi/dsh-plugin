// Two bundles from one checkout:
// - lib/index.js  — the Host plugin, @deepseek-ai/* runtime APIs bundled in
//   (profile bundles install as linked checkouts; bare imports resolve along
//   the checkout's real path and can never reach the harness runtime's copy).
// - lib/client.js — the browser half, a `window.__ModuleLoader__.load` CJS
//   factory. react, react/jsx-runtime, and react-dom stay external: they are
//   platform seed words every client bundle may require.
//
// The installed runtime (0.2.2-rc.1 desktop app) does NOT register
// @deepseek-ai/dsh-client-ui-primitives in its web module table — that
// packaging predates the standalone primitives row — so a runtime require of
// it throws "missed the module table" and kills the whole client module
// (symptom: the Models-page card extension silently vanishes). The atoms the
// card mirrors the Models page with are therefore BUNDLED here from the
// harness checkout's source through client-primitives.js, with their CSS
// modules scoped and inlined by the plugin below.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRIMITIVES_SHIM = resolve(HERE, 'client-primitives.js')

const CSS_MODULE_PREFIX = '\0mmsp-css-module:'

/**
 * A one-file CSS-modules pipeline for the bundled atoms:
 * - every `*.module.css` import resolves to a virtual module whose default
 *   export maps each local class to a `dshmmspN-<local>` scoped name;
 * - the rewritten sheets accumulate and are injected as one <style> element
 *   at the very top of the emitted bundle, so the single-file module load
 *   dresses the atoms before any component renders.
 *
 * url(...) payloads, block comments, and quoted strings are shielded before
 * scoping so things like `http://www.w3.org/2000/svg` inside data URIs are
 * never mistaken for class selectors.
 */
function inlineCssModules() {
  const sheets = []
  let fileIndex = 0
  return {
    name: 'mmsp-inline-css-modules',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? resolve(source) : resolve(dirname(importer), source)
      // The `.js` tail keeps tsdown's css-guard (which keys on the
      // `.module.css` suffix of the RESOLVED id) from demanding @tsdown/css;
      // the module is fully virtual and load() answers it as plain JS.
      return CSS_MODULE_PREFIX + absolute + '.js'
    },
    load(id) {
      if (!id.startsWith(CSS_MODULE_PREFIX)) return null
      const file = id.slice(CSS_MODULE_PREFIX.length).replace(/\.js$/, '')
      const source = readFileSync(file, 'utf8')
      // Shield spans where `.name` is not a selector: url(...) first (its
      // quotes are part of the payload), then comments, then bare strings.
      const shielded = []
      const shield = (text) => {
        const slots = []
        const stash = (match) => {
          slots.push(match)
          return `mmspSlot${slots.length - 1}z`
        }
        const masked = text
          .replace(/\/\*[\s\S]*?\*\//g, stash)
          .replace(/url\(\s*[^)]*\)/g, stash)
          .replace(/'[^'\n]*'|"[^"\n]*"/g, stash)
        return { masked, slots }
      }
      const { masked, slots } = shield(source)
      const names = new Set()
      for (const match of masked.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) names.add(match[1])
      const scope = `dshmmsp${(fileIndex += 1)}`
      const map = {}
      for (const name of names) map[name] = `${scope}-${name}`
      const rewritten = masked.replace(
        /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g,
        (whole, name) => map[name] === undefined ? whole : `.${map[name]}`,
      ).replace(/mmspSlot(\d+)z/g, (whole, at) => slots[Number(at)] ?? whole)
      sheets.push(rewritten)
      return { code: `export default ${JSON.stringify(map)}`, moduleType: 'js' }
    },
    renderChunk(code) {
      if (sheets.length === 0) return null
      // Escape `</` so the combo <script> delivery never terminates early.
      const text = JSON.stringify(sheets.join('\n')).replace(/<\//g, '<\\/')
      const injector = `;(function(){try{var s=document.createElement('style');s.textContent=${text};(document.head||document.documentElement).appendChild(s);}catch(e){}})();\n`
      return { code: injector + code, map: null }
    },
  }
}

export default [
  {
    entry: { index: 'index.js' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    clean: false,
    noExternal: [/^@deepseek-ai\//],
    minify: false,
    treeshake: true,
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    entry: { client: 'client.jsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
    alias: { '@deepseek-ai/dsh-client-ui-primitives': PRIMITIVES_SHIM },
    plugins: [inlineCssModules()],
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: {
      entryFileNames: 'client.js',
      // The catch reports any load-time failure to the browser console with a
      // recognizable tag: a dead client module is otherwise completely silent
      // (no slot registration, no UI, nothing in the page).
      banner: `window.__ModuleLoader__.load({ id: '@zhuyeqi/dsh-plugin-llm-mmsp', factory: (require) => { try {`,
      footer: 'return module.exports; } catch (error) { console.error("[llm-mmsp/client] module load failed:", error); throw error; } } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
