import { defineConfig } from 'tsdown'
import platformModules from './client-platform.json' with { type: 'json' }

const packageId = 'dsh-annotation'
const platformModuleSet = new Set(platformModules)
const isClientExternal = (specifier: string): boolean =>
  platformModuleSet.has(specifier) || specifier.startsWith('@deepseek-ai/dsh-')

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
    deps: {
      neverBundle: isClientExternal,
      alwaysBundle: (specifier) => !isClientExternal(specifier),
      onlyBundle: false,
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
