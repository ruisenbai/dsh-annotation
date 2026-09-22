/** Plugin-owned workspace/staged Diff entry point; no third-party renderer or DOM scraping. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { z } from 'zod'
import {
  diffPathSchema,
  diffSnapshotSchema,
  diffQuote,
  parseDiffSource,
  relocationCandidates,
  type DiffSnapshot,
  type DiffRange,
  type DiffSide,
} from '../../shared/diff-source.ts'
import type { AnnotationId, AnnotationSelectionCapture } from '../../shared/types.ts'
import type { AnnotationView } from '../controller.ts'
import type { InputAnnotationProps } from '../contract.ts'
import { diffRows, visibleDiffRows } from '../diff-rows.ts'

/** Controller actions for the plugin-owned Git reader and editor. */
export interface DiffPanelActions {
  /** @param value - Diff command request JSON. @returns Host-validated result JSON. */
  request(value: unknown): Promise<unknown>
  /** Open the reader without changing existing drafts. */
  open(): void
  /** Close the reader and suspend unfinished editing. */
  close(): void
  /** @param capture - Host-validated source. @param extend - Extend a same-side selection. @param supplementalTo - Immutable original annotation. */
  begin(capture: AnnotationSelectionCapture, extend?: boolean, supplementalTo?: AnnotationId): void
}

const listSchema = z.object({
  files: z.array(
    z.object({
      path: diffPathSchema,
      oldPath: diffPathSchema.nullable(),
      newPath: diffPathSchema.nullable(),
      status: z.string(),
    }),
  ),
})
const readSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), snapshot: diffSnapshotSchema }),
  z.object({ kind: z.literal('unsupported'), reason: z.string() }),
])

/** Accessible line actions and explicitly confirmed rebinding share the existing editor and drafts.
 * @param props - Controller state, localized actions and the shared editor.
 * @returns The entry button and modal with frozen Diff rows.
 */
