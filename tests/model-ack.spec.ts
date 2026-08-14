import { describe, expect, it } from 'vitest'
import { parseModelAcknowledgements, stripModelAcknowledgementMarkers } from '../src/shared/model-ack.ts'

describe('model acknowledgements', () => {
  it('accepts explicit ids and deduplicates them', () => {
    const text =
      'Done.\n<!-- dsh-inline-annotations:{"submissionId":"sub-1","processed":["ann-1","ann-1"]} -->'
    expect(parseModelAcknowledgements(text)).toEqual([
      {
        submissionId: 'sub-1',
        processed: ['ann-1'],
      },
    ])
  })

  it('ignores prose guesses and malformed markers', () => {
    expect(parseModelAcknowledgements('I handled ann-1.')).toEqual([])
    expect(parseModelAcknowledgements('<!-- dsh-inline-annotations:{bad} -->')).toEqual([])
    expect(
      parseModelAcknowledgements('<!-- dsh-inline-annotations:{"submissionId":1,"processed":[]} -->'),
    ).toEqual([])
  })

  it('strips machine markers from rendered text only', () => {
    const raw = 'Answer\n\n<!-- dsh-inline-annotations:{"submissionId":"sub","processed":[]} -->\n\nTail'
    expect(stripModelAcknowledgementMarkers(raw)).toBe('Answer\n\nTail')
    expect(raw).toContain('submissionId')
  })
})
