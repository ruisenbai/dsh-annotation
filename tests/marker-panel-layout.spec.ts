// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { styles } from '../src/client/styles.ts'

const nodes: HTMLElement[] = []

afterEach(() => {
  for (const node of nodes.splice(0)) node.remove()
})

function rowStyles(className: string, placement: string) {
  const sheet = document.createElement('style')
  nodes.push(sheet)
  sheet.textContent = styles
  document.head.append(sheet)
  const root = document.createElement('section')
  nodes.push(root)
  root.className = className
  root.dataset.floatingPlacement = placement
  root.innerHTML = `
    <div class="dia-item" role="listitem">
      <div class="dia-item__main">
        <span class="dia-item__index">6</span>
        <span class="dia-item__copy"><q>F</q><span>Reading note 6.</span></span>
      </div>
      <div class="dia-item__actions">
        <button class="dia-row-action" type="button">Edit</button>
        <button class="dia-row-action" type="button">Delete</button>
      </div>
    </div>`
  document.body.append(root)
  return {
    row: getComputedStyle(root.querySelector('.dia-item')!),
    actions: getComputedStyle(root.querySelector('.dia-item__actions')!),
    copy: getComputedStyle(root.querySelector('.dia-item__copy')!),
  }
}

describe('marker bottom-panel layout', () => {
  it('gives the copy and wrapping actions separate full-width rows', () => {
    const layout = rowStyles('dia-marker-popover', 'panel')
    expect(layout.row.display).toBe('grid')
    expect(layout.row.gridTemplateColumns).toBe('minmax(0, 1fr)')
    expect(layout.row.alignItems).toBe('stretch')
    expect(layout.actions.flexWrap).toBe('wrap')
    expect(layout.actions.justifyContent).toBe('flex-end')
    expect(layout.copy.display).toBe('grid')
  })

  it.each(['left', 'right', 'top', 'bottom'])(
    'keeps a %s card in its existing single-row layout',
    (placement) => {
      expect(rowStyles('dia-marker-popover', placement).row.display).toBe('flex')
    },
  )

  it('does not restyle annotation rows in the summary list', () => {
    expect(rowStyles('dia-inline-panel', 'panel').row.display).toBe('flex')
  })
})
