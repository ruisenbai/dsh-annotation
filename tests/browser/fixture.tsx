import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { AnnotatedAssistantNode } from '../../src/client/components/AnnotatedAssistantNode.tsx'
import { AnnotationDock } from '../../src/client/components/AnnotationDock.tsx'
import type { AnnotationEndpoint, AnnotationView } from '../../src/client/controller.ts'
import { AnnotationController } from '../../src/client/controller.ts'
import type { AssistantAnnotationProps, InputAnnotationProps } from '../../src/client/contract.ts'
import { en } from '../../src/client/locales.ts'
import { AnnotationStorage } from '../../src/client/storage.ts'
import { styles } from '../../src/client/styles.ts'
import { DEFAULT_CONFIG } from '../../src/shared/config.ts'
import type { MessageIdentity, SessionIdentity } from '../../src/shared/types.ts'
import { COMPOSER_ATTACHMENT_TOKEN } from '../../src/client/composer-attachment.ts'
import type { SelectionCapture } from '../../src/client/selection.ts'
import { BrowserComposer } from './Composer.tsx'

const MESSAGE_ID = 'browser-assistant-message' as MessageIdentity
const SESSION_ID = 'browser-session' as SessionIdentity
const TEXT = 'Alpha selected phrase and the rest of this visual line continues until the final word omega.'
const READING_WORDS = ['A', 'B', 'C', 'D', 'E', 'F']
const READING_TEXT = [
  'A B C D E F.',
  'Reading should keep the original measure and line breaks. This paragraph has enough text to wrap naturally at desktop and mobile widths, including enlarged text. The annotation controls belong in unused space, not in the middle of a sentence.',
  'A second paragraph keeps the surrounding context visible while a reader reviews several notes on the same line. Selecting and copying this text must remain a native browser operation.',
].join('\n\n')
const REPLY_ANSWERS = [
  'The first answer stays selectable.',
  'The second answer stays selectable.',
  'The third answer stays selectable.',
  'The fourth answer stays selectable.',
]

