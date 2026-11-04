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
  expect(text).not.toContain('Processing mode:')
  expect(text).toContain(
    '<!-- dsh-annotation-reply:{"submissionId":"sub-test","annotationId":"ann-test-1","ordinal":1} -->',
  )
  expect(text).toContain('<!-- dsh-annotation:{"submissionId":"sub-test","processed":["annotation-id"]} -->')
  if (locale === 'zh') {
    expect(text).toContain('\n注解 1\n')
    expect(text).not.toContain('总体要求：')
    expect(text).not.toContain('（没有额外的用户目标或约束。）')
    expect(text).not.toContain('请按注解逐条处理，并保持未涉及的原文不变。')
    expect(text).toContain('processed 仅列本次按交付方式实际完成的注解 ID')
  } else {
    expect(text).toContain('\nAnnotation 1\n')
    expect(text).not.toContain('Overall requirement:')
    expect(text).not.toContain('(No additional user goal or constraint was provided.)')
    expect(text).not.toContain('Handle every annotation in order and preserve unaffected content.')
    expect(text).toContain(
      'processed lists only annotation IDs actually completed in this reply under the delivery mode',
    )
  }
}

describe('processing-mode model instructions', () => {
  it('generates Chinese answer instructions without rewrite or modification directives', () => {
    const text = formatted('answer', 'zh')
    expectSharedProtocol(text, 'zh')
    expect(text).toContain('交付方式：逐条回答')
    expect(text).toContain('按编号逐条回答，不合并')
    expect(text).toContain('每段以「注解 N：」开头，段前原样输出对应隐藏关联标记')
    expect(text).not.toContain('重写正文')
    expect(text).not.toContain('实际修改')
  })

  it('generates English answer instructions without rewrite or modification directives', () => {
    const text = formatted('answer', 'en')
    expectSharedProtocol(text, 'en')
    expect(text).toContain('Delivery mode: answer')
    expect(text).toContain('Answer annotations in order without merging them')
    expect(text).toContain(
      'Start each section with "Annotation N:" and precede it with its exact hidden association marker',
    )
    expect(text).not.toContain('coherent rewrite')
    expect(text).not.toContain('Modify the accessible annotated target')
  })

  it('generates Chinese rewrite instructions that permit integration instead of per-item prose', () => {
    const text = formatted('rewrite', 'zh')
    expectSharedProtocol(text, 'zh')
    expect(text).toContain('交付方式：连贯重写')
    expect(text).toContain('先输出完整、连贯的重写正文，融入意见')
    expect(text).toContain('可合并相关注解')
    expect(text).toContain('不要写成逐条问答')
    expect(text).toContain('正文后按注解顺序附简短处理说明')
    expect(text).toContain('每条以「注解 N：」开头，前置对应隐藏关联标记')
    expect(text).not.toContain('不合并')
    expect(text).not.toContain('实际修改')
  })

  it('generates English rewrite instructions that permit integration instead of per-item prose', () => {
    const text = formatted('rewrite', 'en')
    expectSharedProtocol(text, 'en')
    expect(text).toContain('Delivery mode: rewrite')
    expect(text).toContain('First produce a complete, coherent rewrite incorporating the annotations')
    expect(text).toContain('combine related annotations where useful')
    expect(text).toContain('without per-annotation Q&A')
    expect(text).toContain('After the body, add brief handling notes in annotation order')
    expect(text).toContain('headed "Annotation N:" and preceded by their exact hidden association markers')
    expect(text).not.toContain('without merging them')
    expect(text).not.toContain('Modify the accessible annotated target')
  })

  it('generates Chinese modify instructions that require execution or an explicit blocker', () => {
    const text = formatted('modify', 'zh')
    expectSharedProtocol(text, 'zh')
    expect(text).toContain('交付方式：实际修改')
    expect(text).toContain('实际修改可访问的批注对象')
    expect(text).toContain('保留未涉及部分')
    expect(text).toContain('按需使用工具并报告结果')
    expect(text).toContain('不要仅给建议或将建议当成已完成的修改')
    expect(text).toContain('缺少工具、权限或材料时，说明未完成原因和所需条件')
    expect(text).toContain('结果后按注解顺序附简短处理说明')
    expect(text).toContain('每条以「注解 N：」开头，前置对应隐藏关联标记')
    expect(text).not.toContain('不合并')
    expect(text).not.toContain('重写正文')
  })

  it('generates English modify instructions that require execution or an explicit blocker', () => {
    const text = formatted('modify', 'en')
    expectSharedProtocol(text, 'en')
    expect(text).toContain('Delivery mode: modify')
    expect(text).toContain('Modify the accessible annotated target')
    expect(text).toContain('preserve unaffected parts')
    expect(text).toContain('use tools as needed, and report results')
    expect(text).toContain('Do not merely suggest changes or present suggestions as completed work')
    expect(text).toContain(
      'If tools, permissions, or materials are missing, explain what remains undone and what is needed',
    )
    expect(text).toContain('After the results, add brief handling notes in annotation order')
    expect(text).toContain('headed "Annotation N:" and preceded by their exact hidden association markers')
    expect(text).not.toContain('without merging them')
    expect(text).not.toContain('coherent rewrite')
  })

  it.each([
    ['zh', 'answer'],
    ['zh', 'rewrite'],
    ['zh', 'modify'],
    ['en', 'answer'],
    ['en', 'rewrite'],
    ['en', 'modify'],
  ] as const)(
    'keeps user constraints and conflict handling in %s %s mode',
    (protocolLocale, processingMode) => {
      const text = formatSubmissionMessage(
        fixturePayload({
          protocolLocale,
          processingMode,
          overallRequirement: '  Review only this paragraph.\nKeep the examples.  ',
        }),
      )
      expect(text).toContain('Review only this paragraph.\nKeep the examples.')
      expect(text).toContain(
        protocolLocale === 'zh'
          ? '总体要求指定目标、范围与约束，交付方式指定输出形式；直接冲突时说明并请求澄清。'
          : 'The overall requirement defines goals, scope, and constraints; delivery mode defines output format. If they conflict, explain and ask for clarification.',
      )
    },
  )

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
