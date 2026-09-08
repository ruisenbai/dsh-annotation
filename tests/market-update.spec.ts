import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import { MarketUpdateController, type MarketUpdateState } from '../src/client/market-update.ts'

const schema = 'dsh-market/update-api/v1'

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    schema,
    apiVersion: 1,
    stability: 'beta',
    marketVersion: '1.45.0',
    features: { check: true, update: true, progress: true, rollback: true, restart: true },
    restart: { supported: true },
    endpoints: {
      updates: '/dsh-market/api/v1/updates',
      operations: '/dsh-market/api/v1/operations',
      rollback: '/dsh-market/api/v1/rollback',
      restart: '/dsh-market/api/v1/restart',
    },
    ...overrides,
  }
}

function check(updateAvailable = true) {
  return {
    schema,
    package: {
      name: 'dsh-annotation',
      source: 'github',
      installedVersion: '0.6.0',
      latestVersion: updateAvailable ? '0.7.0' : '0.6.0',
      updateAvailable,
    },
  }
}

function operation(
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolled-back',
  options: {
    failure?: { code: string; message: string; retryable: boolean } | null
    rollback?: boolean
    refresh?: boolean
    restart?: boolean
    installedVersion?: string | null
    percent?: number | null
  } = {},
) {
  return {
    schema,
    operation: {
      schema,
      operationId: 'boot-update-1',
      kind: 'update',
      packageName: 'dsh-annotation',
      state,
      createdAt: 1,
      startedAt: 2,
      finishedAt: state === 'queued' || state === 'running' ? null : 3,
      beforeVersion: '0.6.0',
      installedVersion: options.installedVersion ?? (state === 'succeeded' ? '0.7.0' : '0.6.0'),
      progress: {
        phase: state === 'running' ? 'install' : null,
        done: options.percent ?? 0,
        total: 100,
        percent: options.percent ?? null,
        currentPackage: null,
        detail: state === 'running' ? 'installing dsh-annotation' : null,
        downloaded: null,
        size: null,
      },
      outcome: {
        refreshRequired: options.refresh ?? false,
        restartRequired: options.restart ?? false,
        rollback: {
          available: options.rollback ?? false,
          state: options.rollback ? 'available' : 'unavailable',
          detail: null,
        },
      },
      failure: options.failure ?? null,
    },
  }
}

function until(
  store: SnapshotStore<MarketUpdateState>,
  predicate: (state: MarketUpdateState) => boolean,
): Promise<MarketUpdateState> {
  const current = store.getSnapshot()
  if (predicate(current)) return Promise.resolve(current)
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getSnapshot()
      if (!predicate(state)) return
      unsubscribe()
      resolve(state)
    })
  })
}

