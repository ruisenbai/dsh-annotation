/** Public dsh-market update API integration for the annotation Settings section. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

const API_SCHEMA = 'dsh-market/update-api/v1'
const PACKAGE_NAME = 'dsh-annotation'
const CAPABILITIES_ENDPOINT = '/dsh-market/api/v1/capabilities'
const FORCE_FAILURES = new Set(['RELEASE_TOO_FRESH', 'VERSION_UNCHANGED'])

type MarketUpdatePhase =
  | 'idle'
  | 'checking'
  | 'unavailable'
  | 'current'
  | 'available'
  | 'updating'
  | 'succeeded'
  | 'failed'
  | 'rolling-back'
  | 'rolled-back'
  | 'restarting'

/** State rendered by the dsh-market section of the annotation Settings section. */
export interface MarketUpdateState {
  readonly phase: MarketUpdatePhase
  readonly marketVersion: string | null
  readonly stability: 'beta' | 'stable' | null
  readonly installedVersion: string | null
  readonly latestVersion: string | null
  readonly source: string | null
  readonly progressPercent: number | null
  readonly progressDetail: string | null
  readonly error: string | null
  readonly forceAllowed: boolean
  readonly rollbackAvailable: boolean
  readonly refreshRequired: boolean
  readonly restartRequired: boolean
  readonly restartSupported: boolean
}

/** Registration-side face for dsh-market actions in the annotation Settings section. */
export interface MarketUpdateInjected {
  readonly hooks: {
    /** Market snapshot bound by the renderer as useMarketUpdate. */
    readonly marketUpdate: SnapshotStore<MarketUpdateState>
  }
  /** Discover dsh-market and check this package for an update. */
  readonly checkUpdate: () => void
  /** Start the available update, optionally bypassing the release-age wait. */
  readonly installUpdate: (force?: boolean) => void
  /** Roll back the update operation when dsh-market retained a recovery point. */
  readonly rollbackUpdate: () => void
  /** Ask dsh-market to restart a Host whose lifecycle it owns. */
  readonly restartHost: () => void
  /** Reload the browser after a live activation. */
  readonly refreshClient: () => void
}

interface MarketCapabilities {
  readonly marketVersion: string
  readonly stability: 'beta' | 'stable'
  readonly check: boolean
  readonly update: boolean
  readonly rollback: boolean
  readonly restartSupported: boolean
  readonly endpoints: {
    readonly updates: string
    readonly operations: string
    readonly rollback: string
    readonly restart: string
  }
}

interface UpdateCheck {
  readonly installedVersion: string | null
  readonly latestVersion: string | null
  readonly source: string
  readonly updateAvailable: boolean
}

interface UpdateOperation {
  readonly operationId: string
  readonly packageName: string
  readonly state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolled-back'
  readonly installedVersion: string | null
  readonly progress: { readonly percent: number | null; readonly detail: string | null }
  readonly outcome: {
    readonly refreshRequired: boolean
    readonly restartRequired: boolean
    readonly rollback: { readonly available: boolean }
  }
  readonly failure: { readonly code: string; readonly message: string; readonly retryable: boolean } | null
}

type RequestJson = (input: string, init?: RequestInit) => Promise<unknown>
type PollDelay = (signal: AbortSignal) => Promise<void>

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function requiredRecord(owner: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record(owner[key])
  if (value === undefined) throw new Error(`dsh-market response is missing ${key}`)
  return value
}

function requiredString(owner: Record<string, unknown>, key: string): string {
  const value = owner[key]
  if (typeof value !== 'string' || value === '') {
    throw new Error(`dsh-market response is missing ${key}`)
  }
  return value
}

function nullableString(owner: Record<string, unknown>, key: string): string | null {
  const value = owner[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`dsh-market response has an invalid ${key}`)
  return value
}

function schemaRecord(value: unknown): Record<string, unknown> {
  const body = record(value)
  if (body === undefined || body.schema !== API_SCHEMA) {
    throw new Error('dsh-market returned an unsupported update API response')
  }
  return body
}

function endpoint(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\/dsh-market\/api\/v1\/[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(`dsh-market returned an invalid ${name} endpoint`)
  }
  return value
}

function parseCapabilities(value: unknown): MarketCapabilities {
  const body = schemaRecord(value)
  if (body.apiVersion !== 1 || (body.stability !== 'beta' && body.stability !== 'stable')) {
    throw new Error('dsh-market update API v1 is unavailable')
  }
  const features = requiredRecord(body, 'features')
  const restart = requiredRecord(body, 'restart')
  const endpoints = requiredRecord(body, 'endpoints')
  return {
    marketVersion: requiredString(body, 'marketVersion'),
    stability: body.stability,
    check: features.check === true,
    update: features.update === true,
    rollback: features.rollback === true,
    restartSupported: features.restart === true && restart.supported === true,
    endpoints: {
      updates: endpoint(endpoints.updates, 'updates'),
      operations: endpoint(endpoints.operations, 'operations'),
      rollback: endpoint(endpoints.rollback, 'rollback'),
      restart: endpoint(endpoints.restart, 'restart'),
    },
  }
}

