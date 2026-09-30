import type { AnnotationAnchor } from '../../shared/annotation-source.ts'
import type { InputAnnotationProps } from '../contract.ts'
import type { TextQuoteSelector } from '../../shared/types.ts'

/** The file label belongs to presentation; persisted quote.exact remains unchanged. */
export function displayAnnotationQuote(
  item: AnnotationAnchor & { readonly quote: TextQuoteSelector },
  t: InputAnnotationProps['t'],
): string {
  return item.source?.kind === 'file' && item.quote.exact !== ''
    ? `${t('source.fileQuotePrefix')}${item.quote.exact}`
    : item.quote.exact
}

/** Render the immutable source identity, path, location, and creation entry of one record. */
export function AnnotationSourceLabel({ item, t }: { item: AnnotationAnchor; t: InputAnnotationProps['t'] }) {
  const source = item.source
  if (source === undefined || source.kind === 'message') {
    return (
      <span className="dia-source-label">
        <span>{t('source.body')}</span>
        <span>{t('creation.body')}</span>
      </span>
    )
  }
  if (source.kind === 'diff') {
    const snapshot = source.snapshot
    return (
      <span className="dia-source-label">
        <span>{t('source.diff')}</span>
        <span>{t('diff.legacyReadOnly')}</span>
        <span>
          {snapshot.oldPath !== snapshot.newPath && snapshot.oldPath !== null && snapshot.newPath !== null
            ? `${snapshot.oldPath} → ${snapshot.newPath}`
            : (snapshot.newPath ?? snapshot.oldPath)}
        </span>
        <span>
          {t(`diff.${snapshot.range}`)} · {t(`diff.${source.side}`)} · {source.startLine}–{source.endLine}
        </span>
      </span>
    )
  }
  const entry =
    source.entry === 'body'
      ? t('creation.body')
      : source.entry === 'hover'
        ? t('creation.hover')
        : t('creation.sidebar')
  if (source.kind === 'file') {
    return (
      <span className="dia-source-label">
        <span>{t('source.file')}</span>
        {source.expired ? <span>{t('source.expired')}</span> : null}
        <span>{source.path}</span>
        <span>
          {source.wholeFile ? t('source.wholeFile') : ''} · {entry}
        </span>
      </span>
    )
  }
  const lineLocation =
    source.startLine === undefined || source.endLine === undefined
      ? ''
      : source.startLine === source.endLine
        ? String(source.startLine)
        : `${source.startLine}–${source.endLine}`
  const columnLocation =
    source.startColumn === undefined || source.endColumn === undefined
      ? ''
      : `:${source.startColumn + 1}–${source.endColumn}`
  return (
    <span className="dia-source-label">
      <span>{t('source.diff')}</span>
      {source.expired ? <span>{t('source.expired')}</span> : null}
      <span>{source.snapshot.path}</span>
      <span>
        {source.wholeFile
          ? t('source.wholeFile')
          : `${t(`diff.${source.side}`)} · ${lineLocation}${columnLocation}`}{' '}
        · {entry}
      </span>
    </span>
  )
}
