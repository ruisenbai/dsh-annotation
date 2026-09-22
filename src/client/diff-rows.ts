/** Real file rows derived only from the two captured contents, never rendered Markdown. */
import { structuredPatch } from 'diff'
import { fileLines, type DiffSnapshot } from '../shared/diff-source.ts'

/** One displayed text row with independent real old/new file coordinates. */
export interface DiffCodeRow {
  readonly kind: 'context' | 'add' | 'del'
  readonly old?: number
  readonly new?: number
  readonly text: string
}

/** Preserve independent old/new counters across hunks, including empty sides.
 * @param snapshot - The complete captured comparison.
 * @returns Text rows; expensive comparisons fall back to full deletion/addition without changing coordinates.
 */
export function diffRows(snapshot: DiffSnapshot): readonly DiffCodeRow[] {
  const old = fileLines(snapshot.old.content ?? '')
  const next = fileLines(snapshot.new.content ?? '')
  const patch = structuredPatch(
    '',
    '',
    snapshot.old.content ?? '',
    snapshot.new.content ?? '',
    undefined,
    undefined,
    { context: 3, maxEditLength: 512 },
  )
  if (patch === undefined)
    return [
      ...old.map((text, index) => ({ kind: 'del' as const, old: index + 1, text })),
      ...next.map((text, index) => ({ kind: 'add' as const, new: index + 1, text })),
    ]
  const rows: DiffCodeRow[] = []
  let left = 1
  let right = 1
  for (const hunk of patch.hunks) {
    while (left < Math.max(1, hunk.oldStart) && right < Math.max(1, hunk.newStart)) {
      rows.push({ kind: 'context', old: left++, new: right++, text: old[left - 2]! })
    }
    for (const line of hunk.lines) {
      if (line[0] === '-') rows.push({ kind: 'del', old: left++, text: line.slice(1) })
      else if (line[0] === '+') rows.push({ kind: 'add', new: right++, text: line.slice(1) })
      else if (line[0] === ' ') rows.push({ kind: 'context', old: left++, new: right++, text: line.slice(1) })
    }
  }
  while (left <= old.length && right <= next.length) {
    rows.push({ kind: 'context', old: left++, new: right++, text: old[left - 2]! })
  }
  return rows
}

/** Fold only unchanged rows; full captured context remains available for expansion and navigation.
 * @param rows - Full-file rows from one frozen comparison.
 * @param expanded - Whether unchanged regions are visible.
 * @returns Visible rows and non-anchorable fold controls.
 */
export function visibleDiffRows(
  rows: readonly DiffCodeRow[],
  expanded: boolean,
): readonly (DiffCodeRow | { readonly kind: 'fold'; readonly count: number })[] {
  if (expanded) return rows
  const result: (DiffCodeRow | { kind: 'fold'; count: number })[] = []
  for (let at = 0; at < rows.length;) {
    if (rows[at]!.kind !== 'context') {
      result.push(rows[at++]!)
      continue
    }
    let end = at
    while (end < rows.length && rows[end]!.kind === 'context') end++
    if (end - at > 9)
      result.push(
        ...rows.slice(at, at + 3),
        { kind: 'fold', count: end - at - 6 },
        ...rows.slice(end - 3, end),
      )
    else result.push(...rows.slice(at, end))
    at = end
  }
  return result
}
