// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceEndpoint, sourceObstacles } from '../src/client/source-geometry.ts'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function fragments(...rects: DOMRect[]): DOMRectList {
  return {
    ...rects,
    length: rects.length,
    item: (index) => rects[index] ?? null,
    [Symbol.iterator]: () => rects[Symbol.iterator](),
  }
}

function measure() {
  const descriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  const selected: string[] = []
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      selected.push(this.toString())
      return fragments(new DOMRect(this.startOffset * 10, 40, 10, 16))
    },
  })
  return {
    selected,
    restore: () => {
      if (descriptor === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', descriptor)
    },
  }
}

describe('live source character geometry', () => {
  it.each(['尾字  \n\t', '尾字\u00a0\u200b', '尾🌟  ', '尾e\u0301\n'])(
    'uses a complete last visible grapheme in %j',
    (text) => {
      const root = document.createElement('p')
      root.textContent = text
      document.body.append(root)
      const range = document.createRange()
      range.selectNodeContents(root)
      const geometry = measure()
      try {
        const endpoint = sourceEndpoint(range)
        expect(endpoint?.contextElement).toBe(root)
        expect(geometry.selected).toEqual([
          text.replace(/[\s\u200b]+$/u, '').endsWith('e\u0301')
            ? 'e\u0301'
            : text.includes('🌟')
              ? '🌟'
              : '字',
        ])
        expect(endpoint?.rect.width).toBe(10)
      } finally {
        geometry.restore()
      }
    },
  )

  it('chooses the last paragraph and its own font element across normalized forward and backward selections', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>第一段文字</p><p>跨行的末尾<strong>字符</strong>  </p><p>下一段不在选区</p>'
    document.body.append(root)
    const range = document.createRange()
    range.setStart(root.firstChild!, 0)
    range.setEnd(root, 2)
    const geometry = measure()
    try {
      const selection = document.getSelection()!
      selection.setBaseAndExtent(root, 2, root.firstChild!, 0)
      expect(sourceEndpoint(selection.getRangeAt(0))?.contextElement).toBe(root.querySelector('strong'))
      expect(sourceEndpoint(range)?.contextElement).toBe(root.querySelector('strong'))
      expect(geometry.selected).toEqual(['符', '符'])
    } finally {
      geometry.restore()
    }
  })

  it('skips hidden content and marker labels without substituting a container rectangle', () => {
    const root = document.createElement('div')
    root.innerHTML = '可见<span hidden>隐藏</span><nav class="dia-markers">123</nav>'
    document.body.append(root)
    const range = document.createRange()
    range.selectNodeContents(root)
    const geometry = measure()
    try {
      expect(sourceEndpoint(range)?.contextElement).toBe(root)
      expect(geometry.selected).toEqual(['见'])
      geometry.selected.length = 0
      expect(sourceObstacles(root)).toHaveLength(1)
      expect(geometry.selected).toEqual(['可见'])
      root.replaceChildren(document.createTextNode('  \n'))
      range.selectNodeContents(root)
      expect(sourceEndpoint(range)).toBeNull()
    } finally {
      geometry.restore()
    }
  })
})
