/** Capture readable source versions without adding archived content to model submissions. */
import type { AnnotationController, AnnotationView } from './controller.ts'
import type { SelectionCapture } from './selection.ts'
import { sourceFields } from '../shared/annotation-source.ts'
import { sha256Hex } from '../shared/snapshot-hash.ts'
import type { MessageIdentity, SubmittedAnnotation } from '../shared/types.ts'
import { loadOfficialDiff } from './diff-integration.tsx'
import { officialDiffUrl } from './official-adapters.ts'
import type { ReadFileSnapshot } from './components/FileWholeAnnotationAction.tsx'
import { snapshotOwner, type SourceSnapshotContent, type SourceSnapshotStore } from './source-snapshots.ts'

/** Read only the captured version; mixed-version chunks cannot become a complete source copy. */
export async function captureSourceContent(
  capture: SelectionCapture,
  readFile: ReadFileSnapshot,
  readMessage: (messageId: MessageIdentity) => string | undefined,
  signal: AbortSignal,
): Promise<SourceSnapshotContent> {
  if (signal.aborted) throw new Error('snapshot-cancelled')
  const source = capture.source
  if (source === undefined || source.kind === 'message') {
    const messageId = source?.messageId ?? capture.messageId
    const text = messageId === undefined ? undefined : readMessage(messageId)
    if (text === undefined) throw new Error('snapshot-source-unavailable')
    return { kind: 'message', text, mediaType: 'text/markdown' }
  }
  if (source.kind === 'diff')
    return { kind: 'diff', text: JSON.stringify(source.snapshot, null, 2), mediaType: 'application/json' }
  if (source.kind === 'official-diff') {
    const { sessionId, seq, fileIndex, turn, path } = source.snapshot
    const { snapshot } = await loadOfficialDiff(officialDiffUrl(sessionId, seq, fileIndex), fetch, signal)
    if (signal.aborted) throw new Error('snapshot-cancelled')
    if (snapshot.turn !== turn || snapshot.path !== path || snapshot.hash !== source.snapshot.hash)
      throw new Error('snapshot-source-changed')
    return {
      kind: 'diff',
      text:
        snapshot.kind === 'text'
          ? snapshot.hunks
              .map(
                (hunk) =>
                  '@@ -' +
                  hunk.oldStart +
                  ',' +
                  hunk.oldLines +
                  ' +' +
                  hunk.newStart +
                  ',' +
                  hunk.newLines +
                  ' @@\n' +
                  hunk.lines.join('\n'),
              )
              .join('\n')
          : JSON.stringify(snapshot, null, 2),
      mediaType: 'text/plain',
    }
  }
  const chunks: Uint8Array[] = []
  let offset = 0
  while (!signal.aborted) {
    const result = await readFile(source.sessionId, source.path, signal, { offset, length: 1024 * 1024 })
    if (signal.aborted) throw new Error('snapshot-cancelled')
    const value = result.value
    if (
      !result.ok ||
      value === undefined ||
      value.offset !== offset ||
      value.version !== source.resourceVersion ||
      value.absolutePath !== source.path ||
      (value.bytes !== undefined && value.bytes !== source.snapshot.bytes) ||
      value.data.length > 1024 * 1024 ||
      offset + value.data.length > source.snapshot.bytes ||
      (!value.eof && value.data.length === 0)
    )
      throw new Error('snapshot-source-changed')
    chunks.push(value.data)
    offset += value.data.length
    if (!value.eof) continue
    if (offset !== source.snapshot.bytes) throw new Error('snapshot-source-incomplete')
    const data = new Uint8Array(offset)
    let position = 0
    for (const chunk of chunks) {
      data.set(chunk, position)
      position += chunk.length
    }
    if (source.snapshot.version === 1 && sha256Hex(data) !== source.snapshot.hash)
      throw new Error('snapshot-source-changed')
    const textual = ['text', 'code', 'markdown', 'html', 'csv', 'tsv'].includes(source.format)
    const suffix = source.path.split('.').at(-1)?.toLowerCase()
    const imageTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      bmp: 'image/bmp',
    }
    return {
      kind: 'file',
      text: textual ? new TextDecoder('utf-8', { fatal: true }).decode(data) : '',
      mediaType: textual
        ? 'text/plain'
        : source.format === 'pdf'
          ? 'application/pdf'
          : (imageTypes[suffix ?? ''] ?? 'application/octet-stream'),
      data,
    }
  }
  throw new Error('snapshot-cancelled')
}

