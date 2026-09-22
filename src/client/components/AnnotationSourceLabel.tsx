/** File positions are user-facing; hashes and repository identity remain diagnostic details. */
import type { AnnotationAnchor } from '../../shared/annotation-source.ts'
import type { InputAnnotationProps } from '../contract.ts'

/** Render localized file coordinates without showing internal identifiers by default.
 * @param props - Decoded annotation, locale dictionary and optional diagnostic disclosure.
 * @returns A Diff source label, or no label for a message source.
 */
export function AnnotationSourceLabel({
  item,
  t,
  diagnostics = false,
}: {
  item: AnnotationAnchor
  t: InputAnnotationProps['t']
  diagnostics?: boolean
}) {
  const source = item.source
  if (source?.kind !== 'diff') return null
  const snapshot = source.snapshot
  return (
    <>
      <span className="dia-source-label">
        <span>
          {snapshot.oldPath !== snapshot.newPath && snapshot.oldPath !== null && snapshot.newPath !== null
            ? `${snapshot.oldPath} → ${snapshot.newPath}`
            : (snapshot.newPath ?? snapshot.oldPath)}
        </span>
        <span>
          {t(`diff.${snapshot.range}`)} · {t(`diff.${source.side}`)} · {source.startLine}–{source.endLine}
        </span>
      </span>
      {diagnostics && (
        <details className="dia-diagnostics">
          <summary>{t('diagnostics.title')}</summary>
          <pre>
            {JSON.stringify(
              {
                repository: snapshot.repository,
                repositoryId: snapshot.repositoryId,
                snapshot: snapshot.id,
                head: snapshot.head,
                old: snapshot.old.oid ?? snapshot.old.sha256,
                new: snapshot.new.oid ?? snapshot.new.sha256,
                fingerprint: source.fingerprint,
                reboundFrom: source.reboundFrom?.snapshot.id,
              },
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </>
  )
}
