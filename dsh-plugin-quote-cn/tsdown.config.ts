import { defineConfig } from 'tsdown';

const PACKAGE_NAME = '@zhuyeqi/dsh-plugin-quote-cn';
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime'];

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    clean: false,
    deps: {
      // Runtime-external packages must resolve where the bundle runs. The
      // plugin is linked into the DSH profile from this checkout, so Node
      // resolves its imports along THIS directory tree — not the profile's.
      // cordis / dsh-system-prompt appear only in erased `import type` rows,
      // so they are never imported at runtime. schemastery, however, is a
      // real runtime import: keep it OUT of neverBundle so tsdown inlines it
      // and lib/index.js ends up with zero external imports.
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-system-prompt',
      ],
    },
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
  {
    entry: { client: 'src/client.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]);
