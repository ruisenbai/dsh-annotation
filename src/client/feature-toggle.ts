/** Host-backed feature setting and staged main-Settings state. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_ANNOTATION_AUTO_ATTACH,
  DEFAULT_ANNOTATION_COMPACT_SUMMARY,
  DEFAULT_ANNOTATION_ENABLED,
  DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
  DEFAULT_OFFICIAL_DIFF_ANNOTATIONS,
  DEFAULT_OFFICIAL_FILE_ANNOTATIONS,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  LEGACY_ANNOTATION_ENABLED_STORAGE_KEY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
  type TranscriptVisibilityKey,
  type TranscriptVisibilitySettings,
} from '../shared/settings.ts'

/** State rendered by the annotation section in main Settings. */
export interface AnnotationSettingsCardState {
  /** Whether the Host serves this plugin's settings namespace. */
  readonly available: boolean
  /** Whether file-preview annotation actions are enabled. */
  readonly officialFileAnnotations: boolean
  /** Whether official turn-Diff annotation actions are enabled. */
  readonly officialDiffAnnotations: boolean
  /** Whether the active settings provider accepts writes. */
  readonly writable: boolean
  /** Enabled value shown by the staged switch. */
  readonly enabled: boolean
  /** Whether saving leaves a user-layer enabled value. */
  readonly overridden: boolean
  /** Whether saving leaves a user-layer official file value. */
  readonly officialFileAnnotationsOverridden: boolean
  /** Whether saving leaves a user-layer official Diff value. */
  readonly officialDiffAnnotationsOverridden: boolean
  /** Auto-attach value shown by the staged switch. */
  readonly autoAttach: boolean
  /** Whether saving leaves a user-layer auto-attach value. */
  readonly autoAttachOverridden: boolean
  /** Individual-selection value shown by the staged switch. */
  readonly individualSelection: boolean
  /** Whether saving leaves a user-layer individual-selection value. */
  readonly individualSelectionOverridden: boolean
  /** Compact-summary value shown by the staged switch. */
  readonly compactSummary: boolean
  /** Whether saving leaves a user-layer compact-summary value. */
  readonly compactSummaryOverridden: boolean
  /** Transcript filters shown by the staged switches. */
  readonly transcriptVisibility: TranscriptVisibilitySettings
  /** Whether saving leaves a user-layer value for each transcript filter. */
  readonly transcriptVisibilityOverridden: Readonly<Record<TranscriptVisibilityKey, boolean>>
  /** Whether the card holds a change that has not been saved. */
  readonly dirty: boolean
  /** Whether a settings write is in flight. */
  readonly saving: boolean
  /** Whether the Host did not retain the last staged value. */
  readonly failed: boolean
}

