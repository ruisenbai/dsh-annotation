/** Emphasize validated reply labels only in the host's Markdown display projection. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { parseReplyMarkers } from '../shared/model-ack.ts'
import { replyHeadingNeedles } from '../shared/protocol.ts'
import type { AnnotationView } from './controller.ts'

interface Span {
  start: number
  end: number
}
interface MarkdownNode {
  readonly type: string
  readonly children?: readonly MarkdownNode[] | undefined
  readonly position?:
    | {
        readonly start: { readonly offset?: number | undefined }
        readonly end: { readonly offset?: number | undefined }
      }
    | undefined
}

/**
 * Resolve trusted annotation/submission pairs already observed by the controller.
 * @param view Current annotation history and immutable outgoing records.
 * @returns Composite pair keys; an ordinal by itself never authorizes decoration.
 */
export function knownReplyPairs(
  view: Pick<AnnotationView, 'annotations' | 'outbox' | 'replyAssociations'>,
): ReadonlySet<string> {
  const ids = new Set(view.annotations.map((item) => item.annotationId))
  const pairs = new Set<string>()
  for (const item of view.annotations) {
    if (item.submissionId !== undefined) pairs.add(`${item.submissionId}\0${item.annotationId}`)
  }
  for (const item of view.replyAssociations ?? []) {
    if (ids.has(item.annotationId)) pairs.add(`${item.submissionId}\0${item.annotationId}`)
  }
  for (const entry of view.outbox) {
    if (entry.status !== 'sent') continue
    for (const item of entry.payload.annotations) {
      if (ids.has(item.annotationId)) pairs.add(`${entry.payload.submissionId}\0${item.annotationId}`)
    }
  }
  return pairs
}

/**
 * Add Markdown strong delimiters to an associated label without changing source text storage.
 * @param raw Original message block, including association comments.
 * @param known Known submission/annotation pairs.
 * @returns Display-only Markdown; code, quotes, links, math and existing strong nodes are unchanged.
 */
export function emphasizeReplyLabels(raw: string, known: ReadonlySet<string>): string {
  const markers = parseReplyMarkers(raw)
  if (markers.length === 0 || known.size === 0) return raw
  const plain: (Span & { strong: boolean })[] = []
  const comments: Span[] = []
  const visit = (node: MarkdownNode, strong = false): void => {
    if (
      ['blockquote', 'code', 'inlineCode', 'math', 'inlineMath', 'link', 'linkReference', 'image'].includes(
        node.type,
      )
    )
      return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) {
      if (node.type === 'text') plain.push({ start, end, strong })
      if (node.type === 'html') comments.push({ start, end })
    }
    node.children?.forEach((child) => visit(child, strong || node.type === 'strong'))
  }
  visit(
    fromMarkdown(raw, {
      extensions: [gfm(), math()],
      mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
    }),
  )
  const edits: Span[] = []
  const seen = new Set<string>()
  for (const [index, marker] of markers.entries()) {
    const key = `${marker.submissionId}\0${marker.annotationId}`
    if (
      !known.has(key) ||
      seen.has(key) ||
      !comments.some((span) => span.start <= marker.offset && marker.offset < span.end)
    )
      continue
    seen.add(key)
    const until = markers[index + 1]?.offset ?? raw.length
    const matches: (Span & { strong: boolean })[] = []
    for (const heading of replyHeadingNeedles(marker.ordinal)) {
      for (
        let start = raw.indexOf(heading, marker.offset);
        start >= 0 && start < until;
        start = raw.indexOf(heading, start + heading.length)
      ) {
        const end = start + heading.length
        if (
          /\p{L}|\p{N}|_/u.test(raw[start - 1] ?? '') ||
          !/^\s*(?:[*_]{1,3})?\s*[:：]/u.test(raw.slice(end, until))
        )
          continue
        const parent = plain.find((span) => start >= span.start && end <= span.end)
        if (parent !== undefined) matches.push({ start, end, strong: parent.strong })
      }
    }
    if (matches.length === 1 && matches[0]!.strong === false) edits.push(matches[0]!)
  }
  let result = raw
  for (const { start, end } of edits.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, start)}**${result.slice(start, end)}**${result.slice(end)}`
  }
  return result
}
