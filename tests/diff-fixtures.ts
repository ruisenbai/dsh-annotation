/** Frozen test comparisons; Host attestation is exercised separately against real Git. */
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import {
  diffSnapshotSchema,
  diffContext,
  diffQuote,
  parseDiffSource,
  type DiffSnapshot,
  type DiffSource,
} from '../src/shared/diff-source.ts'
import type { AnnotationSelectionCapture, SubmittedAnnotation } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'
import { parseSubmissionPayload } from '../src/shared/protocol.ts'
import { sourceFields } from '../src/shared/annotation-source.ts'

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const oid = (value: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(value)}\0${value}`)
    .digest('hex')

export function diffSnapshot(
  old = 'header\nold value\nfooter\n',
  next = 'header\nnew value\nextra value\nfooter\n',
  patch: Partial<z.input<typeof diffSnapshotSchema>> = {},
): DiffSnapshot {
  return diffSnapshotSchema.parse({
    version: 1,
    id: sha256(old + '\0' + next),
    seal: '0'.repeat(64),
    sessionId: 'session-test',
    workspace: '/repo',
    repository: '/repo',
    workspaceId: sha256('/repo'),
    repositoryId: sha256('/repo/.git'),
    range: 'worktree',
    oldPath: 'src/example.ts',
    newPath: 'src/example.ts',
    head: oid('commit'),
    capturedAt: 1700000000000,
    old: { kind: 'blob', content: old, sha256: sha256(old), oid: oid(old) },
    new: { kind: 'working-tree', content: next, sha256: sha256(next), oid: null },
    ...patch,
  })
}

export function diffSource(
  snapshot = diffSnapshot(),
  side: 'old' | 'new' = 'new',
  startLine = 2,
  endLine = startLine,
): DiffSource {
  const origin = { kind: 'diff' as const, snapshot, side, startLine, endLine }
  return parseDiffSource({ ...origin, ...diffContext(origin), fingerprint: sha256(diffQuote(origin).exact) })
}

export function diffCapture(source = diffSource()): AnnotationSelectionCapture {
  return { source, quote: diffQuote(source), rect: { top: 0, left: 0, right: 0, bottom: 0 } }
}

export function diffAnnotation(source = diffSource()): SubmittedAnnotation {
  const {
    messageId: _messageId,
    messageSeq: _seq,
    responseVersion: _version,
    ...fields
  } = fixturePayload().annotations[0]!
  return { ...fields, source, quote: diffQuote(source), annotation: 'Check this file line.' }
}

/** One already-submitted mixed batch for backward-compatibility checks only. */
export function legacyDiffPayload() {
  const payload = fixturePayload()
  return parseSubmissionPayload({
    ...payload,
    protocolVersion: 3,
    annotations: [
      { ...payload.annotations[0]!, ...sourceFields(payload.annotations[0]!) },
      { ...diffAnnotation(), annotationId: 'legacy-diff', ordinal: 2 },
    ],
  })
}
