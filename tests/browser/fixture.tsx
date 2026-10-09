import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { TestAnnotatedAssistantNode as AnnotatedAssistantNode } from '../assistant-host-fixture.tsx'
import {
  AnnotationComposerChip,
  AnnotationExperience,
  AnnotationRecordToggle,
} from '../../src/client/components/AnnotationExperience.tsx'
import { AnnotatedUserNode } from '../../src/client/components/AnnotatedUserNode.tsx'
import { AnnotationTrashPanel } from '../../src/client/components/AnnotationTrashPanel.tsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AnnotationTrashRow, AnnotationTrashView } from '../../src/client/annotation-trash.ts'
import type { AnnotationEndpoint, AnnotationView } from '../../src/client/controller.ts'
import {
  AnnotationController,
  editorBufferKey,
  retryEntry,
  selectedAnnotations,
} from '../../src/client/controller.ts'
import type {
  AssistantAnnotationProps,
  InputAnnotationProps,
  UserAnnotationProps,
} from '../../src/client/contract.ts'
import { en } from '../../src/client/locales.ts'
import { fileSource } from '../../src/client/official-adapters.ts'
import type { SourceSnapshotView } from '../../src/client/source-snapshots.ts'
import { AnnotationStorage } from '../../src/client/storage.ts'
import { styles } from '../../src/client/styles.ts'
import { DEFAULT_CONFIG } from '../../src/shared/config.ts'
import type {
  AnnotationDeletionId,
  AnnotationDraft,
  AnnotationId,
  MessageIdentity,
  OutboxAttachments,
  SessionIdentity,
} from '../../src/shared/types.ts'
import { COMPOSER_ATTACHMENT_TOKEN } from '../../src/client/composer-attachment.ts'
import type { SelectionCapture } from '../../src/client/selection.ts'
import { BrowserComposer } from './Composer.tsx'