async function actionReady(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('dsh-market update controller', () => {
  it('discovers v1 before checking the installed package', async () => {
    const request = vi.fn(async (url: string) =>
      url.endsWith('/capabilities') ? capabilities() : check(false),
    )
    const controller = new MarketUpdateController(request)
    const face = controller.inject()
    const complete = until(face.hooks.marketUpdate, (state) => state.phase === 'current')
    face.checkUpdate()

    expect(await complete).toMatchObject({
      marketVersion: '1.45.0',
      stability: 'beta',
      installedVersion: '0.6.0',
      latestVersion: '0.6.0',
      source: 'github',
    })
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/dsh-market/api/v1/capabilities',
      '/dsh-market/api/v1/updates?name=dsh-annotation',
    ])
    await controller.dispose()
  })

  it('observes progress and exposes only capability-backed recovery actions', async () => {
    let operationReads = 0
    const refresh = vi.fn()
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) return capabilities()
      if (url.includes('/updates?')) return check(true)
      if (url.endsWith('/updates') && init?.method === 'POST') return operation('running', { percent: 20 })
      if (url.includes('/operations?')) {
        operationReads += 1
        return operation(
          operationReads === 1 ? 'running' : 'succeeded',
          operationReads === 1
            ? { percent: 65 }
            : { percent: 100, refresh: true, restart: true, rollback: true },
        )
      }
      if (url.endsWith('/restart')) return { schema, result: { ok: true } }
      if (url.endsWith('/rollback')) return operation('rolled-back', { restart: true })
      throw new Error(`unexpected request ${url}`)
    })
    const delay = vi.fn(async () => {})
    const controller = new MarketUpdateController(request, delay, refresh)
    const face = controller.inject()

    const available = until(face.hooks.marketUpdate, (state) => state.phase === 'available')
    face.checkUpdate()
    await available
    await actionReady()
    const succeeded = until(face.hooks.marketUpdate, (state) => state.phase === 'succeeded')
    face.installUpdate()
    expect(await succeeded).toMatchObject({
      installedVersion: '0.7.0',
      progressPercent: 100,
      rollbackAvailable: true,
      refreshRequired: true,
      restartRequired: true,
      restartSupported: true,
    })
    expect(delay).toHaveBeenCalledTimes(2)

    face.refreshClient()
    expect(refresh).toHaveBeenCalledOnce()
    await actionReady()
    const restarted = until(
      face.hooks.marketUpdate,
      (state) => state.phase === 'succeeded' && !state.restartRequired,
    )
    face.restartHost()
    await restarted
    await actionReady()
    const rolledBack = until(face.hooks.marketUpdate, (state) => state.phase === 'rolled-back')
    face.rollbackUpdate()
    expect(await rolledBack).toMatchObject({ installedVersion: '0.6.0', rollbackAvailable: false })
    await controller.dispose()
  })

  it('offers force only after the two documented release-policy failures', async () => {
    let updateAttempt = 0
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) return capabilities()
      if (url.includes('/updates?')) return check(true)
      if (url.endsWith('/updates') && init?.method === 'POST') {
        updateAttempt += 1
        if (updateAttempt === 2) expect(JSON.parse(String(init.body))).toMatchObject({ force: true })
        return operation(
          updateAttempt === 1 ? 'failed' : 'succeeded',
          updateAttempt === 1
            ? {
                failure: {
                  code: 'RELEASE_TOO_FRESH',
                  message: 'The release is too fresh.',
                  retryable: true,
                },
              }
            : undefined,
        )
      }
      throw new Error(`unexpected request ${url}`)
    })
    const controller = new MarketUpdateController(request, async () => {})
    const face = controller.inject()

    const available = until(face.hooks.marketUpdate, (state) => state.phase === 'available')
    face.checkUpdate()
    await available
    await actionReady()
    const failed = until(face.hooks.marketUpdate, (state) => state.phase === 'failed')
    face.installUpdate()
    expect(await failed).toMatchObject({ forceAllowed: true, error: 'The release is too fresh.' })
    await actionReady()
    const succeeded = until(face.hooks.marketUpdate, (state) => state.phase === 'succeeded')
    face.installUpdate(true)
    expect(await succeeded).toMatchObject({ forceAllowed: false, installedVersion: '0.7.0' })
    await controller.dispose()
  })

  it('treats a non-v1 or cross-route discovery response as unavailable', async () => {
    const request = vi.fn(async () =>
      capabilities({
        endpoints: {
          updates: 'https://example.com/update',
          operations: '/dsh-market/api/v1/operations',
          rollback: '/dsh-market/api/v1/rollback',
          restart: '/dsh-market/api/v1/restart',
        },
      }),
    )
    const controller = new MarketUpdateController(request)
    const face = controller.inject()
    const unavailable = until(face.hooks.marketUpdate, (state) => state.phase === 'unavailable')
    face.checkUpdate()

    expect(await unavailable).toMatchObject({ marketVersion: null, installedVersion: null })
    expect(request).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('aborts discovery and reaches quiescence on disposal', async () => {
    let observedSignal: AbortSignal | undefined
    const request = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<unknown>((_resolve, reject) => {
          observedSignal = init?.signal as AbortSignal | undefined
          observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true })
        }),
    )
    const controller = new MarketUpdateController(request)
    const face = controller.inject()
    face.checkUpdate()
    expect(face.hooks.marketUpdate.getSnapshot().phase).toBe('checking')

    await controller.dispose()
    expect(observedSignal?.aborted).toBe(true)
    expect(face.hooks.marketUpdate.getSnapshot().phase).toBe('checking')
  })
})
