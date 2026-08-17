import { describe, expect, it } from 'vitest'
import { parseModelAcknowledgements, stripModelAcknowledgementMarkers } from '../src/shared/model-ack.ts'

describe('model acknowledgements', () => {
  it('accepts explicit ids and deduplicates them', () => {
    const text = 'Done.\n<!-- dsh-inline-comments:{"submissionId":"sub-1","processed":["ann-1","ann-1"]} -->'
    expect(parseModelAcknowledgements(text)).toEqual([
      {
        submissionId: 'sub-1',
        processed: ['ann-1'],
      },
    ])
  })

  it('ignores prose guesses and malformed markers', () => {
    expect(parseModelAcknowledgements('I handled ann-1.')).toEqual([])
    expect(parseModelAcknowledgements('<!-- dsh-inline-comments:{bad} -->')).toEqual([])
    expect(
      parseModelAcknowledgements('<!-- dsh-inline-comments:{"submissionId":1,"processed":[]} -->'),
    ).toEqual([])
  })

  it('keeps pre-rename acknowledgements authoritative', () => {
    const legacy = '<!-- dsh-inline-annotations:{"submissionId":"sub-old","processed":["ann-old"]} -->'
    expect(parseModelAcknowledgements(legacy)).toEqual([{ submissionId: 'sub-old', processed: ['ann-old'] }])
  })

  it('strips machine markers from rendered text only', () => {
    const raw = 'Answer\n\n<!-- dsh-inline-annotations:{"submissionId":"sub","processed":[]} -->\n\nTail'
    expect(stripModelAcknowledgementMarkers(raw)).toBe('Answer\n\nTail')
    expect(raw).toContain('submissionId')
  })
})