/** Registration-side face for the annotation section in main Settings. */
export interface AnnotationSettingsInjected {
  readonly hooks: {
    /** Card snapshot bound by the renderer as useSettingsCard. */
    readonly settingsCard: SnapshotStore<AnnotationSettingsCardState>
  }
  /** Stage the enabled value without writing it. */
  readonly setEnabled: (enabled: boolean) => void
  /** Stage removal of the user override. */
  readonly resetEnabled: () => void
  /** Stage whether file-preview annotations are enabled. */
  readonly setOfficialFileAnnotations: (enabled: boolean) => void
  /** Stage removal of the user file-preview override. */
  readonly resetOfficialFileAnnotations: () => void
  /** Stage whether official turn-Diff annotations are enabled. */
  readonly setOfficialDiffAnnotations: (enabled: boolean) => void
  /** Stage removal of the user turn-Diff override. */
  readonly resetOfficialDiffAnnotations: () => void
  /** Stage whether a new annotation is attached to the official composer automatically. */
  readonly setAutoAttach: (enabled: boolean) => void
  /** Stage removal of the user auto-attach override. */
  readonly resetAutoAttach: () => void
  /** Stage whether each send uses individually selected annotations without writing it. */
  readonly setIndividualSelection: (enabled: boolean) => void
  /** Stage removal of the user individual-selection override. */
  readonly resetIndividualSelection: () => void
  /** Stage the right-aligned, content-sized summary layout without writing it. */
  readonly setCompactSummary: (enabled: boolean) => void
  /** Stage removal of the user compact-summary override. */
  readonly resetCompactSummary: () => void
  /** Stage one transcript filter without changing the saved display settings. */
  readonly setTranscriptVisibility: (field: TranscriptVisibilityKey, enabled: boolean) => void
  /** Stage removal of one user-layer transcript-filter override. */
  readonly resetTranscriptVisibility: (field: TranscriptVisibilityKey) => void
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
  private readonly officialFileAnnotationsEnabled = createSnapshotStore(DEFAULT_OFFICIAL_FILE_ANNOTATIONS)
  private readonly officialDiffAnnotationsEnabled = createSnapshotStore(DEFAULT_OFFICIAL_DIFF_ANNOTATIONS)
  private readonly autoAttachEnabled = createSnapshotStore(DEFAULT_ANNOTATION_AUTO_ATTACH)
  private readonly individualSelectionEnabled = createSnapshotStore<boolean | null>(null)
  private readonly compactSummaryEnabled = createSnapshotStore(DEFAULT_ANNOTATION_COMPACT_SUMMARY)
  private readonly transcriptVisibilitySettings = createSnapshotStore<TranscriptVisibilitySettings>(
    DEFAULT_TRANSCRIPT_VISIBILITY,
  )
  private stagedEnabled: StagedBoolean | undefined
  private stagedOfficialFileAnnotations: StagedBoolean | undefined
  private stagedOfficialDiffAnnotations: StagedBoolean | undefined
  private stagedAutoAttach: StagedBoolean | undefined
  private stagedIndividualSelection: StagedBoolean | undefined
  private stagedCompactSummary: StagedBoolean | undefined
  private stagedTranscriptVisibility: Partial<Record<TranscriptVisibilityKey, StagedBoolean>> = {}
  private saving = false
  private failed = false
  private readonly card: SnapshotStore<AnnotationSettingsCardState>
  private readonly unsubscribe: () => void
  private legacyEnabled: boolean | undefined
  private migrationTask: Promise<void> | undefined
  private saveTask: Promise<void> | undefined
  private disposed = false

