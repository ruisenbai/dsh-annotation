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

const MESSAGE_ID = 'browser-assistant-message' as MessageIdentity
const SESSION_ID = 'browser-session' as SessionIdentity
const TEXT = 'Alpha selected phrase and the rest of this visual line continues until the final word omega.'
const EXACT = 'selected phrase'
function captureFor(exact: string): SelectionCapture {
  const start = TEXT.indexOf(exact)
  if (start < 0) throw new Error(`fixture text is missing ${exact}`)
  return {
    messageId: MESSAGE_ID,
    messageSeq: 42,
    responseVersion: MESSAGE_ID,
    quote: {
      exact,
      prefix: TEXT.slice(Math.max(0, start - 32), start),
      suffix: TEXT.slice(start + exact.length, start + exact.length + 32),
      start,
      end: start + exact.length,
    },
    rect: { top: 0, left: 0, bottom: 0, right: 0 },
  }
}
const CAPTURE = captureFor(EXACT)

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
.browser-composer textarea { min-height: 56px; flex: 1; resize: vertical; border: 0; background: transparent; color: inherit; font: inherit; }
`

function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}
const t = translate as InputAnnotationProps['t']

function Fixture() {
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
  const useWorkspaces = useCallback(
    <Selected,>(selector: (state: { archivedSessionIds: readonly string[] }) => Selected): Selected =>
      selector({ archivedSessionIds: [] }),
    [],
  )
  const seedSameLine = () => {
    controller.clearLocalDrafts()
    const selections = ['Alpha', 'selected', 'phrase', 'and', 'the']
    selections.forEach((exact, index) => {
      controller.beginSelection(captureFor(exact))
      controller.updateEditorText(`Browser marker ${index + 1}`)
      controller.saveEditor()
    })
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
              data: { source: { kind: 'user', inlineAnnotations: entry.payload } },
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
    controller.updateEditorText('Browser retry annotation')
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
    beginSelection: (capture: SelectionCapture) => controller.beginSelection(capture),
    openAnnotation: controller.openAnnotation.bind(controller),
    updateEditorText: controller.updateEditorText.bind(controller),
    confirmLongSelection: controller.confirmLongSelection.bind(controller),
    saveEditor: controller.saveEditor.bind(controller),
    closeEditor: controller.closeEditor.bind(controller),
    deleteDraft: controller.deleteDraft.bind(controller),
    undoDelete: controller.undoDelete.bind(controller),
    dismissDeleteUndo: controller.dismissDeleteUndo.bind(controller),
    exportLocalData: controller.exportLocalData.bind(controller),
    clearLocalDrafts: controller.clearLocalDrafts.bind(controller),
    setPanelOpen: controller.setPanelOpen.bind(controller),
    toggleComposerAttachment: () => {
      setAttached((current) => !current)
      return true
    },
    repairComposerAttachment: () => undefined,
    withdraw: async (submissionId: Parameters<AnnotationController['markWithdrawn']>[0]) => {
      controller.markWithdrawn(submissionId)
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
        blocks: [
          { kind: 'reasoning', text: 'Reasoning stays outside annotation offsets.' },
          { kind: 'text', text: TEXT },
        ],
        finalNode: { messageId: MESSAGE_ID, seq: 42 },
      },
      location: { kind: 'root' },
    },
    useTurnData: () => undefined,
    openFile: () => undefined,
    loadImage: async () => new Blob(),
    fileMentions: () => undefined,
    t,
  }
  const dockProps = {
    ...shared,
    sessionId: SESSION_ID,
    session: { pending: [], running: false },
    input: {
      draft: attached ? COMPOSER_ATTACHMENT_TOKEN + composerText : composerText,
      imageIds: [],
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
    <main className="browser-fixture">
      <style>{fixtureTokens + styles}</style>
      <h1>Inline annotation browser fixture</h1>
      <div className="browser-scroller" data-testid="conversation-scroll">
        <div className="browser-spacer" />
        <AnnotatedAssistantNode {...(assistantProps as unknown as AssistantAnnotationProps)} />
        <div className="browser-spacer" />
      </div>
      <div className="browser-controls">
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
      <AnnotationDock {...(dockProps as unknown as InputAnnotationProps)} />
      <div className="browser-composer" data-composer-card>
        <textarea
          aria-label="Official composer"
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            submitComposer()
          }}
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
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
