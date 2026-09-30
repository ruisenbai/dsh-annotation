/** Complete source information shared by record previews and deleted-record details. */
import type { ReactNode } from 'react'
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotationDraft } from '../../shared/types.ts'
import { officialDiffContext } from '../../shared/official-source.ts'
import type { InputAnnotationProps } from '../contract.ts'
import { AnnotationSourceLabel, displayAnnotationQuote } from './AnnotationSourceLabel.tsx'

function FullValue({ value }: { readonly value: string }) {
  return (
    <HoverCard
      inline
      anchor={
        <span className="dia-detail-value" tabIndex={0}>
          {value}
        </span>
      }
      content={<span className="dia-detail-value__full">{value}</span>}
    />
  )
}

/**
 * Show captured text without list truncation or assumptions about current file contents.
 * @param props Saved annotation, localized labels, and optional historical-content viewer.
 * @returns Selectable source and annotation details.
 */
export function AnnotationDetails({
  item,
  t,
  children,
}: {
  item: AnnotationDraft
  t: InputAnnotationProps['t']
  children?: ReactNode
}) {
  const source = item.source
  const located = source !== undefined && source.kind !== 'message' ? source : undefined
  const path =
    source?.kind === 'file'
      ? source.path
      : source?.kind === 'official-diff'
        ? source.snapshot.path
        : source?.kind === 'diff'
          ? (source.snapshot.newPath ?? source.snapshot.oldPath)
          : undefined
  const start = located?.startLine
  const end = located?.endLine
  const columns =
    located !== undefined && 'startColumn' in located && located.startColumn !== undefined
      ? `:${located.startColumn + 1}`
      : ''
  const endColumns =
    located !== undefined && 'endColumn' in located && located.endColumn !== undefined
      ? `:${located.endColumn}`
      : ''
  const session =
    source?.kind === 'file'
      ? source.sessionId
      : source?.kind === 'official-diff' || source?.kind === 'diff'
        ? source.snapshot.sessionId
        : undefined
  const diffContext = source?.kind === 'official-diff' ? officialDiffContext(source) : undefined
  return (
    <section className="dia-annotation-details" aria-label={t('details.title')}>
      <strong>{t('details.annotation')}</strong>
      <p>{item.annotation || t('highlightOnly')}</p>
      <strong>{t('details.quote')}</strong>
      <q>{displayAnnotationQuote(item, t) || t('source.wholeFile')}</q>
      {(item.quote.prefix || item.quote.suffix) && (
        <>
          <strong>{t('details.context')}</strong>
          <pre>
            {item.quote.prefix}
            <mark>{item.quote.exact}</mark>
            {item.quote.suffix}
          </pre>
        </>
      )}
      <AnnotationSourceLabel item={item} t={t} />
      <dl>
        {path && (
          <>
            <dt>{t('details.filename')}</dt>
            <dd>{path.split(/[\\/]/u).at(-1)}</dd>
            <dt>{t('details.path')}</dt>
            <dd>
              <FullValue value={path} />
            </dd>
          </>
        )}
        {source?.kind === 'file' && (
          <>
            <dt>{t('details.address')}</dt>
            <dd>
              <FullValue value={source.resourceAddress} />
            </dd>
            <dt>{t('details.version')}</dt>
            <dd>
              <FullValue value={source.resourceVersion} />
            </dd>
          </>
        )}
        {start !== undefined && end !== undefined && (
          <>
            <dt>{t('details.location')}</dt>
            <dd>
              {start}
              {columns}–{end}
              {endColumns}
            </dd>
          </>
        )}
        {source?.kind === 'file' && source.snapshot.coordinateSpace === 'rendered' && (
          <>
            <dt>{t('details.coordinates')}</dt>
            <dd>{t('details.rendered')}</dd>
            <dt>{t('details.renderedOffsets')}</dt>
            <dd>
              {item.quote.start}–{item.quote.end}
            </dd>
          </>
        )}
        {session && (
          <>
            <dt>{t('details.session')}</dt>
            <dd>
              <FullValue value={String(session)} />
            </dd>
          </>
        )}
        {source === undefined || source.kind === 'message' ? (
          <>
            <dt>{t('details.message')}</dt>
            <dd>
              <FullValue value={String(item.messageId)} />
            </dd>
          </>
        ) : null}
        {source?.kind === 'official-diff' && (
          <>
            <dt>{t('details.turn')}</dt>
            <dd>{source.snapshot.turn}</dd>
            <dt>{t('details.changeSequence')}</dt>
            <dd>{source.snapshot.seq}</dd>
            <dt>{t('details.fileIndex')}</dt>
            <dd>{source.snapshot.fileIndex}</dd>
            <dt>{t('details.side')}</dt>
            <dd>{source.side === 'file' ? t('source.wholeFile') : t(`diff.${source.side}`)}</dd>
            <dt>{t('details.version')}</dt>
            <dd>
              <FullValue value={source.snapshot.hash} />
            </dd>
            {diffContext?.before && (
              <>
                <dt>{t('details.contextBefore')}</dt>
                <dd>
                  <pre>{diffContext.before}</pre>
                </dd>
              </>
            )}
            {diffContext?.after && (
              <>
                <dt>{t('details.contextAfter')}</dt>
                <dd>
                  <pre>{diffContext.after}</pre>
                </dd>
              </>
            )}
          </>
        )}
        <dt>{t('details.status')}</dt>
        <dd>{t(`status.${item.status}`)}</dd>
      </dl>
      {children}
    </section>
  )
}