function captureFor(exact: string, text = TEXT): SelectionCapture {
  const start = text.indexOf(exact)
  if (start < 0) throw new Error(`fixture text is missing ${exact}`)
  return {
    messageId: MESSAGE_ID,
    messageSeq: 42,
    responseVersion: MESSAGE_ID,
    quote: {
      exact,
      prefix: text.slice(Math.max(0, start - 32), start),
      suffix: text.slice(start + exact.length, start + exact.length + 32),
      start,
      end: start + exact.length,
    },
    rect: { top: 0, left: 0, bottom: 0, right: 0 },
  }
}
const fixtureTokens = `
:root {
  color-scheme: light dark;
  --dsw-font-family: system-ui, sans-serif;
  --ds-font-family-code: ui-monospace, SFMono-Regular, Consolas;
  --dsw-static-neutral-bluish-00: #ffffff;
  --dsw-alias-bg-base: #ffffff;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #f4f6f8;
  --dsw-alias-bg-layer-3: #ffffff;
  --dsw-alias-label-primary: #17212b;
  --dsw-alias-label-primary-foreground: #ffffff;
  --dsw-alias-label-primary-dimmed: #394b5a;
  --dsw-alias-label-secondary: #596b78;
  --dsw-alias-label-tertiary: #758692;
  --dsw-alias-label-caption: #8c9aa4;
  --dsw-alias-border-l1: #e5e9ed;
  --dsw-alias-border-l2: #ccd4da;
  --dsw-alias-interactive-bg-hover: #edf2f5;
  --dsw-alias-interactive-bg-active: #e3e9ee;
  --dsw-alias-button-info-fill: #4d6bfe;
  --dsw-alias-button-info-hover: #405bd8;
  --dsw-alias-button-contrast-fill: #24292f;
  --dsw-alias-tooltip-bg: #24292f;
  --dsw-alias-label-primary-inverted: #ffffff;
  --dsw-alias-state-business-primary: #4d6bfe;
  --dsw-alias-state-business-tertiary: #e7ecff;
  --dsw-alias-state-warn-label: #ffd37a;
  --dsw-static-deepseek-450: #5b79ff;
  --dsw-alias-state-success-primary: #138a62;
  --dsw-alias-state-success-secondary: #0a6b4a;
  --dsw-alias-state-success-tertiary: #d8f2e8;
  --dsw-alias-state-warn-primary: #a66a00;
  --dsw-alias-state-warn-tertiary: #fff0c9;
  --dsw-alias-state-error-primary: #d33a3a;
  --dsw-alias-scrollbar-bg-l2: #c8d0d6;
  --dsw-alias-scrollbar-hover-l2: #aeb9c1;
  --dsw-specific-tip: var(--dsw-alias-bg-layer-2);
  --dsw-specific-menu: var(--dsw-alias-bg-layer-3);
  --dsw-specific-bubble: var(--dsw-alias-bg-layer-2);
  --dsw-shadow-lv3: 0 10px 34px rgba(23, 33, 43, 0.2);
}
@media (prefers-color-scheme: dark) {
  :root {
    --dsw-alias-bg-base: #15191e;
    --dsw-alias-bg-layer-1: #1c2229;
    --dsw-alias-bg-layer-2: #242b33;
    --dsw-alias-bg-layer-3: #20262d;
    --dsw-alias-label-primary: #eef2f5;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-label-primary-dimmed: #d2d9df;
    --dsw-alias-label-secondary: #b7c0c8;
    --dsw-alias-label-tertiary: #96a2ad;
    --dsw-alias-label-caption: #7f8b96;
    --dsw-alias-border-l1: #313942;
    --dsw-alias-border-l2: #44505b;
    --dsw-alias-interactive-bg-hover: #2c353e;
    --dsw-alias-state-business-primary: #5b79ff;
    --dsw-alias-state-business-tertiary: #26345f;
    --dsw-alias-scrollbar-bg-l2: #596570;
    --dsw-alias-scrollbar-hover-l2: #707c86;
  }
}
html, body, #root { min-height: 100%; }
body { margin: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 14px/1.55 system-ui, sans-serif; }
.browser-fixture { box-sizing: border-box; width: min(720px, 100%); margin: 0 auto; padding: 16px; }
.browser-scroller { height: 360px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 0 14px; }
.browser-spacer { height: 390px; }
.browser-controls { display: flex; gap: 8px; margin: 12px 0; }
.browser-composer { display: flex; gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.browser-composer [data-composer-input] { min-height: 56px; flex: 1; border: 0; background: transparent; color: inherit; font: inherit; outline: none; white-space: pre-wrap; }
.browser-composer p { margin: 0; }
.browser-fixture--reading { width: 100%; }
.browser-fixture--reading h1 { margin: 0 0 12px; font-size: 20px; }
.browser-fixture--reading .browser-scroller { box-sizing: border-box; height: calc((100vh - 240px) / var(--fixture-zoom, 1)); min-height: 220px; padding: 24px; }
.browser-fixture--reading .browser-spacer { height: 80px; }
.browser-fixture--reading .browser-scroller[data-reply='true'] .browser-spacer { height: 340px; }
.browser-fixture--reading .dia-assistant { width: min(500px, 100%); margin-inline: auto; }
.browser-fixture--reading .browser-controls { flex-wrap: wrap; }
.browser-reading-reply { margin: 24px auto; }
.browser-reading-reply[data-wrapped='true'] { width: 90px; overflow-wrap: anywhere; }
.browser-fixture--blocked .browser-scroller { padding-inline: 0; }
.browser-fixture--blocked .browser-reading-source .dia-assistant { width: 100%; }
.browser-reading-source pre { margin: 0; padding: 12px 0; font: inherit; white-space: pre-wrap; }
`

function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}
const t = translate as InputAnnotationProps['t']

