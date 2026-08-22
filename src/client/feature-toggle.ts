/** Host-backed feature setting and staged plugin-configuration card state. */

import {
  createSnapshotStore,
  type SettingsScope,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_INLINE_COMMENTS_ENABLED,
  LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY,
  type InlineCommentsSettings,
} from '../shared/settings.ts'

/** State rendered by the plugin-configuration card. */
export interface InlineCommentsSettingsCardState {
  /** Whether the Host serves this plugin's settings namespace. */
  readonly available: boolean
  /** Whether the active settings provider accepts writes. */
  readonly writable: boolean
  /** Enabled value shown by the staged switch. */
  readonly enabled: boolean
  /** Whether saving leaves a user-layer enabled value. */
  readonly overridden: boolean
  /** Whether the card holds a change that has not been saved. */
  readonly dirty: boolean
  /** Whether a settings write is in flight. */
  readonly saving: boolean
  /** Whether the Host did not retain the last staged value. */
  readonly failed: boolean
}

/** Registration-side face for the plugin-configuration card. */
export interface InlineCommentsSettingsInjected {
  readonly hooks: {
    /** Card snapshot bound by the renderer as useSettingsCard. */
    readonly settingsCard: SnapshotStore<InlineCommentsSettingsCardState>
  }
  /** Stage the enabled value without writing it. */
  readonly setEnabled: (enabled: boolean) => void
  /** Stage removal of the user override. */
  readonly resetEnabled: () => void
  /** Persist the staged value. */
  readonly save: () => void
  /** Drop the staged value. */
  readonly discard: () => void
}

interface LegacyEnabledStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
}

type StagedEnabled =
  { readonly kind: 'set'; readonly value: boolean } | { readonly kind: 'clear'; readonly value: boolean }

function userEnabled(value: unknown): boolean | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!Object.prototype.hasOwnProperty.call(value, 'enabled')) return undefined
  const enabled = (value as { readonly enabled?: unknown }).enabled
  return typeof enabled === 'boolean' ? enabled : undefined
}

function readLegacyEnabled(storage: LegacyEnabledStorage | undefined): boolean | undefined {
  try {
    const value = storage?.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)
    if (value === 'true') return true
    if (value === 'false') return false
  } catch {
    // Browser privacy modes can deny reads from the legacy localStorage key.
  }
  return undefined
}

/**
 * Project one Host settings namespace into the feature toggle and its staged card.
 * The feature changes only after the Host accepts a card save; a valid legacy browser preference remains authoritative until its one-time Host migration lands.
 */
export class InlineCommentsSettingsController {
  private readonly featureEnabled = createSnapshotStore(DEFAULT_INLINE_COMMENTS_ENABLED)
  private staged: StagedEnabled | undefined
  private saving = false
  private failed = false
  private readonly card: SnapshotStore<InlineCommentsSettingsCardState>
  private readonly unsubscribe: () => void
  private legacyEnabled: boolean | undefined
  private migrationTask: Promise<void> | undefined
  private saveTask: Promise<void> | undefined
  private disposed = false

  /**
   * @param scope - browser settings scope bound to the Host plugin namespace.
   * @param legacyStorage - browser storage read only to preserve the pre-0.1.3 enabled preference.
   */
  constructor(
    private readonly scope: SettingsScope<InlineCommentsSettings>,
    private readonly legacyStorage?: LegacyEnabledStorage,
  ) {
    this.legacyEnabled = readLegacyEnabled(legacyStorage)
    this.card = createSnapshotStore(this.project())
    this.unsubscribe = scope.subscribe(() => {
      this.publish()
    })
    this.publish()
  }

  /** @returns the enabled source used to install or remove conversation integrations. */
  feature(): SnapshotStore<boolean> {
    return this.featureEnabled
  }

