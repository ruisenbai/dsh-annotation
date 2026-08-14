import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig } from '../src/shared/config.ts'

describe('configuration', () => {
  it('resolves all defaults explicitly', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
  })

  it('accepts deployment overrides', () => {
    expect(resolveConfig({ commandName: 'review_submit', locateHistoryPages: 3 })).toMatchObject({
      commandName: 'review_submit',
      locateHistoryPages: 3,
    })
  })

  it.each([
    [{ commandName: 'Bad Name' }, 'commandName'],
    [{ maxPayloadBytes: 0 }, 'maxPayloadBytes'],
    [{ maxAnnotationsPerSubmission: 1.5 }, 'maxAnnotationsPerSubmission'],
  ])('rejects invalid config %#', (value, message) => {
    expect(() => resolveConfig(value)).toThrow(message)
  })
})
