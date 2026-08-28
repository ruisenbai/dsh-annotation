/** Host-backed feature setting and staged plugin-configuration card state. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_ANNOTATION_AUTO_ATTACH,
  DEFAULT_ANNOTATION_ENABLED,
  DEFAULT_ANNOTATION_LOCAL_TOOLS,
  LEGACY_ANNOTATION_ENABLED_STORAGE_KEY,
  type AnnotationSettings,
} from '../shared/settings.ts'

/** State rendered by the plugin-configuration card. */
export interface AnnotationSettingsCardState {
  /** Whether the Host serves this plugin's settings namespace. */
  readonly available: boolean
  /** Whether the active settings provider accepts writes. */
  readonly writable: boolean
  /** Enabled value shown by the staged switch. */
  readonly enabled: boolean
  /** Whether saving leaves a user-layer enabled value. */
  readonly overridden: boolean
  /** Auto-attach value shown by the staged switch. */
  readonly autoAttach: boolean
  /** Whether saving leaves a user-layer auto-attach value. */
  readonly autoAttachOverridden: boolean
  /** 注解汇总框是否显示本地数据控件（删除与下载）。 */
  readonly localTools: boolean
  /** Whether saving leaves a user-layer local-tools value. */
  readonly localToolsOverridden: boolean
  /** Whether the card holds a change that has not been saved. */
  readonly dirty: boolean
  /** Whether a settings write is in flight. */
  readonly saving: boolean
  /** Whether the Host did not retain the last staged value. */
  readonly failed: boolean
}

/** Registration-side face for the plugin-configuration card. */
export interface AnnotationSettingsInjected {
  readonly hooks: {
    /** Card snapshot bound by the renderer as useSettingsCard. */
    readonly settingsCard: SnapshotStore<AnnotationSettingsCardState>
  }
  /** Stage the enabled value without writing it. */
  readonly setEnabled: (enabled: boolean) => void
  /** Stage removal of the user override. */
  readonly resetEnabled: () => void
  /** Stage whether a new annotation is attached to the official composer automatically. */
  readonly setAutoAttach: (enabled: boolean) => void
  /** Stage removal of the user auto-attach override. */
  readonly resetAutoAttach: () => void
  /** Stage whether the summary box shows the local data tools. */
  readonly setLocalTools: (enabled: boolean) => void
  /** Stage removal of the user local-tools override. */
  readonly resetLocalTools: () => void
  /** Persist the staged value. */
  readonly save: () => void
  /** Drop the staged value. */
  readonly discard: () => void
}

interface LegacyEnabledStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
}

type StagedBoolean =
  { readonly kind: 'set'; readonly value: boolean } | { readonly kind: 'clear'; readonly value: boolean }

function userBoolean(value: unknown, field: keyof AnnotationSettings): boolean | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!Object.prototype.hasOwnProperty.call(value, field)) return undefined
  const stored = (value as Record<string, unknown>)[field]
  return typeof stored === 'boolean' ? stored : undefined
}

