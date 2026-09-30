import { describe, expect, it } from 'vitest'
import { emphasizeReplyLabels } from '../src/client/reply-emphasis.ts'

const marker = '<!-- dsh-annotation-reply:{"submissionId":"sub-1","annotationId":"ann-1","ordinal":1} -->'
const known = new Set(['sub-1\0ann-1'])

describe('reply-label emphasis projection', () => {
  it.each(['注解 1：说明', 'Annotation 1: Explanation'])('emphasizes a complete known label: %s', (body) => {
    const raw = `${marker}\n${body}`
    expect(emphasizeReplyLabels(raw, known)).toBe(
      `${marker}\n**${body.split(/[:：]/u)[0]}**${body.slice(body.search(/[:：]/u))}`,
    )
    expect(raw).toBe(`${marker}\n${body}`)
  })

  it.each([
    '```\n注解 1：literal\n```',
    '`注解 1：literal`',
    '> 注解 1：quoted',
    '[注解 1：link](https://example.com)',
    '$注解 1：math$',
    '**注解 1**：already strong',
    '**注解 1**：first\n\n注解 1：ambiguous second',
    '注解 10：different number',
    '注解 1：first\n\n注解 1：ambiguous second',
  ])('leaves non-prose, already emphasized and ambiguous matches unchanged: %s', (body) => {
    const raw = `${marker}\n${body}`
    expect(emphasizeReplyLabels(raw, known)).toBe(raw)
  })

  it('ignores unknown associations and marker-looking text inside code', () => {
    const raw = `${marker}\n注解 1：explanation`
    expect(emphasizeReplyLabels(raw, new Set())).toBe(raw)
    const code = `\`\`\`\n${marker}\n\`\`\`\n\n注解 1：unrelated prose`
    expect(emphasizeReplyLabels(code, known)).toBe(code)
  })
})