function parseCheck(value: unknown): UpdateCheck {
  const body = schemaRecord(value)
  const pkg = requiredRecord(body, 'package')
  if (requiredString(pkg, 'name') !== PACKAGE_NAME || typeof pkg.updateAvailable !== 'boolean') {
    throw new Error('dsh-market returned an update for another package')
  }
  return {
    installedVersion: nullableString(pkg, 'installedVersion'),
    latestVersion: nullableString(pkg, 'latestVersion'),
    source: requiredString(pkg, 'source'),
    updateAvailable: pkg.updateAvailable,
  }
}

function parseOperation(value: unknown): UpdateOperation {
  const body = schemaRecord(value)
  const operation = requiredRecord(body, 'operation')
  const progress = requiredRecord(operation, 'progress')
  const outcome = requiredRecord(operation, 'outcome')
  const rollback = requiredRecord(outcome, 'rollback')
  const state = operation.state
  if (
    state !== 'queued' &&
    state !== 'running' &&
    state !== 'succeeded' &&
    state !== 'failed' &&
    state !== 'cancelled' &&
    state !== 'rolled-back'
  ) {
    throw new Error('dsh-market returned an invalid operation state')
  }
  let failure: UpdateOperation['failure'] = null
  if (operation.failure !== null) {
    const failureRecord = record(operation.failure)
    if (failureRecord === undefined) {
      throw new Error('dsh-market returned an invalid operation failure')
    }
    failure = {
      code: requiredString(failureRecord, 'code'),
      message: requiredString(failureRecord, 'message'),
      retryable: failureRecord.retryable === true,
    }
  }
  const percent = progress.percent
  if (percent !== null && typeof percent !== 'number') {
    throw new Error('dsh-market returned invalid update progress')
  }
  const detail = progress.detail
  if (detail !== null && typeof detail !== 'string') {
    throw new Error('dsh-market returned invalid update detail')
  }
  return {
    operationId: requiredString(operation, 'operationId'),
    packageName: requiredString(operation, 'packageName'),
    state,
    installedVersion: nullableString(operation, 'installedVersion'),
    progress: { percent, detail },
    outcome: {
      refreshRequired: outcome.refreshRequired === true,
      restartRequired: outcome.restartRequired === true,
      rollback: { available: rollback.available === true },
    },
    failure,
  }
}

async function browserRequest(input: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  const value: unknown = await response.json()
  if (!response.ok) {
    const body = record(value)
    const failure = body === undefined ? undefined : record(body.failure)
    const message = failure?.message ?? body?.error
    throw new Error(
      typeof message === 'string' ? message : `dsh-market request failed (${String(response.status)})`,
    )
  }
  return value
}

function pollDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, 500)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const INITIAL_STATE: MarketUpdateState = {
  phase: 'idle',
  marketVersion: null,
  stability: null,
  installedVersion: null,
  latestVersion: null,
  source: null,
  progressPercent: null,
  progressDetail: null,
  error: null,
  forceAllowed: false,
  rollbackAvailable: false,
  refreshRequired: false,
  restartRequired: false,
  restartSupported: false,
}

/** Own one capability-discovered dsh-market update flow. */
export class MarketUpdateController {
  private readonly store = createSnapshotStore<MarketUpdateState>(INITIAL_STATE)
  private capabilities: MarketCapabilities | undefined
  private operationId: string | undefined
  private task: Promise<void> | undefined
  private abort = new AbortController()
  private disposed = false

  /**
   * @param request - same-origin JSON transport; injectable for deterministic tests.
   * @param delay - polling delay; injectable so tests never depend on wall-clock timing.
   * @param refresh - browser reload action.
   */
  constructor(
    private readonly request: RequestJson = browserRequest,
    private readonly delay: PollDelay = pollDelay,
    private readonly refresh: () => void = () => globalThis.location.reload(),
  ) {}

  /** @returns the Slot injection face used by the annotation Settings section. */
  inject(): MarketUpdateInjected {
    return {
      hooks: { marketUpdate: this.store },
      checkUpdate: () => this.start(() => this.check()),
      installUpdate: (force = false) => this.start(() => this.update(force)),
      rollbackUpdate: () => this.start(() => this.rollback()),
      restartHost: () => this.start(() => this.restart()),
      refreshClient: () => {
        if (!this.disposed && this.store.getSnapshot().refreshRequired) this.refresh()
      },
    }
  }

