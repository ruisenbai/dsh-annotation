/** Settings recycle bin: durable deleted annotations and their available original sources. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Button,
  HoverCard,
  IconChevronDownOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AnnotationTrashInjected, AnnotationTrashRow } from '../annotation-trash.ts'
import type { SourceSnapshotView } from '../source-snapshots.ts'
import { sourceType } from '../../shared/annotation-source.ts'
import { AnnotationDetails } from './AnnotationDetails.tsx'

type Props = InjectFace<AnnotationTrashInjected> &
  PropsLocale<'dshAnnotation'> & {
    readonly useSessionCatalog: SnapshotSelectorHook<SessionListState>
  }

function sessionLabel(id: string, catalog: SessionListState['byId']): string {
  const summary = catalog[id as SessionId]
  if (summary === undefined) return id
  const cwd = summary.cwd?.replace(/[/\\]+$/u, '') ?? ''
  const project = cwd.slice(Math.max(cwd.lastIndexOf('/'), cwd.lastIndexOf('\\')) + 1)
  const title = summary.title?.trim() || summary.displayTitle
  return project !== '' && title !== project ? `${project} - ${title}` : title
}

function rowKey(row: AnnotationTrashRow): string {
  return JSON.stringify([row.sessionId, row.entry.annotation.annotationId])
}

function FullValue({ value }: { readonly value: string }) {
  return (
    <HoverCard
      inline
      anchor={
        <span className="dia-trash__ellipsis" tabIndex={0}>
          {value}
        </span>
      }
      content={<span className="dia-trash__hover-value">{value}</span>}
    />
  )
}

function SourceContent({
  row,
  revision,
  read,
  t,
}: {
  readonly row: AnnotationTrashRow
  readonly revision: number
  readonly read: Props['readSourceSnapshot']
  readonly t: Props['t']
}) {
  const [snapshot, setSnapshot] = useState<SourceSnapshotView>({ state: 'fragment' })
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let current = true
    setSnapshot({ state: 'fragment' })
    void read(row.sessionId, row.entry.annotation.annotationId).then(
      (value) => {
        if (current) setSnapshot(value)
      },
      () => {
        if (current) setSnapshot({ state: 'fragment', error: 'storage' })
      },
    )
    return () => {
      current = false
    }
  }, [row.sessionId, row.entry.annotation.annotationId, revision, read])
  const content = snapshot.content
  useEffect(() => {
    if (content?.data === undefined) {
      setUrl(undefined)
      return
    }
    const bytes = new Uint8Array(content.data.length)
    bytes.set(content.data)
    const next = URL.createObjectURL(new Blob([bytes], { type: content.mediaType }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [content])
  const source = row.entry.annotation.source
  const path =
    source?.kind === 'file'
      ? source.path
      : source?.kind === 'official-diff'
        ? source.snapshot.path
        : undefined
  return (
    <section className="dia-trash__source">
      <h3>{t('trash.fullSource')}</h3>
      {snapshot.state === 'capturing' ? <p role="status">{t('trash.capturing')}</p> : null}
      {snapshot.state === 'fragment' ? (
        <p>{t(snapshot.error === undefined ? 'trash.fragment' : 'trash.snapshotUnavailable')}</p>
      ) : null}
      {content !== undefined && (content.text !== '' || content.mediaType.startsWith('text/')) ? (
        <pre>{content.text}</pre>
      ) : null}
      {url !== undefined && content?.mediaType.startsWith('image/') ? (
        <img className="dia-trash__image" src={url} alt={path ?? t('trash.fullSource')} />
      ) : null}
      {url !== undefined && content?.mediaType === 'application/pdf' ? (
        <iframe className="dia-trash__pdf" src={url} title={t('trash.fullSource')} sandbox="" />
      ) : null}
      {url !== undefined ? (
        <a href={url} download={path?.split('/').at(-1)}>
          {t('trash.download')}
        </a>
      ) : null}
    </section>
  )
}

/** Recycle-bin operations are independent of whether the Host settings form is writable. */
export function AnnotationTrashPanel(props: Props) {
  const { t } = props
  const view = props.useAnnotationTrash((state) => state)
  const revision = props.useSourceSnapshots((state) => state)
  const catalog = props.useSessionCatalog((state) => state.byId)
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState('all')
  const [kind, setKind] = useState('all')
  const [selected, setSelected] = useState<string>()
  const [confirmation, setConfirmation] = useState<readonly AnnotationTrashRow[]>()
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const sessionFilter = useRef<HTMLSelectElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const sessions = [...new Set(view.rows.map((row) => row.sessionId))]
  const visible = view.rows.filter(
    (row) =>
      (session === 'all' || row.sessionId === session) &&
      (kind === 'all' || sourceType(row.entry.annotation) === kind),
  )
  const detail = visible.find((row) => rowKey(row) === selected)

  useEffect(() => {
    if (selected !== undefined && detail === undefined) setSelected(undefined)
  }, [detail, selected])

  const focusFallback = (): void => {
    requestAnimationFrame(() => {
      const row = list.current?.querySelector<HTMLButtonElement>('.dia-trash__disclosure')
      if (row !== undefined && row !== null) row.focus()
      else sessionFilter.current?.focus()
    })
  }

  const restore = async (row: AnnotationTrashRow) => {
    setBusy(true)
    try {
      const restored = await props.restoreTrashed(row.sessionId, [row.entry.annotation.annotationId])
      if (restored) {
        if (selected === rowKey(row)) setSelected(undefined)
        focusFallback()
      }
    } finally {
      setBusy(false)
    }
  }

  const purge = async () => {
    if (confirmation === undefined) return
    setBusy(true)
    try {
      const removed = await props.purgeTrashed(confirmation)
      if (!removed) return
      const removedKeys = new Set(confirmation.map(rowKey))
      if (selected !== undefined && removedKeys.has(selected)) setSelected(undefined)
      setConfirmation(undefined)
      focusFallback()
    } finally {
      setBusy(false)
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.dia-trash-modal') !== null) return
    sessionFilter.current?.focus()
  }, [open])

  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        variant="outline"
        onClick={() => {
          props.refreshTrash()
          setOpen(true)
        }}
      >
        {t('trash.open', { count: view.rows.length })}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false)
        }}
        title={t('trash.title')}
        closeLabel={t('trash.close')}
        description={t('trash.description')}
        className="dia-trash-modal"
        contentClassName="dia-trash-modal__content"
      >
        <div className="dia-trash">
          <div className="dia-trash__toolbar">
            <label className="dia-trash__session-field">
              <span>{t('trash.session')}</span>
              <span className="dia-trash__select-wrap">
                <select
                  ref={sessionFilter}
                  aria-label={t('trash.session')}
                  value={session}
                  onChange={(event) => {
                    setSession(event.target.value)
                    setSelected(undefined)
                  }}
                >
                  <option value="all">{t('trash.allSessions')}</option>
                  {sessions.map((id) => (
                    <option key={id} value={id} title={String(id)}>
                      {sessionLabel(id, catalog)}
                    </option>
                  ))}
                </select>
                <IconChevronDownOutlineRegular aria-hidden="true" />
              </span>
            </label>
            <fieldset className="dia-trash__source-filter">
              <legend>{t('trash.source')}</legend>
              {(
                [
                  ['all', 'records.filterAll'],
                  ['message', 'records.filterBody'],
                  ['file', 'records.filterFile'],
                  ['diff', 'records.filterDiff'],
                ] as const
              ).map(([value, key]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="dia-trash-source"
                    value={value}
                    checked={kind === value}
                    onChange={() => {
                      setKind(value)
                      setSelected(undefined)
                    }}
                  />
                  <span>{t(key)}</span>
                </label>
              ))}
            </fieldset>
            <Button
              size="sm"
              variant="outline"
              className="dia-danger-button"
              disabled={busy || view.rows.length === 0}
              onClick={() => setConfirmation(view.rows)}
            >
              {t('trash.clear')}
            </Button>
          </div>
          {view.error !== null ? (
            <div className="dia-trash__notice" role="alert">
              <span>{t(`trash.error.${view.error}`)}</span>
              <Button size="sm" variant="ghost" onClick={props.refreshTrash}>
                {t('trash.retry')}
              </Button>
            </div>
          ) : null}
          <div className="dia-trash__workspace">
            {visible.length === 0 ? (
              <p className="dia-trash__empty">{t('trash.empty')}</p>
            ) : (
              <ul ref={list} className="dia-trash__list">
                {visible.map((row) => {
                  const item = row.entry.annotation
                  const key = rowKey(row)
                  const expanded = detail === row
                  return (
                    <li className="dia-trash__row" data-selected={expanded || undefined} key={key}>
                      <button
                        type="button"
                        className="dia-trash__disclosure"
                        aria-expanded={expanded}
                        onClick={() => setSelected(expanded ? undefined : key)}
                      >
                        <span className="dia-trash__annotation">{item.annotation || t('highlightOnly')}</span>
                        <small className="dia-trash__time">
                          {t('trash.deletedAt')}: {new Date(row.entry.deletedAt).toLocaleString()}
                        </small>
                      </button>
                      <div className="dia-trash__row-actions">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restore(row)}>
                          {t('trash.restore')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="dia-danger-button"
                          disabled={busy}
                          onClick={() => setConfirmation([row])}
                        >
                          {t('trash.deleteForever')}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {detail === undefined ? (
              <div className="dia-trash__detail dia-trash__detail--empty" aria-hidden="true" />
            ) : (
              <div className="dia-trash__detail">
                <dl className="dia-trash__identity">
                  <dt>{t('trash.session')}</dt>
                  <dd>
                    <FullValue value={String(detail.sessionId)} />
                  </dd>
                </dl>
                <AnnotationDetails item={detail.entry.annotation} t={t}>
                  <SourceContent row={detail} revision={revision} read={props.readSourceSnapshot} t={t} />
                </AnnotationDetails>
              </div>
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={confirmation !== undefined}
        onClose={() => {
          if (!busy) setConfirmation(undefined)
        }}
        title={t('trash.confirmTitle')}
        closeLabel={t('trash.close')}
        className="dia-trash-confirm-modal"
        contentClassName="dia-trash-confirm-modal__content"
        footer={
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmation(undefined)}>
              {t('trash.cancel')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="dia-danger-button"
              disabled={busy}
              onClick={() => void purge()}
            >
              {t('trash.deleteForever')}
            </Button>
          </>
        }
      >
        <p>{t('trash.confirmText', { count: confirmation?.length ?? 0 })}</p>
        {view.error === 'write' || view.error === 'locked' || view.error === 'cleanup' ? (
          <p className="dia-trash__notice" role="alert">
            {t(`trash.error.${view.error}`)}
          </p>
        ) : null}
      </Modal>
    </>
  )
}
