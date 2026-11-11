import '@testing-library/jest-dom/vitest'

/** jsdom omits CSS.supports; the primitives' anchored-menu layout reads it on mount. */
if (typeof globalThis.CSS === 'undefined') {
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: { supports: () => false },
  })
} else if (typeof globalThis.CSS.supports !== 'function') {
  Object.defineProperty(globalThis.CSS, 'supports', {
    configurable: true,
    value: () => false,
  })
}
