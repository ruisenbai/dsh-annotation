import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
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
  --dsw-alias-bg-base: #ffffff;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #f4f6f8;
  --dsw-alias-bg-layer-3: #ffffff;
  --dsw-alias-label-primary: #17212b;
  --dsw-alias-label-primary-foreground: #ffffff;
  --dsw-alias-label-primary-dimmed: #394b5a;
  --dsw-alias-label-secondary: #596b78;
  --dsw-alias-label-tertiary: #758692;
  --dsw-alias-border-l1: #e5e9ed;
  --dsw-alias-border-l2: #ccd4da;
  --dsw-alias-interactive-bg-hover: #edf2f5;
  --dsw-alias-state-success-primary: #138a62;
  --dsw-alias-state-success-secondary: #0a6b4a;
  --dsw-alias-state-success-tertiary: #d8f2e8;
  --dsw-alias-state-warn-primary: #a66a00;
  --dsw-alias-state-warn-tertiary: #fff0c9;
  --dsw-alias-state-error-primary: #d33a3a;
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
    --dsw-alias-border-l1: #313942;
    --dsw-alias-border-l2: #44505b;
    --dsw-alias-interactive-bg-hover: #2c353e;
  }
}
html, body, #root { min-height: 100%; }
body { margin: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 14px/1.55 system-ui, sans-serif; }
.browser-fixture { box-sizing: border-box; width: min(720px, 100%); margin: 0 auto; padding: 16px; }
.browser-scroller { height: 360px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 0 14px; }
.browser-spacer { height: 390px; }
.browser-controls { display: flex; gap: 8px; margin: 12px 0; }
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
    setOverallRequirementDraft: controller.setOverallRequirementDraft.bind(controller),
    submit: async () => undefined,
    withdraw: async () => undefined,
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
      </div>
      <AnnotationDock {...(dockProps as unknown as InputAnnotationProps)} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
