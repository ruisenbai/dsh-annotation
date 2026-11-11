/** Independent source bubble using the existing reference row and annotation floating placement. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconCloseOutlineRegular,
  MenuSurface,
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AssistantAnnotationProps } from '../contract.ts'
import type { SourceReferenceMarker } from '../controller.ts'
import type { MarkerGroup } from '../marker-layout.ts'
import { rendered, useAnnotationFloating } from '../floating.ts'
import { ReferenceRecord } from './SideChatReferences.tsx'

/**
 * Display and remove only the reference identified by this bubble.
 * @param props - Exact reference owner, content geometry and Session-addressed actions.
 * @returns One accessible bubble and its independently dismissible record dialog.
 */
export function ReferenceMarkerButton({
  group,
  item,
  t,
  remove,
  locate,
  onPreview,
}: {
  readonly group: MarkerGroup
  readonly item: SourceReferenceMarker
  readonly t: AssistantAnnotationProps['t']
  readonly remove: AssistantAnnotationProps['removeSourceReference']
  readonly locate: AssistantAnnotationProps['locateSideChatReference']
  readonly onPreview: (active: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const preview = useRef(onPreview)
  useEffect(() => {
    preview.current = onPreview
  }, [onPreview])
  useEffect(() => () => preview.current(false), [])
  const close = useCallback(() => {
    setOpen(false)
    onPreview(false)
  }, [onPreview])
  const floating = useAnnotationFloating({ enabled: open, floatingRef: panel, anchor: () => anchor.current })
  useDismissOnOutsidePointer(anchor, open, close, panel)
  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        anchor.current?.focus()
      }
    }
    const check = () => {
      if (anchor.current !== null && !rendered(anchor.current)) close()
    }
    const observer = new MutationObserver(check)
    for (let element: HTMLElement | null = anchor.current; element !== null; element = element.parentElement)
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'inert', 'aria-hidden'],
      })
    document.addEventListener('keydown', dismiss)
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', dismiss)
    }
  }, [close, open])
  const label = t('sideChat.referenceLabel', { ordinal: item.ordinal })
  return (
    <>
      <Tooltip
        portal
        label={item.reference.quote.exact}
        side="top"
        delayMs={300}
        maxWidth={280}
        disabled={open}
      >
        <button
          ref={anchor}
          type="button"
          className="dia-marker"
          data-reference-id={item.reference.referenceId}
          data-active={open}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          style={{
            top: group.top,
            left: group.left,
            width: group.width,
            height: group.height,
            fontSize: group.fontSize,
            fontFamily: group.fontFamily,
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') onPreview(true)
          }}
          onPointerLeave={() => {
            if (!open) onPreview(false)
          }}
          onFocus={() => onPreview(true)}
          onBlur={() => {
            if (!open) onPreview(false)
          }}
          onClick={() => setOpen((current) => !current)}
        >
          <span
            style={{
              left: group.labelLeft,
              top: group.labelTop,
              bottom: group.labelTop === undefined ? undefined : 'auto',
            }}
          >
            {item.ordinal}
          </span>
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <MenuSurface
            ref={panel}
            role="dialog"
            aria-label={label}
            className="dia-marker-popover dia-record"
            style={floating.style}
            data-floating-placement={floating.placement}
          >
            <Button
              size="sm"
              variant="ghost"
              className="dia-marker-popover__close"
              icon={<IconCloseOutlineRegular size={16} />}
              aria-label={t('editor.cancel')}
              onClick={close}
            />
            <ReferenceRecord
              reference={item.reference}
              ordinal={item.ordinal}
              t={t}
              disabled={item.disabled}
              locateReference={locate ?? (async () => false)}
              {...(remove === undefined
                ? {}
                : {
                    removeReference: (id: Parameters<NonNullable<typeof remove>>[1]) =>
                      remove(item.sideChatId, id),
                  })}
            />
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}
