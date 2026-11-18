import ts from 'typescript'
import { defineConfig } from 'vitest/config'

/** Node ≥25 ships process-wide Web Storage that shadows jsdom storage; disable it when present. */
const execArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

export default defineConfig({
  plugins: [
    {
      name: 'standard-remote-decorators',
      enforce: 'pre',
      transform(source, id) {
        if (!id.endsWith('.ts') || !/^\s*@Remote\b/m.test(source)) return
        const result = ts.transpileModule(source, {
          fileName: id,
          compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, sourceMap: true },
        })
        return { code: result.outputText, map: result.sourceMapText ?? null }
      },
    },
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    execArgv,
    // Real Git cases use the managed Host subprocess provider for every read.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/, /@deepseek-ai\/dsh-client-ui-dockkit/, /katex/],
      },
    },
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/shared/{annotation-source,codec,config,diff-source,ids,model-ack,protocol}.ts',
        'src/host/**/*.ts',
        'src/client/{controller,diff-rows,highlight,market-update,selection,storage}.ts',
      ],
      thresholds: {
        lines: 78,
        functions: 78,
        branches: 68,
        statements: 75,
      },
    },
  },
})
