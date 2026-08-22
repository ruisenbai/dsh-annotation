import { describe, expect, it } from 'vitest'
import {
  machineMarkerSpans,
  parseModelAcknowledgements,
  parseReplyMarkers,
  stripMachineMarkers,
  stripModelAcknowledgementMarkers,
  strippedOffset,
} from '../src/shared/model-ack.ts'

describe('model acknowledgements', () => {
  it('accepts explicit ids and deduplicates them', () => {
    const text = 'Done.\n<!-- dsh-annotation:{"submissionId":"sub-1","processed":["ann-1","ann-1"]} -->'
    expect(parseModelAcknowledgements(text)).toEqual([
      {
        submissionId: 'sub-1',
        processed: ['ann-1'],
      },
    ])
  })

  it('ignores prose guesses and malformed markers', () => {
    expect(parseModelAcknowledgements('I handled ann-1.')).toEqual([])
    expect(parseModelAcknowledgements('<!-- dsh-annotation:{bad} -->')).toEqual([])
    expect(parseModelAcknowledgements('<!-- dsh-annotation:{"submissionId":1,"processed":[]} -->')).toEqual(
      [],
    )
  })

  it('keeps pre-rename acknowledgements authoritative', () => {
    const comments = '<!-- dsh-inline-comments:{"submissionId":"sub-old","processed":["ann-old"]} -->'
    expect(parseModelAcknowledgements(comments)).toEqual([
      { submissionId: 'sub-old', processed: ['ann-old'] },
    ])
    const annotations =
      '<!-- dsh-inline-annotations:{"submissionId":"sub-older","processed":["ann-older"]} -->'
    expect(parseModelAcknowledgements(annotations)).toEqual([
      { submissionId: 'sub-older', processed: ['ann-older'] },
    ])
  })

  it('strips machine markers from rendered text only', () => {
    const raw =
      'Answer\n\n<!-- dsh-annotation:{"submissionId":"sub","processed":[]} -->\n\n<!-- dsh-annotation-reply:{"submissionId":"sub","annotationId":"ann","ordinal":1} -->\n注解 1：正文'
    expect(stripModelAcknowledgementMarkers(raw)).toContain('dsh-annotation-reply')
    expect(stripModelAcknowledgementMarkers(raw)).not.toContain('"processed"')
    expect(stripMachineMarkers(raw)).toBe('Answer\n\n注解 1：正文')
    expect(raw).toContain('submissionId')
  })

  it('strips legacy reply markers as well', () => {
    const raw =
      '<!-- dsh-inline-annotations-reply:{"submissionId":"s","annotationId":"a","ordinal":1} -->\n注解 1：'
    expect(stripMachineMarkers(raw)).toBe('注解 1：')
  })
})

describe('reply markers', () => {
  it('parses well-formed markers with their raw offsets', () => {
    const text =
      '前文 <!-- dsh-annotation-reply:{"submissionId":"sub-1","annotationId":"ann-1","ordinal":1} --> 后文'
    expect(parseReplyMarkers(text)).toEqual([
      { submissionId: 'sub-1', annotationId: 'ann-1', ordinal: 1, offset: text.indexOf('<!--') },
    ])
  })

  it('parses legacy reply marker prefixes', () => {
    const text = '<!-- dsh-inline-comments-reply:{"submissionId":"s","annotationId":"a","ordinal":2} -->'
    expect(parseReplyMarkers(text)).toEqual([{ submissionId: 's', annotationId: 'a', ordinal: 2, offset: 0 }])
  })

  it('ignores malformed, non-integer-ordinal, and foreign markers', () => {
    expect(parseReplyMarkers('<!-- dsh-annotation-reply:{bad} -->')).toEqual([])
    expect(
      parseReplyMarkers('<!-- dsh-annotation-reply:{"submissionId":"s","annotationId":1,"ordinal":1} -->'),
    ).toEqual([])
    expect(
      parseReplyMarkers(
        '<!-- dsh-annotation-reply:{"submissionId":"s","annotationId":"a","ordinal":"x"} -->',
      ),
    ).toEqual([])
    expect(parseReplyMarkers('<!-- other-plugin:{"submissionId":"s"} -->')).toEqual([])
  })

  it('translates raw offsets into stripped offsets', () => {
    const raw =
      'A <!-- dsh-annotation-reply:{"submissionId":"s","annotationId":"a","ordinal":1} --> B <!-- dsh-annotation:{"submissionId":"s","processed":[]} --> C'
    const spans = machineMarkerSpans(raw)
    const reply = parseReplyMarkers(raw)[0]!
    expect(strippedOffset(reply.offset, spans)).toBe(2)
    expect(strippedOffset(raw.length, spans)).toBe('A  B  C'.length)
  })
})