function Fixture({ mode }: { mode: 'legacy' | 'reading' | 'blocked' }) {
  const reading = mode !== 'legacy'
  const sourceText = reading ? READING_TEXT : TEXT
  const [replyText, setReplyText] = useState('')
  const [replyClosed, setReplyClosed] = useState(false)
  const [replyWrapped, setReplyWrapped] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(true)
  const [compactSummary, setCompactSummary] = useState(true)
  const controller = useMemo(() => {
    const storage = new AnnotationStorage(window.localStorage, SESSION_ID)
    storage.clear()
    return new AnnotationController(
      SESSION_ID,
      storage,
      { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
      DEFAULT_CONFIG,
    )
  }, [])
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [composerText, setComposerText] = useState('')
  const [attached, setAttached] = useState(false)
  useEffect(() => () => controller.dispose(), [controller])

  const useAnnotations = useCallback(
    <Selected,>(selector: (state: AnnotationView) => Selected): Selected => selector(view),
    [view],
  )
  const useCompactSummary = useCallback(
    <Selected,>(selector: (enabled: boolean) => Selected): Selected => selector(compactSummary),
    [compactSummary],
  )
  const useWorkspaces = useCallback(
    <Selected,>(selector: (state: { archivedSessionIds: readonly string[] }) => Selected): Selected =>
      selector({ archivedSessionIds: [] }),
    [],
  )
  const deleteFixtureDrafts = () => {
    for (const annotation of controller.getSnapshot().annotations) {
      if (annotation.status === 'draft') controller.deleteDraft(annotation.annotationId)
    }
    controller.dismissDeleteUndo()
  }
  const seedSameLine = () => {
    deleteFixtureDrafts()
    const selections = ['Alpha', 'selected', 'phrase', 'and', 'the']
    selections.forEach((exact, index) => {
      controller.beginSelection(captureFor(exact))
      controller.updateEditorText(`Browser marker ${index + 1}`)
      controller.saveEditor()
    })
  }
  const seedReading = (count: number) => {
    deleteFixtureDrafts()
    controller.setPanelOpen(false)
    READING_WORDS.slice(0, count).forEach((exact, index) => {
      controller.beginSelection(captureFor(exact, sourceText))
      controller.updateEditorText(`Reading note ${index + 1}.`)
      controller.saveEditor()
    })
  }
  const seedReply = () => {
    seedReading(4)
    const entry = controller.createOutbox('queue', SESSION_ID, 'Explain all four notes.')
    controller.markSending(entry.payload.submissionId)
    controller.markAccepted(entry.payload.submissionId)
    controller.reconcile({
      chat: {
        nodes: new Map([
          [
            'submitted',
            { kind: 'user', data: { source: { kind: 'user', annotationSubmission: entry.payload } } },
          ],
        ]),
      },
      queue: [],
      hasMore: false,
    } as never)
    setReplyText(
      entry.payload.annotations
        .map((annotation, index) => {
          const marker = JSON.stringify({
            submissionId: entry.payload.submissionId,
            annotationId: annotation.annotationId,
            ordinal: annotation.ordinal,
          })
          return `<!-- dsh-annotation-reply:${marker} -->\n\n\n\nAnnotation ${annotation.ordinal}: ${REPLY_ANSWERS[index]}`
        })
        .join('\n\n\n\n'),
    )
    setReplyClosed(false)
    setReplyWrapped(false)
    setSourceOpen(false)
  }
  const submitComposer = () => {
    if (!attached) return
    const entry = controller.createOutbox('queue', SESSION_ID, composerText)
    controller.markSending(entry.payload.submissionId)
    controller.markAccepted(entry.payload.submissionId)
    controller.reconcile({
      chat: { nodes: new Map() },
      queue: [{ messageId: entry.messageId }],
      hasMore: false,
    } as never)
    setAttached(false)
    setComposerText('')
  }
  const settleSent = () => {
    const entry = controller.getSnapshot().outbox.find((item) => item.status === 'queued')
    if (entry === undefined) return
    controller.reconcile({
      chat: {
        nodes: new Map([
          [
            'sent',
            {
              kind: 'user',
              data: { source: { kind: 'user', annotationSubmission: entry.payload } },
            },
          ],
        ]),
      },
      queue: [],
      hasMore: false,
    } as never)
  }
  const seedFailedSubmission = () => {
    controller.beginSelection(captureFor('omega'))
    controller.updateEditorText('Browser retry comment')
    controller.saveEditor()
    const entry = controller.createOutbox('queue', SESSION_ID, 'Retry this batch.')
    controller.markSending(entry.payload.submissionId)
    controller.markFailed(entry.payload.submissionId, 'fixture transport failure')
    setComposerText('Retry this batch.')
    setAttached(true)
  }
  const registerEndpoint = (messageId: MessageIdentity, endpoint: AnnotationEndpoint) =>
    controller.registerEndpoint(messageId, endpoint)

  const shared = {
    useAnnotations,
    useCompactSummary,
    beginSelection: (capture: SelectionCapture) => controller.beginSelection(capture),
    openAnnotation: controller.openAnnotation.bind(controller),
    updateEditorText: controller.updateEditorText.bind(controller),
    confirmLongSelection: controller.confirmLongSelection.bind(controller),
    saveEditor: controller.saveEditor.bind(controller),
    closeEditor: controller.closeEditor.bind(controller),
    deleteDraft: controller.deleteDraft.bind(controller),
    undoDelete: controller.undoDelete.bind(controller),
    dismissDeleteUndo: controller.dismissDeleteUndo.bind(controller),
    setPanelOpen: controller.setPanelOpen.bind(controller),
    autoAttachEnabled: () => true,
    ensureComposerAttachment: () => {
      setAttached(true)
      return true
    },
    toggleComposerAttachment: () => {
      setAttached((current) => !current)
      return true
    },
    repairComposerAttachment: () => undefined,
    withdraw: async (submissionId: Parameters<AnnotationController['markWithdrawn']>[0]) => {
      controller.markWithdrawn(submissionId)
    },
    discardOutbox: (submissionId: Parameters<AnnotationController['discardOutbox']>[0]) => {
      controller.discardOutbox(submissionId)
    },
    navigate: controller.navigate.bind(controller),
    annotateMessage: controller.annotateMessage.bind(controller),
    registerEndpoint,
    updateHighlightRanges: () => undefined,
    activateHighlight: () => undefined,
    removeHighlights: () => undefined,
    highlightsSupported: () => false,
  }

  const assistantProps = {
    ...shared,
    node: {
      data: {
        status: 'closed',
        blocks: reading
          ? [{ kind: 'text', text: sourceText }]
          : [
              { kind: 'reasoning', text: 'Reasoning stays outside comment offsets.' },
              { kind: 'text', text: sourceText },
            ],
        finalNode: { messageId: MESSAGE_ID, seq: 42 },
      },
      location: { kind: 'root' },
    },
    useTurnData: () => undefined,
    openFile: () => undefined,
    renderMessageImages: () => null,
    fileMentions: () => undefined,
    t,
  }
  const dockProps = {
    ...shared,
    sessionId: SESSION_ID,
    session: { pending: [], running: false },
    input: {
      draft: attached ? COMPOSER_ATTACHMENT_TOKEN + composerText : composerText,
      attachmentIds: [],
      draftRev: 1,
      phase: attached ? 'claimed' : 'plain',
      ...(attached ? { claim: { token: COMPOSER_ATTACHMENT_TOKEN } } : {}),
      occurrences: [],
      queue: [],
    },
    useWorkspaces,
    t,
  }

  return (
    <main
      className={`browser-fixture${reading ? ' browser-fixture--reading' : ''}${mode === 'blocked' ? ' browser-fixture--blocked' : ''}`}
      data-annotation-count={view.annotations.length}
    >
      <style>{fixtureTokens + styles}</style>
      <h1>Annotation browser fixture</h1>
      <div
        className="browser-scroller"
        data-testid="conversation-scroll"
        data-reply={replyText !== '' || undefined}
      >
        <div className="browser-spacer" />
        <div
          className="browser-reading-source"
          data-testid="reading-source"
          data-source-open={sourceOpen}
          data-turn-process-hidden={!sourceOpen || undefined}
          hidden={!sourceOpen}
        >
          <AnnotatedAssistantNode
            {...(assistantProps as unknown as AssistantAnnotationProps)}
            turnProcess={
              {
                spec: {},
                foldable: true,
                open: sourceOpen,
                setOpen: setSourceOpen,
              } as unknown as AssistantAnnotationProps['turnProcess']
            }
          >
            {mode === 'blocked' ? (
              <pre>
                <code>{sourceText}</code>
              </pre>
            ) : undefined}
          </AnnotatedAssistantNode>
        </div>
        {replyText !== '' && (
          <>
            <button type="button" data-testid="reply-keyboard-start">
              Keyboard entry
            </button>
            <div className="browser-reading-reply" data-testid="reading-reply" data-wrapped={replyWrapped}>
              <AnnotatedAssistantNode
                {...(assistantProps as unknown as AssistantAnnotationProps)}
                node={
                  {
                    ...assistantProps.node,
                    data: {
                      status: replyClosed ? 'closed' : 'running',
                      blocks: [{ kind: 'text', text: replyText }],
                      finalNode: { messageId: 'browser-reply-message' as MessageIdentity, seq: 44 },
                    },
                  } as unknown as AssistantAnnotationProps['node']
                }
              />
            </div>
          </>
        )}
        <div className="browser-spacer" />
      </div>
      <div data-composer-seat>
        <AnnotationDock {...(dockProps as unknown as InputAnnotationProps)} />
        <div className="browser-composer" data-composer-card>
          <BrowserComposer
            text={attached ? COMPOSER_ATTACHMENT_TOKEN + composerText : composerText}
            onText={(text) =>
              setComposerText(
                text.startsWith(COMPOSER_ATTACHMENT_TOKEN)
                  ? text.slice(COMPOSER_ATTACHMENT_TOKEN.length)
                  : text,
              )
            }
            onSubmit={submitComposer}
          />
          <button
            type="button"
            aria-label="Send official task"
            disabled={!attached && composerText.trim() === ''}
            onClick={submitComposer}
          >
            Send
          </button>
        </div>
      </div>
      <div className="browser-controls">
        {reading && (
          <>
            <button
              type="button"
              data-testid="summary-layout"
              aria-pressed={compactSummary}
              onClick={() => setCompactSummary((value) => !value)}
            >
              Toggle compact summary
            </button>
            <button type="button" data-testid="reading-clear" onClick={() => seedReading(0)}>
              Clear notes
            </button>
            <button type="button" data-testid="reading-one" onClick={() => seedReading(1)}>
              One note
            </button>
            <button type="button" data-testid="reading-six" onClick={() => seedReading(6)}>
              Six notes
            </button>
            <button type="button" data-testid="seed-reading-reply" onClick={seedReply}>
              Seed reply
            </button>
            <button type="button" data-testid="reply-finish" onClick={() => setReplyClosed(true)}>
              Finish reply
            </button>
            <button type="button" data-testid="reply-wrap" onClick={() => setReplyWrapped((value) => !value)}>
              Wrap reply label
            </button>
          </>
        )}
        <button type="button" data-testid="seed-same-line" onClick={seedSameLine}>
          Seed same-line markers
        </button>
        <button type="button" data-testid="settle-sent" onClick={settleSent}>
          Settle durable send
        </button>
        <button type="button" data-testid="seed-failed" onClick={seedFailedSubmission}>
          Seed failed submission
        </button>
      </div>
    </main>
  )
}

const scenario = new URLSearchParams(window.location.search).get('scenario')
const mode = scenario === 'reading' || scenario === 'blocked' ? scenario : 'legacy'
createRoot(document.getElementById('root')!).render(<Fixture mode={mode} />)