  /**
   * @param scope - shared configuration form bound to the Host plugin entry.
   * @param legacyStorage - browser storage read only to preserve the pre-0.1.3 enabled preference.
   */
  constructor(
    private readonly scope: ConfigForm<AnnotationSettings>,
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

  /** @returns whether file-preview annotation actions are enabled. */
  officialFileAnnotations(): SnapshotStore<boolean> {
    return this.officialFileAnnotationsEnabled
  }

  /** @returns whether official turn-Diff annotation actions are enabled. */
  officialDiffAnnotations(): SnapshotStore<boolean> {
    return this.officialDiffAnnotationsEnabled
  }

  /** @returns whether a newly saved annotation should arm the official composer. */
  autoAttach(): SnapshotStore<boolean> {
    return this.autoAttachEnabled
  }

  /** @returns the accepted per-send selection mode, or null before Host settings are ready. */
  individualSelection(): SnapshotStore<boolean | null> {
    return this.individualSelectionEnabled
  }

  /** @returns whether the summary is right-aligned and sized to its content. */
  compactSummary(): SnapshotStore<boolean> {
    return this.compactSummaryEnabled
  }

  /** @returns saved Host transcript filters; unchanged values retain the same snapshot reference. */
  transcriptVisibility(): SnapshotStore<TranscriptVisibilitySettings> {
    return this.transcriptVisibilitySettings
  }

  /** @returns the slot inject face for the annotation section in main Settings. */
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
      setOfficialFileAnnotations: (enabled) => {
        if (this.disposed) return
        this.stagedOfficialFileAnnotations =
          enabled === this.effectiveOfficialFileAnnotations() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetOfficialFileAnnotations: () => {
        if (this.disposed) return
        this.stagedOfficialFileAnnotations =
          this.storedOfficialFileAnnotations() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_OFFICIAL_FILE_ANNOTATIONS }
        this.failed = false
        this.publishCard()
      },
      setOfficialDiffAnnotations: (enabled) => {
        if (this.disposed) return
        this.stagedOfficialDiffAnnotations =
          enabled === this.effectiveOfficialDiffAnnotations() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetOfficialDiffAnnotations: () => {
        if (this.disposed) return
        this.stagedOfficialDiffAnnotations =
          this.storedOfficialDiffAnnotations() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_OFFICIAL_DIFF_ANNOTATIONS }
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
      setIndividualSelection: (enabled) => {
        if (this.disposed) return
        this.stagedIndividualSelection =
          enabled === this.effectiveIndividualSelection() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetIndividualSelection: () => {
        if (this.disposed) return
        this.stagedIndividualSelection =
          this.storedIndividualSelection() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION }
        this.failed = false
        this.publishCard()
      },
      setCompactSummary: (enabled) => {
        if (this.disposed) return
        this.stagedCompactSummary =
          enabled === this.effectiveCompactSummary() ? undefined : { kind: 'set', value: enabled }
        this.failed = false
        this.publishCard()
      },
      resetCompactSummary: () => {
        if (this.disposed) return
        this.stagedCompactSummary =
          this.storedCompactSummary() === undefined
            ? undefined
            : { kind: 'clear', value: DEFAULT_ANNOTATION_COMPACT_SUMMARY }
        this.failed = false
        this.publishCard()
      },
      setTranscriptVisibility: (field, enabled) => {
        if (this.disposed) return
        if (enabled === this.effectiveTranscriptVisibility()[field]) {
          delete this.stagedTranscriptVisibility[field]
        } else {
          this.stagedTranscriptVisibility[field] = { kind: 'set', value: enabled }
        }
        this.failed = false
        this.publishCard()
      },
      resetTranscriptVisibility: (field) => {
        if (this.disposed) return
        if (this.storedTranscriptVisibility(field) === undefined) {
          delete this.stagedTranscriptVisibility[field]
        } else {
          this.stagedTranscriptVisibility[field] = {
            kind: 'clear',
            value: DEFAULT_TRANSCRIPT_VISIBILITY[field],
          }
        }
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
            this.stagedOfficialFileAnnotations === undefined &&
            this.stagedOfficialDiffAnnotations === undefined &&
            this.stagedAutoAttach === undefined &&
            this.stagedIndividualSelection === undefined &&
            this.stagedCompactSummary === undefined &&
            Object.keys(this.stagedTranscriptVisibility).length === 0 &&
            !this.failed)
        ) {
          return
        }
        this.stagedEnabled = undefined
        this.stagedOfficialFileAnnotations = undefined
        this.stagedOfficialDiffAnnotations = undefined
        this.stagedAutoAttach = undefined
        this.stagedIndividualSelection = undefined
        this.stagedCompactSummary = undefined
        this.stagedTranscriptVisibility = {}
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

  private effectiveOfficialFileAnnotations(): boolean {
    const snapshot = this.scope.getSnapshot()
    return snapshot.status === 'ready' && typeof snapshot.value?.officialFileAnnotations === 'boolean'
      ? snapshot.value.officialFileAnnotations
      : DEFAULT_OFFICIAL_FILE_ANNOTATIONS
  }

  private effectiveOfficialDiffAnnotations(): boolean {
    const snapshot = this.scope.getSnapshot()
    return snapshot.status === 'ready' && typeof snapshot.value?.officialDiffAnnotations === 'boolean'
      ? snapshot.value.officialDiffAnnotations
      : DEFAULT_OFFICIAL_DIFF_ANNOTATIONS
  }

  private effectiveAutoAttach(): boolean {
    const snapshot = this.scope.getSnapshot()
    return snapshot.status === 'ready' && typeof snapshot.value?.autoAttach === 'boolean'
      ? snapshot.value.autoAttach
      : DEFAULT_ANNOTATION_AUTO_ATTACH
  }

  private effectiveIndividualSelection(): boolean | null {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return null
    return typeof snapshot.value?.individualSelection === 'boolean'
      ? snapshot.value.individualSelection
      : DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION
  }

  private effectiveCompactSummary(): boolean {
    const snapshot = this.scope.getSnapshot()
    return snapshot.status === 'ready' && snapshot.value !== undefined
      ? snapshot.value.compactSummary
      : DEFAULT_ANNOTATION_COMPACT_SUMMARY
  }

  private effectiveTranscriptVisibility(): TranscriptVisibilitySettings {
    const snapshot = this.scope.getSnapshot()
    const values =
      snapshot.status === 'ready' && snapshot.value !== undefined
        ? snapshot.value
        : DEFAULT_TRANSCRIPT_VISIBILITY
    const current = this.transcriptVisibilitySettings.getSnapshot()
    if (TRANSCRIPT_VISIBILITY_KEYS.every((field) => current[field] === values[field])) return current
    const next = { ...DEFAULT_TRANSCRIPT_VISIBILITY }
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) next[field] = values[field]
    return next
  }

