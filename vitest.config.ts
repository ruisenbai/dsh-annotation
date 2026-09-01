import { defineConfig } from 'vitest/config'

/** Node ≥25 ships process-wide Web Storage that shadows jsdom storage; disable it when present. */
const execArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

export default defineConfig({
  test: {
    execArgv,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/, /katex/],
      },
    },
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/shared/{codec,config,ids,model-ack,protocol}.ts',
        'src/host/**/*.ts',
        'src/client/{controller,highlight,selection,storage}.ts',
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