export function DiffAnnotationPanel({
  view,
  actions,
  t,
  onEdit,
  onSuspend,
  children,
}: {
  view: AnnotationView
  actions: DiffPanelActions
  t: InputAnnotationProps['t']
  children?: ReactNode
  onEdit(id: AnnotationId): void
  onSuspend(): void
}) {
  const incoming = view.diffPanel
  const open = incoming !== null && incoming !== undefined
  const [range, setRange] = useState<DiffRange>('worktree')
  const [files, setFiles] = useState<z.infer<typeof listSchema>['files']>([])
  const [snapshot, setSnapshot] = useState<DiffSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [proposal, setProposal] = useState<{ snapshot: DiffSnapshot; line: number } | null>(null)
  const epoch = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const original = view.annotations.find((item) => item.annotationId === incoming?.annotationId)
  const originalSource = original?.source?.kind === 'diff' ? original.source : undefined
  const rows = useMemo(() => (snapshot === null ? [] : diffRows(snapshot)), [snapshot])
  const shown = useMemo(() => visibleDiffRows(rows, expanded), [rows, expanded])

  const perform = async (request: unknown, receive: (result: unknown) => void) => {
    const generation = ++epoch.current
    setBusy(true)
    setError(null)
    try {
      const result = await actions.request(request)
      if (generation === epoch.current) receive(result)
    } catch (cause) {
      if (generation === epoch.current) {
        setProposal(null)
        setError(`${t('diff.unavailable')} ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    } finally {
      if (generation === epoch.current) setBusy(false)
    }
  }

  const acceptRead = (value: unknown) => {
    const result = readSchema.parse(value)
    setProposal(null)
    if (result.kind === 'unsupported') {
      setSnapshot(null)
      setError(t('diff.unsupported', { reason: result.reason }))
      return
    }
    setSnapshot(result.snapshot)
    setExpanded(false)
  }

  const list = (nextRange: DiffRange) => {
    onSuspend()
    setRange(nextRange)
    setFiles([])
    setSnapshot(null)
    setProposal(null)
    void perform({ action: 'list', range: nextRange }, (value) => setFiles(listSchema.parse(value).files))
  }

  useEffect(() => {
    epoch.current++
    setBusy(false)
    setError(null)
    setProposal(null)
    if (!open) return
    if (incoming?.snapshot !== undefined) {
      setSnapshot(incoming.snapshot)
      setRange(incoming.snapshot.range)
      setExpanded(true)
      setFiles([])
    } else list(range)
    return () => {
      epoch.current++
    }
    // A panel-open request owns its initial load; range changes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  useEffect(() => {
    if (!open || originalSource === undefined || snapshot?.id !== originalSource.snapshot.id) return
    const target = scroller.current?.querySelector<HTMLElement>(
      `[data-${originalSource.side}-line="${originalSource.startLine}"] button`,
    )
    target?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
    target?.focus({ preventScroll: true })
  }, [open, snapshot, originalSource, expanded])

  const anchor = (side: DiffSide, line: number, extend: boolean) => {
    if (snapshot === null) return
    const editor = view.editor
    const source = editor?.kind === 'new' ? editor.capture.source : undefined
    if (extend && (source?.kind !== 'diff' || source.snapshot.id !== snapshot.id || source.side !== side)) {
      setError(t('diff.rangeMismatch'))
      return
    }
    const startLine = extend && source?.kind === 'diff' ? Math.min(source.startLine, line) : line
    const endLine = extend && source?.kind === 'diff' ? Math.max(source.endLine, line) : line
    void perform({ action: 'anchor', snapshot, side, startLine, endLine }, (value) => {
      const result = z.object({ source: z.unknown(), quote: z.unknown() }).parse(value)
      const captured = parseDiffSource(result.source)
      actions.begin(
        { source: captured, quote: diffQuote(captured), rect: { top: 0, left: 0, right: 0, bottom: 0 } },
        extend,
      )
      setExpanded(true)
    })
  }

  const checkCurrent = () => {
    if (originalSource === undefined) return
    setProposal(null)
    void perform({ action: 'recapture', source: originalSource }, (value) => {
      const result = readSchema.parse(value)
      if (result.kind !== 'text') {
        setError(t('diff.changed'))
        return
      }
      const matches = relocationCandidates(originalSource, result.snapshot)
      if (matches.length !== 1) {
        setProposal(null)
        setError(t(matches.length > 1 ? 'diff.ambiguous' : 'diff.changed'))
        return
      }
      setProposal({ snapshot: result.snapshot, line: matches[0]! })
    })
  }

  const rebind = () => {
    if (originalSource === undefined || original === undefined || proposal === null) return
    const next = proposal
    void perform(
      {
        action: 'anchor',
        snapshot: next.snapshot,
        side: originalSource.side,
        startLine: next.line,
        endLine: next.line + originalSource.endLine - originalSource.startLine,
        reboundFrom: originalSource,
      },
      (value) => {
        const result = z.object({ source: z.unknown() }).parse(value)
        const source = parseDiffSource(result.source)
        setSnapshot(next.snapshot)
        setExpanded(true)
        setProposal(null)
        actions.begin(
          { source, quote: diffQuote(source), rect: { top: 0, left: 0, bottom: 0, right: 0 } },
          false,
          original.annotationId,
        )
      },
    )
  }

  return (
    <>
      <Button variant="outline" onClick={actions.open}>
        {t('diff.open')}
      </Button>
      <Modal
        open={open}
        title={t('diff.title')}
        closeLabel={t('diff.close')}
        onClose={actions.close}
        className="dia-diff-modal"
        contentClassName="dia-diff-content"
      >
        <div data-annotation-diff="true" className="dia-diff">
          <div className="dia-diff-toolbar">
            <Button
              variant={range === 'worktree' ? 'primary' : 'outline'}
              disabled={busy}
              onClick={() => list('worktree')}
            >
              {t('diff.worktree')}
            </Button>
            <Button
              variant={range === 'staged' ? 'primary' : 'outline'}
              disabled={busy}
              onClick={() => list('staged')}
            >
              {t('diff.staged')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => list(range)}>
              {t('diff.refresh')}
            </Button>
            {originalSource !== undefined && (
              <Button variant="outline" disabled={busy} onClick={checkCurrent}>
                {t('diff.checkCurrent')}
              </Button>
            )}
            <Button variant="outline" onClick={actions.close}>
              {t('diff.back')}
            </Button>
          </div>
          {files.length > 0 && (
            <label className="dia-diff-file">
              {t('diff.file')}
              <select
                disabled={busy}
                value={snapshot?.newPath ?? snapshot?.oldPath ?? ''}
                onChange={(event) => {
                  onSuspend()
                  void perform({ action: 'capture', range, path: event.target.value }, acceptRead)
                }}
              >
                <option value="" disabled>
                  {t('diff.chooseFile')}
                </option>
                {files.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.status} · {file.path}
                  </option>
                ))}
              </select>
            </label>
          )}
          {busy && <p role="status">{t('diff.loading')}</p>}
          {error !== null && <p role="alert">{error}</p>}
          {proposal !== null && (
            <div role="status">
              {t('diff.proposal', { line: proposal.line })}{' '}
              <Button disabled={busy} onClick={rebind}>
                {t('diff.rebind')}
              </Button>
            </div>
          )}
          {!busy && files.length === 0 && snapshot === null && error === null && <p>{t('diff.noChanges')}</p>}
          {snapshot !== null && (
            <>
              <div className="dia-diff-heading">
                <strong>
                  {snapshot.oldPath !== null &&
                  snapshot.newPath !== null &&
                  snapshot.oldPath !== snapshot.newPath
                    ? `${snapshot.oldPath} → ${snapshot.newPath}`
                    : (snapshot.newPath ?? snapshot.oldPath)}
                </strong>
                <span>
                  {t(snapshot.id === originalSource?.snapshot.id ? 'diff.original' : 'diff.captured')} ·{' '}
                  {t(`diff.${snapshot.range}`)}
                </span>
                <Button variant="outline" onClick={() => setExpanded(!expanded)}>
                  {t(expanded ? 'diff.collapse' : 'diff.expand')}
                </Button>
              </div>
              <p className="dia-diff-help">{t('diff.help')}</p>
              {rows.length === 0 ? (
                <p>{t('diff.empty')}</p>
              ) : (
                <div className="dia-diff-scroll" ref={scroller}>
                  <div className="dia-diff-code" aria-label={t('diff.code')}>
                    <div className="dia-diff-row dia-diff-columns" aria-hidden="true">
                      <span className="dia-diff-gutter">{t('diff.old')}</span>
                      <span className="dia-diff-gutter">{t('diff.new')}</span>
                      <span className="dia-diff-markers" />
                      <span />
                    </div>
                    {shown.map((row, index) => {
                      if (row.kind === 'fold')
                        return (
                          <div key={`fold-${index}`} className="dia-diff-fold">
                            <Button variant="outline" onClick={() => setExpanded(true)}>
                              {t('diff.fold', { count: row.count })}
                            </Button>
                          </div>
                        )
                      const markers = view.annotations.filter(
                        (item) =>
                          item.source?.kind === 'diff' &&
                          item.source.snapshot.id === snapshot.id &&
                          item.source.startLine === row[item.source.side],
                      )
                      const selected =
                        originalSource?.snapshot.id === snapshot.id &&
                        row[originalSource.side] !== undefined &&
                        row[originalSource.side]! >= originalSource.startLine &&
                        row[originalSource.side]! <= originalSource.endLine
                      return (
                        <div
                          className="dia-diff-row"
                          data-kind={row.kind}
                          data-selected={selected || undefined}
                          key={`${row.old ?? ''}:${row.new ?? ''}`}
                        >
                          {(['old', 'new'] as const).map((side) => (
                            <span
                              key={side}
                              className="dia-diff-gutter"
                              {...{ [`data-${side}-line`]: row[side] }}
                            >
                              {row[side] !== undefined && (
                                <>
                                  <button
                                    type="button"
                                    className="dia-diff-plus"
                                    disabled={busy}
                                    aria-label={t('diff.add', { side: t(`diff.${side}`), line: row[side] })}
                                    title={t('diff.add', { side: t(`diff.${side}`), line: row[side] })}
                                    onKeyDown={(event) => {
                                      if (event.shiftKey && (event.key === 'Enter' || event.key === ' ')) {
                                        event.preventDefault()
                                        anchor(side, row[side]!, true)
                                      }
                                    }}
                                    onClick={(event) => anchor(side, row[side]!, event.shiftKey)}
                                  >
                                    +
                                  </button>
                                  <span aria-hidden="true">{row[side]}</span>
                                </>
                              )}
                            </span>
                          ))}
                          <span className="dia-diff-markers">
                            {markers.map((item) => (
                              <button
                                type="button"
                                key={item.annotationId}
                                onClick={() => onEdit(item.annotationId)}
                                aria-label={t('diff.marker', { ordinal: item.ordinal })}
                              >
                                #{item.ordinal}
                              </button>
                            ))}
                          </span>
                          <code>{row.text}</code>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <details className="dia-diagnostics">
                <summary>{t('diagnostics.title')}</summary>
                <pre>
                  {JSON.stringify(
                    {
                      snapshot: snapshot.id,
                      repository: snapshot.repository,
                      repositoryId: snapshot.repositoryId,
                      old: snapshot.old.oid ?? snapshot.old.sha256,
                      new: snapshot.new.oid ?? snapshot.new.sha256,
                      head: snapshot.head,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
          {children}
        </div>
      </Modal>
    </>
  )
}