  /** @returns the slot inject face for the plugin-configuration card. */
  inject(): InlineCommentsSettingsInjected {
    return {
      hooks: { settingsCard: this.card },
      setEnabled: (enabled) => {
        if (this.disposed) return
        this.staged = enabled === this.effectiveEnabled() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetEnabled: () => {
        if (this.disposed) return
        this.staged =
          this.storedEnabled() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_INLINE_COMMENTS_ENABLED }
        this.failed = false
        this.publishCard()
      },
      save: () => {
        this.startSave()
      },
      discard: () => {
        if (this.disposed || (this.staged === undefined && !this.failed)) return
        this.staged = undefined
        this.failed = false
        this.publishCard()
      },
    }
  }

  /**
   * Stop deriving state, then wait for every settings write started by this controller.
   * @returns settlement after the controller reaches quiescence.
   */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.unsubscribe()
    }
    const tasks = [this.migrationTask, this.saveTask].filter(
      (task): task is Promise<void> => task !== undefined,
    )
    await Promise.allSettled(tasks)
  }

  private effectiveEnabled(): boolean {
    const snapshot = this.scope.getSnapshot()
    if (this.storedEnabled() === undefined && this.legacyEnabled !== undefined) return this.legacyEnabled
    return snapshot.status === 'ready' && typeof snapshot.value?.enabled === 'boolean'
      ? snapshot.value.enabled
      : DEFAULT_INLINE_COMMENTS_ENABLED
  }

  private storedEnabled(): boolean | undefined {
    return userEnabled(this.scope.getSnapshot().user)
  }

  private project(): InlineCommentsSettingsCardState {
    const snapshot = this.scope.getSnapshot()
    const stored = this.storedEnabled()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      enabled: this.staged?.value ?? this.effectiveEnabled(),
      overridden: this.staged?.kind === 'set' || (this.staged === undefined && stored !== undefined),
      dirty: this.staged !== undefined,
      saving: this.saving,
      failed: this.failed,
    }
  }

  private publish(): void {
    if (this.disposed) return
    this.syncLegacyPreference()
    this.featureEnabled.set(this.effectiveEnabled())
    this.publishCard()
  }

  private publishCard(): void {
    if (this.disposed) return
    this.card.set(this.project())
  }

  private syncLegacyPreference(): void {
    if (this.legacyEnabled === undefined) return
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return
    if (this.storedEnabled() !== undefined) {
      this.clearLegacyPreference()
      return
    }
    if (!snapshot.writable || snapshot.mode !== 'host' || this.migrationTask !== undefined) return
    const task = this.migrateLegacyPreference(this.legacyEnabled)
    this.migrationTask = task
    const settle = () => {
      if (this.migrationTask === task) this.migrationTask = undefined
    }
    void task.then(settle, settle)
  }

  private async migrateLegacyPreference(enabled: boolean): Promise<void> {
    try {
      await this.scope.set('enabled', enabled)
    } catch {
      // The legacy value remains authoritative; a later page load can retry the migration.
      return
    }
    if (this.disposed) return
    if (this.storedEnabled() === enabled) this.clearLegacyPreference()
    this.publish()
  }

  private clearLegacyPreference(): void {
    this.legacyEnabled = undefined
    try {
      this.legacyStorage?.removeItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)
    } catch {
      // The Host value is authoritative even when browser privacy controls deny cleanup.
    }
  }

  private startSave(): void {
    if (this.disposed || this.saveTask !== undefined) return
    const task = this.save()
    this.saveTask = task
    const settle = () => {
      if (this.saveTask === task) this.saveTask = undefined
    }
    void task.then(settle, settle)
  }

  private async save(): Promise<void> {
    const staged = this.staged
    if (staged === undefined || this.saving) return
    this.saving = true
    this.failed = false
    this.publishCard()
    let landed = false
    try {
      if (staged.kind === 'clear') await this.scope.unset('enabled')
      else await this.scope.set('enabled', staged.value)
      const stored = this.storedEnabled()
      landed = staged.kind === 'clear' ? stored === undefined : stored === staged.value
    } catch {
      landed = false
    }
    if (this.disposed) return
    if (landed && this.staged === staged) this.staged = undefined
    this.saving = false
    this.failed = !landed
    this.publish()
  }
}
