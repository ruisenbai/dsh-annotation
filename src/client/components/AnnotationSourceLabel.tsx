import type { AnnotationAnchor } from '../../shared/annotation-source.ts'
import type { InputAnnotationProps } from '../contract.ts'

/**
 * Render readable file coordinates for a historical Diff annotation.
 * @param props Decoded annotation and locale dictionary.
 * @returns A Diff source label, or no label for a message source.
 */
export function AnnotationSourceLabel({ item, t }: { item: AnnotationAnchor; t: InputAnnotationProps['t'] }) {
  const source = item.source
  if (source?.kind !== 'diff') return null
  const snapshot = source.snapshot
  return (
    <span className="dia-source-label">
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
