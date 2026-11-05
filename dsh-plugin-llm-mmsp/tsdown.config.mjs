// Two bundles from one checkout:
// - lib/index.js  — the Host plugin, @deepseek-ai/* runtime APIs bundled in
//   (profile bundles install as linked checkouts; bare imports resolve along
//   the checkout's real path and can never reach the harness runtime's copy).
// - lib/client.js — the browser half, a `window.__ModuleLoader__.load` CJS
//   factory with react + jsx-runtime external (the page's module table
//   provides them).
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
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: '@zhuyeqi/dsh-plugin-llm-mmsp', factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
