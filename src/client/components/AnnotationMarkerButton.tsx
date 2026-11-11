/** One directly accessible numbered button per saved annotation. */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotationDraft, AnnotationId, SessionIdentity } from '../../shared/types.ts'
import type { MarkerGroup } from '../marker-layout.ts'
import type { InputAnnotationProps } from '../contract.ts'

function previewText(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
}

/**
 * Open exactly this annotation without aggregating adjacent or identical selections.
 * @param props - One marker's geometry, record and annotation actions.
 * @returns Its independently focusable button and official preview.
 */
export function AnnotationMarkerButton({
  group,
  annotations,
  t,
  activeId,
  detailsOpen,
  editorOpen,
  onPreview,
  onOpen,
  ownerTitle,
  targetSessionId,
}: {
  readonly group: MarkerGroup
  readonly annotations: readonly AnnotationDraft[]
  readonly t: InputAnnotationProps['t']
  readonly activeId: AnnotationId | null
  readonly detailsOpen: boolean
  readonly editorOpen: boolean
  readonly onPreview: (id: AnnotationId | null) => void
  readonly onOpen: (item: AnnotationDraft) => void
  readonly ownerTitle?: string | undefined
  readonly targetSessionId?: SessionIdentity | undefined
}) {
  const annotation = annotations.find((item) => item.annotationId === group.annotationIds[0])
  if (annotation === undefined) return null
  const opinion = annotation.annotation === '' ? t('highlightOnly') : annotation.annotation
  const label = `${ownerTitle === undefined ? '' : `${ownerTitle} · `}#${annotation.ordinal}: ${opinion}`
  return (
    <Tooltip
      label={previewText(ownerTitle === undefined ? opinion : `${ownerTitle} · ${opinion}`)}
      portal
      side="top"
      delayMs={300}
      maxWidth={280}
      disabled={detailsOpen}
    >
      <button
        type="button"
        className="dia-marker"
        data-annotation-id={annotation.annotationId}
        data-dia-annotation-target={targetSessionId}
        data-annotation-ids={annotation.annotationId}
        data-status={annotation.status}
        data-active={annotation.annotationId === activeId}
        style={{
          top: group.top,
          left: group.left,
          width: group.width,
          height: group.height,
          fontSize: group.fontSize,
          fontFamily: group.fontFamily,
          pointerEvents: 'auto',
        }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={annotation.annotationId === activeId && detailsOpen}
        disabled={editorOpen}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') onPreview(annotation.annotationId)
        }}
        onPointerLeave={() => onPreview(activeId)}
        onFocus={() => onPreview(annotation.annotationId)}
        onBlur={() => onPreview(activeId)}
        onClick={() => onOpen(annotation)}
      >
        <span
          style={{
            left: group.labelLeft,
            top: group.labelTop,
            bottom: group.labelTop === undefined ? undefined : 'auto',
          }}
        >
          {annotation.ordinal}
        </span>
      </button>
    </Tooltip>
  )
}