const MESSAGE_ID = 'browser-assistant-message' as MessageIdentity
const SESSION_ID = 'browser-session' as SessionIdentity
const INTERACTION_SESSION_IDS = {
  a: 'browser-interaction-session-a' as SessionIdentity,
  b: 'browser-interaction-session-b' as SessionIdentity,
} as const
const TEXT = 'Alpha selected phrase and the rest of this visual line continues until the final word omega.'
const INTERACTION_ATTACHMENTS = Object.freeze([
  Object.freeze({ type: 'image' as const, mediaType: 'image/png', name: 'evidence.png' }),
  Object.freeze({ type: 'file' as const, mediaType: 'application/pdf', name: 'notes.pdf' }),
])
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
  --dsw-alias-border-l3: var(--dsw-alias-border-l2);
  --dsw-alias-button-primary-fill: var(--dsw-alias-label-primary);
  --dsw-alias-button-primary-hover: var(--dsw-alias-label-secondary);
  --dsw-alias-button-tool-bar-fill: var(--dsw-alias-bg-layer-2);
  --dsw-alias-button-tool-bar-hover: var(--dsw-alias-interactive-bg-hover);
  --dsw-alias-interactive-bg-hover: #edf2f5;
  --dsw-alias-interactive-bg-hover-danger: rgba(236, 19, 19, 0.05);
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
  --dsw-specific-menu: rgba(248, 249, 250, 0.58);
  --dsw-specific-selector: rgb(249, 250, 251);
  --dsw-alias-interactive-bg-hover-solid: rgb(241, 243, 245);
  --dsw-menu-backdrop-filter: blur(40px) saturate(150%);
  --dsw-elevation-panel: 0 0 0 0.5px var(--dsw-alias-border-l1), 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02);
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
    --dsw-alias-label-primary-foreground: #15191e;
    --dsw-alias-label-primary-dimmed: #d2d9df;
    --dsw-alias-label-secondary: #b7c0c8;
    --dsw-alias-label-tertiary: #96a2ad;
    --dsw-alias-label-caption: #7f8b96;
    --dsw-alias-border-l1: #313942;
    --dsw-alias-border-l2: #44505b;
    --dsw-alias-interactive-bg-hover: #2c353e;
    --dsw-alias-interactive-bg-hover-danger: rgba(242, 90, 90, 0.15);
    --dsw-alias-state-error-primary: #f25a5a;
    --dsw-alias-state-business-primary: #5b79ff;
    --dsw-alias-state-business-tertiary: #26345f;
    --dsw-alias-scrollbar-bg-l2: #596570;
    --dsw-alias-scrollbar-hover-l2: #707c86;
    --dsw-specific-menu: rgba(48, 49, 54, 0.5);
    --dsw-specific-selector: rgb(53, 54, 56);
    --dsw-alias-interactive-bg-hover-solid: rgb(53, 54, 56);
  }
}
html, body, #root { min-height: 100%; }
body { margin: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 14px/1.55 system-ui, sans-serif; }
.browser-fixture { box-sizing: border-box; width: min(720px, 100%); margin: 0 auto; padding: 16px; }
.browser-scroller { height: 360px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 0 14px; }
.browser-spacer { height: 390px; }
.browser-controls { display: flex; gap: 8px; margin: 12px 0; }
.browser-composer { position: relative; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.browser-composer-toolbar { display: flex; width: 100%; justify-content: flex-end; align-items: center; gap: 4px; }
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
.browser-fixture--interaction { width: min(960px, 100%); }
.browser-fixture--interaction .browser-scroller { height: 440px; }
.browser-fixture--interaction .browser-controls { flex-wrap: wrap; }
.browser-interaction-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.browser-interaction-head h1 { min-width: min(100%, 260px); flex: 1; margin: 0; }
.browser-interaction-status { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 8px 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.browser-attachments { display: flex; min-width: 0; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.browser-attachment { max-width: 100%; overflow-wrap: anywhere; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 2px 8px; }
.browser-history { min-width: 0; margin: 16px 0; }
.browser-test-output { display: none; }
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
    bindNoticeHost: () => () => undefined,
    beginSelection: (capture: SelectionCapture) => controller.beginSelection(capture),
    chooseOverlap: controller.chooseOverlap.bind(controller),
    dismissOverlap: controller.dismissOverlap.bind(controller),
    suspendEditor: controller.suspendEditor.bind(controller),
    resumeEditor: controller.resumeEditor.bind(controller),
    discardEditorDraft: controller.discardEditorDraft.bind(controller),
    toggleSelected: controller.toggleSelected.bind(controller),
    detachAnnotations: controller.detachAnnotations.bind(controller),
    trashAnnotations: controller.trashAnnotations.bind(controller),
    setProcessingMode: controller.setProcessingMode.bind(controller),
    selectRetry: controller.selectRetry.bind(controller),
    openAnnotation: controller.openAnnotation.bind(controller),
    updateEditorText: controller.updateEditorText.bind(controller),
    confirmLongSelection: controller.confirmLongSelection.bind(controller),
    saveEditor: controller.saveEditor.bind(controller),
    closeEditor: controller.closeEditor.bind(controller),
    deleteDraft: controller.deleteDraft.bind(controller),
    undoDelete: controller.undoDelete.bind(controller),
    dismissDeleteUndo: controller.dismissDeleteUndo.bind(controller),
    setPanelOpen: controller.setPanelOpen.bind(controller),
    setRecordExpanded: controller.setRecordExpanded.bind(controller),
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
        <AnnotationExperience {...(dockProps as unknown as InputAnnotationProps)} />
        <div className="browser-composer" data-composer-card>
          <AnnotationComposerChip {...(dockProps as unknown as InputAnnotationProps)} />
          <div className="browser-composer-toolbar">
            <AnnotationRecordToggle {...(dockProps as unknown as InputAnnotationProps)} />
            <button type="button" aria-label="Fixture model selector">
              Model
            </button>
          </div>
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

type InteractionAttachment = (typeof INTERACTION_ATTACHMENTS)[number]

type InteractionRecord =
  | {
      readonly kind: 'plain'
      readonly plain: string
      readonly attachments: readonly InteractionAttachment[]
    }
  | {
      readonly kind: 'annotation'
      readonly plain: string
      readonly payload: ReturnType<AnnotationController['createOutbox']>['payload']
      readonly attachments?: OutboxAttachments
      readonly fixtureTransport: 'metadata-only'
    }

function interactionAttachmentMetadata(
  attachments: readonly InteractionAttachment[],
): OutboxAttachments | undefined {
  if (attachments.length === 0) return undefined
  const images = attachments.filter((attachment) => attachment.type === 'image')
  return Object.freeze({
    count: attachments.length,
    kinds: Object.freeze(attachments.map((attachment) => attachment.type)),
    mediaTypes: Object.freeze(images.map((attachment) => attachment.mediaType)),
    names: Object.freeze(images.map((attachment) => attachment.name)),
  })
}

function InteractionFixture() {
  const [activeSession, setActiveSession] = useState<keyof typeof INTERACTION_SESSION_IDS>('a')
  return (
    <InteractionSession
      key={activeSession}
      activeSession={activeSession}
      sessionId={INTERACTION_SESSION_IDS[activeSession]}
      setActiveSession={setActiveSession}
    />
  )
}

function InteractionSession({
  activeSession,
  sessionId,
  setActiveSession,
}: {
  activeSession: keyof typeof INTERACTION_SESSION_IDS
  sessionId: SessionIdentity
  setActiveSession: (session: keyof typeof INTERACTION_SESSION_IDS) => void
}) {
  const controller = useMemo(
    () =>
      new AnnotationController(
        sessionId,
        new AnnotationStorage(window.localStorage, sessionId),
        { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
        DEFAULT_CONFIG,
      ),
    [sessionId],
  )
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [composerText, setComposerText] = useState('')
  const [attachments, setAttachments] = useState<readonly InteractionAttachment[]>([])
  const [aggregateAttached, setAggregateAttached] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failNext, setFailNext] = useState(false)
  const [lastRecord, setLastRecord] = useState<InteractionRecord | null>(null)
  const [historyPayload, setHistoryPayload] = useState<
    ReturnType<AnnotationController['createOutbox']>['payload'] | null
  >(null)
  const [historyAttachments, setHistoryAttachments] = useState<readonly InteractionAttachment[]>([])

  useEffect(() => () => controller.dispose(), [controller])

  const useAnnotations = useCallback(
    <Selected,>(selector: (state: AnnotationView) => Selected): Selected => selector(view),
    [view],
  )
  const useCompactSummary = useCallback(
    <Selected,>(selector: (enabled: boolean) => Selected) => selector(true),
    [],
  )
  const useWorkspaces = useCallback(
    <Selected,>(selector: (state: { archivedSessionIds: readonly string[] }) => Selected): Selected =>
      selector({ archivedSessionIds: [] }),
    [],
  )
  const retry = retryEntry(view)
  const selected = selectedAnnotations(view)
  const claimActive =
    retry !== undefined || (selected.length > 0 && (view.selectionMode === 'individual' || aggregateAttached))
  const phase = submitting ? 'submitting' : claimActive ? 'claimed' : 'plain'
  const attachmentCount = attachments.length

  useEffect(() => {
    if (
      view.selectionMode === 'all' &&
      aggregateAttached &&
      retryEntry(view) === undefined &&
      selectedAnnotations(view).length === 0
    ) {
      setAggregateAttached(false)
    }
  }, [aggregateAttached, view])

  const discardEditors = () => {
    controller.closeEditor(true)
    for (const editor of controller.getSnapshot().editorDrafts) {
      controller.discardEditorDraft(editorBufferKey(editor))
    }
    controller.dismissOverlap()
  }
  const clearDraftAnnotations = () => {
    discardEditors()
    for (const annotation of controller.getSnapshot().annotations) {
      if (annotation.status === 'draft') controller.deleteDraft(annotation.annotationId)
    }
    controller.dismissDeleteUndo()
  }
  const saveDirect = (exact: string, note: string): AnnotationId => {
    controller.beginSelection(captureFor(exact))
    controller.updateEditorText(note)
    return controller.saveEditor()
  }
  const seedOneEarly = () => {
    clearDraftAnnotations()
    saveDirect('Alpha', 'Early selected note')
    controller.setPanelOpen(false)
  }
  const seedThree = () => {
    clearDraftAnnotations()
    saveDirect(
      'Alpha',
      'First saved note\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\nSeventh line\nEighth line\nNinth line',
    )
    saveDirect('phrase', 'Middle retained note')
    saveDirect('omega', 'Third saved note')
    controller.setPanelOpen(false)
    setAggregateAttached(false)
    setLastRecord(null)
  }
  const seedOverlap = () => {
    clearDraftAnnotations()
    saveDirect('Alpha selected phrase', 'First overlap note')
    controller.beginSelection(captureFor('selected phrase and'))
    controller.chooseOverlap()
    controller.updateEditorText('Second overlap note')
    controller.saveEditor()
    controller.beginSelection(captureFor('phrase and the'))
  }
  const ensureComposerAttachment = () => {
    const snapshot = controller.getSnapshot()
    if (retryEntry(snapshot) === undefined && selectedAnnotations(snapshot).length === 0) return false
    if (snapshot.selectionMode === 'all') setAggregateAttached(true)
    return true
  }
  const toggleComposerAttachment = () => {
    const snapshot = controller.getSnapshot()
    if (snapshot.selectionMode !== 'all') return false
    if (
      !aggregateAttached &&
      retryEntry(snapshot) === undefined &&
      selectedAnnotations(snapshot).length === 0
    )
      return false
    setAggregateAttached((current) => !current)
    return true
  }
  const saveEditor = () => {
    const wasNew = controller.getSnapshot().editor?.kind === 'new'
    const annotationId = controller.saveEditor()
    if (wasNew && controller.getSnapshot().selectionMode === 'all') setAggregateAttached(true)
    return annotationId
  }
  const selectRetry = (submissionId: Parameters<AnnotationController['selectRetry']>[0]) => {
    setAggregateAttached(false)
    controller.selectRetry(submissionId)
    if (
      controller.getSnapshot().selectionMode === 'all' &&
      retryEntry(controller.getSnapshot()) !== undefined
    )
      setAggregateAttached(true)
  }
  const submitComposer = () => {
    if (submitting) return
    const snapshot = controller.getSnapshot()
    const snapshotRetry = retryEntry(snapshot)
    const snapshotSelected = selectedAnnotations(snapshot)
    const claimed =
      snapshotRetry !== undefined ||
      (snapshotSelected.length > 0 && (snapshot.selectionMode === 'individual' || aggregateAttached))
    if (!claimed) {
      setLastRecord({ kind: 'plain', plain: composerText, attachments })
      return
    }
    const entry = controller.createOutbox(
      'queue',
      sessionId,
      composerText,
      interactionAttachmentMetadata(attachments),
      'en',
      snapshot,
    )
    setLastRecord({
      kind: 'annotation',
      plain: composerText,
      payload: entry.payload,
      ...(entry.attachments === undefined ? {} : { attachments: entry.attachments }),
      fixtureTransport: 'metadata-only',
    })
    controller.markSending(entry.payload.submissionId)
    if (failNext) {
      setFailNext(false)
      controller.markFailed(entry.payload.submissionId, 'fixture transport failure')
      return
    }
    controller.markAccepted(entry.payload.submissionId)
    controller.reconcile({
      chat: {
        nodes: new Map([
          [
            `history:${entry.payload.submissionId}`,
            { kind: 'user', data: { source: { kind: 'user', annotationSubmission: entry.payload } } },
          ],
        ]),
      },
      queue: [],
      hasMore: false,
    } as never)
    setHistoryPayload(entry.payload)
    setHistoryAttachments(attachments)
    setAggregateAttached(false)
    setComposerText('')
    setAttachments([])
  }
  const setSelectionMode = (individual: boolean) => {
    controller.setSelectionMode(individual)
    setAggregateAttached(false)
  }

  const shared = {
    useAnnotations,
    useCompactSummary,
    bindNoticeHost: () => () => undefined,
    beginSelection: controller.beginSelection.bind(controller),
    chooseOverlap: controller.chooseOverlap.bind(controller),
    dismissOverlap: controller.dismissOverlap.bind(controller),
    suspendEditor: controller.suspendEditor.bind(controller),
    resumeEditor: controller.resumeEditor.bind(controller),
    discardEditorDraft: controller.discardEditorDraft.bind(controller),
    toggleSelected: controller.toggleSelected.bind(controller),
    detachAnnotations: controller.detachAnnotations.bind(controller),
    trashAnnotations: controller.trashAnnotations.bind(controller),
    setProcessingMode: controller.setProcessingMode.bind(controller),
    selectRetry,
    openAnnotation: controller.openAnnotation.bind(controller),
    updateEditorText: controller.updateEditorText.bind(controller),
    confirmLongSelection: controller.confirmLongSelection.bind(controller),
    saveEditor,
    closeEditor: controller.closeEditor.bind(controller),
    deleteDraft: controller.deleteDraft.bind(controller),
    undoDelete: controller.undoDelete.bind(controller),
    dismissDeleteUndo: controller.dismissDeleteUndo.bind(controller),
    setPanelOpen: controller.setPanelOpen.bind(controller),
    setRecordExpanded: controller.setRecordExpanded.bind(controller),
    autoAttachEnabled: () => controller.getSnapshot().selectionMode === 'all',
    ensureComposerAttachment,
    toggleComposerAttachment,
    repairComposerAttachment: () => undefined,
    withdraw: async (submissionId: Parameters<AnnotationController['markWithdrawn']>[0]) => {
      controller.markWithdrawn(submissionId)
    },
    discardOutbox: controller.discardOutbox.bind(controller),
    navigate: controller.navigate.bind(controller),
    annotateMessage: controller.annotateMessage.bind(controller),
    registerEndpoint: (messageId: MessageIdentity, endpoint: AnnotationEndpoint) =>
      controller.registerEndpoint(messageId, endpoint),
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
        blocks: [{ kind: 'text', text: TEXT }],
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
    sessionId,
    session: { pending: [], running: submitting },
    input: {
      draft: claimActive ? COMPOSER_ATTACHMENT_TOKEN + composerText : composerText,
      attachmentIds: attachments.map((attachment, index) => `${attachment.type}-${index}`),
      draftRev: 1,
      phase,
      ...(claimActive ? { claim: { token: COMPOSER_ATTACHMENT_TOKEN } } : {}),
      occurrences: [],
      queue: [],
    },
    useWorkspaces,
    t,
  }
  const historyNode =
    historyPayload === null
      ? null
      : {
          data: {
            source: { kind: 'user', annotationSubmission: historyPayload },
            content: historyAttachments.map((attachment, index) =>
              attachment.type === 'image'
                ? {
                    type: 'image',
                    attachment: {
                      attachmentId: `fixture-image-${index}`,
                      name: attachment.name,
                      mediaType: attachment.mediaType,
                    },
                  }
                : {
                    type: 'file',
                    attachment: {
                      attachmentId: `fixture-file-${index}`,
                      name: attachment.name,
                      bytes: 2048,
                    },
                  },
            ),
          },
        }

  return (
    <main
      className="browser-fixture browser-fixture--interaction"
      data-testid="interaction-fixture"
      data-active-session={activeSession}
      data-composer-phase={phase}
      data-selection-mode={view.selectionMode}
      data-selected-count={view.selectedAnnotationIds.length}
      data-attachment-count={attachmentCount}
      data-annotation-count={view.annotations.length}
    >
      <style>{fixtureTokens + styles}</style>
      <div className="browser-interaction-head">
        <h1>Annotation interaction fixture</h1>
        <button type="button" data-testid="session-a" onClick={() => setActiveSession('a')}>
          Session A
        </button>
        <button type="button" data-testid="session-b" onClick={() => setActiveSession('b')}>
          Session B
        </button>
      </div>
      <div className="browser-interaction-status" aria-label="Fixture state">
        <span data-testid="active-session-label">Session {activeSession.toUpperCase()}</span>
        <span data-testid="composer-phase">Composer {phase}</span>
        <span data-testid="attachment-count">Attachments {attachmentCount}</span>
        <span data-testid="selected-count">Selected {view.selectedAnnotationIds.length}</span>
      </div>
      <div className="browser-scroller" data-testid="conversation-scroll">
        <div className="browser-spacer" />
        <div data-testid="interaction-source">
          <AnnotatedAssistantNode {...(assistantProps as unknown as AssistantAnnotationProps)} />
        </div>
        <div className="browser-spacer" />
      </div>
      <div data-composer-seat>
        <AnnotationExperience {...(dockProps as unknown as InputAnnotationProps)} />
        <div className="browser-attachments" data-testid="fixture-attachments">
          {attachments.map((attachment) => (
            <span key={`${attachment.type}:${attachment.name}`} className="browser-attachment">
              {attachment.type}: {attachment.name} ({attachment.mediaType})
            </span>
          ))}
        </div>
        <div className="browser-composer" data-composer-card>
          <AnnotationComposerChip {...(dockProps as unknown as InputAnnotationProps)} />
          <div className="browser-composer-toolbar">
            <AnnotationRecordToggle {...(dockProps as unknown as InputAnnotationProps)} />
            <button type="button" aria-label="Fixture model selector">
              Model
            </button>
          </div>
          <BrowserComposer
            text={claimActive ? COMPOSER_ATTACHMENT_TOKEN + composerText : composerText}
            disabled={submitting}
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
            aria-label="Send fixture message"
            disabled={submitting || (!claimActive && composerText.trim() === '' && attachments.length === 0)}
            onClick={submitComposer}
          >
            Send
          </button>
        </div>
      </div>
      <div className="browser-controls" aria-label="Interaction test controls">
        <button
          type="button"
          data-testid="begin-quick-editor"
          onClick={() => controller.beginSelection(captureFor('Alpha'))}
        >
          Begin quick annotation
        </button>
        <button type="button" data-testid="seed-one-early" onClick={seedOneEarly}>
          Seed one early marker
        </button>
        <button type="button" data-testid="seed-three" onClick={seedThree}>
          Seed three saved annotations
        </button>
        <button type="button" data-testid="seed-overlap" onClick={seedOverlap}>
          Seed two overlapping annotations
        </button>
        <button type="button" data-testid="selection-individual" onClick={() => setSelectionMode(true)}>
          Use individual selection
        </button>
        <button type="button" data-testid="selection-all" onClick={() => setSelectionMode(false)}>
          Use aggregate selection
        </button>
        <button
          type="button"
          data-testid="attachments-load"
          onClick={() => setAttachments(INTERACTION_ATTACHMENTS)}
        >
          Load image and file metadata
        </button>
        <button type="button" data-testid="attachments-clear" onClick={() => setAttachments([])}>
          Clear fixture attachments
        </button>
        <button
          type="button"
          data-testid="fail-next"
          aria-pressed={failNext}
          onClick={() => setFailNext(true)}
        >
          Fail next annotation send
        </button>
        <button type="button" data-testid="submitting-on" onClick={() => setSubmitting(true)}>
          Begin pending send
        </button>
        <button type="button" data-testid="submitting-off" onClick={() => setSubmitting(false)}>
          Finish pending send
        </button>
      </div>
      {historyNode !== null && (
        <section className="browser-history" data-testid="interaction-history">
          <AnnotatedUserNode
            {...({
              ...shared,
              node: historyNode,
              renderMessageImages: ({ images }: { images: readonly unknown[] }) => (
                <span data-testid="history-image">Image attachment ({images.length})</span>
              ),
              openFile: () => undefined,
              openSkill: () => undefined,
              t,
            } as unknown as UserAnnotationProps<'user'>)}
          />
        </section>
      )}
      <pre className="browser-test-output" data-testid="interaction-submit-json">
        {lastRecord === null ? '' : JSON.stringify(lastRecord)}
      </pre>
      <pre className="browser-test-output" data-testid="interaction-view-json">
        {JSON.stringify(view)}
      </pre>
    </main>
  )
}

function trashFixtureRow(index: number): AnnotationTrashRow {
  const sessionId = `browser-trash-session-with-a-long-identifier-${index % 3}` as SessionIdentity
  const path = `/workspace/a/very/long/project/path/that-must-stay-contained/review-source-${index}.txt`
  const quote = `Quoted source text ${index}`
  const annotation: AnnotationDraft = {
    annotationId: `browser-trash-annotation-${index}` as AnnotationId,
    ordinal: index,
    source: fileSource(
      {
        sessionId,
        resourceAddress: `dsh-resource://file/session/${String(sessionId)}/${encodeURIComponent(path)}`,
        path,
        resourceVersion: `browser-trash-version-${index}`,
        format: 'text',
        hash: index.toString(16).padStart(64, '0'),
        bytes: new TextEncoder().encode(quote).byteLength,
        text: quote,
      },
      'sidebar',
      false,
    ),
    quote: {
      exact: quote,
      prefix: 'Context before ',
      suffix: ' context after',
      start: 15,
      end: 15 + quote.length,
    },
    annotation: `Annotation ${index}: ${'Long review text remains readable and does not crowd the actions. '.repeat(3)}`,
    kind: 'note',
    status: 'draft',
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
  }
  return {
    sessionId,
    entry: {
      annotation,
      deletedAt: 1_700_000_000_000 + index,
      deletionId: `browser-trash-deletion-${index}` as AnnotationDeletionId,
      editorDrafts: [],
    },
  }
}

const TRASH_FIXTURE_ROWS = Object.freeze(Array.from({ length: 14 }, (_, index) => trashFixtureRow(index + 1)))
const trashSessions: SessionListState['byId'] = {}
for (let index = 0; index < 3; index += 1) {
  const id = `browser-trash-session-with-a-long-identifier-${index}` as SessionId
  trashSessions[id] = {
    id,
    title: `Review ${index + 1}`,
    displayTitle: `Review ${index + 1}`,
    cwd: `/workspace/project-${index + 1}`,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
  }
}
const trashSessionCatalog: SessionListState = {
  ids: [],
  byId: trashSessions,
  phase: 'ready',
  projectionsBySession: {},
}
const TRASH_SOURCE_TEXT = Array.from(
  { length: 48 },
  (_, index) => `Source line ${index + 1}: retained snapshot content stays reachable in the detail pane.`,
).join('\n')

function TrashFixture() {
  const [rows, setRows] = useState<readonly AnnotationTrashRow[]>(TRASH_FIXTURE_ROWS)
  const view = useMemo<AnnotationTrashView>(() => ({ rows, error: null }), [rows])
  const useAnnotationTrash = useCallback(
    <Selected,>(selector: (state: AnnotationTrashView) => Selected): Selected => selector(view),
    [view],
  )
  const useSourceSnapshots = useCallback(
    <Selected,>(selector: (revision: number) => Selected): Selected => selector(0),
    [],
  )
  const restoreTrashed = useCallback(async (_sessionId: SessionIdentity, ids: readonly AnnotationId[]) => {
    setRows((current) => current.filter((row) => !ids.includes(row.entry.annotation.annotationId)))
    return true
  }, [])
  const purgeTrashed = useCallback(async (selectedRows: readonly AnnotationTrashRow[]) => {
    const removed = new Set(selectedRows.map((row) => row.entry.annotation.annotationId))
    setRows((current) => current.filter((row) => !removed.has(row.entry.annotation.annotationId)))
    return true
  }, [])
  const readSourceSnapshot = useCallback(
    async (): Promise<SourceSnapshotView> => ({
      state: 'complete',
      content: { kind: 'file', mediaType: 'text/plain', text: TRASH_SOURCE_TEXT },
    }),
    [],
  )
  return (
    <main className="browser-fixture browser-fixture--trash" data-testid="trash-fixture">
      <style>{fixtureTokens + styles}</style>
      <h1>Recycle-bin visual fixture</h1>
      <AnnotationTrashPanel
        useSessionCatalog={(selector) => selector(trashSessionCatalog)}
        useAnnotationTrash={useAnnotationTrash}
        useSourceSnapshots={useSourceSnapshots}
        refreshTrash={() => undefined}
        restoreTrashed={restoreTrashed}
        purgeTrashed={purgeTrashed}
        readSourceSnapshot={readSourceSnapshot}
        t={t}
      />
    </main>
  )
}

const parameters = new URLSearchParams(window.location.search)
const scenario = parameters.get('scenario')
if (scenario === 'interaction' && parameters.get('reset') === '1') {
  for (const sessionId of Object.values(INTERACTION_SESSION_IDS)) {
    new AnnotationStorage(window.localStorage, sessionId).clear()
  }
  parameters.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}`)
}
const mode = scenario === 'reading' || scenario === 'blocked' ? scenario : 'legacy'
createRoot(document.getElementById('root')!).render(
  scenario === 'interaction' ? (
    <InteractionFixture />
  ) : scenario === 'trash' ? (
    <TrashFixture />
  ) : (
    <Fixture mode={mode} />
  ),
)
