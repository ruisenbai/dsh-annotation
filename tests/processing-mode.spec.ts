import { describe, expect, it } from 'vitest'
import { formatSubmissionMessage } from '../src/shared/protocol.ts'
import type { AnnotationSubmissionPayload, ProcessingMode, ProtocolLocale } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'

function formatted(mode: ProcessingMode, protocolLocale: ProtocolLocale): string {
  const source = fixturePayload({ processingMode: mode, protocolLocale })
  const { overallRequirement, ...payload } = source
  void overallRequirement
  return formatSubmissionMessage(payload)
}

function expectSharedProtocol(text: string, locale: ProtocolLocale): void {
  expect(text).toContain('Processing mode:')
  expect(text).toContain(
    '<!-- dsh-annotation-reply:{"submissionId":"sub-test","annotationId":"ann-test-1","ordinal":1} -->',
  )
  expect(text).toContain('<!-- dsh-annotation:{"submissionId":"sub-test","processed":["annotation-id"]} -->')
  if (locale === 'zh') {
    expect(text).toContain('注解 1 (ann-test-1)')
    expect(text).toContain('（没有额外的用户目标或约束。）')
    expect(text).not.toContain('请按注解逐条处理，并保持未涉及的原文不变。')
    expect(text).toContain('总体要求用于指定目标、范围与约束；处理方式用于指定交付形式。')
    expect(text).toContain('如果二者直接冲突，请明确指出冲突并请求澄清')
    expect(text).toContain('不要自动写入本批次的全部 ID')
    expect(text).toContain('没有实际处理完成的注解 ID 不要放进 processed')
  } else {
    expect(text).toContain('Annotation 1 (ann-test-1)')
    expect(text).toContain('(No additional user goal or constraint was provided.)')
    expect(text).not.toContain('Handle every annotation in order and preserve unaffected content.')
    expect(text).toContain(
      'The overall requirement defines goals, scope, and constraints; the processing mode defines the deliverable.',
    )
    expect(text).toContain('If they directly conflict, explain the conflict and ask for clarification')
    expect(text).toContain('do not automatically include the full batch')
    expect(text).toContain('unless its requested handling was actually completed')
  }
}

describe('processing-mode model instructions', () => {
  it('generates Chinese answer instructions without rewrite or modification directives', () => {
    const text = formatted('answer', 'zh')
    expectSharedProtocol(text, 'zh')
    expect(text).toContain('交付方式：逐条回答')
    expect(text).toContain('请按顺序逐条回答每一条注解')
    expect(text).toContain('不要合并不同注解')
    expect(text).not.toContain('连贯的整合正文')
    expect(text).not.toContain('实际执行修改')
  })

  it('generates English answer instructions without rewrite or modification directives', () => {
    const text = formatted('answer', 'en')
    expectSharedProtocol(text, 'en')
    expect(text).toContain('Delivery mode: answer')
    expect(text).toContain('Answer every annotation in order')
    expect(text).toContain('Do not merge different annotations')
    expect(text).not.toContain('coherent integrated rewrite')
    expect(text).not.toContain('Make actual changes')
  })

  it('generates Chinese rewrite instructions that permit integration instead of per-item prose', () => {
    const text = formatted('rewrite', 'zh')
    expectSharedProtocol(text, 'zh')
    expect(text).toContain('交付方式：连贯重写')
    expect(text).toContain('连贯的整合正文')
    expect(text).toContain('可以合并处理相互关联的注解')
    expect(text).toContain('不要把正文写成逐条问答')
    expect(text).toContain('正文后附上简短的批注处理说明')
    expect(text).not.toContain('不要合并不同注解')
    expect(text).not.toContain('实际执行修改')
  })

  it('generates English rewrite instructions that permit integration instead of per-item prose', () => {
    const text = formatted('rewrite', 'en')
    expectSharedProtocol(text, 'en')
    expect(text).toContain('Delivery mode: rewrite')
    expect(text).toContain('coherent integrated rewrite as the primary deliverable')
    expect(text).toContain('combine related annotations when useful')
    expect(text).toContain('Do not turn the rewritten body into a per-annotation Q&A')
    expect(text).toContain('After the body, add brief annotation-handling notes')
    expect(text).not.toContain('Do not merge different annotations')
    expect(text).not.toContain('Make actual changes')
  })

  it('generates Chinese modify instructions that require execution or an explicit blocker', () => {
    const text = formatted('modify', 'zh')
    expectSharedProtocol(text, 'zh')
    expect(text).toContain('交付方式：实际修改')
    expect(text).toContain('围绕被批注对象实际执行修改并报告结果')
    expect(text).toContain('保留未涉及部分')
    expect(text).toContain('不要只解释应该如何修改')
    expect(text).toContain('缺少工具、权限或必要材料')
    expect(text).toContain('修改结果后附上简短的批注处理说明')
    expect(text).not.toContain('不要合并不同注解')
    expect(text).not.toContain('连贯的整合正文')
  })

  it('generates English modify instructions that require execution or an explicit blocker', () => {
    const text = formatted('modify', 'en')
    expectSharedProtocol(text, 'en')
    expect(text).toContain('Delivery mode: modify')
    expect(text).toContain('Make actual changes to the annotated target and report the result')
    expect(text).toContain('preserve unaffected parts')
    expect(text).toContain('Do not only explain what should change')
    expect(text).toContain('missing tools, permissions, or required materials')
    expect(text).toContain('After the modification result, add brief annotation-handling notes')
    expect(text).not.toContain('Do not merge different annotations')
    expect(text).not.toContain('coherent integrated rewrite')
  })

  it.each([
    ['zh', '补充关联注解 ID：ann-from-history'],
    ['en', 'Supplemental to annotation ID: ann-from-history'],
  ] as const)('shows a historical supplemental relationship in %s model text', (protocolLocale, expected) => {
    const payload = fixturePayload({ protocolLocale })
    const annotation = {
      ...payload.annotations[0]!,
      supplementalTo:
        'ann-from-history' as AnnotationSubmissionPayload['annotations'][number]['annotationId'],
    }
    expect(formatSubmissionMessage({ ...payload, annotations: [annotation] })).toContain(expected)
  })
})