  /**
   * Abort network and polling work, then wait for its settlement.
   * @returns settlement after the controller reaches quiescence.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.abort.abort(new DOMException('dsh-annotation unloaded', 'AbortError'))
    await Promise.allSettled(this.task === undefined ? [] : [this.task])
  }

  private publish(next: MarketUpdateState): void {
    if (!this.disposed) this.store.set(next)
  }

  private merge(patch: Partial<MarketUpdateState>): void {
    this.publish({ ...this.store.getSnapshot(), ...patch })
  }

  private start(run: () => Promise<void>): void {
    if (this.disposed || this.task !== undefined) return
    this.task = run()
      .catch((error: unknown) => {
        if (this.abort.signal.aborted) return
        if (this.store.getSnapshot().phase === 'unavailable') return
        this.merge({ phase: 'failed', error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        this.task = undefined
      })
  }

  private async discover(): Promise<MarketCapabilities> {
    if (this.capabilities !== undefined) return this.capabilities
    try {
      const capabilities = parseCapabilities(
        await this.request(CAPABILITIES_ENDPOINT, { signal: this.abort.signal }),
      )
      this.capabilities = capabilities
      this.merge({
        marketVersion: capabilities.marketVersion,
        stability: capabilities.stability,
        restartSupported: capabilities.restartSupported,
      })
      return capabilities
    } catch (error) {
      if (this.abort.signal.aborted) throw error
      this.publish({ ...INITIAL_STATE, phase: 'unavailable' })
      throw error
    }
  }

  private async check(): Promise<void> {
    this.merge({ phase: 'checking', error: null, forceAllowed: false })
    const capabilities = await this.discover()
    if (!capabilities.check) {
      this.publish({
        ...INITIAL_STATE,
        phase: 'unavailable',
        marketVersion: capabilities.marketVersion,
        stability: capabilities.stability,
      })
      return
    }
    const query = new URLSearchParams({ name: PACKAGE_NAME })
    const result = parseCheck(
      await this.request(`${capabilities.endpoints.updates}?${query.toString()}`, {
        signal: this.abort.signal,
      }),
    )
    this.publish({
      ...INITIAL_STATE,
      phase: result.updateAvailable ? 'available' : 'current',
      marketVersion: capabilities.marketVersion,
      stability: capabilities.stability,
      installedVersion: result.installedVersion,
      latestVersion: result.latestVersion,
      source: result.source,
      restartSupported: capabilities.restartSupported,
    })
  }

  private async update(force: boolean): Promise<void> {
    const before = this.store.getSnapshot()
    const capabilities = await this.discover()
    if (!capabilities.update || (force ? !before.forceAllowed : before.phase !== 'available')) return
    this.merge({
      phase: 'updating',
      error: null,
      forceAllowed: false,
      progressPercent: null,
      progressDetail: null,
    })
    const accepted = parseOperation(
      await this.request(capabilities.endpoints.updates, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageName: PACKAGE_NAME, ...(force ? { force: true } : {}) }),
        signal: this.abort.signal,
      }),
    )
    this.operationId = accepted.operationId
    await this.observe(accepted)
  }

  private async observe(initial: UpdateOperation): Promise<void> {
    const capabilities = this.capabilities
    if (capabilities === undefined) throw new Error('dsh-market capabilities are unavailable')
    let operation = initial
    while (operation.state === 'queued' || operation.state === 'running') {
      if (operation.packageName !== PACKAGE_NAME) {
        throw new Error('dsh-market returned an operation for another package')
      }
      this.merge({
        phase: 'updating',
        installedVersion: operation.installedVersion,
        progressPercent: operation.progress.percent,
        progressDetail: operation.progress.detail,
      })
      await this.delay(this.abort.signal)
      const query = new URLSearchParams({ operationId: operation.operationId })
      operation = parseOperation(
        await this.request(`${capabilities.endpoints.operations}?${query.toString()}`, {
          signal: this.abort.signal,
        }),
      )
    }
    this.applyTerminal(operation)
  }

  private applyTerminal(operation: UpdateOperation): void {
    if (operation.packageName !== PACKAGE_NAME) {
      throw new Error('dsh-market returned an operation for another package')
    }
    const failure = operation.failure
    this.merge({
      phase:
        operation.state === 'succeeded'
          ? 'succeeded'
          : operation.state === 'rolled-back'
            ? 'rolled-back'
            : 'failed',
      installedVersion: operation.installedVersion,
      progressPercent: operation.progress.percent,
      progressDetail: operation.progress.detail,
      error: failure?.message ?? null,
      forceAllowed: failure !== null && FORCE_FAILURES.has(failure.code),
      rollbackAvailable: operation.outcome.rollback.available,
      refreshRequired: operation.outcome.refreshRequired,
      restartRequired: operation.outcome.restartRequired,
    })
  }

  private async rollback(): Promise<void> {
    const capabilities = await this.discover()
    const state = this.store.getSnapshot()
    if (!capabilities.rollback || !state.rollbackAvailable || this.operationId === undefined) return
    this.merge({ phase: 'rolling-back', error: null })
    const operation = parseOperation(
      await this.request(capabilities.endpoints.rollback, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: this.operationId }),
        signal: this.abort.signal,
      }),
    )
    this.applyTerminal(operation)
  }

  private async restart(): Promise<void> {
    const capabilities = await this.discover()
    const state = this.store.getSnapshot()
    if (!capabilities.restartSupported || !state.restartRequired) return
    this.merge({ phase: 'restarting', error: null })
    await this.request(capabilities.endpoints.restart, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: this.abort.signal,
    })
    this.merge({ phase: 'succeeded', restartRequired: false })
  }
}