function savedCapture(item: SubmittedAnnotation): SelectionCapture {
  return {
    ...sourceFields(item),
    quote: item.quote,
    ...(item.structure === undefined ? {} : { structure: item.structure }),
    rect: { top: 0, left: 0, bottom: 0, right: 0 },
  }
}

type CapturePhase = 'editor' | 'saved' | 'trash'
interface CaptureCandidate {
  readonly phase: CapturePhase
  readonly capture: SelectionCapture
}

function candidates(view: AnnotationView): Map<string, CaptureCandidate> {
  const entries = new Map<string, CaptureCandidate>()
  for (const editor of [...view.editorDrafts, ...(view.editor === null ? [] : [view.editor])])
    if (editor.kind === 'new' && editor.draftId !== undefined)
      entries.set(editor.draftId, { phase: 'editor', capture: editor.capture })
  for (const item of view.annotations)
    entries.set(item.annotationId, { phase: 'saved', capture: savedCapture(item) })
  for (const item of view.trash)
    entries.set(item.annotation.annotationId, { phase: 'trash', capture: savedCapture(item.annotation) })
  return entries
}

/** Capture retained records again when their original source becomes available. */
export function observeSourceSnapshots(
  controller: AnnotationController,
  snapshots: SourceSnapshotStore,
  load: (capture: SelectionCapture, signal: AbortSignal) => Promise<SourceSnapshotContent>,
  changed: () => void,
  cleanupFailed: () => void,
  captureFailed: () => void,
): () => void {
  let active = true
  let retained = new Set<string>()
  const inFlight = new Set<string>()
  const completed = new Set<string>()
  const storageFailed = new Set<string>()
  const lastAttempt = new Map<string, { readonly phase: CapturePhase; readonly view: AnnotationView }>()
  let previousTrash = controller.getSnapshot().trash
  let previousMarks = controller.getSnapshot().deletionMarks
  const refresh = (): void => {
    const view = controller.getSnapshot()
    const sources = candidates(view)
    const next = new Set(sources.keys())
    for (const id of retained)
      if (!next.has(id)) {
        completed.delete(id)
        storageFailed.delete(id)
        lastAttempt.delete(id)
        void snapshots.release(snapshotOwner(controller.sessionId, id)).catch(() => {
          // The durable deletion still prevents resurrection; a later purge retries local content cleanup.
          if (active) cleanupFailed()
        })
      }
    retained = next
    for (const [id, candidate] of sources) {
      const previous = lastAttempt.get(id)
      if (
        inFlight.has(id) ||
        completed.has(id) ||
        storageFailed.has(id) ||
        (previous?.phase === candidate.phase && previous.view === view)
      )
        continue
      lastAttempt.set(id, { phase: candidate.phase, view })
      inFlight.add(id)
      const key = snapshotOwner(controller.sessionId, id)
      void snapshots
        .capture(key, (signal) => load(candidate.capture, signal))
        .then(async () => {
          if (!active || !retained.has(id)) return
          const saved = await snapshots.read(key)
          if (!active || !retained.has(id)) return
          if (saved.state === 'complete') completed.add(id)
          else if (saved.error === 'storage') {
            storageFailed.add(id)
            captureFailed()
          }
        })
        .catch(() => {
          if (active && retained.has(id)) {
            storageFailed.add(id)
            captureFailed()
          }
        })
        .finally(() => {
          inFlight.delete(id)
          if (active && retained.has(id)) refresh()
        })
    }
    if (previousTrash !== view.trash || previousMarks !== view.deletionMarks) {
      previousTrash = view.trash
      previousMarks = view.deletionMarks
      changed()
    }
  }
  const stop = controller.subscribe(refresh)
  refresh()
  return () => {
    active = false
    stop()
  }
}
