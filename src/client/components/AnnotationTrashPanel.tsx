/** Settings recycle bin: durable deleted annotations and their available original sources. */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationTrashInjected, AnnotationTrashRow } from '../annotation-trash.ts'
import type { SourceSnapshotView } from '../source-snapshots.ts'
import { sourceType } from '../../shared/annotation-source.ts'
import { AnnotationDetails } from './AnnotationDetails.tsx'

type Props = InjectFace<AnnotationTrashInjected> & PropsLocale<'dshAnnotation'>

function rowKey(row: AnnotationTrashRow): string {
  return JSON.stringify([row.sessionId, row.entry.annotation.annotationId])
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
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState('all')
  const [kind, setKind] = useState('all')
  const [selected, setSelected] = useState<string>()
  const [confirmation, setConfirmation] = useState<readonly AnnotationTrashRow[]>()
  const [busy, setBusy] = useState(false)
  const sessions = [...new Set(view.rows.map((row) => row.sessionId))]
  const visible = view.rows.filter(
    (row) =>
      (session === 'all' || row.sessionId === session) &&
      (kind === 'all' || sourceType(row.entry.annotation) === kind),
  )
  const detail = visible.find((row) => rowKey(row) === selected)
  const restore = async (row: AnnotationTrashRow) => {
    setBusy(true)
    try {
      await props.restoreTrashed(row.sessionId, [row.entry.annotation.annotationId])
    } finally {
      setBusy(false)
    }
  }
  const purge = async () => {
    if (confirmation === undefined) return
    setBusy(true)
    try {
      await props.purgeTrashed(confirmation)
      setConfirmation(undefined)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="dia-plugin-card__discard"
        onClick={() => {
          props.refreshTrash()
          setOpen(true)
        }}
      >
        {t('trash.open', { count: view.rows.length })}
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false)
        }}
        title={t('trash.title')}
        closeLabel={t('trash.close')}
        description={t('trash.description')}
        className="dia-trash"
      >
        <div className="dia-trash__toolbar">
          <select
            aria-label={t('trash.session')}
            value={session}
            onChange={(event) => setSession(event.target.value)}
          >
            <option value="all">{t('trash.allSessions')}</option>
            {sessions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <select
            aria-label={t('trash.source')}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">{t('records.filterAll')}</option>
            <option value="message">{t('records.filterBody')}</option>
            <option value="file">{t('records.filterFile')}</option>
            <option value="diff">{t('records.filterDiff')}</option>
          </select>
          <button
            type="button"
            className="dia-plugin-card__discard"
            data-danger="true"
            disabled={busy || view.rows.length === 0}
            onClick={() => setConfirmation(view.rows)}
          >
            {t('trash.clear')}
          </button>
        </div>
        {view.error !== null ? (
          <div className="dia-trash__notice" role="alert">
            {t(`trash.error.${view.error}`)}{' '}
            <button type="button" onClick={props.refreshTrash}>
              {t('trash.retry')}
            </button>
          </div>
        ) : null}
        {visible.length === 0 ? (
          <p>{t('trash.empty')}</p>
        ) : (
          <ul className="dia-trash__list">
            {visible.map((row) => {
              const item = row.entry.annotation
              return (
                <li className="dia-trash__row" key={rowKey(row)}>
                  <button
                    type="button"
                    aria-expanded={detail === row}
                    onClick={() => setSelected(detail === row ? undefined : rowKey(row))}
                  >
                    <span>{item.annotation || t('highlightOnly')}</span>
                    <small>
                      {t('trash.deletedAt')}: {new Date(row.entry.deletedAt).toLocaleString()}
                    </small>
                  </button>
                  <div>
                    <button type="button" disabled={busy} onClick={() => void restore(row)}>
                      {t('trash.restore')}
                    </button>
                    <button
                      type="button"
                      data-danger="true"
                      disabled={busy}
                      onClick={() => setConfirmation([row])}
                    >
                      {t('trash.deleteForever')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {detail === undefined ? null : (
          <div className="dia-trash__detail">
            <p>
              {t('trash.session')}: {detail.sessionId}
            </p>
            <AnnotationDetails item={detail.entry.annotation} t={t}>
              <SourceContent row={detail} revision={revision} read={props.readSourceSnapshot} t={t} />
            </AnnotationDetails>
          </div>
        )}
      </Modal>
      <Modal
        open={confirmation !== undefined}
        onClose={() => {
          if (!busy) setConfirmation(undefined)
        }}
        title={t('trash.confirmTitle')}
        closeLabel={t('trash.close')}
        className="dia-trash__confirm"
        footer={
          <>
            <button type="button" disabled={busy} onClick={() => setConfirmation(undefined)}>
              {t('trash.cancel')}
            </button>
            <button type="button" data-danger="true" disabled={busy} onClick={() => void purge()}>
              {t('trash.deleteForever')}
            </button>
          </>
        }
      >
        <p>{t('trash.confirmText', { count: confirmation?.length ?? 0 })}</p>
      </Modal>
    </>
  )
}