  private storedTranscriptVisibility(field: TranscriptVisibilityKey): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, field)
  }

  private storedCompactSummary(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'compactSummary')
  }

  private storedEnabled(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'enabled')
  }

  private storedOfficialFileAnnotations(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'officialFileAnnotations')
  }

  private storedOfficialDiffAnnotations(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'officialDiffAnnotations')
  }

  private storedAutoAttach(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'autoAttach')
  }

  private storedIndividualSelection(): boolean | undefined {
    return userBoolean(this.scope.getSnapshot().user, 'individualSelection')
  }

  private project(): AnnotationSettingsCardState {
    const snapshot = this.scope.getSnapshot()
    const stored = this.storedEnabled()
    const transcriptVisibility = { ...this.effectiveTranscriptVisibility() }
    const transcriptVisibilityOverridden = { ...DEFAULT_TRANSCRIPT_VISIBILITY }
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) {
      const staged = this.stagedTranscriptVisibility[field]
      if (staged !== undefined) transcriptVisibility[field] = staged.value
      transcriptVisibilityOverridden[field] =
        staged?.kind === 'set' ||
        (staged === undefined && this.storedTranscriptVisibility(field) !== undefined)
    }
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      enabled: this.stagedEnabled?.value ?? this.effectiveEnabled(),
      overridden:
        this.stagedEnabled?.kind === 'set' || (this.stagedEnabled === undefined && stored !== undefined),
      officialFileAnnotations:
        this.stagedOfficialFileAnnotations?.value ?? this.effectiveOfficialFileAnnotations(),
      officialFileAnnotationsOverridden:
        this.stagedOfficialFileAnnotations?.kind === 'set' ||
        (this.stagedOfficialFileAnnotations === undefined &&
          this.storedOfficialFileAnnotations() !== undefined),
      officialDiffAnnotations:
        this.stagedOfficialDiffAnnotations?.value ?? this.effectiveOfficialDiffAnnotations(),
      officialDiffAnnotationsOverridden:
        this.stagedOfficialDiffAnnotations?.kind === 'set' ||
        (this.stagedOfficialDiffAnnotations === undefined &&
          this.storedOfficialDiffAnnotations() !== undefined),
      autoAttach: this.stagedAutoAttach?.value ?? this.effectiveAutoAttach(),
      autoAttachOverridden:
        this.stagedAutoAttach?.kind === 'set' ||
        (this.stagedAutoAttach === undefined && this.storedAutoAttach() !== undefined),
      individualSelection:
        this.stagedIndividualSelection?.value ??
        this.effectiveIndividualSelection() ??
        DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
      individualSelectionOverridden:
        this.stagedIndividualSelection?.kind === 'set' ||
        (this.stagedIndividualSelection === undefined && this.storedIndividualSelection() !== undefined),
      compactSummary: this.stagedCompactSummary?.value ?? this.effectiveCompactSummary(),
      compactSummaryOverridden:
        this.stagedCompactSummary?.kind === 'set' ||
        (this.stagedCompactSummary === undefined && this.storedCompactSummary() !== undefined),
      transcriptVisibility,
      transcriptVisibilityOverridden,
      dirty:
        this.stagedEnabled !== undefined ||
        this.stagedOfficialFileAnnotations !== undefined ||
        this.stagedOfficialDiffAnnotations !== undefined ||
        this.stagedAutoAttach !== undefined ||
        this.stagedIndividualSelection !== undefined ||
        this.stagedCompactSummary !== undefined ||
        Object.keys(this.stagedTranscriptVisibility).length > 0,
      saving: this.saving,
      failed: this.failed,
    }
  }

  private publish(): void {
    if (this.disposed) return
    this.syncLegacyPreference()
    this.featureEnabled.set(this.effectiveEnabled())
    this.officialFileAnnotationsEnabled.set(this.effectiveOfficialFileAnnotations())
    this.officialDiffAnnotationsEnabled.set(this.effectiveOfficialDiffAnnotations())
    this.autoAttachEnabled.set(this.effectiveAutoAttach())
    const individualSelection = this.effectiveIndividualSelection()
    if (individualSelection !== this.individualSelectionEnabled.getSnapshot()) {
      this.individualSelectionEnabled.set(individualSelection)
    }
    this.compactSummaryEnabled.set(this.effectiveCompactSummary())
    const transcriptVisibility = this.effectiveTranscriptVisibility()
    if (transcriptVisibility !== this.transcriptVisibilitySettings.getSnapshot()) {
      this.transcriptVisibilitySettings.set(transcriptVisibility)
    }
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
    const stagedOfficialFileAnnotations = this.stagedOfficialFileAnnotations
    const stagedOfficialDiffAnnotations = this.stagedOfficialDiffAnnotations
    const stagedAutoAttach = this.stagedAutoAttach
    const stagedIndividualSelection = this.stagedIndividualSelection
    const stagedCompactSummary = this.stagedCompactSummary
    const stagedTranscriptVisibility = { ...this.stagedTranscriptVisibility }
    if (
      (stagedEnabled === undefined &&
        stagedOfficialFileAnnotations === undefined &&
        stagedOfficialDiffAnnotations === undefined &&
        stagedAutoAttach === undefined &&
        stagedIndividualSelection === undefined &&
        stagedCompactSummary === undefined &&
        Object.keys(stagedTranscriptVisibility).length === 0) ||
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
    const officialFileAnnotationsLanded =
      stagedOfficialFileAnnotations === undefined
        ? true
        : await this.persistBoolean('officialFileAnnotations', stagedOfficialFileAnnotations, () =>
            this.storedOfficialFileAnnotations(),
          )
    const officialDiffAnnotationsLanded =
      stagedOfficialDiffAnnotations === undefined
        ? true
        : await this.persistBoolean('officialDiffAnnotations', stagedOfficialDiffAnnotations, () =>
            this.storedOfficialDiffAnnotations(),
          )
    const autoAttachLanded =
      stagedAutoAttach === undefined
        ? true
        : await this.persistBoolean('autoAttach', stagedAutoAttach, () => this.storedAutoAttach())
    const individualSelectionLanded =
      stagedIndividualSelection === undefined
        ? true
        : await this.persistBoolean('individualSelection', stagedIndividualSelection, () =>
            this.storedIndividualSelection(),
          )
    const compactSummaryLanded =
      stagedCompactSummary === undefined
        ? true
        : await this.persistBoolean('compactSummary', stagedCompactSummary, () => this.storedCompactSummary())
    const transcriptVisibilityLanded: Partial<Record<TranscriptVisibilityKey, boolean>> = {}
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) {
      const staged = stagedTranscriptVisibility[field]
      if (staged === undefined) continue
      transcriptVisibilityLanded[field] = await this.persistBoolean(field, staged, () =>
        this.storedTranscriptVisibility(field),
      )
    }
    if (this.disposed) return
    if (enabledLanded && this.stagedEnabled === stagedEnabled) this.stagedEnabled = undefined
    if (
      officialFileAnnotationsLanded &&
      this.stagedOfficialFileAnnotations === stagedOfficialFileAnnotations
    ) {
      this.stagedOfficialFileAnnotations = undefined
    }
    if (
      officialDiffAnnotationsLanded &&
      this.stagedOfficialDiffAnnotations === stagedOfficialDiffAnnotations
    ) {
      this.stagedOfficialDiffAnnotations = undefined
    }
    if (autoAttachLanded && this.stagedAutoAttach === stagedAutoAttach) this.stagedAutoAttach = undefined
    if (individualSelectionLanded && this.stagedIndividualSelection === stagedIndividualSelection) {
      this.stagedIndividualSelection = undefined
    }
    if (compactSummaryLanded && this.stagedCompactSummary === stagedCompactSummary) {
      this.stagedCompactSummary = undefined
    }
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) {
      if (
        transcriptVisibilityLanded[field] &&
        this.stagedTranscriptVisibility[field] === stagedTranscriptVisibility[field]
      ) {
        delete this.stagedTranscriptVisibility[field]
      }
    }
    this.saving = false
    this.failed =
      !enabledLanded ||
      !officialFileAnnotationsLanded ||
      !officialDiffAnnotationsLanded ||
      !autoAttachLanded ||
      !individualSelectionLanded ||
      !compactSummaryLanded ||
      Object.values(transcriptVisibilityLanded).some((landed) => !landed)
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
