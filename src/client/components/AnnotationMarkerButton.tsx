import { useRef, useState } from 'react'
import { Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotationDraft, AnnotationId } from '../../shared/types.ts'
import type { MarkerGroup } from '../marker-layout.ts'
import type { InputAnnotationProps } from '../contract.ts'

function previewText(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
}

/** Numbered marker shared by assistant replies and mounted official resources. */
export function AnnotationMarkerButton({
  group,
  annotations,
  t,
  activeId,
  detailsOpen,
  editorOpen,
  onPreview,
  onOpen,
}: {
  readonly group: MarkerGroup
  readonly annotations: readonly AnnotationDraft[]
  readonly t: InputAnnotationProps['t']
  readonly activeId: AnnotationId | null
  readonly detailsOpen: boolean
  readonly editorOpen: boolean
  readonly onPreview: (id: AnnotationId | null) => void
  readonly onOpen: (item: AnnotationDraft) => void
}) {
  const [groupOpen, setGroupOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const members = group.annotationIds.flatMap((id) => {
    const item = annotations.find((candidate) => candidate.annotationId === id)
    return item === undefined ? [] : [item]
  })
  const first = members[0]
  if (first === undefined) return null
  const annotation = members.find((item) => item.annotationId === activeId) ?? first
  const grouped = members.length > 1
  const label = grouped
    ? t('marker.groupLabel', {
        count: members.length,
        ordinals: members.map((item) => item.ordinal).join(', '),
      })
    : `#${annotation.ordinal}: ${annotation.annotation === '' ? t('highlightOnly') : annotation.annotation}`
  const button = (
    <Tooltip
      label={grouped ? label : previewText(annotation.annotation || t('highlightOnly'))}
      side="top"
      delayMs={300}
      maxWidth={280}
      disabled={detailsOpen || groupOpen}
    >
      <button
        ref={buttonRef}
        type="button"
        className="dia-marker"
        data-annotation-id={first.annotationId}
        data-annotation-ids={group.annotationIds.join(' ')}
        data-status={annotation.status}
        data-active={members.some((item) => item.annotationId === activeId)}
        style={{
          top: group.top,
          left: group.left,
          width: group.width,
          height: group.height,
          pointerEvents: 'auto',
        }}
        aria-label={label}
        aria-haspopup={grouped ? 'menu' : 'dialog'}
        aria-expanded={grouped ? groupOpen : undefined}
        disabled={editorOpen}
        onPointerEnter={() => onPreview(annotation.annotationId)}
        onPointerLeave={() => onPreview(activeId)}
        onFocus={() => onPreview(annotation.annotationId)}
        onBlur={() => onPreview(activeId)}
        onClick={() => (grouped ? setGroupOpen((open) => !open) : onOpen(annotation))}
      >
        <span>{grouped ? t('marker.groupCount', { count: members.length }) : annotation.ordinal}</span>
      </button>
    </Tooltip>
  )
  return grouped ? (
    <Menu
      open={groupOpen && !editorOpen}
      portal
      dense
      autoFocus
      anchor={button}
      getAnchorRect={() => buttonRef.current?.getBoundingClientRect() ?? null}
      onClose={() => setGroupOpen(false)}
      items={members.map((item) => ({
        id: item.annotationId,
        label: `#${item.ordinal} ${item.annotation || t('highlightOnly')}`,
      }))}
      selectedId={activeId ?? undefined}
      onSelect={(id) => {
        setGroupOpen(false)
        const item = members.find((member) => member.annotationId === id)
        if (item !== undefined) onOpen(item)
      }}
    />
  ) : (
    button
  )
}
