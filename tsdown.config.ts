import { defineConfig } from 'tsdown'

const packageId = 'dsh-annotation'
const platformModules = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-input-trigger/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const shared = {
  outDir: 'lib',
  target: 'es2024',
  dts: false,
  clean: false,
  fixedExtension: false,
  sourcemap: false,
} as const

export default defineConfig([
  {
    ...shared,
    entry: ['lib/types/index.js', 'lib/types/invariant.js'],
    format: ['esm'],
    platform: 'node',
    deps: { neverBundle: [/^node:/, /^@deepseek-ai\//] },
  },
  {
    ...shared,
    entry: { client: 'lib/types/client/index.js' },
    format: ['cjs'],
    platform: 'browser',
    deps: { neverBundle: platformModules, onlyBundle: false },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
