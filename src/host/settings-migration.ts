/** Restore this plugin's preferences from the Host's retained settings archive. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  ANNOTATION_SETTINGS_NAMESPACE,
  ARCHIVED_PREFERENCES_IMPORTED_FIELD,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../shared/settings.ts'

const FIELDS = [
  'enabled',
  'officialFileAnnotations',
  'officialDiffAnnotations',
  'autoAttach',
  'individualSelection',
  'compactSummary',
  ...TRANSCRIPT_VISIBILITY_KEYS,
] as const

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function archivedPreferences(document: unknown): Partial<AnnotationSettings> | undefined {
  const sections = record(document)
  if (sections === undefined) throw new TypeError('Invalid archived settings document')
  let result: Partial<Record<keyof AnnotationSettings, boolean>> | undefined
  for (const namespace of ['inline-comments', ANNOTATION_SETTINGS_NAMESPACE]) {
    if (!Object.hasOwn(sections, namespace)) continue
    const values = record(sections[namespace])
    if (values === undefined) throw new TypeError('Invalid archived annotation preferences')
    result ??= {}
    for (const field of FIELDS) {
      if (!Object.hasOwn(values, field)) continue
      const value = values[field]
      if (typeof value !== 'boolean') throw new TypeError(`Invalid archived annotation preference: ${field}`)
      result[field] = value
    }
  }
  return result
}

/**
 * Fill missing user overrides once, preserving newer edits and the original archive.
 * @param ctx - Host filesystem, active profile and configuration-form services.
 * @param signal - cancels reads and prevents a write after disposal.
 * @returns completion after one revision-fenced, atomic settings mutation, or a no-op.
 */
export async function restoreArchivedSettings(ctx: Context, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const initial = ctx.settings.describe().find((item) => item.ns === ANNOTATION_SETTINGS_NAMESPACE)
  if (initial === undefined || record(initial.value)?.[ARCHIVED_PREFERENCES_IMPORTED_FIELD] === true) return
  const target = await ctx.fs.resolve(join(ctx.profileContext.home, 'settings.yaml.imported'), { signal })
  let source: string
  try {
    source = await ctx.fs.readText(target, signal)
  } catch (error) {
    if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return
    throw error
  }
  signal.throwIfAborted()
  const parsed: unknown = parse(source)
  const archived = archivedPreferences(parsed)
  if (archived === undefined) return
  const current = ctx.settings.describe().find((item) => item.ns === ANNOTATION_SETTINGS_NAMESPACE)
  if (current === undefined) throw new Error('Annotation configuration form is unavailable')
  if (record(current.value)?.[ARCHIVED_PREFERENCES_IMPORTED_FIELD] === true) return
  const user = record(current.user) ?? {}
  const ops: SettingsPathOp[] = []
  for (const field of FIELDS) {
    if (archived[field] !== undefined && !Object.hasOwn(user, field)) {
      ops.push({ op: 'set', path: [field], value: archived[field] })
    }
  }
  ops.push({ op: 'set', path: [ARCHIVED_PREFERENCES_IMPORTED_FIELD], value: true })
  signal.throwIfAborted()
  await ctx.settings.mutate(ANNOTATION_SETTINGS_NAMESPACE, ops, current.revision)
}

/**
 * Own optional archive recovery until the Host configuration forms are ready.
 * @param ctx - plugin context that owns the listener, cancellation and awaited cleanup.
 */
export function installSettingsMigration(ctx: Context): void {
  ctx.inject(['settings', 'profileContext', 'fs'], (child) => {
    const abort = new AbortController()
    let task: Promise<void> | undefined
    let pending = false
    const schedule = () => {
      if (abort.signal.aborted) return
      if (task !== undefined) {
        pending = true
        return
      }
      task = Promise.resolve()
        .then(async () => {
          do {
            pending = false
            try {
              await restoreArchivedSettings(child, abort.signal)
            } catch (error) {
              if (!abort.signal.aborted)
                child.logger.warn(
                  'dsh-annotation: archived preferences were not restored; the archive is unchanged (%s)',
                  error instanceof Error ? error.name : 'unknown error',
                )
            }
          } while (pending && !abort.signal.aborted)
        })
        .finally(() => {
          task = undefined
          if (pending) schedule()
        })
    }
    child.on('settings/document-updated', schedule)
    schedule()
    child.effect(
      () => async () => {
        abort.abort()
        await task
      },
      'dsh-annotation: archived settings recovery',
    )
  })
}