function readLegacyEnabled(storage: LegacyEnabledStorage | undefined): boolean | undefined {
  try {
    const value = storage?.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)
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
export class AnnotationSettingsController {
  private readonly featureEnabled = createSnapshotStore(DEFAULT_ANNOTATION_ENABLED)
  private readonly autoAttachEnabled = createSnapshotStore(DEFAULT_ANNOTATION_AUTO_ATTACH)
  private readonly localToolsEnabled = createSnapshotStore(DEFAULT_ANNOTATION_LOCAL_TOOLS)
  private stagedEnabled: StagedBoolean | undefined
  private stagedAutoAttach: StagedBoolean | undefined
  private stagedLocalTools: StagedBoolean | undefined
  private saving = false
  private failed = false
  private readonly card: SnapshotStore<AnnotationSettingsCardState>
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
    private readonly scope: SettingsScope<AnnotationSettings>,
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

  /** @returns whether a newly saved annotation should arm the official composer. */
  autoAttach(): SnapshotStore<boolean> {
    return this.autoAttachEnabled
  }

  /** @returns whether the summary box shows the local data tools. */
  localTools(): SnapshotStore<boolean> {
    return this.localToolsEnabled
  }

  /** @returns the slot inject face for the plugin-configuration card. */
  inject(): AnnotationSettingsInjected {
    return {
      hooks: { settingsCard: this.card },
      setEnabled: (enabled) => {
        if (this.disposed) return
        this.stagedEnabled = enabled === this.effectiveEnabled() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetEnabled: () => {
        if (this.disposed) return
        this.stagedEnabled =
          this.storedEnabled() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_ANNOTATION_ENABLED }
        this.failed = false
        this.publishCard()
      },
      setAutoAttach: (enabled) => {
        if (this.disposed) return
        this.stagedAutoAttach =
          enabled === this.effectiveAutoAttach() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetAutoAttach: () => {
        if (this.disposed) return
        this.stagedAutoAttach =
          this.storedAutoAttach() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_ANNOTATION_AUTO_ATTACH }
        this.failed = false
        this.publishCard()
      },
      setLocalTools: (enabled) => {
        if (this.disposed) return
        this.stagedLocalTools =
          enabled === this.effectiveLocalTools() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetLocalTools: () => {
        if (this.disposed) return
        this.stagedLocalTools =
          this.storedLocalTools() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_ANNOTATION_LOCAL_TOOLS }
        this.failed = false
        this.publishCard()
      },
      save: () => {
        this.startSave()
      },
      discard: () => {
        if (
          this.disposed ||
          (this.stagedEnabled === undefined &&
            this.stagedAutoAttach === undefined &&
            this.stagedLocalTools === undefined &&
            !this.failed)
        ) {
          return
        }
        this.stagedEnabled = undefined
        this.stagedAutoAttach = undefined
        this.stagedLocalTools = undefined
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
      : DEFAULT_ANNOTATION_ENABLED
  }

  private effectiveAutoAttach(): boolean {
    const snapshot = this.scope.getSnapshot()
    return snapshot.status === 'ready' && typeof snapshot.value?.autoAttach === 'boolean'
      ? snapshot.value.autoAttach
      : DEFAULT_ANNOTATION_AUTO_ATTACH
  }

  private effectiveLocalTools(): boolean {
    const snapshot = this.scope.getSnapshot()
    return snapshot.status === 'ready' && typeof snapshot.value?.localTools === 'boolean'
      ? snapshot.value.localTools
      : DEFAULT_ANNOTATION_LOCAL_TOOLS
  }

  private storedEnabled(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'enabled')
  }

  private storedAutoAttach(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'autoAttach')
  }

  private storedLocalTools(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'localTools')
  }

  private project(): AnnotationSettingsCardState {
    const snapshot = this.scope.getSnapshot()
    const stored = this.storedEnabled()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      enabled: this.stagedEnabled?.value ?? this.effectiveEnabled(),
      overridden:
        this.stagedEnabled?.kind === 'set' || (this.stagedEnabled === undefined && stored !== undefined),
      autoAttach: this.stagedAutoAttach?.value ?? this.effectiveAutoAttach(),
      autoAttachOverridden:
        this.stagedAutoAttach?.kind === 'set' ||
        (this.stagedAutoAttach === undefined && this.storedAutoAttach() !== undefined),
      localTools: this.stagedLocalTools?.value ?? this.effectiveLocalTools(),
      localToolsOverridden:
        this.stagedLocalTools?.kind === 'set' ||
        (this.stagedLocalTools === undefined && this.storedLocalTools() !== undefined),
      dirty:
        this.stagedEnabled !== undefined ||
        this.stagedAutoAttach !== undefined ||
        this.stagedLocalTools !== undefined,
      saving: this.saving,
      failed: this.failed,
    }
  }

  private publish(): void {
    if (this.disposed) return
    this.syncLegacyPreference()
    this.featureEnabled.set(this.effectiveEnabled())
    this.autoAttachEnabled.set(this.effectiveAutoAttach())
    this.localToolsEnabled.set(this.effectiveLocalTools())
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
      this.legacyStorage?.removeItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)
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
    const stagedEnabled = this.stagedEnabled
    const stagedAutoAttach = this.stagedAutoAttach
    const stagedLocalTools = this.stagedLocalTools
    if (
      (stagedEnabled === undefined && stagedAutoAttach === undefined && stagedLocalTools === undefined) ||
      this.saving
    ) {
      return
    }
    this.saving = true
    this.failed = false
    this.publishCard()
    const enabledLanded =
      stagedEnabled === undefined
        ? true
        : await this.persistBoolean('enabled', stagedEnabled, () => this.storedEnabled())
    const autoAttachLanded =
      stagedAutoAttach === undefined
        ? true
        : await this.persistBoolean('autoAttach', stagedAutoAttach, () => this.storedAutoAttach())
    const localToolsLanded =
      stagedLocalTools === undefined
        ? true
        : await this.persistBoolean('localTools', stagedLocalTools, () => this.storedLocalTools())
    if (this.disposed) return
    if (enabledLanded && this.stagedEnabled === stagedEnabled) this.stagedEnabled = undefined
    if (autoAttachLanded && this.stagedAutoAttach === stagedAutoAttach) this.stagedAutoAttach = undefined
    if (localToolsLanded && this.stagedLocalTools === stagedLocalTools) this.stagedLocalTools = undefined
    this.saving = false
    this.failed = !enabledLanded || !autoAttachLanded || !localToolsLanded
    this.publish()
  }

  private async persistBoolean(
    field: keyof AnnotationSettings,
    staged: StagedBoolean,
    storedValue: () => boolean | undefined,
  ): Promise<boolean> {
    try {
      if (staged.kind === 'clear') await this.scope.unset(field)
      else await this.scope.set(field, staged.value)
    } catch {
      return false
    }
    const stored = storedValue()
    return staged.kind === 'clear' ? stored === undefined : stored === staged.value
  }
}
